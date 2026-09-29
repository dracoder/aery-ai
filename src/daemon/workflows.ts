import Database from 'better-sqlite3';
import { parseSchedule, nextRun } from './schedule';
import { validScopePattern } from '../chain/ladder';
import { MIND_RUNNERS } from './mind-organs';

const RUNNERS: readonly string[] = ['brain', ...MIND_RUNNERS];

export type WorkflowStatus = 'proposed' | 'active' | 'paused';
export type RunOutcome = 'ok' | 'failed' | 'timeout' | 'skipped';

export interface Workflow {
  id: number;
  name: string;
  purpose: string;
  prompt: string;
  schedule: string;
  status: WorkflowStatus;
  source: string;
  createdTs: string;
  updatedTs: string;
  nextRunTs: string | null;
  lastRunTs: string | null;
  lastOutcome: string | null;
  scope: string;
  runner: string;
  catchUp: number;
}

export interface WorkflowRun {
  id: number;
  workflowId: number;
  startedTs: string;
  finishedTs: string | null;
  trigger: string;
  outcome: RunOutcome | null;
  detail: string | null;
}

export interface WorkflowInput {
  name: string;
  purpose?: string;
  prompt: string;
  schedule: string;
  scope?: string[];
  runner?: string;
  catchUp?: boolean;
}

const LIMIT = { name: 80, purpose: 300, prompt: 4000, schedule: 60, scopeLanes: 12 };

export function parseScope(raw: unknown): string[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.filter((p) => validScopePattern(p)).map((p) => String(p).trim());
  } catch {
    return [];
  }
}

export function initialStatus(requested: unknown, scope: unknown): WorkflowStatus {
  if (Array.isArray(scope) && scope.length) return 'proposed';
  return requested === 'proposed' ? 'proposed' : 'active';
}

export function scopeForRun(wf: { status: string; scope: unknown }): string[] {
  return wf.status === 'active' ? parseScope(wf.scope) : [];
}

export function validateInput(input: Partial<WorkflowInput>): string | null {
  const name = String(input.name ?? '').trim();
  const prompt = String(input.prompt ?? '').trim();
  const schedule = String(input.schedule ?? '').trim();
  if (!name) return 'name required';
  if (name.length > LIMIT.name) return `name too long (max ${LIMIT.name})`;
  if (!prompt) return 'prompt required';
  if (prompt.length > LIMIT.prompt) return `prompt too long (max ${LIMIT.prompt})`;
  if (String(input.purpose ?? '').length > LIMIT.purpose) return `purpose too long (max ${LIMIT.purpose})`;
  if (schedule.length > LIMIT.schedule) return `schedule too long (max ${LIMIT.schedule})`;
  if (!parseSchedule(schedule)) {
    return `unknown schedule "${schedule}" — use manual, every 15m/2h, daily@HH:MM, weekdays@HH:MM, weekends@HH:MM, weekly@mon HH:MM, or monthly@1..28 HH:MM`;
  }
  if (input.runner !== undefined && !RUNNERS.includes(String(input.runner))) {
    return `unknown runner "${String(input.runner).slice(0, 20)}" — ${RUNNERS.map((r) => `'${r}'`).join(' or ')}`;
  }
  if (input.scope !== undefined) {
    if (!Array.isArray(input.scope)) return 'scope must be a list of lane patterns';
    if (input.scope.length > LIMIT.scopeLanes) return `scope too broad (max ${LIMIT.scopeLanes} lanes)`;
    for (const p of input.scope) {
      if (!validScopePattern(p)) {
        return `invalid scope lane "${String(p).slice(0, 60)}" — name real lanes (a bare * is not an order)`;
      }
    }
  }
  return null;
}

const ROW_COLS = `id, name, purpose, prompt, schedule, status, source,
  created_ts AS createdTs, updated_ts AS updatedTs,
  next_run_ts AS nextRunTs, last_run_ts AS lastRunTs, last_outcome AS lastOutcome, scope, runner,
  catch_up AS catchUp`;

const RUN_COLS = `id, workflow_id AS workflowId, started_ts AS startedTs,
  finished_ts AS finishedTs, run_trigger AS trigger, outcome, detail`;

