import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { verifyChain, type StoredAuditRow } from '../chain/audit';

const KEEP = 14;

const CHAIN_DB = 'aeryx.db';

export interface StateCopy {
  name: string;
  ok: boolean;
  bytes: number;
  error?: string;
}

export interface BackupResult {
  file: string;
  rows: number;
  chainIntact: boolean;
  snapshot: string;
  stateDir: string;
  state: StateCopy[];
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

function prior(dir: string, prefix: string, suffix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && (!suffix || f.endsWith(suffix)))
    .sort()
    .reverse();
}

export function stateDatabases(root: string): string[] {
  const dir = path.join(root, 'data');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.db') && f !== CHAIN_DB)
    .sort();
}

async function copyAndVerify(from: string, to: string): Promise<StateCopy> {
  const name = path.basename(from);
  try {
    const src = new Database(from, { readonly: true });
    try {
      await src.backup(to);
    } finally {
      src.close();
    }
    const copy = new Database(to, { readonly: true });
    try {
      const row = copy.pragma('quick_check', { simple: true });
      if (row !== 'ok') throw new Error(`quick_check said ${String(row)}`);
      const tables = copy
        .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'")
        .get() as { c: number };
      if (tables.c === 0) throw new Error('the copy holds no tables');
    } finally {
      copy.close();
    }
    return { name, ok: true, bytes: fs.statSync(to).size };
  } catch (e: any) {
    return { name, ok: false, bytes: fs.existsSync(to) ? fs.statSync(to).size : 0, error: e?.message ?? String(e) };
  }
}

export interface RestoreResult {
  from: string;
  rows: number;
  chainIntact: boolean;
  replaced: string | null;
}

export interface StateRestoreResult {
  from: string;
  restored: string[];
  replaced: string[];
}

export function restoreState(root: string, dir?: string): StateRestoreResult {
  const backups = path.join(root, 'backups');
  const name = dir ?? prior(backups, 'state-')[0];
  if (!name) throw new Error('no state backup to restore from');
  const src = path.isAbsolute(name) ? name : path.join(backups, name);
  if (!fs.existsSync(src)) throw new Error(`no such state backup: ${name}`);

  const files = fs.readdirSync(src).filter((f) => f.endsWith('.db'));
  if (files.length === 0) throw new Error(`state backup ${path.basename(src)} holds no databases`);

  for (const f of files) {
    const db = new Database(path.join(src, f), { readonly: true });
    try {
      const row = db.pragma('quick_check', { simple: true });
      if (row !== 'ok') throw new Error(`refusing to restore: ${f} fails quick_check (${String(row)})`);
    } finally {
      db.close();
    }
  }

  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const s = stamp();
  const restored: string[] = [];
  const replaced: string[] = [];
  for (const f of files) {
    const live = path.join(dataDir, f);
    if (fs.existsSync(live)) {
      const aside = `${live}.replaced-${s}`;
      fs.renameSync(live, aside);
      replaced.push(aside);
    }
    for (const sib of ['-wal', '-shm']) fs.rmSync(live + sib, { force: true });
    fs.copyFileSync(path.join(src, f), live);
    restored.push(f);
  }
  return { from: src, restored, replaced };
}

export function restoreBackup(root: string, file?: string): RestoreResult {
  const dir = path.join(root, 'backups');
  const name = file ?? prior(dir, 'aeryx-', '.db')[0];
  if (!name) throw new Error('no backup to restore from');
  const src = path.isAbsolute(name) ? name : path.join(dir, name);
  if (!fs.existsSync(src)) throw new Error(`no such backup: ${name}`);

  const copy = new Database(src, { readonly: true });
  let rows: StoredAuditRow[];
  try {
    rows = copy
      .prepare('SELECT id, ts, tool, lane, risk_class AS riskClass, detail, verdict, prev_hash, row_hash FROM commands ORDER BY id')
      .all() as StoredAuditRow[];
  } finally {
    copy.close();
  }
  const broken = verifyChain(rows);
  if (broken !== null) {
    throw new Error(`refusing to restore: the backup's own chain breaks at row ${broken}`);
  }

  const dbPath = path.join(root, 'data', 'aeryx.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  let replaced: string | null = null;
  if (fs.existsSync(dbPath)) {
    replaced = `${dbPath}.replaced-${stamp()}`;
    fs.renameSync(dbPath, replaced);
  }
  for (const sib of ['-wal', '-shm']) fs.rmSync(dbPath + sib, { force: true });
  fs.copyFileSync(src, dbPath);

  fs.rmSync(path.join(root, 'backups', '.chain-anchor.json'), { force: true });

  return { from: src, rows: rows.length, chainIntact: true, replaced };
}

export async function runBackup(root: string): Promise<BackupResult | null> {
  const dbPath = path.join(root, 'data', 'aeryx.db');
  if (!fs.existsSync(dbPath)) return null;

  const dir = path.join(root, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const s = stamp();
  const dest = path.join(dir, `aeryx-${s}.db`);

  const src = new Database(dbPath, { readonly: true });
  try {
    await src.backup(dest);
  } finally {
    src.close();
  }

  const copy = new Database(dest, { readonly: true });
  let rows: StoredAuditRow[];
  try {
    rows = copy
      .prepare('SELECT id, ts, tool, lane, risk_class AS riskClass, detail, verdict, prev_hash, row_hash FROM commands ORDER BY id')
      .all() as StoredAuditRow[];
  } finally {
    copy.close();
  }
  const chainIntact = verifyChain(rows) === null;

  const stateDir = path.join(dir, `state-${s}`);
  fs.mkdirSync(stateDir, { recursive: true });
  const state: StateCopy[] = [];
  for (const name of stateDatabases(root)) {
    state.push(await copyAndVerify(path.join(root, 'data', name), path.join(stateDir, name)));
  }

  const snapDir = path.join(dir, `snapshot-${s}`);
  fs.mkdirSync(snapDir, { recursive: true });
  const guardrails = path.join(root, 'guardrails.json');
  if (fs.existsSync(guardrails)) fs.copyFileSync(guardrails, path.join(snapDir, 'guardrails.json'));
  const memDir = path.join(root, 'memory');
  if (fs.existsSync(memDir)) {
    for (const f of fs.readdirSync(memDir).filter((f) => f.endsWith('.md'))) {
      fs.copyFileSync(path.join(memDir, f), path.join(snapDir, f));
    }
  }

  for (const stale of prior(dir, 'aeryx-', '.db').slice(KEEP)) {
    fs.rmSync(path.join(dir, stale), { force: true });
    for (const sib of ['-shm', '-wal']) fs.rmSync(path.join(dir, stale + sib), { force: true });
  }
  for (const stale of prior(dir, 'snapshot-').slice(KEEP)) {
    fs.rmSync(path.join(dir, stale), { recursive: true, force: true });
  }
  for (const stale of prior(dir, 'state-').slice(KEEP)) {
    fs.rmSync(path.join(dir, stale), { recursive: true, force: true });
  }

  return { file: dest, rows: rows.length, chainIntact, snapshot: snapDir, stateDir, state };
}
