import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src-tauri', 'installer');
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
};

const exporter = path.join(ROOT, 'scripts', 'export-public.mjs');
let tree = ROOT;
let temp = null;
if (existsSync(exporter)) {
  temp = mkdtempSync(path.join(os.tmpdir(), 'aeryx-pack-'));
  tree = path.join(temp, 'aeryx');
  run(process.execPath, [exporter, tree]);
}
const site = existsSync(path.join(tree, 'site', 'install.sh')) ? path.join(tree, 'site') : path.join(ROOT, 'site');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(path.join(site, 'install.sh'), path.join(OUT, 'install.sh'));
cpSync(path.join(site, 'install.ps1'), path.join(OUT, 'install.ps1'));

if (temp) rmSync(temp, { recursive: true, force: true });
console.log(`staged the app installer in ${path.relative(ROOT, OUT)}`);
