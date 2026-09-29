import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 23879;
const TOKEN = randomBytes(32).toString('hex');
const DESK = `http://127.0.0.1:${PORT}/desk`;
const SHOT = path.join(os.tmpdir(), `desk-live-${Date.now()}.png`);

let pass = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const post = async (verb, body) => {
  const res = await fetch(`${DESK}/${verb}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const agent = spawn(process.execPath, [path.join(ROOT, 'dist', 'session-agent.mjs')], {
  cwd: ROOT,
  env: { ...process.env, AERYX_DESK_PORT: String(PORT), AERYX_DESK_CALLBACK_TOKEN: TOKEN },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let agentOut = '';
agent.stdout.on('data', (d) => { agentOut += d; });
agent.stderr.on('data', (d) => { agentOut += d; });

async function waitForDesk(ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await post('talon', {});
      if (r.status === 403) return true;
    } catch { }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  check('the desk comes up and listens', await waitForDesk(), agentOut.slice(-200));

  const forged = await post('talon', { token: 'x'.repeat(64), capability: 'talon', args: ['cursor'] });
  check('a forged core token is refused', forged.status === 403, `got ${forged.status}`);

  const noCap = await post('talon', { token: TOKEN, capability: 'brain', args: ['cursor'] });
  check('a core-only capability cannot be asked of the desk', noCap.status === 400, `got ${noCap.status}`);

  const badArgv = await post('talon', { token: TOKEN, capability: 'talon', args: ['click', '--evil', '1'] });
  check('an argv this program could not emit is refused', badArgv.status === 400, `got ${badArgv.status}`);

  const stray = await post('talon', { token: TOKEN, capability: 'talon', args: ['click', '--x', '1', 'extra'] });
  check('a stray positional value is refused', stray.status === 400, `got ${stray.status}`);

  const cursor = await post('talon', { token: TOKEN, capability: 'talon', args: ['cursor'] });
  check('the desk really runs talon.exe in the interactive session',
    cursor.status === 200 && cursor.data.code === 0 && /\d/.test(String(cursor.data.out ?? '')),
    JSON.stringify(cursor.data).slice(0, 160));

  const cap = await post('talon', { token: TOKEN, capability: 'talon', args: ['capture', '--out', SHOT] });
  const wrote = cap.status === 200 && cap.data.code === 0 && fs.existsSync(SHOT) && fs.statSync(SHOT).size > 10_000;
  check('a real screen capture lands on disk', wrote,
    `${JSON.stringify(cap.data).slice(0, 120)} size=${fs.existsSync(SHOT) ? fs.statSync(SHOT).size : 'absent'}`);
} finally {
  agent.kill();
  try { fs.unlinkSync(SHOT); } catch { }
}

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.error(`  FAILED: ${f}`);
process.exit(failures.length ? 1 : 0);
