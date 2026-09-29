import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { sessionShape, sessionShapeIssue, brainWorkspace, pluginRootIssue } from './session';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { PRIVACY_ENV } from './providers';
import { mindTools } from './mind-tools';
import type { ConfirmExtras } from './mind-tools-api';
import { costDelta } from '../daemon/usage';
import { classify, auditDetail, resolveSafeDirs, class3Verdict, viaFloor, stricter, redactSecrets, type Guardrails, type GateState } from '../chain/gateway';
import {
  computeRowHash, verifyChain, anchorMismatch, GENESIS_HASH,
  type AuditRow, type StoredAuditRow, type ChainAnchor,
} from '../chain/audit';
import {
  DEFAULT_LADDER, LADDER_VERDICT, eligible, freshLane, laneLabel, onAutoUse,
  onDecision, onStandingResponse, replayLanes, revoke as revokeLane, scopeAllows,
  type LadderPolicy, type LaneState,
} from '../chain/ladder';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEMORY_DIR = path.join(ROOT, 'memory');
const DATA_DIR = path.join(ROOT, 'data');

function send(obj: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'aeryx.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT DEFAULT CURRENT_TIMESTAMP,
    role TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT DEFAULT CURRENT_TIMESTAMP,
    tool TEXT NOT NULL,
    lane TEXT NOT NULL DEFAULT '',
    risk_class INTEGER NOT NULL DEFAULT -1,
    detail TEXT,
    verdict TEXT NOT NULL,
    prev_hash TEXT NOT NULL DEFAULT '',
    row_hash TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

const logMsg = db.prepare('INSERT INTO conversations (role, text) VALUES (?, ?)');
const insertCmd = db.prepare(
  `INSERT INTO commands (ts, tool, lane, risk_class, detail, verdict, prev_hash, row_hash)
   VALUES (@ts, @tool, @lane, @riskClass, @detail, @verdict, @prev_hash, @row_hash)`
);
const lastHash = db.prepare(
  "SELECT row_hash FROM commands WHERE row_hash != '' ORDER BY id DESC LIMIT 1"
);
const hashedCount = db.prepare(
  "SELECT COUNT(*) AS n FROM commands WHERE row_hash != ''"
);

const auditRows = db
  .prepare('SELECT id, ts, tool, lane, risk_class AS riskClass, detail, verdict, prev_hash, row_hash FROM commands ORDER BY id')
  .all() as StoredAuditRow[];
const ANCHOR_FILE = path.join(ROOT, 'backups', '.chain-anchor.json');

function readAnchor(): ChainAnchor | null {
  try {
    const a = JSON.parse(fs.readFileSync(ANCHOR_FILE, 'utf-8'));
    return typeof a?.headHash === 'string' && typeof a?.count === 'number' ? a : null;
  } catch {
    return null;
  }
}

function writeAnchorState() {
  try {
    const count = (hashedCount.get() as { n: number }).n;
    const headHash = (lastHash.get() as { row_hash: string } | undefined)?.row_hash ?? GENESIS_HASH;
    fs.mkdirSync(path.dirname(ANCHOR_FILE), { recursive: true });
    fs.writeFileSync(ANCHOR_FILE, JSON.stringify({ headHash, count } satisfies ChainAnchor));
  } catch (e) {
    console.error(`[audit] could not write the chain anchor: ${e}`);
  }
}

const brokenAt = verifyChain(auditRows);
const missing = anchorMismatch(auditRows, readAnchor());
const chainIntact = brokenAt === null && missing === null;
if (brokenAt !== null) {
  console.error(`[audit] chain broken at command id ${brokenAt} — log was modified`);
}
if (missing) {
  console.error(`[audit] ${missing}`);
}
writeAnchorState();

function logCmd(tool: string, lane: string, riskClass: number, detail: string, verdict: string) {
  const row: AuditRow = {
    ts: new Date().toISOString(),
    tool,
    lane,
    riskClass,
    detail: redactSecrets(detail),
    verdict,
  };
  const prev = (lastHash.get() as { row_hash: string } | undefined)?.row_hash ?? GENESIS_HASH;
  insertCmd.run({ ...row, prev_hash: prev, row_hash: computeRowHash(prev, row) });
  writeAnchorState();
}

function readMemory(): string {
  const parts: string[] = [];
  for (const f of ['persona.md', 'user.md', 'learned.md', 'continuity.md']) {
    const p = path.join(MEMORY_DIR, f);
    if (fs.existsSync(p)) parts.push(fs.readFileSync(p, 'utf-8'));
  }
  const learnedSkills = path.join(MEMORY_DIR, 'skills');
  if (fs.existsSync(learnedSkills)) {
    for (const f of fs.readdirSync(learnedSkills).filter((f) => f.endsWith('.md'))) {
      parts.push(fs.readFileSync(path.join(learnedSkills, f), 'utf-8'));
    }
  }
  return parts.join('\n\n---\n\n');
}

const rawGuardrails = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'guardrails.json'), 'utf-8')
) as Guardrails & { ladder?: Partial<LadderPolicy> };
const WORKSPACE = brainWorkspace(readBrainConfig(), os.homedir());
fs.mkdirSync(WORKSPACE, { recursive: true });
const DIR_VARS = { WORKSPACE, AERYX: ROOT, TEMP: os.tmpdir(), HOME: os.homedir() };
function withReal(dirs: string[]): string[] {
  const out = new Set(dirs);
  for (const d of dirs) {
    try { out.add(fs.realpathSync(d)); } catch { }
  }
  return [...out];
}
const guardrails: Guardrails = {
  ...rawGuardrails,
  confirmOutsideDirs: withReal(resolveSafeDirs(rawGuardrails.confirmOutsideDirs ?? [], DIR_VARS)),
  sensitiveReadDirs: withReal(resolveSafeDirs(rawGuardrails.sensitiveReadDirs ?? [], DIR_VARS)),
  taintReadDirs: withReal(resolveSafeDirs(rawGuardrails.taintReadDirs ?? [], DIR_VARS)),
};

