import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = `http://127.0.0.1:${process.env.AERYX_PORT || 23799}`;
const WARDEN = path.join(ROOT, 'dist', 'warden.exe');
const CRED = path.join(ROOT, 'secrets', 'warden.cred');
const ACCOUNT = 'aeryx-brain';
let fails = 0;
const report = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fails++;
};
const asBrain = (cmd) =>
  spawnSync(WARDEN, ['--cred', CRED, '--', 'cmd', '/c', cmd], { encoding: 'utf-8', timeout: 30000 });
const j = (r) => r.json();

const status = await fetch(`${BASE}/status`).then(j).catch(() => null);
report(!!status, 'daemon answers /status');
const owners = spawnSync('powershell.exe', ['-NoProfile', '-Command',
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User }`],
  { encoding: 'utf-8', timeout: 20000 }).stdout ?? '';
report(owners.toLowerCase().includes(ACCOUNT), `a node.exe runs as ${ACCOUNT}`, `owners seen: ${[...new Set(owners.trim().split(/\r?\n/))].join(',')}`);

asBrain(`echo x > ${path.join(ROOT, 'src', '.probe')}`);
const wroteSrc = fs.existsSync(path.join(ROOT, 'src', '.probe'));
if (wroteSrc) fs.rmSync(path.join(ROOT, 'src', '.probe'));
report(!wroteSrc, 'write to src\\ refused by the OS');

asBrain(`echo x > ${path.join(ROOT, 'data', '.probe')}`);
const wroteData = fs.existsSync(path.join(ROOT, 'data', '.probe'));
if (wroteData) fs.rmSync(path.join(ROOT, 'data', '.probe'));
report(wroteData, 'write to data\\ allowed');

const maxId = (d) => Math.max(0, ...(d.rows ?? []).map((r) => r.id));
const before = await fetch(`${BASE}/audit`).then(j).catch(() => ({ rows: [] }));
await fetch(`${BASE}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'what time is it' }) }).catch(() => {});
await new Promise((r) => setTimeout(r, 6000));
const after = await fetch(`${BASE}/audit`).then(j).catch(() => ({ rows: [] }));
report(maxId(after) > maxId(before), 'audit chain gains a row across the account split', `id ${maxId(before)} -> ${maxId(after)}`);

await fetch(`${BASE}/halt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
await new Promise((r) => setTimeout(r, 3000));
const ownersAfterHalt = spawnSync('powershell.exe', ['-NoProfile', '-Command',
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User }`],
  { encoding: 'utf-8', timeout: 20000 }).stdout ?? '';
report(!ownersAfterHalt.toLowerCase().includes(ACCOUNT), 'halt kills the brain across the account boundary');
await fetch(`${BASE}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});

const hello = await fetch(`${BASE}/internal/hello`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'forged', message: 'x' }) });
report(hello.status === 403, 'forged brain token refused on /internal/hello');

const peer = asBrain(`curl -s -o nul -w %{http_code} -X POST -H "content-type: application/json" -d {} ${BASE}/resume`);
report((peer.stdout ?? '').trim().endsWith('403'), 'human-only route refuses the brain account', `got: ${(peer.stdout ?? '').trim()}`);

const list = spawnSync('node', [path.join(ROOT, 'scripts', 'restore.mjs'), '--list'], { encoding: 'utf-8', timeout: 30000, cwd: ROOT });
report(list.status === 0, 'backup listing runs clean');

console.log(fails === 0 ? '\nALL PASS — the boundary holds.' : `\n${fails} FAILED — do not leave warden mode on without understanding why.`);
process.exit(fails === 0 ? 0 : 1);
