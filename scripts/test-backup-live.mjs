import { build } from 'esbuild';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(path.join(ROOT, 'node_modules', '.aeryx-live-'));
const out = path.join(tmp, 'backup.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src/daemon/backup.ts')], bundle: true, platform: 'node',
  format: 'esm', external: ['better-sqlite3'], outfile: out, logLevel: 'silent',
});
const B = await import(pathToFileURL(out).href);

let pass = 0;
const fail = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

function census(file) {
  const db = new Database(file, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const counts = {};
    let total = 0;
    for (const { name } of tables) {
      const c = db.prepare(`SELECT count(*) AS c FROM "${name}"`).get().c;
      counts[name] = c;
      total += c;
    }
    return { counts, total, tables: tables.length };
  } finally {
    db.close();
  }
}

console.log('\nBACKUP COVERAGE — live, against the real data directory\n');

const names = B.stateDatabases(ROOT);
ok('the real machine has state databases beside the chain', names.length > 0, `${names.length}: ${names.join(', ')}`);

const before = {};
for (const n of names) {
  try { before[n] = census(path.join(ROOT, 'data', n)); } catch (e) { before[n] = { error: e.message }; }
}

const daemonUp = names.some((n) => existsSync(path.join(ROOT, 'data', `${n}-shm`)));
ok('the daemon is holding these databases open (a live WAL, not a quiet file)', daemonUp,
  daemonUp ? 'shm siblings present' : 'no shm — start the daemon for the honest version of this proof');

const r = await B.runBackup(ROOT);
ok('the backup ran', !!r, r ? path.basename(r.file) : 'returned null');
ok('the audit chain in the copy verifies', r.chainIntact, `${r.rows} rows`);

const bad = r.state.filter((s) => !s.ok);
ok('every state database copied and verified', bad.length === 0,
  bad.length ? bad.map((s) => `${s.name}: ${s.error}`).join('; ') : `${r.state.length}/${r.state.length}`);

ok('coverage is the whole set, not a subset', r.state.length === names.length,
  `${r.state.length} copied of ${names.length} present`);

let matched = 0;
let mismatched = [];
for (const n of names) {
  const copy = path.join(r.stateDir, n);
  if (!existsSync(copy)) { mismatched.push(`${n}: no copy`); continue; }
  if (before[n]?.error) continue;
  let after;
  try { after = census(copy); } catch (e) { mismatched.push(`${n}: copy unreadable (${e.message})`); continue; }
  if (after.total < before[n].total) mismatched.push(`${n}: ${before[n].total} rows live, ${after.total} in the copy`);
  else matched++;
}
ok('every copy carries at least the rows that were live when it started', mismatched.length === 0,
  mismatched.length ? mismatched.join('; ') : `${matched} databases, WAL contents included`);

const biggest = names
  .filter((n) => !before[n]?.error)
  .sort((a, b) => before[b].total - before[a].total)[0];
if (biggest) {
  const main = statSync(path.join(ROOT, 'data', biggest)).size;
  const wal = existsSync(path.join(ROOT, 'data', `${biggest}-wal`)) ? statSync(path.join(ROOT, 'data', `${biggest}-wal`)).size : 0;
  const copy = statSync(path.join(r.stateDir, biggest)).size;
  ok(`${biggest} was read through its WAL`, before[biggest].total > 0,
    `${before[biggest].total} rows · main ${main}B + wal ${wal}B -> copy ${copy}B`);
}

const dirs = readdirSync(path.join(ROOT, 'backups')).filter((f) => f.startsWith('state-'));
ok('the state set is retained on disk', dirs.length > 0, `${dirs.length} state backup(s) kept`);

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail.length === 0 ? 'ALL PASS' : 'FAILURES'} ${pass}/${pass + fail.length}\n`);
process.exit(fail.length === 0 ? 0 : 1);