function readBrainConfig(): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'aeryx.config.json'), 'utf-8'));
  } catch {
    return {};
  }
}
const selfPaths = withReal((guardrails.selfPaths ?? []).map((p) => path.resolve(ROOT, p)));
const scratchDirs = withReal([path.resolve(ROOT, 'data', 'scratch')]);

const gateState: GateState = { tainted: false };

const ladderPolicy: LadderPolicy = { ...DEFAULT_LADDER, ...(rawGuardrails.ladder ?? {}) };
const lanes = new Map<string, LaneState>();
const laneOf = (id: string) => lanes.get(id) ?? freshLane();

function replayGrants() {
  if (ladderPolicy.enabled && !chainIntact) {
    console.error('[ladder] audit chain broken — all standing grants ignored, asking about everything');
  }
  for (const [id, lane] of replayLanes(auditRows, ladderPolicy, chainIntact)) lanes.set(id, lane);
  const standing = [...lanes].filter(([, l]) => l.tier === 'standing').map(([id]) => id);
  console.error(standing.length ? `[ladder] standing grants: ${standing.join(', ')}` : '[ladder] no standing grants');
}

type ConfirmVerdict = 'yes' | 'no' | 'timeout';

const pendingConfirms = new Map<string, (v: ConfirmVerdict) => void>();
let confirmCounter = 0;

export const CONFIRM_TIMEOUT_MS = 90_000;

function askConfirmation(
  question: string,
  riskClass: number,
  laneId: string,
  extras?: ConfirmExtras,
): Promise<ConfirmVerdict> {
  const id = `c${++confirmCounter}`;
  send({ type: 'confirm', id, question, riskClass, laneId, ts: Date.now(), timeoutMs: CONFIRM_TIMEOUT_MS, ...(extras ?? {}) });
  return new Promise((resolve) => {
    pendingConfirms.set(id, resolve);
    setTimeout(() => {
      if (pendingConfirms.delete(id)) {
        send({ type: 'confirm-expired', id });
        resolve('timeout');
      }
    }, CONFIRM_TIMEOUT_MS);
  });
}

const HELLO_ENABLED = (() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'aeryx.config.json'), 'utf-8'));
    return cfg.helloClass3 !== false;
  } catch {
    return true;
  }
})();

Object.assign(process.env, PRIVACY_ENV);
const PROVIDER_ENV_KEYS = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN']);
let BRAIN_TOKEN = '';

let RESUME_SESSION = '';
let bootSettled: () => void = () => {};
const bootHandshake = new Promise<void>((resolve) => { bootSettled = resolve; });
setTimeout(() => bootSettled(), 3000);

function helloVerify(message: string): Promise<'verified' | 'declined' | 'unavailable'> {
  if (!HELLO_ENABLED) return Promise.resolve('unavailable');
  if (BRAIN_TOKEN) {
    return fetch(`${DAEMON_URL}/internal/hello`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: BRAIN_TOKEN, message: message.slice(0, 200) }),
      signal: AbortSignal.timeout(95_000),
    })
      .then(async (res) => {
        if (!res.ok) return 'unavailable' as const;
        const d: any = await res.json().catch(() => ({}));
        return d.result === 'verified' || d.result === 'declined' ? d.result : ('unavailable' as const);
      })
      .catch(() => 'unavailable' as const);
  }
  return new Promise((resolve) => {
    const script = path.join(ROOT, 'scripts', 'hello-verify.ps1');
    if (!fs.existsSync(script)) return resolve('unavailable');
    const p = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Message', message.slice(0, 200)],
      { cwd: ROOT, windowsHide: true, stdio: 'ignore' },
    );
    const t = setTimeout(() => {
      p.kill();
      resolve('unavailable');
    }, 90_000);
    p.on('error', () => { clearTimeout(t); resolve('unavailable'); });
    p.on('exit', (code) => {
      clearTimeout(t);
      resolve(code === 0 ? 'verified' : 'declined');
    });
  });
}

