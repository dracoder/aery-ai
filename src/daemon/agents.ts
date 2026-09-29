import Database from 'better-sqlite3';

export type AgentStatus = 'proposed' | 'active' | 'retired';

export interface PermanentAgent {
  id: number;
  slug: string;
  description: string;
  prompt: string;
  tools: string | null;
  status: AgentStatus;
  source: string;
  createdTs: string;
  updatedTs: string;
}

export interface AgentInput {
  slug: string;
  description: string;
  prompt: string;
  tools?: string[] | null;
}

const SLUG_RE = /^[a-z][a-z0-9-]{1,39}$/;
const LIMIT = { description: 300, prompt: 6000, tools: 40 };

export function validateAgentInput(input: Partial<AgentInput>): string | null {
  const slug = String(input.slug ?? '').trim();
  const description = String(input.description ?? '').trim();
  const prompt = String(input.prompt ?? '').trim();
  if (!SLUG_RE.test(slug)) return 'slug must be kebab-case: lowercase letter first, then letters/digits/hyphens, 2–40 chars';
  if (!description) return 'description required — the brain routes on it';
  if (description.length > LIMIT.description) return `description too long (max ${LIMIT.description})`;
  if (!prompt) return 'prompt required';
  if (prompt.length > LIMIT.prompt) return `prompt too long (max ${LIMIT.prompt})`;
  if (input.tools != null) {
    if (!Array.isArray(input.tools)) return 'tools must be an array of tool names, or omitted to inherit';
    if (input.tools.length > LIMIT.tools) return `too many tools (max ${LIMIT.tools})`;
    if (input.tools.some((t) => typeof t !== 'string' || !t.trim() || t.length > 60)) return 'tools must be short tool-name strings';
  }
  return null;
}

const COLS = `id, slug, description, prompt, tools, status, source,
  created_ts AS createdTs, updated_ts AS updatedTs`;

export class AgentStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    if (dbPath !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        prompt TEXT NOT NULL,
        tools TEXT,
        status TEXT NOT NULL DEFAULT 'proposed',
        source TEXT NOT NULL DEFAULT 'ui',
        created_ts TEXT NOT NULL,
        updated_ts TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  create(input: AgentInput, opts: { status?: AgentStatus; source?: string; now?: Date } = {}): PermanentAgent {
    const err = validateAgentInput(input);
    if (err) throw new Error(err);
    const slug = input.slug.trim();
    if (this.bySlug(slug)) throw new Error(`an agent named "${slug}" already exists (retired agents keep their name — revive or pick another)`);
    const now = (opts.now ?? new Date()).toISOString();
    const status: AgentStatus = opts.status === 'active' ? 'active' : 'proposed';
    const r = this.db.prepare(
      `INSERT INTO agents (slug, description, prompt, tools, status, source, created_ts, updated_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      slug, input.description.trim(), input.prompt.trim(),
      input.tools == null ? null : JSON.stringify(input.tools.map((t) => t.trim())),
      status, opts.source ?? 'ui', now, now,
    );
    return this.get(Number(r.lastInsertRowid))!;
  }

  get(id: number): PermanentAgent | null {
    return (this.db.prepare(`SELECT ${COLS} FROM agents WHERE id = ?`).get(id) as PermanentAgent | undefined) ?? null;
  }

  bySlug(slug: string): PermanentAgent | null {
    return (this.db.prepare(`SELECT ${COLS} FROM agents WHERE slug = ?`).get(slug) as PermanentAgent | undefined) ?? null;
  }

  list(): PermanentAgent[] {
    return this.db.prepare(`SELECT ${COLS} FROM agents ORDER BY id`).all() as PermanentAgent[];
  }

  active(): PermanentAgent[] {
    return this.db.prepare(`SELECT ${COLS} FROM agents WHERE status = 'active' ORDER BY id`).all() as PermanentAgent[];
  }

  approve(id: number, now = new Date()): PermanentAgent {
    return this.transition(id, ['proposed'], 'active', now);
  }

  retire(id: number, now = new Date()): PermanentAgent {
    return this.transition(id, ['active', 'proposed'], 'retired', now);
  }

  revive(id: number, now = new Date()): PermanentAgent {
    return this.transition(id, ['retired'], 'active', now);
  }

  private transition(id: number, from: AgentStatus[], to: AgentStatus, now: Date): PermanentAgent {
    const a = this.get(id);
    if (!a) throw new Error(`no agent #${id}`);
    if (!from.includes(a.status)) throw new Error(`agent #${id} ("${a.slug}") is ${a.status}, not ${from.join('/')}`);
    this.db.prepare('UPDATE agents SET status = ?, updated_ts = ? WHERE id = ?').run(to, now.toISOString(), id);
    return this.get(id)!;
  }

  edit(id: number, patch: Partial<AgentInput>, now = new Date()): PermanentAgent {
    const a = this.get(id);
    if (!a) throw new Error(`no agent #${id}`);
    const merged: AgentInput = {
      slug: patch.slug ?? a.slug,
      description: patch.description ?? a.description,
      prompt: patch.prompt ?? a.prompt,
      tools: patch.tools !== undefined ? patch.tools : (a.tools ? JSON.parse(a.tools) : null),
    };
    const err = validateAgentInput(merged);
    if (err) throw new Error(err);
    if (merged.slug !== a.slug && this.bySlug(merged.slug)) throw new Error(`an agent named "${merged.slug}" already exists`);
    const nextTools = merged.tools == null ? null : JSON.stringify(merged.tools.map((t) => t.trim()));
    const reshaped = merged.prompt.trim() !== a.prompt || nextTools !== (a.tools ?? null);
    const status = reshaped && a.status === 'active' ? 'proposed' : a.status;
    this.db.prepare(
      'UPDATE agents SET slug = ?, description = ?, prompt = ?, tools = ?, status = ?, updated_ts = ? WHERE id = ?'
    ).run(
      merged.slug.trim(), merged.description.trim(), merged.prompt.trim(),
      nextTools, status, now.toISOString(), id,
    );
    return this.get(id)!;
  }
}
