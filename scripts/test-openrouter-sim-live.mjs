import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const BASE = `http://127.0.0.1:${process.env.AERYX_PORT || 23799}`;
const SIM_PORT = Number(process.env.SIM_PORT || 23801);
const ROOT = process.env.AERYX_ROOT;
const MARK = `SIM-${randomUUID().slice(0, 8)}`;
const KEY = `sk-or-v1-sim-${randomUUID()}`;
let fails = 0;
const report = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body) =>
  fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const status = () => fetch(`${BASE}/status`).then((r) => r.json()).catch(() => null);

if (!ROOT || !fs.existsSync(path.join(ROOT, 'package.json'))) {
  console.log('set AERYX_ROOT to the install\'s app folder (the one holding aeryx.config.json)');
  process.exit(1);
}

const seen = [];
const sim = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { }
    seen.push({ path: req.url, headers: req.headers, body });
    if (req.method === 'POST' && req.url.startsWith('/v1/messages/count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ input_tokens: 10 }));
    }
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'not simulated' } }));
    }
    const text = `${MARK} from ${body.model}`;
    const message = { id: 'msg_sim', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } };
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...message, content: [{ type: 'text', text }], stop_reason: 'end_turn' }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message });
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    ev('message_stop', {});
    res.end();
  });
});
await new Promise((r) => sim.listen(SIM_PORT, '127.0.0.1', r));

const says = [];
const events = new AbortController();
(async () => {
  try {
    const r = await fetch(`${BASE}/events`, { signal: events.signal });
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = block.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try { const e = JSON.parse(line.slice(6)); if (e.type === 'say') says.push(e); } catch { }
      }
    }
  } catch { }
})();

const st0 = await status();
if (!st0) {
  console.log('the daemon is not answering — start it with AERYX_OPENROUTER_URL set to the simulator');
  process.exit(1);
}

async function waitReady(ms = 30_000) {
  for (let t = 0; t < ms; t += 1000) {
    const s = await status();
    if (s && !s.setupNeeded && s.brain !== 'needs-setup') return true;
    await sleep(1000);
  }
  return false;
}

async function askThrough(kind, model) {
  const before = seen.length;
  const r = await post('/ask', { text: `Provider drill for ${kind}: reply in one short sentence.` });
  report(r.status === 202, `${kind}: /ask is queued`, `HTTP ${r.status}`);
  let reply = null;
  for (let t = 0; t < 90 && !reply; t++) {
    reply = says.find((s) => typeof s.text === 'string' && s.text.includes(MARK) && s.text.includes(model));
    if (!reply) await sleep(1000);
  }
  report(!!reply, `${kind}: the brain's answer came from the simulator`, reply ? `"${reply.text.slice(0, 60)}"` : 'no say event');
  const brainCalls = seen.slice(before).filter((s) => s.path.startsWith('/v1/messages') && !s.path.includes('count_tokens'));
  report(brainCalls.length > 0, `${kind}: the Agent SDK sent Messages requests to the provider URL`, `${brainCalls.length} call(s)`);
  report(brainCalls.every((c) => c.headers.authorization === `Bearer ${KEY}`), `${kind}: every call carries the stored key as a Bearer token`);
  report(brainCalls.some((c) => c.body.model === model), `${kind}: the configured model is requested`, model);
  report(brainCalls.every((c) => !c.headers['x-api-key'] && !JSON.stringify(c.headers).includes('sk-ant-')), `${kind}: no Anthropic credential reaches the provider`);
  report(brainCalls.some((c) => Array.isArray(c.body.tools) && c.body.tools.length > 0), `${kind}: the brain offers its tools (still behind the Chain)`);
}

const bad = await post('/setup/test', { kind: 'openrouter', secret: 'notanopenrouterkey' });
report(bad.status === 400, 'a non-OpenRouter key is refused before any call', `HTTP ${bad.status}`);

let before = seen.length;
const t1 = await post('/setup/test', { kind: 'openrouter', secret: KEY }).then((r) => r.json());
const probe = seen.slice(before).find((s) => s.path.startsWith('/v1/messages'));
report(t1.ok === true, 'setup test: the simulated OpenRouter answered', t1.detail);
report(probe?.headers.authorization === `Bearer ${KEY}` && !probe?.headers['x-api-key'], 'setup test sends the key as Bearer, no x-api-key');
report(probe?.body.model === 'anthropic/claude-sonnet-5', 'setup test asks for the default OpenRouter model', probe?.body.model);

const set1 = await post('/setup/provider', { kind: 'openrouter', secret: KEY }).then((r) => r.json());
report(set1.ok === true, 'OpenRouter connected', JSON.stringify(set1.provider ?? set1.error));
const cfgText = fs.readFileSync(path.join(ROOT, 'aeryx.config.json'), 'utf-8');
report(!cfgText.includes(KEY), 'the key is not in aeryx.config.json');
const state = await fetch(`${BASE}/setup/state`).then((r) => r.json());
report(state.providers.find((p) => p.kind === 'openrouter')?.keyStored === true, 'the key is held by the OS credential store');
report(await waitReady(), 'setup is cleared and the brain starts on OpenRouter');
await askThrough('openrouter', 'anthropic/claude-sonnet-5');

const set2 = await post('/setup/provider', { kind: 'codex' }).then((r) => r.json());
report(set2.ok === true, 'Codex connected with no key typed', JSON.stringify(set2.provider ?? set2.error));
await sleep(1500);
report(await waitReady(), 'the brain restarts on Codex');
await askThrough('codex', 'openai/gpt-5.3-codex');

const audit = await fetch(`${BASE}/audit?limit=500`).then((r) => r.json());
report(audit.chainIntact === true, 'the audit chain is intact');
report(audit.rows.some((r) => String(r.detail ?? '').includes('openrouter')), 'the provider change is audited');
report(!JSON.stringify(audit.rows).includes(KEY), 'the key never appears in the audit');
const logFile = path.join(ROOT, 'data', 'aeryxd.log');
report(fs.existsSync(logFile) && !fs.readFileSync(logFile, 'utf-8').includes(KEY), 'the key never appears in the daemon log');

events.abort();
sim.close();
console.log(`\n${fails ? `${fails} FAILED` : 'all passed'} — simulator saw ${seen.length} request(s): ${[...new Set(seen.map((s) => s.path.split('?')[0]))].join(', ')}`);
process.exit(fails ? 1 : 0);