function noteLadder(laneId: string, verdict: string, text: string, speak = false) {
  logCmd('ladder', laneId, 3, laneLabel(laneId), verdict);
  send({ type: 'info', text, speak });
}

function offerStanding(laneId: string) {
  if (pendingConfirms.size > 0) return;
  void (async () => {
    const answer = await askConfirmation(
      `You've let me handle ${laneLabel(laneId)} ${ladderPolicy.standingTarget} times without stepping in. Keep it that way permanently?`,
      2,
      `ladder.standing:${laneId}`,
    );
    const accept = answer === 'timeout' ? null : answer === 'yes';
    const { lane, effect } = onStandingResponse(laneOf(laneId), accept);
    lanes.set(laneId, lane);
    if (effect.kind === 'promoted') {
      noteLadder(laneId, LADDER_VERDICT.standing, `standing autonomy granted: ${laneLabel(laneId)}`, true);
    } else if (accept === false) {
      noteLadder(laneId, LADDER_VERDICT.declined, `keeping ${laneLabel(laneId)} at session-only`);
    }
  })();
}

function realTarget(input: Record<string, unknown>): string | null {
  const raw = String(input.file_path ?? input.notebook_path ?? input.path ?? '');
  if (!raw || !path.isAbsolute(raw)) return null;
  let base = path.resolve(raw);
  const rest: string[] = [];
  while (!fs.existsSync(base)) {
    const up = path.dirname(base);
    if (up === base) return null;
    rest.unshift(path.basename(base));
    base = up;
  }
  try {
    const real = path.join(fs.realpathSync(base), ...rest);
    return real !== path.resolve(raw) ? real : null;
  } catch {
    return null;
  }
}

async function canUseTool(toolName: string, input: Record<string, unknown>) {
  const allow = { behavior: 'allow' as const, updatedInput: input };
  const gr = { ...guardrails, selfPaths, scratchDirs };
  const real = realTarget(input);
  const c = viaFloor(real
    ? stricter(classify(toolName, input, gr, gateState), classify(toolName, { ...input, file_path: real }, gr, gateState))
    : classify(toolName, input, gr, gateState), lastVia);
  const detail = auditDetail(input);
  const record = (verdict: string) => logCmd(toolName, c.laneId, c.riskClass, detail, verdict);

  if (c.denyReason) {
    record('denied');
    send({ type: 'blocked', tool: toolName, lane: c.laneId, reason: c.denyReason });
    return { behavior: 'deny' as const, message: c.denyReason };
  }

  const guard = mindTools.askGuard(lastVia, c.laneId);
  if (guard) {
    record(guard.verdict);
    if (guard.kind === 'deny') {
      send({ type: 'blocked', tool: toolName, lane: c.laneId, reason: guard.reason });
      return { behavior: 'deny' as const, message: guard.message };
    }
    return allow;
  }

  if (currentScope && lastVia === 'workflow' && !gateState.tainted && scopeAllows(c.laneId, currentScope)) {
    record('auto:scope');
    return allow;
  }

  if (c.riskClass >= 2) {
    const canClimb = eligible(c.laneId, c.riskClass, ladderPolicy);
    const lane = laneOf(c.laneId);

    if (canClimb && lane.tier !== 'ask') {
      record(`auto:${lane.tier}`);
      const { lane: next, effect } = onAutoUse(lane, ladderPolicy);
      lanes.set(c.laneId, next);
      if (effect.kind === 'propose-standing') offerStanding(c.laneId);
    } else {
      let answer = await askConfirmation(
        c.question ?? `Allow ${toolName}?`, c.riskClass, c.laneId,
        mindTools.confirmExtras(toolName, input, c.laneId),
      );

      let verdictSuffix = '';
      if (answer === 'yes' && c.riskClass >= 3) {
        const hello = await helloVerify(c.question ?? `Allow ${toolName}?`);
        const verdict = class3Verdict(hello, !HELLO_ENABLED);
        verdictSuffix = verdict.suffix;
        if (!verdict.allow) answer = 'no';
        if (hello === 'unavailable') {
          send({ type: 'info', text: verdict.allow
            ? 'Class 3 approved by UI only — helloClass3 is off in aeryx.config.json'
            : 'identity check unavailable — Class 3 denied (set helloClass3:false to allow UI-only approval)' });
        }
      }
      record(answer === 'yes' ? `confirmed${verdictSuffix}` : `rejected${verdictSuffix}`);

      if (canClimb && answer !== 'timeout') {
        const { lane: next, effect } = onDecision(lane, answer === 'yes', ladderPolicy);
        lanes.set(c.laneId, next);
        if (effect.kind === 'promoted') {
          noteLadder(c.laneId, LADDER_VERDICT.session,
            `that's ${ladderPolicy.streakTarget} in a row — I'll stop asking about ${laneLabel(c.laneId)} until I restart. Say "ask me again" to undo.`, true);
        } else if (effect.kind === 'demoted') {
          noteLadder(c.laneId, LADDER_VERDICT.demoted, `back to asking about ${laneLabel(c.laneId)}`);
        }
      }

      if (answer !== 'yes') return { behavior: 'deny' as const, message: 'The user declined this action.' };
    }
  } else {
    record('auto');
  }

  if (c.taints && !gateState.tainted) {
    gateState.tainted = true;
    send({ type: 'info', text: 'reading external content — commands will need confirmation from here' });
  }

  return allow;
}

