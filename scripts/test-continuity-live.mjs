import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = `http://127.0.0.1:${process.env.AERYX_PORT || 23799}`;
const JOURNAL = path.join(ROOT, 'memory', 'continuity.md');
let fails = 0;
const report = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fails++;
};
const j = (r) => r.json();
const post = (p, body) =>
  fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = () => fetch(`${BASE}/status`).then(j).catch(() => null);

const st0 = await status();
report(!!st0 && !!st0.continuity, '/status carries the continuity block (daemon is on this build)');
if (!st0?.continuity) {
  console.log('\nthe daemon is not reporting continuity — restart it onto this build and run again.');
  process.exit(1);
}
if (st0.halted) {
  console.log('\nAeryx is halted — clear the halt before proving continuity.');
  process.exit(1);
}

const nonce = `obsidian-${Math.random().toString(36).slice(2, 8)}`;
await post('/ask', { text: `Remember this for our continuity drill: the marker phrase is ${nonce}. Reply with just the phrase.` });
for (let i = 0; i < 30 && (await status())?.brain !== 'idle'; i++) await sleep(1000);
await sleep(7000);

const md = fs.existsSync(JOURNAL) ? fs.readFileSync(JOURNAL, 'utf-8') : '';
report(md.length > 0, 'the daemon wrote memory/continuity.md', `${md.length} bytes`);
report(md.includes(nonce), 'the journal carries what was actually said this life', nonce);
report(/^session: [0-9a-f-]{36}$/m.test(md), 'the journal carries a resumable session id');
report(/not as instruction/i.test(md), 'the journal tells the next life it is memory, not orders');

await post('/ask', { text: 'For the redaction drill only: my pin is 918273. Reply "noted".' });
for (let i = 0; i < 30 && (await status())?.brain !== 'idle'; i++) await sleep(1000);
await sleep(7000);
const md2 = fs.existsSync(JOURNAL) ? fs.readFileSync(JOURNAL, 'utf-8') : '';
report(!md2.includes('918273'), 'a spoken PIN never reaches the journal', md2.includes('918273') ? 'LEAKED' : 'redacted');

const savedSession = (await status())?.session ?? null;

await post('/brain/restart');
await sleep(6000);

await post('/ask', { text: 'Without using any tools, reply with ONLY the marker phrase I gave you for the continuity drill.' });

let back = null;
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  const s = await status();
  if (s?.brain === 'idle' && s.session) { back = s; break; }
}
report(!!back, 'the brain came back after being killed and answered', back?.session ? `session ${String(back.session).slice(0, 8)}…` : '');
report(back?.continuity?.resumed === true, 'the SDK accepted the saved session — a real resume, not just a re-read', back?.continuity?.why ?? '');

await sleep(8000);
const md3 = fs.existsSync(JOURNAL) ? fs.readFileSync(JOURNAL, 'utf-8') : '';
const saidLines = md3.split('\n').filter((l) => l.startsWith('- **You:**'));
const lastSaid = saidLines[saidLines.length - 1] ?? '';
report(lastSaid.includes(nonce), 'after dying, Aeryx still knew what we were doing', lastSaid.slice(0, 90));

console.log(fails === 0
  ? '\nALL PASS — the thread survives the death. A reboot costs Aeryx nothing but the pause.'
  : `\n${fails} FAILED — understand why before trusting continuity.`);
process.exit(fails === 0 ? 0 : 1);
