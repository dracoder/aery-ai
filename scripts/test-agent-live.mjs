const BASE = `http://127.0.0.1:${process.env.AERYX_PORT || 23799}`;
const MARKER = 'PERMANENT AGENT ONLINE';
const SLUG = 'proof-echo-' + Date.now().toString(36);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, route, body) {
  const res = await fetch(BASE + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let step = 0;
const pass = (msg) => console.log(`  ✔ ${++step}. ${msg}`);
function fail(msg) {
  console.error(`  ✘ FAIL at step ${step + 1}: ${msg}`);
  process.exit(1);
}

async function waitForSay(match, timeoutMs) {
  const res = await fetch(BASE + '/events');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const r = await Promise.race([
        reader.read(),
        sleep(Math.max(0, deadline - Date.now())).then(() => ({ done: true, timedOut: true })),
      ]);
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const m = JSON.parse(line.slice(6));
          if (m.type === 'say' && match(m)) return m;
        } catch { }
      }
    }
  } finally {
    try { reader.cancel(); } catch { }
  }
  return null;
}

console.log(`live proof against ${BASE} (agent "${SLUG}")\n`);

const status = await call('GET', '/status').catch(() => null);
if (!status || status.status !== 200) fail('daemon is not running — start it with: npm run daemon');
pass(`daemon alive (brain: ${status.data.brain})`);

const proposed = await call('POST', '/agents', {
  slug: SLUG,
  description: 'proof agent for the agent gate — invoked once, then retired',
  prompt: `You are a proof agent. Whatever you are asked, reply with exactly these words and nothing else: ${MARKER}`,
  status: 'proposed',
  source: 'ui',
});
if (proposed.status !== 201) fail(`propose: ${proposed.status} ${JSON.stringify(proposed.data)}`);
const agent = proposed.data.agent;
if (agent.status !== 'proposed') fail(`not proposed: ${JSON.stringify(agent)}`);
pass(`proposed #${agent.id} "${agent.slug}"`);

const rosterBefore = await call('GET', '/agents');
const mine = rosterBefore.data.agents.find((a) => a.id === agent.id);
if (!mine || mine.status !== 'proposed') fail('proposal missing or mis-stated on the roster surface');
pass('proposal visible, status proposed — not on the boot roster');

const approved = await call('POST', `/agents/${agent.id}/approve`);
if (approved.status !== 200 || approved.data.agent.status !== 'active') fail(`approve: ${JSON.stringify(approved)}`);
pass('approved — active');

const restarted = await call('POST', '/brain/restart');
if (restarted.status !== 200) fail(`brain restart: ${restarted.status}`);
await sleep(6000);
pass('brain restarted — roster re-read');

const sayPromise = waitForSay((m) => String(m.text ?? '').toUpperCase().includes('AGENT ONLINE'), 300_000);
const asked = await call('POST', '/ask', {
  text: `Use the ${SLUG} subagent (it is on your permanent roster) with any short input, and relay its reply verbatim. Do not answer from memory — actually invoke it.`,
});
if (asked.status !== 202) fail(`ask: ${asked.status} ${JSON.stringify(asked.data)}`);
console.log('    …asked; waiting for the brain to invoke the subagent (cold start can take a minute)');
const say = await sayPromise;
if (!say) fail('no reply containing the marker within 5 minutes');
pass(`brain relayed the subagent's marker: "${String(say.text).slice(0, 60)}"`);

const audit = await call('GET', '/audit?limit=200');
if (audit.data.chainIntact !== true) fail('audit chain not intact');
const rows = audit.data.rows;
const spawn = rows.some((r) => r.tool === 'wyrmling' && Date.parse(r.ts) > Date.now() - 10 * 60_000);
if (!spawn) fail('no wyrmling spawn row in the chain — the roster agent was not actually invoked');
for (const verdict of ['proposed', 'approved']) {
  if (!rows.some((r) => r.tool === 'agent' && String(r.detail).includes(`"${SLUG}"`) && r.verdict === verdict)) {
    fail(`no '${verdict}' agent row in the chain`);
  }
}
pass('chain intact — agent proposed/approved rows + a live subagent spawn row');

const retired = await call('POST', `/agents/${agent.id}/retire`);
if (retired.status !== 200 || retired.data.agent.status !== 'retired') fail(`retire: ${JSON.stringify(retired)}`);
const after = await call('GET', '/agents');
const still = after.data.agents.find((a) => a.id === agent.id);
if (!still) fail('retired agent vanished from the surface — history must stay visible');
if (still.status !== 'retired') fail(`status after retire: ${still.status}`);
pass('retired — off the boot roster, still on the books');

console.log(`\nALL PASS — agent proposed → approved → loaded → invoked → retired, chain intact.`);