function handleLadderCommand(action: string, laneId?: string) {
  if (action === 'revoke') {
    const targets = laneId ? [laneId] : [...lanes.keys()];
    let dropped = 0;
    for (const id of targets) {
      const { lane, effect } = revokeLane(laneOf(id));
      lanes.set(id, lane);
      if (effect.kind === 'demoted') {
        logCmd('ladder', id, 3, laneLabel(id), LADDER_VERDICT.revoked);
        dropped++;
      }
    }
    send({
      type: 'info',
      speak: true,
      text: dropped
        ? `Revoked ${dropped} autonomy grant${dropped === 1 ? '' : 's'} — I'll ask about everything again.`
        : 'Nothing to revoke — I already ask about everything.',
    });
    return;
  }

  const granted = [...lanes].filter(([, l]) => l.tier !== 'ask');
  send({
    type: 'info',
    speak: true,
    text: granted.length
      ? `I act without asking on: ${granted.map(([id, l]) => `${laneLabel(id)} (${l.tier})`).join('; ')}.`
      : 'I ask you about everything above routine work right now.',
  });
}

const DAEMON_URL = `http://127.0.0.1:${process.env.AERYX_PORT || 23799}`;

async function daemonCall(method: string, route: string, body?: unknown): Promise<unknown> {
  const res = await fetch(DAEMON_URL + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data.error ?? `daemon replied ${res.status}`));
  return data;
}

const asText = (v: unknown) => ({
  content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v) }],
});

const MIND = mindTools.tools({ daemonUrl: DAEMON_URL, token: () => BRAIN_TOKEN, daemonCall, asText });
const VERBS = mindTools.verbText();

const idArg = {
  id: z.number().int().describe('workflow id (from workflow_list)'),
  name: z.string().optional().describe('workflow name — shown to the user in the approval prompt'),
};
const agentIdArg = {
  id: z.number().int().describe('agent id (from agent_list)'),
  slug: z.string().optional().describe('agent slug — shown to the user in the approval prompt'),
};
const SCHEDULE_HELP =
  'manual | every 15m | every 2h | daily@08:00 | weekdays@07:30 | weekends@10:00 | weekly@mon 09:00 | monthly@1 09:00';

