import { build } from 'esbuild';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const tmp = mkdtempSync(path.join(ROOT, 'node_modules', '.aeryx-gate-'));

export async function load(entry, name) {
  const out = path.join(tmp, name);
  await build({
    entryPoints: [path.join(ROOT, entry)], bundle: true, platform: 'node',
    format: 'esm', external: ['better-sqlite3'], outfile: out, logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
}

export const GW = await load('src/chain/gateway.ts', 'gateway.mjs');
export const { classify } = GW;
export const AUD = await load('src/chain/audit.ts', 'audit.mjs');
export const { computeRowHash, verifyChain, GENESIS_HASH } = AUD;
export const L = await load('src/chain/ladder.ts', 'ladder.mjs');
export const LENS = await load('src/daemon/lens.ts', 'lens.mjs');

export const raw = JSON.parse(readFileSync(path.join(ROOT, 'guardrails.json'), 'utf-8'));
export const G = {
  ...raw,
  selfPaths: (raw.selfPaths ?? []).map((p) => path.resolve(ROOT, p)),
  confirmOutsideDirs: GW.resolveSafeDirs(raw.confirmOutsideDirs ?? [], { WORKSPACE: 'C:\\WORK', AERYX: ROOT, TEMP: os.tmpdir() }),
  sensitiveReadDirs: GW.resolveSafeDirs(raw.sensitiveReadDirs ?? [], { AERYX: ROOT, HOME: os.homedir() }),
  taintReadDirs: GW.resolveSafeDirs(raw.taintReadDirs ?? [], { AERYX: ROOT, HOME: os.homedir(), TEMP: os.tmpdir() }),
};
export const clean = () => ({ tainted: false });

let pass = 0;
const failures = [];
export function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    failures.push(`${name}\n    ${e.message}`);
  }
}
export async function checkA(name, fn) {
  try {
    await fn();
    pass++;
  } catch (e) {
    failures.push(`${name}\n    ${e.message}`);
  }
}
export const eq = (actual, expected, what) => {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
};
export function finish() {
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(failures.length ? 1 : 0);
}