export class WorkflowStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    if (dbPath !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        schedule TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed',
        source TEXT NOT NULL DEFAULT 'ui',
        created_ts TEXT NOT NULL,
        updated_ts TEXT NOT NULL,
        next_run_ts TEXT,
        last_run_ts TEXT,
        last_outcome TEXT
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id INTEGER NOT NULL,
        started_ts TEXT NOT NULL,
        finished_ts TEXT,
        run_trigger TEXT NOT NULL DEFAULT 'schedule',
        outcome TEXT,
        detail TEXT
      );
    `);
    const cols = this.db.prepare(`PRAGMA table_info(workflows)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'scope')) {
      this.db.exec(`ALTER TABLE workflows ADD COLUMN scope TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!cols.some((c) => c.name === 'runner')) {
      this.db.exec(`ALTER TABLE workflows ADD COLUMN runner TEXT NOT NULL DEFAULT 'brain'`);
    }
    if (!cols.some((c) => c.name === 'catch_up')) {
      this.db.exec(`ALTER TABLE workflows ADD COLUMN catch_up INTEGER NOT NULL DEFAULT 0`);
    }
  }

  close() {
    this.db.close();
  }

  create(input: WorkflowInput, opts: { status?: WorkflowStatus; source?: string; now?: Date } = {}): Workflow {
    const err = validateInput(input);
    if (err) throw new Error(err);
    const now = opts.now ?? new Date();
    const status: WorkflowStatus = opts.status === 'active' ? 'active' : 'proposed';
    const sched = parseSchedule(input.schedule)!;
    const next = status === 'active' ? isoOrNull(nextRun(sched, now)) : null;
    const r = this.db.prepare(
      `INSERT INTO workflows (name, purpose, prompt, schedule, status, source, created_ts, updated_ts, next_run_ts, scope, runner, catch_up)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      String(input.name).trim(), String(input.purpose ?? '').trim(), String(input.prompt).trim(),
      String(input.schedule).trim().toLowerCase(), status, opts.source ?? 'ui',
      now.toISOString(), now.toISOString(), next,
      JSON.stringify(input.scope ?? []),
      input.runner && RUNNERS.includes(String(input.runner)) ? String(input.runner) : 'brain',
      input.catchUp === true ? 1 : 0,
    );
    return this.get(Number(r.lastInsertRowid))!;
  }

  get(id: number): Workflow | null {
    return (this.db.prepare(`SELECT ${ROW_COLS} FROM workflows WHERE id = ?`).get(id) as Workflow | undefined) ?? null;
  }

  list(): Workflow[] {
    return this.db.prepare(`SELECT ${ROW_COLS} FROM workflows ORDER BY id`).all() as Workflow[];
  }

  approve(id: number, now = new Date()): Workflow {
    return this.transition(id, ['proposed'], 'active', now);
  }

  pause(id: number, now = new Date()): Workflow {
    return this.transition(id, ['active'], 'paused', now);
  }

  resume(id: number, now = new Date()): Workflow {
    return this.transition(id, ['paused'], 'active', now);
  }

  private transition(id: number, from: WorkflowStatus[], to: WorkflowStatus, now: Date): Workflow {
    const wf = this.get(id);
    if (!wf) throw new Error(`no workflow #${id}`);
    if (!from.includes(wf.status)) throw new Error(`workflow #${id} is ${wf.status}, not ${from.join('/')}`);
    const next = to === 'active' ? isoOrNull(nextRun(parseSchedule(wf.schedule)!, now)) : null;
    this.db.prepare('UPDATE workflows SET status = ?, next_run_ts = ?, updated_ts = ? WHERE id = ?')
      .run(to, next, now.toISOString(), id);
    return this.get(id)!;
  }

  edit(id: number, patch: Partial<WorkflowInput>, now = new Date()): Workflow {
    const wf = this.get(id);
    if (!wf) throw new Error(`no workflow #${id}`);
    const merged: WorkflowInput = {
      name: patch.name ?? wf.name,
      purpose: patch.purpose ?? wf.purpose,
      prompt: patch.prompt ?? wf.prompt,
      schedule: patch.schedule ?? wf.schedule,
      scope: patch.scope ?? parseScope(wf.scope),
      runner: String(patch.runner ?? wf.runner),
    };
    const err = validateInput(merged);
    if (err) throw new Error(err);
    const scopeChanged = patch.scope !== undefined
      && JSON.stringify(patch.scope) !== JSON.stringify(parseScope(wf.scope));
    const promptChanged = patch.prompt !== undefined && patch.prompt !== wf.prompt;
    const runnerChanged = patch.runner !== undefined && patch.runner !== wf.runner;
    const demote = wf.status !== 'proposed' && (scopeChanged || promptChanged || runnerChanged);
    const status = demote ? 'proposed' : wf.status;
    const next = status === 'active'
      ? isoOrNull(nextRun(parseSchedule(merged.schedule)!, now))
      : null;
    this.db.prepare(
      'UPDATE workflows SET name = ?, purpose = ?, prompt = ?, schedule = ?, status = ?, next_run_ts = ?, updated_ts = ?, scope = ? WHERE id = ?'
    ).run(
      merged.name.trim(), String(merged.purpose ?? '').trim(), merged.prompt.trim(),
      merged.schedule.trim().toLowerCase(), status, next, now.toISOString(),
      JSON.stringify(merged.scope ?? []), id,
    );
    return this.get(id)!;
  }

  remove(id: number): Workflow {
    const wf = this.get(id);
    if (!wf) throw new Error(`no workflow #${id}`);
    this.db.prepare('DELETE FROM runs WHERE workflow_id = ?').run(id);
    this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    return wf;
  }

  tick(now = new Date(), graceMs = 60 * 60_000): { due: Workflow[]; skipped: { workflow: Workflow; reason: string }[] } {
    const due: Workflow[] = [];
    const skipped: { workflow: Workflow; reason: string }[] = [];
    const open = new Set(this.openRuns().map((r) => r.workflowId));

    for (const wf of this.list()) {
      if (wf.status !== 'active' || !wf.nextRunTs) continue;
      const slot = Date.parse(wf.nextRunTs);
      if (!(slot <= now.getTime())) continue;

      const next = isoOrNull(nextRun(parseSchedule(wf.schedule)!, now));
      this.db.prepare('UPDATE workflows SET next_run_ts = ? WHERE id = ?').run(next, wf.id);

      let reason: string | null = null;
      if (open.has(wf.id)) reason = 'previous run still going';
      else if (now.getTime() - slot > graceMs && !wf.catchUp) reason = 'missed while the daemon was off';

      if (reason) {
        this.recordClosedRun(wf.id, 'schedule', 'skipped', reason, now);
        skipped.push({ workflow: this.get(wf.id)!, reason });
      } else {
        due.push(this.get(wf.id)!);
      }
    }
    return { due, skipped };
  }

  openRun(workflowId: number, trigger: 'schedule' | 'manual', now = new Date()): number {
    const wf = this.get(workflowId);
    if (!wf) throw new Error(`no workflow #${workflowId}`);
    if (wf.status !== 'active') throw new Error(`workflow #${workflowId} is ${wf.status} — approve it first`);
    const r = this.db.prepare(
      'INSERT INTO runs (workflow_id, started_ts, run_trigger) VALUES (?, ?, ?)'
    ).run(workflowId, now.toISOString(), trigger);
    return Number(r.lastInsertRowid);
  }

  closeRun(runId: number, outcome: RunOutcome, detail: string, now = new Date()): WorkflowRun | null {
    const run = this.db.prepare(`SELECT ${RUN_COLS} FROM runs WHERE id = ?`).get(runId) as WorkflowRun | undefined;
    if (!run || run.finishedTs) return null;
    this.db.prepare('UPDATE runs SET finished_ts = ?, outcome = ?, detail = ? WHERE id = ?')
      .run(now.toISOString(), outcome, detail.slice(0, 400), runId);
    this.noteOutcome(run.workflowId, outcome, now);
    return this.db.prepare(`SELECT ${RUN_COLS} FROM runs WHERE id = ?`).get(runId) as WorkflowRun;
  }

  private recordClosedRun(workflowId: number, trigger: string, outcome: RunOutcome, detail: string, now: Date) {
    this.db.prepare(
      'INSERT INTO runs (workflow_id, started_ts, finished_ts, run_trigger, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(workflowId, now.toISOString(), now.toISOString(), trigger, outcome, detail);
    this.noteOutcome(workflowId, outcome, now);
  }

  private noteOutcome(workflowId: number, outcome: RunOutcome, now: Date) {
    this.db.prepare('UPDATE workflows SET last_run_ts = ?, last_outcome = ? WHERE id = ?')
      .run(now.toISOString(), outcome, workflowId);
  }

  openRuns(): WorkflowRun[] {
    return this.db.prepare(`SELECT ${RUN_COLS} FROM runs WHERE finished_ts IS NULL ORDER BY id`).all() as WorkflowRun[];
  }

  timeoutRuns(maxAgeMs: number, now = new Date()): WorkflowRun[] {
    const out: WorkflowRun[] = [];
    for (const run of this.openRuns()) {
      if (now.getTime() - Date.parse(run.startedTs) > maxAgeMs) {
        const closed = this.closeRun(run.id, 'timeout', `no completion after ${Math.round(maxAgeMs / 60_000)} minutes`, now);
        if (closed) out.push(closed);
      }
    }
    return out;
  }

  failOpenRuns(reason: string, now = new Date()): WorkflowRun[] {
    const out: WorkflowRun[] = [];
    for (const run of this.openRuns()) {
      const closed = this.closeRun(run.id, 'failed', reason, now);
      if (closed) out.push(closed);
    }
    return out;
  }

  consecutiveFailures(workflowId: number): number {
    let n = 0;
    for (const run of this.runs(workflowId, 20)) {
      if (run.outcome === 'failed' || run.outcome === 'timeout') n++;
      else if (run.outcome === 'skipped' || run.outcome === null) continue;
      else break;
    }
    return n;
  }

  runs(workflowId: number, limit = 20): WorkflowRun[] {
    return this.db.prepare(
      `SELECT ${RUN_COLS} FROM runs WHERE workflow_id = ? ORDER BY id DESC LIMIT ?`
    ).all(workflowId, Math.min(Math.max(limit, 1), 100)) as WorkflowRun[];
  }
}

function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}