const workflowServer = createSdkMcpServer({
  name: 'aeryx',
  version: '1.0.0',
  tools: [
    tool('workflow_list', 'List every workflow: status, schedule, last and next run.', {},
      async () => asText(await daemonCall('GET', '/workflows'))),
    tool('workflow_runs', 'Recent runs of one workflow.',
      { id: z.number().int(), limit: z.number().int().min(1).max(50).optional() },
      async (a) => asText(await daemonCall('GET', `/workflows/${a.id}/runs${a.limit ? `?limit=${a.limit}` : ''}`))),
    tool('workflow_propose',
      'Draft a new scheduled workflow. It arms NOTHING until the user approves it ' +
      '(status-page button, or workflow_approve when asked by voice). ' +
      `Schedule grammar: ${SCHEDULE_HELP}. ` + VERBS.scopeHelp,
      {
        name: z.string(),
        purpose: z.string().describe('plain words: what this automation is for'),
        prompt: z.string().describe('the instruction the brain will run on schedule'),
        schedule: z.string(),
        scope: z.array(z.string()).optional().describe('standing-order lane patterns; omit for confirm-everything'),
        runner: z.enum(['brain', ...VERBS.runners] as [string, ...string[]]).optional().describe(
          "which engine runs it: 'brain' (you, the default)" + VERBS.runnerNote),
      },
      async (a) => asText(await daemonCall('POST', '/workflows', { ...a, status: 'proposed', source: 'brain' }))),
    tool('workflow_approve', 'Activate a proposed workflow so it runs on its schedule.', idArg,
      async (a) => asText(await daemonCall('POST', `/workflows/${a.id}/approve`))),
    tool('workflow_edit',
      'Change a workflow (name/purpose/prompt/schedule/scope). Changing the prompt or the ' +
      'standing-order scope of an ACTIVE workflow demotes it to proposed — the user re-approves.',
      {
        ...idArg, purpose: z.string().optional(), prompt: z.string().optional(),
        schedule: z.string().optional(), scope: z.array(z.string()).optional(),
      },
      async (a) => {
        const { id, ...patch } = a;
        return asText(await daemonCall('POST', `/workflows/${id}/edit`, patch));
      }),
    tool('workflow_pause', 'Pause an active workflow. It keeps its history and can be resumed.', idArg,
      async (a) => asText(await daemonCall('POST', `/workflows/${a.id}/pause`))),
    tool('workflow_resume', 'Resume a paused workflow.', idArg,
      async (a) => asText(await daemonCall('POST', `/workflows/${a.id}/resume`))),
    tool('workflow_delete', 'Delete a workflow and its run history.', idArg,
      async (a) => asText(await daemonCall('POST', `/workflows/${a.id}/delete`))),
    tool('workflow_run_now', 'Run a workflow immediately, outside its schedule.', idArg,
      async (a) => asText(await daemonCall('POST', `/workflows/${a.id}/run`))),
    ...MIND.afterWorkflows,
    tool('agent_list', 'List permanent agents: roster status, description, tools.', {},
      async () => asText(await daemonCall('GET', '/agents'))),
    tool('agent_propose',
      'Draft a permanent agent. It joins NOTHING until the user approves it; ' +
      'active agents load into the roster at the next brain start. Omit tools ' +
      'to inherit the parent set — every call a subagent makes is still gated ' +
      'by the Chain either way.',
      {
        slug: z.string().describe('kebab-case name, e.g. inbox-triager'),
        description: z.string().describe('when to use this agent — routing happens on this'),
        prompt: z.string().describe('the agent\'s system prompt'),
        tools: z.array(z.string()).optional().describe('allowed tool names; omit to inherit'),
      },
      async (a) => asText(await daemonCall('POST', '/agents', { ...a, status: 'proposed', source: 'brain' }))),
    tool('agent_approve', 'Activate a proposed agent (joins the roster at next brain start).', agentIdArg,
      async (a) => asText(await daemonCall('POST', `/agents/${a.id}/approve`))),
    tool('agent_edit', 'Change a permanent agent (slug/description/prompt/tools).',
      { ...agentIdArg, description: z.string().optional(), prompt: z.string().optional(), tools: z.array(z.string()).optional() },
      async (a) => {
        const { id, ...patch } = a;
        return asText(await daemonCall('POST', `/agents/${id}/edit`, patch));
      }),
    tool('agent_retire', 'Retire an agent from the roster. Kept in history; revive restores it.', agentIdArg,
      async (a) => asText(await daemonCall('POST', `/agents/${a.id}/retire`))),
    tool('agent_revive', 'Re-activate a retired agent.', agentIdArg,
      async (a) => asText(await daemonCall('POST', `/agents/${a.id}/revive`))),
    ...MIND.afterAgents,

    tool('about_me_draft',
      'Propose a complete draft of the user\'s About Me (memory/user.md). Writes nothing — ' +
      'the user reads and applies it in the Lair. Use after interviewing them; include ' +
      'everything the file should say (it replaces the whole file).',
      { content: z.string().describe('the full markdown for user.md') },
      async (a) => asText(await daemonCall('POST', '/hoard/draft', { content: a.content }))),

    tool('lens_show', VERBS.lensShow,
      {
        template: z.enum(['document', 'table']).describe('which renderer — document (68ch prose) or table (rows)'),
        id: z.string().describe(VERBS.lensId),
      },
      async (a) => asText(await daemonCall('POST', '/internal/lens-show', { token: BRAIN_TOKEN, ...a }))),
  ],
});

