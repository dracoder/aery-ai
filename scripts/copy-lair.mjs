import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(ROOT, 'lair', 'out');
const dest = path.join(ROOT, 'dist', 'lair');

if (!fs.existsSync(src)) {
  console.error('lair/out missing — run the Next build first (npm run build:lair)');
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`lair → ${path.relative(ROOT, dest)}`);

await build({
  entryPoints: [path.join(ROOT, 'lair', 'app', 'familiar', 'engine.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  logLevel: 'warning',
  outfile: path.join(ROOT, 'dist', 'familiar.js'),
});
console.log('familiar → dist/familiar.js');
