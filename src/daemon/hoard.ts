import Database from 'better-sqlite3';

export type NoticeStatus = 'proposed' | 'kept' | 'dismissed';

export interface Notice {
  id: number;
  fact: string;
  status: NoticeStatus;
  createdTs: string;
  decidedTs: string | null;
}

export interface UserDraft {
  id: number;
  content: string;
  status: 'proposed' | 'applied' | 'rejected';
  createdTs: string;
  decidedTs: string | null;
}

export const DRAFT_MAX = 8000;

export function validateDraft(s: unknown): string | null {
  if (typeof s !== 'string') return 'draft must be a string';
  const t = s.trim();
  if (t.length < 20) return 'too short to be an about-me (min 20 chars)';
  if (t.length > DRAFT_MAX) return `too long (max ${DRAFT_MAX} chars)`;
  return null;
}

export const FACT_MIN = 8;
export const FACT_MAX = 300;

export function normalizeFact(s: string): string {
  return String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

export function validateFact(s: unknown): string | null {
  if (typeof s !== 'string') return 'fact must be a string';
  const t = s.trim();
  if (t.length < FACT_MIN) return `too short to be a fact (min ${FACT_MIN} chars)`;
  if (t.length > FACT_MAX) return `too long for one fact (max ${FACT_MAX} chars)`;
  if (!normalizeFact(t)) return 'no content after normalization';
  return null;
}

const ROW = 'id, fact, status, created_ts AS createdTs, decided_ts AS decidedTs';

export class NoticeStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    if (dbPath !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact TEXT NOT NULL,
        norm TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'proposed',
        created_ts TEXT NOT NULL,
        decided_ts TEXT
      );
      CREATE TABLE IF NOT EXISTS user_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed',
        created_ts TEXT NOT NULL,
        decided_ts TEXT
      );
    `);
  }

  close() {
    this.db.close();
  }

  add(facts: string[], learnedContent: string, now = new Date()): Notice[] {
    const known = new Set(
      learnedContent.split('\n').map((l) => normalizeFact(l.replace(/^[-*\s]+/, ''))).filter(Boolean),
    );
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO notices (fact, norm, status, created_ts) VALUES (?, ?, ?, ?)',
    );
    const added: Notice[] = [];
    for (const raw of facts) {
      if (validateFact(raw) !== null) continue;
      const fact = String(raw).trim();
      const norm = normalizeFact(fact);
      if (known.has(norm)) continue;
      const r = insert.run(fact, norm, 'proposed', now.toISOString());
      if (r.changes > 0) added.push(this.get(Number(r.lastInsertRowid))!);
    }
    return added;
  }

  get(id: number): Notice | null {
    return (this.db.prepare(`SELECT ${ROW} FROM notices WHERE id = ?`).get(id) as Notice | undefined) ?? null;
  }

  list(limit = 100): Notice[] {
    return this.db.prepare(`SELECT ${ROW} FROM notices ORDER BY id DESC LIMIT ?`)
      .all(Math.min(Math.max(limit, 1), 500)) as Notice[];
  }

  pendingCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM notices WHERE status = 'proposed'").get() as { n: number }).n;
  }

  keep(id: number, now = new Date()): Notice {
    return this.decide(id, 'kept', now);
  }

  dismiss(id: number, now = new Date()): Notice {
    return this.decide(id, 'dismissed', now);
  }

  private decide(id: number, to: NoticeStatus, now: Date): Notice {
    const n = this.get(id);
    if (!n) throw new Error(`no notice #${id}`);
    if (n.status !== 'proposed') throw new Error(`notice #${id} was already ${n.status}`);
    this.db.prepare('UPDATE notices SET status = ?, decided_ts = ? WHERE id = ?')
      .run(to, now.toISOString(), id);
    return this.get(id)!;
  }

  private static DRAFT_ROW = 'id, content, status, created_ts AS createdTs, decided_ts AS decidedTs';

  draftPropose(content: string, now = new Date()): UserDraft {
    const err = validateDraft(content);
    if (err) throw new Error(err);
    this.db.prepare("UPDATE user_drafts SET status = 'rejected', decided_ts = ? WHERE status = 'proposed'")
      .run(now.toISOString());
    const r = this.db.prepare('INSERT INTO user_drafts (content, status, created_ts) VALUES (?, ?, ?)')
      .run(content.trim(), 'proposed', now.toISOString());
    return this.draftGet(Number(r.lastInsertRowid))!;
  }

  draftGet(id: number): UserDraft | null {
    return (this.db.prepare(`SELECT ${NoticeStore.DRAFT_ROW} FROM user_drafts WHERE id = ?`).get(id) as UserDraft | undefined) ?? null;
  }

  draftPending(): UserDraft | null {
    return (this.db.prepare(`SELECT ${NoticeStore.DRAFT_ROW} FROM user_drafts WHERE status = 'proposed' ORDER BY id DESC LIMIT 1`)
      .get() as UserDraft | undefined) ?? null;
  }

  draftApply(id: number, now = new Date()): UserDraft {
    return this.draftDecide(id, 'applied', now);
  }

  draftReject(id: number, now = new Date()): UserDraft {
    return this.draftDecide(id, 'rejected', now);
  }

  private draftDecide(id: number, to: 'applied' | 'rejected', now: Date): UserDraft {
    const d = this.draftGet(id);
    if (!d) throw new Error(`no draft #${id}`);
    if (d.status !== 'proposed') throw new Error(`draft #${id} was already ${d.status}`);
    this.db.prepare('UPDATE user_drafts SET status = ?, decided_ts = ? WHERE id = ?')
      .run(to, now.toISOString(), id);
    return this.draftGet(id)!;
  }
}