async function loadRoster(): Promise<Record<string, { description: string; prompt: string; tools?: string[] }>> {
  try {
    const data: any = await daemonCall('GET', '/agents');
    const roster: Record<string, { description: string; prompt: string; tools?: string[] }> = {};
    for (const a of data.agents ?? []) {
      if (a.status !== 'active') continue;
      roster[a.slug] = {
        description: String(a.description),
        prompt: String(a.prompt),
        ...(a.tools ? { tools: JSON.parse(a.tools) as string[] } : {}),
      };
    }
    return roster;
  } catch (e: any) {
    console.error(`[agents] roster unavailable (${e?.message ?? e}) — running without permanent agents`);
    return {};
  }
}

function externalMcpServers(): Record<string, unknown> {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'aeryx.config.json'), 'utf-8'));
    const out: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(cfg.mcpServers ?? {})) {
      if (name === 'aeryx') {
        console.error('[mcp] config server "aeryx" ignored — that name is reserved for the internal verb server');
        continue;
      }
      out[name] = def;
    }
    if (Object.keys(out).length) console.error(`[mcp] external servers: ${Object.keys(out).join(', ')}`);
    return out;
  } catch {
    return {};
  }
}

const recentExchanges: { role: string; text: string }[] = [];
let userTurns = 0;
let learning = false;

async function runLearningPass() {
  if (learning || recentExchanges.length === 0) return;
  learning = true;
  const transcript = recentExchanges
    .map((e) => `${e.role.toUpperCase()}: ${e.text}`)
    .join('\n');
  recentExchanges.length = 0;
  try {
    const learnedPath = path.join(MEMORY_DIR, 'learned.md');
    const existing = fs.existsSync(learnedPath) ? fs.readFileSync(learnedPath, 'utf-8') : '';
    const one = query({
      prompt:
        'From this assistant conversation transcript, extract durable facts worth remembering ' +
        'about the user: preferences, paths they use, routines, projects, corrections they gave. ' +
        'Output at most 5 facts, one per line, each a short plain sentence. ' +
        'If nothing is worth remembering long-term, output exactly: NONE\n\n' +
        transcript,
      options: {
        model: process.env.AERYX_MODEL || 'sonnet',
        tools: [],
        settingSources: [],
        maxTurns: 1,
      },
    });
    for await (const msg of one as AsyncIterable<any>) {
      if (msg.type === 'result' && msg.subtype === 'success' && msg.result) {
        const facts = String(msg.result)
          .split('\n')
          .map((l: string) => l.replace(/^[-*•\d.\s]+/, '').trim())
          .filter((l: string) => l && l !== 'NONE' && l.length > 8)
          .filter((l: string) => !existing.toLowerCase().includes(l.toLowerCase().slice(0, 40)));
        if (facts.length) {
          send({ type: 'notice', facts });
        }
      }
    }
  } catch (e: any) {
    send({ type: 'error', message: `learning pass failed: ${e.message}` });
  } finally {
    learning = false;
  }
}

const FACES = { aeri: 'as Aeri, your red form (she/her); answer as Aeri' } as const;
const queue: { text: string; via: string; runId?: number; scope?: string[]; face?: keyof typeof FACES }[] = [];
let wake: (() => void) | null = null;
let lastVia = 'typed';
let lastRunId: number | undefined;
let currentScope: string[] | null = null;

async function* userInput(): AsyncGenerator<any> {
  while (true) {
    while (queue.length === 0) {
      await new Promise<void>((r) => (wake = r));
      wake = null;
    }
    const { text, via, runId, scope, face } = queue.shift()!;
    lastVia = via;
    lastRunId = runId;
    currentScope = via === 'workflow' && Array.isArray(scope) && scope.length > 0 ? scope : null;
    logMsg.run(via === 'workflow' ? 'workflow' : via === 'boot' ? 'boot' : 'user', text);
    if (via !== 'workflow' && via !== 'boot') {
      recentExchanges.push({ role: 'user', text });
      userTurns++;
    }
    send({ type: 'state', state: 'thinking', via });
    yield { type: 'user', message: { role: 'user', content: `[${via}${face ? ` · ${FACES[face]}` : ''}] ${text}` } };
  }
}

let activeQuery: any = null;

async function main() {
  replayGrants();
  const persona = readMemory();
  const roster = await loadRoster();
  if (Object.keys(roster).length) {
    console.error(`[agents] permanent roster: ${Object.keys(roster).join(', ')}`);
  }
  await bootHandshake;

  try {
    await runSession(persona, roster, RESUME_SESSION);
  } catch (e: any) {
    if (!RESUME_SESSION) throw e;
    console.error(`[continuity] resume failed (${e?.message ?? e}) — starting a fresh session`);
    send({ type: 'resumed', ok: false, why: String(e?.message ?? e).slice(0, 200) });
    RESUME_SESSION = '';
    await runSession(persona, roster, '');
  }
}

