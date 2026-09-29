import http from 'node:http';

const BASE = `http://127.0.0.1:${process.env.AERYX_PORT || 23799}`;
const SIM_PORT = Number(process.env.SIM_PORT || 23802);
let fails = 0;
const report = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const get = (p) => fetch(`${BASE}${p}`).then((r) => r.json());
async function ask(text) {
  for (let t = 0; t < 60; t++) {
    if ((await post('/ask', { text })).status === 202) return true;
    await sleep(1000);
  }
  return false;
}

const sim = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { }
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{}');
    }
    const user = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
    const blocks = Array.isArray(user?.content) ? user.content : [{ type: 'text', text: String(user?.content ?? '') }];
    const newest = [...blocks].reverse().find((b) => b.type === 'tool_result' || (b.type === 'text' && !String(b.text).startsWith('<system-reminder>')));
    const wantsTool = newest?.type === 'text' && String(newest.text).includes('FETCHTEST');
    const message = { id: 'm', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
    ev('message_start', { message });
    if (wantsTool) {
      ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_sim1', name: 'WebFetch', input: {} } });
      ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ url: 'https://example.com/', prompt: 'summarise' }) } });
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 30 } });
    } else {
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'LOCALSIM reply' } });
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } });
    }
    ev('message_stop', {});
    res.end();
  });
});
await new Promise((r) => sim.listen(SIM_PORT, '127.0.0.1', r));

const events = [];
const ctl = new AbortController();
(async () => {
  try {
    const r = await fetch(`${BASE}/events`, { signal: ctl.signal });
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
        buf = buf.slice(i + 2);
        if (line) try { events.push(JSON.parse(line.slice(6))); } catch { }
      }
    }
  } catch { }
})();
const waitFor = async (pred, ms = 60_000) => {
  for (let t = 0; t < ms; t += 500) {
    const hit = events.find(pred);
    if (hit) return hit;
    await sleep(500);
  }
  return null;
};

const st0 = await get('/status').catch(() => null);
if (!st0) { console.log('the daemon is not answering'); process.exit(1); }

const quick = await fetch(`${BASE}/quick`);
const quickHtml = await quick.text();
report(quick.ok && quickHtml.includes("fetch('/ask'") && /content-security-policy/i.test([...quick.headers.keys()].join(' ')), 'the daemon serves /quick under the page CSP');

await post('/privacy/local-only', { on: false });
const set = await post('/setup/provider', { kind: 'local', baseUrl: `http://127.0.0.1:${SIM_PORT}`, model: 'sim' }).then((r) => r.json());
report(set.ok === true, 'a local provider connects', JSON.stringify(set.provider ?? set.error));
await sleep(2500);

const m0 = await get('/usage');
const turns0 = m0.today?.turns ?? 0;
events.length = 0;
const nonce = Math.random().toString(36).slice(2, 8);
report(await ask(`Usage drill ${nonce}: say anything.`), 'the ask is accepted');
report(!!(await waitFor((e) => e.type === 'say' && String(e.text).includes('LOCALSIM'))), 'the brain answers through the local model');
await sleep(800);
const m1 = await get('/usage');
report((m1.today?.turns ?? 0) > turns0, 'the turn is counted in today\'s usage', `${turns0} → ${m1.today?.turns}`);
report((m1.today?.inputTokens ?? 0) > 0 && (m1.today?.outputTokens ?? 0) > 0, 'tokens are recorded', `${m1.today?.inputTokens} in / ${m1.today?.outputTokens} out`);
report(m1.basis === 'free', 'a local model is labelled free', m1.basis);

const on = await post('/privacy/local-only', { on: true }).then((r) => r.json());
report(on.ok === true && on.localOnly === true, 'local-only switches on');
const st1 = await get('/status');
report(st1.localOnly === true, '/status reports local-only');
const cloud = await post('/setup/provider', { kind: 'openrouter', secret: 'sk-or-v1-simulated-key-not-real' });
report(cloud.status === 400, 'a cloud provider is refused while local-only is on', `HTTP ${cloud.status}`);
await sleep(3000);
events.length = 0;
report(await ask(`FETCHTEST ${nonce}: fetch https://example.com/ for me.`), 'the fetch ask is accepted');
const blocked = await waitFor((e) => e.type === 'blocked');
report(!!blocked && /local-only/i.test(String(blocked.reason)), 'the Chain denies the web fetch under local-only', blocked ? `${blocked.tool}: ${String(blocked.reason).slice(0, 60)}` : 'no blocked event');
report(!!(await waitFor((e) => e.type === 'say')), 'the brain still replies after the refusal');
const audit = await get('/audit?limit=100');
report(audit.rows.some((r) => String(r.tool) === 'WebFetch' && /den(y|ied)|block/i.test(String(r.verdict))), 'the refusal is in the audit chain');

const off = await post('/privacy/local-only', { on: false }).then((r) => r.json());
report(off.ok === true && (await get('/status')).localOnly === false, 'local-only switches off again');
report((await get('/audit?limit=1')).chainIntact === true, 'the audit chain is intact');

ctl.abort();
sim.close();
console.log(`\n${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
