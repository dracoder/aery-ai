import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditRow {
  ts: string;
  tool: string;
  lane: string;
  riskClass: number;
  detail: string;
  verdict: string;
}

export function canonicalJson(row: AuditRow): string {
  const keys = Object.keys(row).sort() as (keyof AuditRow)[];
  return JSON.stringify(keys.map((k) => [k, row[k]]));
}

export function computeRowHash(prevHash: string, row: AuditRow): string {
  return createHash('sha256').update(prevHash).update(canonicalJson(row)).digest('hex');
}

export interface StoredAuditRow extends AuditRow {
  id: number;
  prev_hash: string;
  row_hash: string;
}

export function verifyChain(rows: StoredAuditRow[]): number | null {
  let prev: string | null = null;
  for (const row of rows) {
    if (!row.row_hash) {
      if (prev === null) continue;
      return row.id;
    }
    if (prev === null) prev = row.prev_hash || GENESIS_HASH;
    if (row.prev_hash !== prev) return row.id;
    const { id: _i, prev_hash: _p, row_hash, ...content } = row;
    if (computeRowHash(prev, content as AuditRow) !== row_hash) return row.id;
    prev = row_hash;
  }
  return null;
}

export interface ChainAnchor {
  headHash: string;
  count: number;
}

export function chainAnchor(rows: StoredAuditRow[]): ChainAnchor {
  const hashed = rows.filter((r) => r.row_hash);
  return {
    headHash: hashed.length ? hashed[hashed.length - 1].row_hash : GENESIS_HASH,
    count: hashed.length,
  };
}

export function anchorMismatch(rows: StoredAuditRow[], anchor: ChainAnchor | null): string | null {
  if (!anchor) return null;
  if (anchor.count === 0) return null;
  const hashed = rows.filter((r) => r.row_hash);
  if (hashed.length < anchor.count) {
    return `${anchor.count - hashed.length} audit row(s) removed — the log held ${anchor.count}, holds ${hashed.length}`;
  }
  const anchored = hashed[anchor.count - 1];
  if (!anchored || anchored.row_hash !== anchor.headHash) {
    return `audit row ${anchor.count} is not the row that was recorded there — the log was rewritten`;
  }
  return null;
}