function pluginRootOnDisk(dir: string): string | null {
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  let manifest: unknown;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf-8')); } catch { manifest = undefined; }
  return pluginRootIssue(entries, manifest);
}

async function runSession(persona: string, roster: Awaited<ReturnType<typeof loadRoster>>, resume: string) {
  const shape = sessionShape(ROOT, WORKSPACE, process.env);
  const unsafe = sessionShapeIssue(shape, ROOT) ?? shape.plugins.map((p) => pluginRootOnDisk(p.path)).find(Boolean) ?? null;
  if (unsafe) throw new Error(`refusing to start the session — ${unsafe}`);
  console.error(`[session] ${shape.model} effort=${shape.effort} turns=${shape.maxTurns} skills=all settings=none`);
  const q = query({
    prompt: userInput(),
    options: {
      ...shape,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: persona },
      canUseTool: canUseTool as any,
      mcpServers: { ...externalMcpServers(), aeryx: workflowServer } as any,
      ...(Object.keys(roster).length ? { agents: roster } : {}),
      ...(resume ? { resume } : {}),
    },
  });
  activeQuery = q;
  let costSoFar = 0;
  if (resume) console.error(`[continuity] resuming session ${resume.slice(0, 8)}…`);

  for await (const msg of q as AsyncIterable<any>) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      const mine = (msg.skills ?? []).filter((s: string) => s.startsWith('aeryx'));
      const drafts = mine.filter((s: string) => s.startsWith('aeryx-drafts:'));
      console.error(`[skills] ${mine.length} loaded (${drafts.length} draft): ${mine.join(', ') || '(none)'}`);
      const roster: string[] = msg.agents ?? [];
      console.error(`[agents] ${roster.length} loaded: ${roster.join(', ') || '(none)'}`);
      send({ type: 'ready', session: msg.session_id, model: msg.model });
      if (resume) send({ type: 'resumed', ok: true, session: msg.session_id });
    } else if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'tool_use') {
          const detail =
            typeof block.input?.command === 'string'
              ? block.input.command.slice(0, 80)
              : typeof block.input?.file_path === 'string'
                ? block.input.file_path
                : '';
          if (block.name === 'Task' || block.name === 'Agent') {
            const kind = String(block.input?.subagent_type ?? 'unnamed').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unnamed';
            const what = String(block.input?.description ?? block.input?.prompt ?? '').slice(0, 150);
            logCmd('wyrmling', `wyrmling.${kind}`, 0, what, 'spawned');
          }
          send({ type: 'tool', name: block.name, detail });
          send({ type: 'state', state: 'executing' });
        }
      }
    } else if (msg.type === 'result') {
      const text =
        msg.subtype === 'success' && msg.result
          ? String(msg.result)
          : 'I ran into a problem with that one.';
      logMsg.run('assistant', text);
      if (lastVia !== 'workflow' && lastVia !== 'boot') recentExchanges.push({ role: 'aeryx', text });
      const u = msg.usage ?? {};
      const cost = costDelta(costSoFar, msg.total_cost_usd);
      costSoFar = cost.total;
      send({
        type: 'usage', inputTokens: u.input_tokens, outputTokens: u.output_tokens,
        cacheTokens: (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), costUsd: cost.delta,
      });
      send({
        type: 'say', text, via: lastVia, ok: msg.subtype === 'success',
        ...(lastRunId !== undefined ? { runId: lastRunId } : {}),
      });
      currentScope = null;
      send({ type: 'state', state: 'idle' });
      if (userTurns > 0 && userTurns % 5 === 0) void runLearningPass();
    }
  }
}

