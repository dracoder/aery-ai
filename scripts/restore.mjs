import { build } from 'esbuild';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(path.join(ROOT, 'node_modules', '.aeryx-restore-'));

try {
  const out = path.join(tmp, 'backup.mjs');
  await build({
    entryPoints: [path.join(ROOT, 'src/daemon/backup.ts')],
    bundle: true, platform: 'node', format: 'esm',
    external: ['better-sqlite3'], outfile: out, logLevel: 'silent',
  });
  const { restoreBackup } = await import(pathToFileURL(out).href);

  const arg = process.argv[2];
  if (arg === '--list') {
    const dir = path.join(ROOT, 'backups');
    const files = readdirSync(dir).filter((f) => f.startsWith('aeryx-') && f.endsWith('.db')).sort().reverse();
    if (!files.length) {
      console.log('no backups in backups/');
    } else {
      console.log(`${files.length} backup(s), newest first:`);
      for (const f of files) {
        const s = statSync(path.join(dir, f));
        console.log(`  ${f}  ${(s.size / 1024).toFixed(0)} KB  ${s.mtime.toISOString()}`);
      }
    }
  } else {
    const r = restoreBackup(ROOT, arg);
    console.log(`restored ${r.rows} audit rows from ${path.basename(r.from)}`);
    console.log('chain verified before the file was put in place');
    if (r.replaced) console.log(`previous database kept at ${path.basename(r.replaced)}`);
    console.log('start the daemon; the chain anchor re-seeds on the first brain boot');
  }
} catch (e) {
  console.error(`restore failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
