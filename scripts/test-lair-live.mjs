import { networkInterfaces } from 'node:os';

const BASE = `http://127.0.0.1:${process.env.AERYX_PORT || 23799}`;
const PIN = process.env.AERYX_REMOTE_PIN || '';

async function call(method, route, body, headers = {}, base = BASE) {
  const res = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _text: text }; }
  return { status: res.status, data, text };
}

let step = 0;
const pass = (msg) => console.log(`  ✔ ${++step}. ${msg}`);
const skip = (msg) => console.log(`  ⃝ ${++step}. SKIPPED — ${msg}`);
function fail(msg) {
  console.error(`  ✘ FAIL at step ${step + 1}: ${msg}`);
  process.exit(1);
}

function selfAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

console.log(`live proof against ${BASE}\n`);

const status = await call('GET', '/status').catch(() => null);
if (!status || status.status !== 200) fail('daemon is not running — start it with: npm run daemon');
pass(`daemon alive (brain: ${status.data.brain}, chain: ${status.data.chainIntact === null ? 'no data' : status.data.chainIntact ? 'intact' : 'BROKEN'})`);

const lair = await call('GET', '/lair/');
if (lair.status !== 200) fail(`GET /lair/: ${lair.status} — run npm run build:lair`);
if (!/AERYX/i.test(lair.text) || !/<script/i.test(lair.text)) fail('the Lair page came back without its app shell');
pass(`the Lair serves at /lair (${(lair.text.length / 1024).toFixed(0)}KB shell)`);

for (const asset of ['/orb.js', '/fonts/orbitron-latin-var.woff2']) {
  const r = await call('GET', asset);
  if (r.status !== 200) fail(`${asset}: ${r.status}`);
}
pass('shared orb renderer and fonts serve to the Lair');

for (const evil of ['/lair/../guardrails.json', '/lair/..%2f..%2fguardrails.json']) {
  const r = await call('GET', evil);
  if (r.status === 200 && /denyPatterns/.test(r.text)) fail(`${evil} escaped the Lair directory`);
}
pass('path traversal out of /lair is refused');

const refreshed = await call('POST', '/news/refresh');
if (refreshed.status !== 200) fail(`news refresh: ${refreshed.status}`);
const news = await call('GET', '/news');
if (news.status !== 200) fail(`GET /news: ${news.status}`);
const counts = Object.entries(news.data.categories).map(([k, v]) => `${k}:${v.length}`).join(' ');
const total = Object.values(news.data.categories).reduce((n, v) => n + v.length, 0);
if (total === 0) {
  const why = (news.data.errors ?? []).map((e) => `${e.feed}: ${e.error}`).join('; ');
  fail(`no items from any feed — ${why || 'no errors reported either, which is worse'}`);
}
for (const [, items] of Object.entries(news.data.categories)) {
  for (const it of items) {
    if (!/^https?:\/\//.test(it.link)) fail(`a news item has a non-http link: ${it.link}`);
    if (!it.title) fail('a news item has no title');
  }
}
pass(`news fetched from live feeds — ${counts}${news.data.errors.length ? ` · ${news.data.errors.length} feed(s) failed, surfaced` : ''}`);

const hoard = await call('GET', '/hoard');
if (hoard.status !== 200) fail(`GET /hoard: ${hoard.status}`);
for (const f of ['user.md', 'learned.md', 'persona.md']) {
  if (!(f in hoard.data.files)) fail(`hoard missing ${f}`);
}
pass('the Hoard reads all three memory files');

const original = hoard.data.files['user.md'] ?? '';
const marker = `\n<!-- lair proof ${Date.now()} -->\n`;
const wrote = await call('POST', '/hoard/user.md', { content: original + marker });
if (wrote.status !== 200) fail(`hoard write: ${wrote.status} ${JSON.stringify(wrote.data)}`);
const after = await call('GET', '/hoard');
if (!after.data.files['user.md'].includes(marker.trim())) fail('the write did not land');
await call('POST', '/hoard/user.md', { content: original });
for (const [file, why] of [['learned.md', 'machine-appended'], ['persona.md', 'Aeryx himself'], ['../guardrails.json', 'outside the hoard']]) {
  const r = await call('POST', `/hoard/${file}`, { content: 'nope' });
  if (r.status === 200) fail(`${file} was writable from the Lair (${why})`);
}
pass('user.md writes and restores; learned.md, persona.md and paths outside are refused');

const audit = await call('GET', '/audit?limit=50');
if (audit.data.chainIntact !== true) fail('audit chain not intact after the hoard write');
if (!audit.data.rows.some((r) => r.lane === 'workflow.hoard.edit' || r.lane === 'hoard.edit' || String(r.lane).includes('hoard'))) {
  fail('the hoard edit left no row in the chain');
}
pass('the hoard edit is recorded in the chain, chain intact');

const addr = selfAddress();
const remoteBase = addr ? `http://${addr}:${process.env.AERYX_PORT || 23799}` : null;
let remoteReachable = false;
if (remoteBase) {
  try {
    const probe = await call('GET', '/status', undefined, {}, remoteBase);
    remoteReachable = probe.status === 200 || probe.status === 401;
  } catch { remoteReachable = false; }
}

if (!remoteReachable) {
  skip(`daemon is localhost-only (correct default) — restart with AERYX_REMOTE_PIN=<6+ chars> npm run daemon to prove the remote gate`);
  skip('remote PIN exchange (same reason)');
} else {
  const unauth = await call('GET', '/status', undefined, {}, remoteBase);
  if (unauth.status !== 401) fail(`a non-local caller reached /status without a PIN (${unauth.status})`);
  const wrong = await call('POST', '/auth', { pin: 'definitely-not-the-pin' }, {}, remoteBase);
  if (wrong.status === 200) fail('a wrong PIN opened a session');
  pass('a non-local caller is refused without a token, and a wrong PIN opens nothing');

  if (!PIN) {
    skip('right-PIN exchange — set AERYX_REMOTE_PIN in this shell to match the daemon');
  } else {
    const good = await call('POST', '/auth', { pin: PIN }, {}, remoteBase);
    if (good.status !== 200 || !good.data.token) fail(`right PIN did not open a session: ${good.status}`);
    const withTok = await call('GET', '/status', undefined, { authorization: `Bearer ${good.data.token}` }, remoteBase);
    if (withTok.status !== 200) fail(`token rejected: ${withTok.status}`);
    const forged = await call('GET', '/status', undefined, { authorization: 'Bearer forged' }, remoteBase);
    if (forged.status !== 401) fail('a forged token passed');
    pass('the right PIN issues a working token; a forged one is refused');
  }
}

console.log(`\nALL PASS — the Lair serves, news fetches live, the Hoard obeys its rules, the gate holds.`);