const mindLogs = mindTools.logHandlers(logCmd);
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type === 'ask' && typeof msg.text === 'string' && msg.text.trim()) {
    const via = msg.via === 'voice' ? 'voice'
      : msg.via === 'workflow' ? 'workflow'
      : msg.via === 'boot' ? 'boot'
      : mindTools.via(msg.via) ?? 'typed';
    queue.push({
      text: msg.text.trim(),
      via,
      runId: typeof msg.runId === 'number' ? msg.runId : undefined,
      ...(via === 'workflow' && Array.isArray(msg.scope)
        ? { scope: msg.scope.filter((s: unknown) => typeof s === 'string') }
        : {}),
      ...((via === 'typed' || via === 'voice') && msg.face === 'aeri' ? { face: 'aeri' as const } : {}),
    });
    wake?.();
  } else if (msg.type === 'confirm-response') {
    const resolve = pendingConfirms.get(msg.id);
    if (resolve) {
      pendingConfirms.delete(msg.id);
      resolve(msg.approve ? 'yes' : 'no');
    }
  } else if (msg.type === 'halt-log') {
    logCmd('halt', 'daemon.halt', 0, String(msg.detail ?? '').slice(0, 200), 'halted');
  } else if (msg.type === 'workflow-log') {
    const lane = String(msg.lane ?? 'event').replace(/[^a-z0-9.:_-]/gi, '').slice(0, 64);
    const verdict = String(msg.verdict ?? 'logged').replace(/[^a-z0-9:_-]/gi, '').slice(0, 40) || 'logged';
    logCmd('workflow', lane.startsWith('workflow.') ? lane : `workflow.${lane}`, 0, String(msg.detail ?? '').slice(0, 200), verdict);
  } else if (msg.type === 'setup-log') {
    const lane = String(msg.lane ?? 'event').replace(/[^a-z0-9.:_-]/gi, '').slice(0, 64);
    const verdict = String(msg.verdict ?? 'logged').replace(/[^a-z0-9:_+-]/gi, '').slice(0, 40) || 'logged';
    logCmd('setup', lane.startsWith('setup.') ? lane : `setup.${lane}`, 0, String(msg.detail ?? '').slice(0, 200), verdict);
  } else if (msg.type === 'hoard-log') {
    const lane = String(msg.lane ?? 'event').replace(/[^a-z0-9.:_-]/gi, '').slice(0, 64);
    const verdict = String(msg.verdict ?? 'logged').replace(/[^a-z0-9:_-]/gi, '').slice(0, 40) || 'logged';
    logCmd('hoard', lane.startsWith('hoard.') ? lane : `hoard.${lane}`, 0, String(msg.detail ?? '').slice(0, 200), verdict);
  } else if (msg.type === 'boot') {
    if (typeof msg.token === 'string' && msg.token) BRAIN_TOKEN = msg.token;
    if (typeof msg.configDir === 'string' && msg.configDir && !process.env.CLAUDE_CONFIG_DIR) {
      process.env.CLAUDE_CONFIG_DIR = msg.configDir;
    }
    if (typeof msg.oauthToken === 'string' && msg.oauthToken && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = msg.oauthToken;
    }
    if (msg.provider && typeof msg.provider === 'object') {
      const env = msg.provider.env && typeof msg.provider.env === 'object' ? msg.provider.env : {};
      for (const [k, v] of Object.entries(env)) {
        if (PROVIDER_ENV_KEYS.has(k) && typeof v === 'string') process.env[k] = v;
      }
      if (typeof msg.provider.model === 'string' && msg.provider.model) process.env.AERYX_MODEL = msg.provider.model;
    }
    if (typeof msg.resumeSession === 'string') RESUME_SESSION = msg.resumeSession;
    if (msg.localOnly === true) gateState.localOnly = true;
    bootSettled();
    send({ type: 'state', state: 'idle' });
  } else if (msg.type === 'lens-log') {
    const lane = String(msg.lane ?? 'event').replace(/[^a-z0-9.:_-]/gi, '').slice(0, 64);
    const verdict = String(msg.verdict ?? 'logged').replace(/[^a-z0-9:_-]/gi, '').slice(0, 40) || 'logged';
    logCmd('lens', lane.startsWith('lens.') ? lane : `lens.${lane}`, 0, String(msg.detail ?? '').slice(0, 200), verdict);
  } else if (msg.type === 'agent-log') {
    const lane = String(msg.lane ?? 'event').replace(/[^a-z0-9.:_-]/gi, '').slice(0, 64);
    const verdict = String(msg.verdict ?? 'logged').replace(/[^a-z0-9:_-]/gi, '').slice(0, 40) || 'logged';
    logCmd('agent', lane.startsWith('agent.') ? lane : `agent.${lane}`, 0, String(msg.detail ?? '').slice(0, 200), verdict);
  } else if (msg.type === 'ladder') {
    handleLadderCommand(String(msg.action ?? 'status'), typeof msg.lane === 'string' ? msg.lane : undefined);
  } else if (msg.type === 'set-model' && typeof msg.model === 'string') {
    void (async () => {
      try {
        if (activeQuery && typeof activeQuery.setModel === 'function') {
          await activeQuery.setModel(msg.model);
          send({ type: 'info', text: `model is now ${msg.model} (session kept)` });
        } else {
          send({ type: 'info', text: `restarting brain on ${msg.model}…` });
          process.exit(0);
        }
      } catch (e: any) {
        send({ type: 'error', message: `model switch failed: ${e.message}` });
      }
    })();
  } else if (typeof msg.type === 'string' && Object.hasOwn(mindLogs, msg.type)) {
    mindLogs[msg.type](msg);
  }
});

main().catch((err) => {
  send({ type: 'error', message: String(err?.message ?? err) });
  process.exit(1);
});
