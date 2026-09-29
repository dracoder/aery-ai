import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { buildWakeRe, wakeCue, wakePhrases, wakePhraseIssue, voiceConfirm } from './wake';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { lookup as dnsLookup } from 'node:dns/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { addUsage, costBasis, sanitizeUsage, summarize } from './usage';
import { verifyChain, type StoredAuditRow } from '../chain/audit';
import { createMind } from './mind';
import type { MicMode } from './mind-api';
import { safeSourceUrl, blockedAddress } from './fetchgate';
import { runBackup } from './backup';
import { PROVIDERS, isOllamaCloudModel, isProviderKind, providerEnv, readProviderConfig, setupNeeded, type ProviderKind } from '../brain/providers';
import { readSecret, storeSecret, validSecret } from './secretstore';
import { parseSchedule, describeSchedule } from './schedule';
import { synthesizeSpeech, type TtsClient, type TtsLoader } from './speech';
import { WorkflowStore, parseScope, initialStatus, scopeForRun, type Workflow } from './workflows';
import { AgentStore, type PermanentAgent } from './agents';
import {
  bearerToken, brainTokenOk, freshAuthState, isLocalAddress, readRemoteConfig, resolveBind, revokeToken, revokeAllSessions,
  tokenFromCookie, tryPin, validNewPin, hashPin, applyPinToConfig,
  validateHoardWrite, crossOriginRefusal, extraHostNames, port80Wanted, remoteAllowed as gateAllows, HOARD_FILES, TOKEN_TTL_MS,
} from './auth';
import { COUNTRY_NAMES, cachedImageUrls, emptyCache, normalizeFeeds, refreshNews, type NewsCache } from './news';
import { brainSpawnPlan, readBrainRunConfig, credentialSyncPlan, brainTokenPath, validStandingToken, brainCredentialMode, type SpawnPlan } from './warden';
import * as os from 'node:os';
import { isHumanOnly, loopbackPeerOwner } from './peer';
import { firstHeading, validateLensTarget, type LensPanel } from './lens';
import { listSkins, skinFile } from './skins';
import { installSkinPack, removeSkin, MAX_PACK_BYTES } from './skinpack';
import {
  daemonRole, roleRuns, sessionTokenPath, sessionAttached, sessionStatus,
  validSessionRegistration, capabilityAvailable, SESSION_STALE_MS,
  type Role, type AttachedSession,
} from './core';
import { NoticeStore } from './hoard';
import {
  CONTINUITY_REL, JOURNAL_EXCHANGES, JOURNAL_EVENTS, renderContinuity, parseContinuity, resumePlan,
  wakePrompt, wakeOnBoot, isHomecoming, shouldGreet, mergeExchanges, redactSecrets,
  type Exchange as JournalExchange, type GovernanceEvent, type ResumePlan,
} from './continuity';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'aeryx.db');
const SKINS_DIR = path.join(DATA_DIR, 'skins');

function sendStatic(req: http.IncomingMessage, res: http.ServerResponse, f: string): void {
  const ext = f.slice(f.lastIndexOf('.') + 1);
  const ranged = ext === 'glb' || ext === 'm4a';
  const { size, mtime } = fs.statSync(f);
  const modified = mtime.toUTCString();
  if (req.headers['if-modified-since'] === modified) { res.writeHead(304, { 'last-modified': modified }); res.end(); return; }
  const range = ranged ? /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || '')) : null;
  const start = range ? Number(range[1]) : 0;
  const end = range ? Math.min(range[2] ? Number(range[2]) : size - 1, size - 1) : size - 1;
  if (range && (start >= size || end < start)) {
    res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return;
  }
  res.writeHead(range ? 206 : 200, {
    'content-type': ({ glb: 'model/gltf-binary', m4a: 'audio/mp4', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' } as Record<string, string>)[ext]!,
    'cache-control': 'public, max-age=0, must-revalidate',
    'last-modified': modified,
    'content-length': end - start + 1,
    ...(ranged ? { 'accept-ranges': 'bytes' } : {}),
    ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
  });
  fs.createReadStream(f, { start, end }).pipe(res);
}

const PORT = Number(process.env.AERYX_PORT || 23799);
const BRAIN_TOKEN = randomBytes(32).toString('hex');

const ROLE: Role = daemonRole(process.argv.slice(2), readConfigRaw());

if (ROLE === 'session') {
  console.error('[daemon] --role session is the session agent, not aeryxd. Run dist/session-agent.mjs instead.');
  process.exit(2);
}

let SESSION: AttachedSession | null = null;

const SESSION_TOKEN = randomBytes(32).toString('hex');

function mintSessionToken() {
  try {
    const p = sessionTokenPath(ROOT);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, SESSION_TOKEN, { encoding: 'utf-8', mode: 0o600 });
  } catch (e: any) {
    log('daemon', `could not leave the session token (${String(e?.message ?? e)}) — no desk will be able to attach`);
  }
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "media-src 'self'",
  "connect-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const MEMORY_DIR = path.join(ROOT, 'memory');

fs.mkdirSync(DATA_DIR, { recursive: true });

function log(scope: string, msg: string) {
  console.error(`[${scope}] ${msg}`);
}

interface Client {
  res: http.ServerResponse;
}
const clients = new Set<Client>();
let eventSeq = 0;

function broadcast(event: Record<string, unknown>) {
  const payload = `id: ${++eventSeq}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    try {
      c.res.write(payload);
    } catch {
      clients.delete(c);
    }
  }
}

const startedAt = Date.now();
let brain: ChildProcess | null = null;
let brainState = 'offline';
let brainVia: string | null = null;
let brainKind: string | null = null;
const USAGE_FILE = path.join(ROOT, 'data', 'usage.json');
const localOnly = (): boolean => readConfigRaw()?.privacy?.localOnly === true;
const LOCAL_ONLY_MSG = 'local-only mode is on, so nothing leaves this machine';
const localDay = (d = new Date()) => d.toLocaleDateString('sv');
const VERSION: string = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version ?? 'dev'); } catch { return 'dev'; }
})();
let session: string | null = null;
let model: string | null = null;
const pendingConfirms = new Map<
  string,
  {
    question: string; ts: number; riskClass: number; laneId: string; timeoutMs: number;
    extra?: Record<string, unknown>;
  }
>();

function sendBrain(obj: Record<string, unknown>): boolean {
  if (!brain?.stdin?.writable) return false;
  try {
    brain.stdin.write(JSON.stringify(obj) + '\n');
    return true;
  } catch {
    return false;
  }
}

const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 5;
const RESTART_DELAY_MS = 1_000;

interface Supervisor {
  stderrTail: string[];
  noteStderr(line: string): void;
  noteExit(code: number | null, signal: string | null): number | null;
}

function makeSupervisor(name: string): Supervisor {
  const crashes: number[] = [];
  const sup: Supervisor = {
    stderrTail: [],
    noteStderr(line: string) {
      sup.stderrTail.push(line);
      if (sup.stderrTail.length > 60) sup.stderrTail.shift();
      log(`${name}:err`, line);
    },
    noteExit(code, signal) {
      const now = Date.now();
      crashes.push(now);
      while (crashes.length && crashes[0]! < now - CRASH_WINDOW_MS) crashes.shift();

      const abnormal = code !== 0 || signal;
      if (abnormal) {
        const report = [
          `--- ${name} exit @ ${new Date(now).toISOString()} ---`,
          `exit code: ${code} signal: ${signal ?? 'none'}`,
          code === 4294967295 ? 'note: 0xFFFFFFFF means a native-level fault, not a JS throw' : '',
          sup.stderrTail.length ? `stderr tail:\n${sup.stderrTail.join('\n')}` : '(no stderr captured)',
        ].filter(Boolean).join('\n');
        try {
          fs.appendFileSync(path.join(DATA_DIR, 'crashes.log'), report + '\n');
        } catch { }
        log(name, `exited code=${code} signal=${signal}`);
      }

      if (crashes.length >= CRASH_LIMIT) {
        const msg = `${name} crashed ${crashes.length} times in a minute — giving up, see data/crashes.log`;
        log(name, msg);
        broadcast({ type: 'error', message: msg });
        return null;
      }
      return RESTART_DELAY_MS;
    },
  };
  return sup;
}

const brainSup = makeSupervisor('brain');

const HALT_FILE = path.join(DATA_DIR, 'halted');

function isHalted(): boolean {
  return fs.existsSync(HALT_FILE);
}

function haltReason(): string {
  try {
    return fs.readFileSync(HALT_FILE, 'utf-8').trim();
  } catch {
    return '';
  }
}

function setHalted(on: boolean, reason: string) {
  if (on) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HALT_FILE, `${new Date().toISOString()} — ${reason || 'halted by the user'}\n`, 'utf-8');
    brain?.kill();
    toVoice({ type: 'mic', mode: 'off' });
    log('daemon', `HALTED — ${reason || 'by the user'}`);
  } else {
    try { fs.rmSync(HALT_FILE); } catch {}
    log('daemon', 'halt cleared — resuming');
  }
  broadcast({ type: 'halt', halted: on, reason: on ? haltReason() : '' });
}

const WAKE_DELAY_MS = 4_000;
let bootWake: { plan: ResumePlan; done: boolean } | null = null;
let greetedThisBoot = false;

function maybeWakeGreeting() {
  if (greetedThisBoot || !bootWake || bootWake.done) return;
  bootWake.done = true;
  greetedThisBoot = true;
  const cfg = readConfigRaw();
  if (!wakeOnBoot(cfg)) return;
  if (isHalted()) return;
  if (!fs.existsSync(CONTINUITY_FILE)) return;
  if (!isHomecoming(os.uptime(), cfg)) {
    log('brain', `no greeting — the machine has been up ${Math.round(os.uptime() / 60)} min; this is a restart, not a homecoming`);
    return;
  }
  let saved: { greeted?: number | null } = {};
  try {
    saved = parseContinuity(fs.readFileSync(CONTINUITY_FILE, 'utf-8'));
  } catch { }
  const newest = newestConversationId();
  if (!shouldGreet(saved, newest)) {
    log('brain', 'no greeting — nothing has been said since the last one');
    return;
  }
  greetedMarker = newest;
  const plan = bootWake.plan;
  setTimeout(() => {
    if (isHalted() || !brain) return;
    log('brain', 'waking with the continuity greeting');
    sendBrain({ type: 'ask', text: wakePrompt(plan, recentGovernance(JOURNAL_EVENTS)), via: 'boot' });
  }, WAKE_DELAY_MS);
}

let STANDING_TOKEN: string | null | undefined;

function standingBrainToken(): string | null {
  if (STANDING_TOKEN !== undefined) return STANDING_TOKEN;
  STANDING_TOKEN = null;
  const cred = brainTokenPath(ROOT);
  if (!fs.existsSync(cred)) return STANDING_TOKEN;
  try {
    const blob = fs.readFileSync(cred, 'utf-8').trim();
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        'Add-Type -AssemblyName System.Security;' +
        '$b=[Console]::In.ReadToEnd().Trim();' +
        '[Console]::Out.Write([Text.Encoding]::UTF8.GetString(' +
        '[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($b),$null,' +
        '[Security.Cryptography.DataProtectionScope]::CurrentUser)))'],
      { input: blob, encoding: 'utf-8', windowsHide: true, timeout: 20_000 },
    ).trim();
    if (validStandingToken(out)) {
      STANDING_TOKEN = out;
      log('brain', 'the brain has a standing credential of its own');
    } else {
      log('brain', 'secrets/brain-token.cred did not decrypt to a usable token — re-run scripts/set-brain-token.ps1');
    }
  } catch (e: any) {
    log('brain', `could not read the standing brain token (${String(e?.message ?? e)}) — re-run scripts/set-brain-token.ps1`);
  }
  return STANDING_TOKEN;
}

function writeConfig(cfg: unknown) {
  const file = path.join(ROOT, 'aeryx.config.json');
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { }
}

function secretName(kind: ProviderKind): string {
  return kind === 'codex' ? 'openrouter' : kind;
}

function hasClaudeLogin(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  if (fs.existsSync(brainTokenPath(ROOT)) && standingBrainToken()) return true;
  if (fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json'))) return true;
  if (process.platform === 'darwin') {
    try {
      execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials'], { stdio: 'ignore', timeout: 10_000 });
      return true;
    } catch { }
  }
  return false;
}

const CLOUD_MODEL_MSG = (m: string) => `local-only mode is on: ${m} runs on ollama.com, pick a model pulled to this machine`;

function resolveBrainProvider(): { ready: false; why: string } | { ready: true; kind: ProviderKind; model: string | null; env: Record<string, string> | null } {
  const cfg = readConfigRaw();
  const p = readProviderConfig(cfg);
  if (p && 'error' in p) return { ready: false, why: p.error };
  if (localOnly() && p?.kind !== 'local') return { ready: false, why: 'local-only mode is on: connect a local model (Ollama)' };
  if (localOnly() && p?.kind === 'local' && isOllamaCloudModel(p.model)) return { ready: false, why: CLOUD_MODEL_MSG(p.model) };
  const secret = p ? readSecret(ROOT, secretName(p.kind)) : null;
  if (setupNeeded(cfg, hasClaudeLogin(), secret !== null)) {
    return { ready: false, why: p ? `${PROVIDERS[p.kind].label} has no key stored` : 'no model connected yet' };
  }
  if (!p) return { ready: true, kind: 'claude', model: null, env: null };
  const pe = providerEnv(p, secret);
  if ('error' in pe) return { ready: false, why: pe.error };
  return { ready: true, kind: p.kind, model: pe.model, env: pe.env };
}

let setupWhy: string | null = null;
const setupAuditBacklog: { lane: string; detail: string; verdict: string }[] = [];
const setupLog = (lane: string, detail: string, verdict: string) => {
  if (brain) sendBrain({ type: 'setup-log', lane, detail, verdict });
  else setupAuditBacklog.push({ lane, detail, verdict });
};

async function ollamaModels(baseUrl: string): Promise<{ reachable: boolean; models: string[]; remote: string[] }> {
  try {
    const r = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { reachable: false, models: [], remote: [] };
    const d: any = await r.json();
    const list = (Array.isArray(d?.models) ? d.models : []).filter((m: any) => m?.name).slice(0, 50);
    const remote = list.filter((m: any) => m.remote_host || m.remote_model || isOllamaCloudModel(String(m.name))).map((m: any) => String(m.name));
    return { reachable: true, models: list.map((m: any) => String(m.name)), remote };
  } catch {
    return { reachable: false, models: [], remote: [] };
  }
}

async function testProvider(kind: ProviderKind, env: Record<string, string>, model: string, secret: string | null): Promise<{ ok: boolean; detail: string }> {
  if (kind === 'claude' && (!secret || env.CLAUDE_CODE_OAUTH_TOKEN)) {
    return { ok: true, detail: secret ? 'Claude subscription token stored — the brain will use it' : "the brain will use this machine's Claude login" };
  }
  const base = env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (env.ANTHROPIC_API_KEY) headers['x-api-key'] = env.ANTHROPIC_API_KEY;
  if (env.ANTHROPIC_AUTH_TOKEN) headers.authorization = `Bearer ${env.ANTHROPIC_AUTH_TOKEN}`;
  try {
    const r = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }),
      signal: AbortSignal.timeout(kind === 'local' ? 120_000 : 30_000),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, detail: redactSecrets(String(d?.error?.message ?? d?.error ?? `HTTP ${r.status}`)).slice(0, 200) };
    const text = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text ?? '').join('').trim() : '';
    return { ok: true, detail: `${model} answered${text ? `: "${text.slice(0, 40)}"` : ''}` };
  } catch (e: any) {
    return { ok: false, detail: kind === 'local' ? 'Ollama did not answer — is it running (ollama serve) with the model pulled?' : `no answer (${String(e?.message ?? e).slice(0, 80)})` };
  }
}

function startBrain() {
  if (isHalted()) {
    log('brain', 'not starting — Aeryx is halted');
    return;
  }
  const provider = resolveBrainProvider();
  if (!provider.ready) {
    setupWhy = provider.why;
    brainState = 'needs-setup';
    log('brain', `waiting for setup — ${provider.why}`);
    broadcast({ type: 'setup-needed', why: provider.why });
    return;
  }
  setupWhy = null;
  brainKind = provider.kind;
  if (brainState === 'needs-setup') brainState = 'offline';
  const entry = path.join(ROOT, 'dist', 'brain.mjs');
  if (!fs.existsSync(entry)) {
    log('brain', `missing ${entry} — run npm run build`);
    return;
  }
  brainSup.stderrTail = [];
  const runCfg = readBrainRunConfig(readConfigRaw(), ROOT);
  const standing = standingBrainToken();
  log('brain', `credential: ${brainCredentialMode(runCfg, standing !== null)}`);
  const credSync = credentialSyncPlan(runCfg, os.homedir(), standing !== null);
  if (credSync) {
    try {
      if (fs.existsSync(credSync.from)) {
        fs.mkdirSync(path.dirname(credSync.to), { recursive: true });
        fs.copyFileSync(credSync.from, credSync.to);
        log('brain', 'refreshed the brain credential from the daemon profile');
      }
    } catch (e: any) {
      log('brain', `credential sync skipped (${String(e?.message ?? e)}) — existing copy left in place`);
    }
  }
  let plan: SpawnPlan;
  try {
    plan = brainSpawnPlan(
      runCfg, ROOT, process.execPath, entry,
      process.env as Record<string, string | undefined>, BRAIN_TOKEN, fs.existsSync,
    );
  } catch (e: any) {
    log('brain', String(e?.message ?? e));
    return;
  }
  brain = spawn(plan.command, plan.args, {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: plan.env,
    windowsHide: true,
  });
  log('brain', `started pid ${brain.pid}${plan.command.endsWith('warden.exe') ? ' (warden)' : ''}`);
  brain.stdin?.on('error', () => {});

  {
    const runCfg = readBrainRunConfig(readConfigRaw(), ROOT);
    const plan = plannedResume();
    resumedOk = null;
    resumeWhy = plan.why;
    log('brain', `continuity: ${plan.why}`);
    sendBrain({
      type: 'boot',
      token: BRAIN_TOKEN,
      ...(runCfg.runAs === 'warden' ? { configDir: runCfg.configDir } : {}),
      ...(standing ? { oauthToken: standing } : {}),
      ...(plan.resume ? { resumeSession: plan.sessionId } : {}),
      ...(provider.env ? { provider: { env: provider.env, model: provider.model } } : {}),
      ...(localOnly() ? { localOnly: true } : {}),
    });
    log('brain', `provider: ${PROVIDERS[provider.kind].label}${provider.model ? ` (${provider.model})` : ''}`);
    for (const row of setupAuditBacklog.splice(0)) sendBrain({ type: 'setup-log', ...row });
    bootWake = { plan, done: false };
    maybeWakeGreeting();
  }

  readline.createInterface({ input: brain.stdout! }).on('line', (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      brainState = 'idle';
      session = msg.session ?? null;
      model = msg.model ?? null;
      writeContinuity();
    } else if (msg.type === 'resumed') {
      resumedOk = msg.ok === true;
      resumeWhy = msg.ok === true ? 'resumed the last session' : String(msg.why ?? 'resume refused').slice(0, 200);
      log('brain', msg.ok ? `resumed session ${String(msg.session ?? '').slice(0, 8)}…` : `resume refused (${msg.why ?? 'unknown'}) — fresh session, journal still read`);
    } else if (msg.type === 'usage') {
      try { addUsage(USAGE_FILE, localDay(), sanitizeUsage(msg), brainKind); } catch { }
    } else if (msg.type === 'state' && typeof msg.state === 'string') {
      brainState = msg.state;
      brainVia = typeof msg.via === 'string' ? msg.via : brainVia;
    } else if (msg.type === 'confirm') {
      const id = String(msg.id);
      const extra = mind.confirmExtra(msg);
      pendingConfirms.set(id, {
        question: String(msg.question ?? ''),
        ts: Date.now(),
        riskClass: Number(msg.riskClass ?? 2),
        laneId: String(msg.laneId ?? ''),
        timeoutMs: Number(msg.timeoutMs ?? 90_000),
        ...(extra ? { extra } : {}),
      });
      mind.onConfirm(id, extra);
    } else if (msg.type === 'confirm-expired') {
      if (pendingConfirms.delete(String(msg.id))) {
        broadcast({ type: 'confirm-expired', id: String(msg.id) });
      }
    }
    if (msg.type === 'notice' && Array.isArray(msg.facts)) {
      try {
        const learnedPath = path.join(MEMORY_DIR, 'learned.md');
        const learned = fs.existsSync(learnedPath) ? fs.readFileSync(learnedPath, 'utf-8') : '';
        const added = notices.add(msg.facts.map(String), learned);
        if (added.length) {
          log('hoard', `${added.length} new notice${added.length === 1 ? '' : 's'} awaiting the user`);
          broadcast({ type: 'hoard-notice', pending: notices.pendingCount() });
        }
      } catch (e: any) {
        log('hoard', `noticing failed: ${e?.message ?? e}`);
      }
      return;
    }
    mind.onBrainMessage(msg);
    if (msg.type === 'say') touchContinuity();
    if (msg.type === 'say' && typeof msg.runId === 'number') {
      const closed = workflows.closeRun(msg.runId, msg.ok === false ? 'failed' : 'ok', String(msg.text ?? '').slice(0, 300));
      if (closed) {
        const wf = workflows.get(closed.workflowId);
        workflowLog('workflow.run', `#${closed.workflowId}${wf ? ` "${wf.name}"` : ''}`, msg.ok === false ? 'run-failed' : 'run-ok');
        broadcast({ type: 'workflow-run', id: closed.workflowId, name: wf?.name, outcome: closed.outcome, detail: closed.detail });
        broadcast({ type: 'workflows' });
      }
    }
    broadcast(msg);
    if (msg.type === 'say' && typeof msg.text === 'string' && msg.via !== 'workflow'
        && !(msg.via === 'boot' && mind.quietNow())) void speak(msg.text);
    else if (msg.type === 'info' && msg.speak === true && typeof msg.text === 'string') void speak(msg.text);
  });

  readline.createInterface({ input: brain.stderr! }).on('line', (l) => brainSup.noteStderr(l));

  brain.on('exit', (code, signal) => {
    writeContinuity(code === 0 ? undefined : `the brain exited unexpectedly (code ${code}${signal ? `, ${signal}` : ''})`);
    brain = null;
    brainState = 'offline';
    brainVia = null;
    session = null;
    pendingConfirms.clear();
    mind.onBrainExit();
    for (const run of workflows.failOpenRuns('brain went offline mid-run')) {
      broadcast({ type: 'workflow-run', id: run.workflowId, outcome: 'failed', detail: run.detail });
    }
    broadcast({ type: 'state', state: 'offline' });
    if (brainRestartRequested) {
      brainRestartRequested = false;
      log('brain', 'restart requested — starting fresh (roster and config re-read)');
      setTimeout(startBrain, 300);
      return;
    }
    const delay = brainSup.noteExit(code, signal ? String(signal) : null);
    if (delay === null) return;
    log('brain', `restarting in ${delay}ms`);
    setTimeout(startBrain, delay);
  });
}

const CONTINUITY_FILE = path.join(ROOT, ...CONTINUITY_REL);

function recentConversation(limit: number): JournalExchange[] {
  if (!fs.existsSync(DB_PATH)) return [];
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const rows = db
      .prepare("SELECT role, text, ts FROM conversations WHERE role != 'boot' ORDER BY id DESC LIMIT ?")
      .all(limit) as JournalExchange[];
    return rows.reverse();
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function recentGovernance(limit: number): GovernanceEvent[] {
  if (!fs.existsSync(DB_PATH)) return [];
  const governanceTools = ['hoard', 'halt', 'agent', ...mind.auditTools()];
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(
      `SELECT ts, lane, detail, verdict FROM commands
        WHERE tool IN (${governanceTools.map(() => '?').join(',')})
          AND (lane LIKE '%.govern%' OR verdict IN ('enabled','disabled','enabled+hello','pin-set+hello','restored','shed','halted','applied'))
        ORDER BY id DESC LIMIT ?`,
    ).all(...governanceTools, limit).reverse() as GovernanceEvent[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function newestConversationId(): number | null {
  if (!fs.existsSync(DB_PATH)) return null;
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db.prepare("SELECT MAX(id) AS n FROM conversations WHERE role != 'boot'").get() as { n: number | null };
    return row?.n ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

let greetedMarker: number | null = null;

const LOCAL_EXCHANGES_FILE = path.join(DATA_DIR, 'local-exchanges.json');
const LOCAL_EXCHANGES_CAP = 24;

function readLocalExchanges(): JournalExchange[] {
  try {
    const rows = JSON.parse(fs.readFileSync(LOCAL_EXCHANGES_FILE, 'utf-8'));
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r.text === 'string') : [];
  } catch {
    return [];
  }
}

function recordLocalExchange(question: string, answer: string) {
  try {
    const now = new Date().toISOString();
    const rows = [
      ...readLocalExchanges(),
      { role: 'user', text: redactSecrets(question).slice(0, 500), ts: now },
      { role: 'local', text: redactSecrets(answer).slice(0, 500), ts: now },
    ].slice(-LOCAL_EXCHANGES_CAP);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOCAL_EXCHANGES_FILE, JSON.stringify(rows), 'utf-8');
  } catch (e) {
    log('daemon', `local exchange not recorded: ${(e as Error).message}`);
  }
}

function writeContinuity(note?: string) {
  try {
    fs.mkdirSync(path.dirname(CONTINUITY_FILE), { recursive: true });
    const keptSession = session ?? (() => {
      try {
        return parseContinuity(fs.readFileSync(CONTINUITY_FILE, 'utf-8')).sessionId;
      } catch {
        return null;
      }
    })();
    fs.writeFileSync(
      CONTINUITY_FILE,
      renderContinuity({
        sessionId: keptSession,
        model,
        updatedTs: new Date().toISOString(),
        halted: isHalted(),
        exchanges: mergeExchanges(recentConversation(JOURNAL_EXCHANGES), readLocalExchanges(), JOURNAL_EXCHANGES),
        events: recentGovernance(JOURNAL_EVENTS),
        open: pendingProposalCounts(),
        greeted: greetedMarker ?? (() => {
          try {
            return parseContinuity(fs.readFileSync(CONTINUITY_FILE, 'utf-8')).greeted;
          } catch {
            return null;
          }
        })(),
        note,
      }),
      'utf-8',
    );
  } catch (e) {
    log('daemon', `continuity journal not written: ${(e as Error).message}`);
  }
}

function plannedResume() {
  let md = '';
  try {
    md = fs.readFileSync(CONTINUITY_FILE, 'utf-8');
  } catch { }
  return resumePlan(parseContinuity(md), new Date(), readConfigRaw());
}

let resumedOk: boolean | null = null;
let resumeWhy = '';

function continuityStatus() {
  let saved: { sessionId: string | null; updatedTs: string | null } = { sessionId: null, updatedTs: null };
  try {
    saved = parseContinuity(fs.readFileSync(CONTINUITY_FILE, 'utf-8'));
  } catch { }
  return {
    journal: fs.existsSync(CONTINUITY_FILE),
    savedSession: saved.sessionId,
    journalUpdated: saved.updatedTs,
    resumed: resumedOk,
    why: resumeWhy,
  };
}

let journalTimer: NodeJS.Timeout | null = null;
function touchContinuity() {
  if (journalTimer) return;
  journalTimer = setTimeout(() => {
    journalTimer = null;
    writeContinuity();
  }, 5_000);
}

const mkLog = (type: string) => (lane: string, detail: string, verdict: string) =>
  sendBrain({ type, lane, detail, verdict });

function readAudit(limit: number): { rows: StoredAuditRow[]; chainIntact: boolean | null } {
  if (!fs.existsSync(DB_PATH)) return { rows: [], chainIntact: null };
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const all = db
      .prepare('SELECT id, ts, tool, lane, risk_class AS riskClass, detail, verdict, prev_hash, row_hash FROM commands ORDER BY id')
      .all() as StoredAuditRow[];
    return { rows: all.slice(-limit), chainIntact: verifyChain(all) === null };
  } finally {
    db.close();
  }
}

const workflows = new WorkflowStore(path.join(DATA_DIR, 'workflows.db'));

const workflowLog = mkLog('workflow-log');

const RUN_TIMEOUT_MS = 20 * 60_000;
const WORKFLOW_TICK_MS = 30_000;

const agents = new AgentStore(path.join(DATA_DIR, 'agents.db'));

const agentLog = mkLog('agent-log');

const notices = new NoticeStore(path.join(DATA_DIR, 'hoard.db'));
const hoardLog = mkLog('hoard-log');
const lensLog = mkLog('lens-log');

function helloRefusal(what: string): string {
  if (process.platform !== 'win32') return `${what} needs Windows Hello, which is Windows-only; refused on ${process.platform} (fails closed).`;
  if (readConfigRaw()?.helloClass3 === false) return `${what} needs Windows Hello and helloClass3 is off; refused (fails closed).`;
  return `Windows Hello did not answer. ${what} needs the second factor — try again at the machine.`;
}

function daemonHello(message: string): Promise<'verified' | 'declined' | 'unavailable'> {
  if (readConfigRaw()?.helloClass3 === false) return Promise.resolve('unavailable');
  return new Promise((resolve) => {
    const script = path.join(ROOT, 'scripts', 'hello-verify.ps1');
    if (!fs.existsSync(script)) return resolve('unavailable');
    const p = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Message', message.slice(0, 200)],
      { cwd: ROOT, windowsHide: false, stdio: 'ignore', detached: true },
    );
    p.unref();
    const t = setTimeout(() => {
      p.kill();
      resolve('unavailable');
    }, 90_000);
    p.on('error', () => { clearTimeout(t); resolve('unavailable'); });
    p.on('exit', (code) => { clearTimeout(t); resolve(code === 0 ? 'verified' : 'declined'); });
  });
}

async function gatedFetch(urlRaw: string, init: { headers: Record<string, string>; timeoutMs: number }): Promise<globalThis.Response | { error: string }> {
  if (localOnly()) return { error: LOCAL_ONLY_MSG };
  let current = urlRaw;
  for (let hop = 0; hop <= 5; hop++) {
    const url = safeSourceUrl(current);
    if (!url) return { error: hop ? 'the source redirected to an internal address — refused' : 'source url must be a public http(s) address — internal surfaces are refused' };
    let addrs: { address: string }[];
    try {
      addrs = await dnsLookup(new URL(url).hostname, { all: true });
    } catch {
      return { error: 'the source host does not resolve' };
    }
    if (!addrs.length || addrs.some((a) => blockedAddress(a.address))) {
      return { error: 'the source resolves to an internal address — refused' };
    }
    const resp = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(init.timeoutMs),
      headers: init.headers,
    });
    const next = resp.status >= 300 && resp.status < 400 ? resp.headers.get('location') : null;
    if (!next) return resp;
    current = new URL(next, url).href;
  }
  return { error: 'the source redirected too many times' };
}

let brainRestartRequested = false;

const withWords = (wf: Workflow) => ({
  ...wf,
  scheduleWords: describeSchedule(parseSchedule(wf.schedule)!),
  scope: parseScope(wf.scope),
});

function fireWorkflow(wf: Workflow, trigger: 'schedule' | 'manual'): { runId?: number; error?: string } {
  const runId = workflows.openRun(wf.id, trigger);
  if (mind.runWorkflow(wf, runId, trigger)) return { runId };
  if (!sendBrain({ type: 'ask', text: wf.prompt, via: 'workflow', runId, scope: scopeForRun(wf) })) {
    workflows.closeRun(runId, 'failed', 'brain offline');
    workflowLog('workflow.run', `#${wf.id} "${wf.name}"`, 'run-failed');
    broadcast({ type: 'workflow-run', id: wf.id, name: wf.name, outcome: 'failed', detail: 'brain offline' });
    return { error: 'brain offline' };
  }
  workflowLog('workflow.run', `#${wf.id} "${wf.name}" (${trigger})`, 'run-start');
  broadcast({ type: 'workflow-run', id: wf.id, name: wf.name, outcome: 'started', runId });
  return { runId };
}

function workflowTick() {
  if (isHalted()) return;
  try {
    for (const run of workflows.timeoutRuns(RUN_TIMEOUT_MS)) {
      workflowLog('workflow.run', `run ${run.id} of #${run.workflowId}`, 'run-timeout');
      broadcast({ type: 'workflow-run', id: run.workflowId, outcome: 'timeout', detail: run.detail });
      broadcast({ type: 'info', text: `a workflow run timed out after ${RUN_TIMEOUT_MS / 60_000} minutes — see its run history` });
    }
    const { due, skipped } = workflows.tick();
    for (const s of skipped) {
      workflowLog('workflow.run', `#${s.workflow.id} "${s.workflow.name}" — ${s.reason}`, 'run-skipped');
      broadcast({ type: 'workflow-run', id: s.workflow.id, name: s.workflow.name, outcome: 'skipped', detail: s.reason });
      broadcast({ type: 'info', text: `workflow "${s.workflow.name}" skipped a slot — ${s.reason}` });
    }
    for (const wf of due) fireWorkflow(wf, 'schedule');
  } catch (e: any) {
    log('workflow', `tick failed: ${e?.message ?? e}`);
  }
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

function readRaw(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > max) { reject(new Error('the zip is too large')); req.destroy(); return; }
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new Error('the zip is too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);

  try {
    const refusal = crossOriginRefusal(req.method, req.headers, extraHostNames(readConfigRaw()?.remote), url.pathname);
    if (refusal) return json(res, 403, { error: refusal });

    if (!remoteAllowed(req, url.pathname)) {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/hud')) {
        res.writeHead(302, { location: '/lair/' });
        return res.end();
      }
      return json(res, 401, { error: 'PIN required', auth: '/auth' });
    }

    if (req.method === 'POST' && url.pathname === '/auth') {
      const body = await readBody(req);
      const r = tryPin(auth, readRemoteConfig(readConfigRaw(), process.env), String(body.pin ?? ''), req.socket.remoteAddress);
      if (!r.ok) {
        log('auth', `PIN rejected from ${req.socket.remoteAddress} (${r.reason})`);
        return json(res, r.reason === 'locked' ? 429 : 401, { error: r.reason, retryAfterMs: r.retryAfterMs });
      }
      log('auth', `remote session opened for ${req.socket.remoteAddress}`);
      const s = JSON.stringify({ token: r.token, expiresAt: r.expiresAt });
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(s),
        'set-cookie': `aeryx=${r.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}`,
      });
      return res.end(s);
    }

    if (isHumanOnly(req.method, url.pathname, mind.humanOnly) && isLocalAddress(req.socket.remoteAddress)) {
      const cfg = readBrainRunConfig(readConfigRaw(), ROOT);
      if (cfg.runAs === 'warden') {
        const owner = await loopbackPeerOwner(PORT, req.socket.remotePort);
        if (owner === null) {
          log('daemon', `peer lookup failed for ${url.pathname} — decision withheld`);
          return json(res, 503, { error: 'could not verify the local caller; retry the decision' });
        } else if (owner.toLowerCase() === cfg.account.toLowerCase()) {
          log('daemon', `refused ${url.pathname} — the brain cannot answer for the user`);
          return json(res, 403, { error: 'this decision belongs to the user, not the brain' });
        }
      }
    }

    if (req.method === 'POST' && url.pathname === '/internal/session') {
      if (!isLocalAddress(req.socket.remoteAddress)) return json(res, 403, { error: 'local only' });
      const body = await readBody(req);
      if (!brainTokenOk(SESSION_TOKEN, String(body.token ?? ''))) return json(res, 403, { error: 'not a session agent' });
      if (body.detach === true) {
        SESSION = null;
        log('daemon', 'the desk has gone — hands are unavailable until someone signs in');
        return json(res, 200, { attached: false });
      }
      const reg = validSessionRegistration(body);
      if (!reg) return json(res, 400, { error: 'a session agent must present an id, a capability list and a loopback port' });
      const cb = String(body.callbackToken ?? '');
      if (cb.length < 32) return json(res, 400, { error: 'a session agent must present a callback token core can prove itself with' });
      const was = sessionAttached(SESSION, Date.now()) ? SESSION!.capabilities.join(',') : null;
      SESSION = { id: reg.id, lastBeatMs: Date.now(), capabilities: reg.capabilities, port: reg.port, callbackToken: cb };
      const now = reg.capabilities.join(',');
      if (was === null) log('daemon', `a desk attached (${now || 'no hands offered'})`);
      else if (was !== now) log('daemon', `the desk changed what it offers: ${now || 'nothing — screen locked?'}`);
      return json(res, 200, { attached: true, staleAfterMs: SESSION_STALE_MS });
    }

    if (req.method === 'POST' && url.pathname === '/internal/hello') {
      if (!isLocalAddress(req.socket.remoteAddress)) return json(res, 403, { error: 'local only' });
      const body = await readBody(req);
      if (!brainTokenOk(BRAIN_TOKEN, String(body.token ?? ''))) return json(res, 403, { error: 'not the brain' });
      const result = await daemonHello(String(body.message ?? 'Approve?'));
      return json(res, 200, { result });
    }

    if (await mind.handleRoute(req, res, url)) return;

    if (req.method === 'POST' && url.pathname === '/internal/lens-show') {
      if (!isLocalAddress(req.socket.remoteAddress)) return json(res, 403, { error: 'local only' });
      const body = await readBody(req);
      if (!brainTokenOk(BRAIN_TOKEN, String(body.token ?? ''))) return json(res, 403, { error: 'not the brain' });
      if (isHalted()) {
        return json(res, 409, { error: `Aeryx is halted — ${haltReason() || 'stopped by you'}.` });
      }
      const panel = openLensPanel(String(body.template ?? ''), body.id, 'conversation');
      if ('error' in panel) return json(res, 400, { error: panel.error });
      return json(res, 200, {
        shown: { template: panel.template, id: panel.id, title: panel.title, source: panel.source, taint: panel.taint },
        note: 'on the Lens now — the owner dismisses it there; you cannot take it back',
      });
    }

    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      const tok = bearerToken(req.headers.authorization) ?? tokenFromCookie(req.headers.cookie);
      const revoked = revokeToken(auth, tok);
      if (revoked) log('auth', `remote session closed by ${req.socket.remoteAddress}`);
      const s = JSON.stringify({ ok: true, revoked });
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(s),
        'set-cookie': 'aeryx=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
      });
      return res.end(s);
    }

    if (req.method === 'POST' && url.pathname === '/auth/pin') {
      if (!isLocalAddress(req.socket.remoteAddress)) {
        return json(res, 403, { error: 'the PIN is set at the machine — this route is local-only' });
      }
      const body = await readBody(req);
      if (!validNewPin(body.pin)) {
        return json(res, 400, { error: 'a PIN must be 8 to 128 characters, not digits only, with no surrounding space or newlines' });
      }
      const hello = await daemonHello('Set a new remote-access PIN for Aeryx');
      if (hello !== 'verified') {
        log('auth', `PIN change refused — Windows Hello ${hello}`);
        return json(res, 403, {
          error: hello === 'declined'
            ? 'Windows Hello declined it'
            : helloRefusal('Changing the PIN'),
        });
      }
      const newCfg = applyPinToConfig(readConfigRaw(), hashPin(String(body.pin)));
      writeConfig(newCfg);
      const revoked = revokeAllSessions(auth);
      log('auth', `remote PIN changed by the user — ${revoked} session(s) revoked, stored as a hash`);
      sendBrain({ type: 'hoard-log', lane: 'hoard.auth', detail: 'remote PIN changed at the machine', verdict: 'pin-set+hello' });
      broadcast({ type: 'info', text: 'Remote PIN changed. Every signed-in device needs the new one; the PIN is now stored hashed.' });
      return json(res, 200, { ok: true, revoked, storage: 'hash' });
    }

    if (req.method === 'GET' && (url.pathname === '/lair' || url.pathname.startsWith('/lair/'))) {
      const rel = url.pathname.replace(/^\/lair\/?/, '') || 'index.html';
      const safe = path.normalize(rel).replace(/^(\.\.[\\/])+/, '');
      let file = path.join(ROOT, 'dist', 'lair', safe);
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!file.startsWith(path.join(ROOT, 'dist', 'lair'))) return json(res, 403, { error: 'nope' });
      if (!fs.existsSync(file)) {
        const fallback = path.join(ROOT, 'dist', 'lair', 'index.html');
        if (!fs.existsSync(fallback)) return json(res, 404, { error: 'the Lair is not built — run npm run build:lair' });
        file = fallback;
      }
      const ext = path.extname(file);
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.json': 'application/json',
        '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
        '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
      };
      const headers: Record<string, string> = { 'content-type': types[ext] ?? 'application/octet-stream' };
      if (ext === '.html') {
        headers['content-security-policy'] = CSP;
        headers['cache-control'] = 'no-cache';
      } else if (url.pathname.includes('/_next/')) {
        headers['cache-control'] = 'public, max-age=31536000, immutable';
      }
      res.writeHead(200, headers);
      res.end(fs.readFileSync(file));
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/hud' || url.pathname === '/lens' || url.pathname === '/orb' || url.pathname === '/quick')) {
      const file = url.pathname === '/hud' ? 'hud.html' : url.pathname === '/lens' ? 'lens.html' : url.pathname === '/orb' ? 'orb.html' : url.pathname === '/quick' ? 'quick.html' : 'status.html';
      const page = path.join(ROOT, 'dist', file);
      if (!fs.existsSync(page)) return json(res, 404, { error: `${file} not built` });
      const html = fs.readFileSync(page);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'cache-control': 'no-cache' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/orb.js' || url.pathname === '/familiar.js')) {
      const f = path.join(ROOT, 'dist', url.pathname.slice(1));
      if (!fs.existsSync(f)) return json(res, 404, { error: `${url.pathname.slice(1)} not built` });
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(fs.readFileSync(f));
      return;
    }

    const dragonAsset = /^\/assets\/(aeryx-city-backdrop\.webp|(?:aeryx|aeri)-mark\.svg|characters\/(?:aeryx|aeri)-(?:(?:core|dragon|human)\.(?:glb|webp)|orb\.png)|characters\/(?:growl|summon)\.m4a|news\/[a-z0-9-]{1,40}\.webp)$/.exec(url.pathname);
    const mindAsset = req.method === 'GET' && !dragonAsset ? mind.assetFile(url.pathname) : null;
    if (req.method === 'GET' && (dragonAsset || mindAsset)) {
      const f = path.join(ROOT, 'dist', 'assets', dragonAsset ? dragonAsset[1]! : mindAsset!);
      if (!fs.existsSync(f)) return json(res, 404, { error: 'dragon asset not built' });
      sendStatic(req, res, f);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/skins') return json(res, 200, { skins: listSkins(SKINS_DIR) });
    if (req.method === 'POST' && url.pathname === '/skins/install') {
      let zip: Buffer;
      try { zip = await readRaw(req, MAX_PACK_BYTES); } catch (e) { return json(res, 413, { error: (e as Error).message }); }
      const r = installSkinPack(SKINS_DIR, zip);
      if (!r.ok) return json(res, 400, { error: r.error });
      log('daemon', `skin pack ${r.replaced ? 'updated' : 'installed'}: ${r.skin.id}`);
      broadcast({ type: 'skins' });
      return json(res, 200, { skin: r.skin, replaced: r.replaced });
    }
    const skinRemove = /^\/skins\/([a-z0-9][a-z0-9-]{0,31})\/remove$/.exec(url.pathname);
    if (req.method === 'POST' && skinRemove) {
      if (!removeSkin(SKINS_DIR, skinRemove[1]!)) return json(res, 404, { error: 'no such skin' });
      log('daemon', `skin removed: ${skinRemove[1]}`);
      broadcast({ type: 'skins' });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/skins/')) {
      const f = skinFile(SKINS_DIR, url.pathname);
      if (!f) return json(res, 404, { error: 'no such skin file' });
      sendStatic(req, res, f);
      return;
    }

    const fontFile = /^\/fonts\/([a-z0-9-]+\.woff2)$/.exec(url.pathname);
    if (req.method === 'GET' && fontFile) {
      const f = path.join(ROOT, 'dist', 'fonts', fontFile[1]!);
      if (!fs.existsSync(f)) return json(res, 404, { error: 'no such font' });
      res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' });
      res.end(fs.readFileSync(f));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      let chainIntact: boolean | null = null;
      try {
        chainIntact = readAudit(1).chainIntact;
      } catch { }
      json(res, 200, {
        daemon: 'aeryx',
        version: VERSION,
        localOnly: localOnly(),
        platform: process.platform,
        setupNeeded: brainState === 'needs-setup',
        provider: (() => {
          const p = readProviderConfig(readConfigRaw());
          return p && !('error' in p) ? { kind: p.kind, model: p.model } : null;
        })(),
        windowsOnly: WINDOWS_ONLY,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        brain: brainState,
        brainVia,
        session,
        desk: sessionStatus(ROLE, SESSION, Date.now()),
        model,
        chainIntact,
        halted: isHalted(),
        haltReason: haltReason(),
        micMode,
        wakePhrase: WAKE_PHRASE,
        wakePhrases: WAKE_PHRASES,
        pendingConfirms: [...pendingConfirms].map(([id, p]) => ({
          id, question: p.question, ts: p.ts, timeoutMs: p.timeoutMs, riskClass: p.riskClass, laneId: p.laneId,
          ...(p.extra ?? {}),
        })),
        remote: !isLocalAddress(req.socket.remoteAddress),
        pendingProposals: pendingProposalCounts(),
        clients: clients.size,
        ...mind.statusFields(),
        continuity: continuityStatus(),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'hello', brain: brainState, session, model })}\n\n`);
      const client: Client = { res };
      clients.add(client);
      const keepalive = setInterval(() => {
        try {
          res.write(': keepalive\n\n');
        } catch {
          clearInterval(keepalive);
        }
      }, 25_000);
      req.on('close', () => {
        clearInterval(keepalive);
        clients.delete(client);
      });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/audio/')) {
      const clip = audioStore.get(url.pathname.slice('/audio/'.length));
      if (!clip) return json(res, 404, { error: 'no such clip' });
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': clip.length });
      res.end(clip);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/usage') {
      const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 7) || 7, 1), 90);
      json(res, 200, {
        windowDays: days,
        ...summarize(USAGE_FILE, localDay(), localDay(new Date(Date.now() - (days - 1) * 24 * 60 * 60_000))),
        basis: costBasis((() => { const p = readProviderConfig(readConfigRaw()); return p && !('error' in p) ? p.kind : null; })()),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/audit') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 500);
      const { rows, chainIntact } = readAudit(limit);
      json(res, 200, { chainIntact, rows });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ask') {
      const body = await readBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) return json(res, 400, { error: 'text required' });
      const ok = routeAsk(text, body.via === 'voice' ? 'voice' : 'typed', body.as === 'aeri' ? 'aeri' : undefined);
      json(
        res,
        ok ? 202 : 503,
        ok ? { queued: true }
          : isHalted() ? { error: `Aeryx is halted — ${haltReason().replace(/^\S+ — /, '') || 'stopped by you'}`, halted: true }
          : { error: 'brain offline' },
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/confirm') {
      const body = await readBody(req);
      const id = String(body.id ?? '');
      const p = pendingConfirms.get(id);
      if (!p) return json(res, 404, { error: 'no such pending confirmation' });
      if (Date.now() - p.ts > p.timeoutMs) {
        pendingConfirms.delete(id);
        broadcast({ type: 'confirm-expired', id });
        return json(res, 410, { error: 'this ask expired — it was denied by timeout, nothing ran' });
      }
      pendingConfirms.delete(id);
      const ok = sendBrain({ type: 'confirm-response', id, approve: body.approve === true });
      json(res, ok ? 200 : 503, ok ? { answered: true } : { error: 'brain offline' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/halt') {
      if (!isLocalAddress(req.socket.remoteAddress)) {
        return json(res, 403, { error: 'the kill switch is local-only — at the machine' });
      }
      const body = await readBody(req);
      const why = String(body.reason ?? '').slice(0, 200);
      sendBrain({ type: 'halt-log', lane: 'daemon.halt', detail: why || 'halted by the user', verdict: 'halted' });
      await new Promise((r) => setTimeout(r, 120));
      await mind.onHalt();
      setHalted(true, why);
      json(res, 200, { halted: true, reason: haltReason() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/resume') {
      if (!isLocalAddress(req.socket.remoteAddress)) {
        return json(res, 403, { error: 'clearing the halt is local-only — at the machine' });
      }
      if (!isHalted()) return json(res, 409, { error: 'not halted' });
      setHalted(false, '');
      startBrain();
      json(res, 200, { halted: false });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/listen') {
      toVoice({ type: 'listen' });
      json(res, 200, { listening: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/mic') {
      const body = await readBody(req);
      const mode = String(body.mode ?? '');
      if (!['ptt', 'wake', 'always', 'off'].includes(mode)) return json(res, 400, { error: 'bad mode' });
      setMicMode(mode as MicMode);
      json(res, 200, { mode });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/audio-done') {
      const body = await readBody(req).catch(() => ({} as any));
      const id = typeof body?.id === 'string' ? body.id : undefined;
      clipDone(id);
      json(res, 200, { resumed: !speaking && unplayedClips.size === 0 });
      return;
    }

    if (url.pathname === '/workflows' && req.method === 'GET') {
      json(res, 200, { workflows: workflows.list().map(withWords) });
      return;
    }

    if (url.pathname === '/workflows' && req.method === 'POST') {
      const body = await readBody(req);
      const status = initialStatus(body.status, body.scope);
      const source = typeof body.source === 'string' ? body.source.slice(0, 20) : 'ui';
      const wf = workflows.create(
        {
          name: body.name, purpose: body.purpose, prompt: body.prompt, schedule: body.schedule,
          ...(Array.isArray(body.scope) ? { scope: body.scope } : {}),
          ...(body.runner === 'local' || body.runner === 'brain' ? { runner: body.runner } : {}),
          ...(body.catchUp === true ? { catchUp: true } : {}),
        },
        { status, source },
      );
      workflowLog(
        status === 'proposed' ? 'workflow.propose' : 'workflow.govern',
        `#${wf.id} "${wf.name}" — ${wf.schedule} (${source})`,
        status === 'proposed' ? 'proposed' : 'created',
      );
      broadcast({ type: 'workflows' });
      if (status === 'proposed') {
        broadcast({ type: 'info', text: `workflow proposed: "${wf.name}" — ${withWords(wf).scheduleWords} — approve it on the status page or by voice` });
      }
      json(res, 201, { workflow: withWords(wf) });
      return;
    }

    const wfRoute = /^\/workflows\/(\d+)\/(approve|pause|resume|edit|delete|run|runs)$/.exec(url.pathname);
    if (wfRoute) {
      const id = Number(wfRoute[1]);
      const action = wfRoute[2]!;
      if (req.method === 'GET' && action === 'runs') {
        const limit = Number(url.searchParams.get('limit') ?? 20) || 20;
        json(res, 200, { runs: workflows.runs(id, limit) });
        return;
      }
      if (req.method === 'POST') {
        if (action === 'run') {
          const wf = workflows.get(id);
          if (!wf) return json(res, 404, { error: `no workflow #${id}` });
          const fired = fireWorkflow(wf, 'manual');
          if (fired.error) return json(res, 503, { error: fired.error });
          broadcast({ type: 'workflows' });
          return json(res, 202, { runId: fired.runId });
        }
        let wf: Workflow;
        if (action === 'approve') {
          const pendingWf = workflows.get(id);
          if (!pendingWf) return json(res, 404, { error: `no workflow #${id}` });
          const scopeLanes = parseScope(pendingWf.scope);
          if (scopeLanes.length > 0) {
            if (!isLocalAddress(req.socket.remoteAddress)) {
              return json(res, 403, { error: 'approving a standing order is local-only — sit at the machine' });
            }
            const hello = await daemonHello(
              `Standing order for workflow "${pendingWf.name}": runs act on their own in ${scopeLanes.join(', ')}`,
            );
            if (hello === 'declined') {
              workflowLog('workflow.govern', `#${id} "${pendingWf.name}" scope`, 'hello-declined');
              return json(res, 403, { error: 'Windows Hello declined the standing order' });
            }
            if (hello === 'unavailable') {
              workflowLog('workflow.govern', `#${id} "${pendingWf.name}" scope`, 'hello-unavailable');
              return json(res, 403, { error: helloRefusal('A standing order') });
            }
          }
          wf = workflows.approve(id);
          workflowLog('workflow.govern', `#${id} "${wf.name}" — ${wf.schedule}${scopeLanes.length ? ` scope[${scopeLanes.join(',')}]` : ''}`,
            scopeLanes.length ? 'approved+hello' : 'approved');
        } else if (action === 'pause') {
          wf = workflows.pause(id);
          workflowLog('workflow.pause', `#${id} "${wf.name}"`, 'paused');
        } else if (action === 'resume') {
          const pausedWf = workflows.get(id);
          if (!pausedWf) return json(res, 404, { error: `no workflow #${id}` });
          const resumeLanes = parseScope(pausedWf.scope);
          if (resumeLanes.length > 0) {
            if (!isLocalAddress(req.socket.remoteAddress)) {
              return json(res, 403, { error: 'resuming a standing order is local-only — sit at the machine' });
            }
            const hello = await daemonHello(`Resume standing order "${pausedWf.name}": runs act on their own in ${resumeLanes.join(', ')}`);
            if (hello !== 'verified') {
              workflowLog('workflow.govern', `#${id} "${pausedWf.name}" resume`, `hello-${hello}`);
              return json(res, 403, { error: hello === 'declined' ? 'Windows Hello declined it' : helloRefusal('Resuming a standing order') });
            }
          }
          wf = workflows.resume(id);
          workflowLog('workflow.govern', `#${id} "${wf.name}"`, 'resumed');
        } else if (action === 'edit') {
          const body = await readBody(req);
          wf = workflows.edit(id, {
            name: body.name, purpose: body.purpose, prompt: body.prompt, schedule: body.schedule,
            ...(Array.isArray(body.scope) ? { scope: body.scope } : {}),
          });
          workflowLog('workflow.govern', `#${id} "${wf.name}" — ${wf.schedule}`,
            wf.status === 'proposed' ? 'edited-demoted' : 'edited');
          if (wf.status === 'proposed') {
            broadcast({ type: 'info', text: `workflow "${wf.name}" changed its prompt or standing order — it is back to proposed and needs your approval again` });
          }
        } else {
          wf = workflows.remove(id);
          workflowLog('workflow.govern', `#${id} "${wf.name}"`, 'deleted');
        }
        broadcast({ type: 'workflows' });
        json(res, 200, { workflow: withWords(wf) });
        return;
      }
    }

    if (url.pathname === '/agents' && req.method === 'GET') {
      json(res, 200, { agents: agents.list() });
      return;
    }

    if (url.pathname === '/agents' && req.method === 'POST') {
      const body = await readBody(req);
      const status = 'proposed' as const;
      const source = typeof body.source === 'string' ? body.source.slice(0, 20) : 'ui';
      const a = agents.create(
        { slug: body.slug, description: body.description, prompt: body.prompt, tools: body.tools ?? null },
        { status, source },
      );
      agentLog(
        status === 'proposed' ? 'agent.propose' : 'agent.govern',
        `#${a.id} "${a.slug}" (${source})`,
        status === 'proposed' ? 'proposed' : 'created',
      );
      broadcast({ type: 'agents' });
      if (status === 'proposed') {
        broadcast({ type: 'info', text: `agent proposed: "${a.slug}" — ${a.description} — approve it on the status page or by voice` });
      }
      json(res, 201, { agent: a });
      return;
    }

    const agRoute = /^\/agents\/(\d+)\/(approve|edit|retire|revive)$/.exec(url.pathname);
    if (agRoute && req.method === 'POST') {
      const id = Number(agRoute[1]);
      const action = agRoute[2]!;
      let a: PermanentAgent;
      if (action === 'approve') {
        a = agents.approve(id);
        agentLog('agent.govern', `#${id} "${a.slug}"`, 'approved');
      } else if (action === 'retire') {
        a = agents.retire(id);
        agentLog('agent.retire', `#${id} "${a.slug}"`, 'retired');
      } else if (action === 'revive') {
        a = agents.revive(id);
        agentLog('agent.govern', `#${id} "${a.slug}"`, 'revived');
      } else {
        const body = await readBody(req);
        a = agents.edit(id, { slug: body.slug, description: body.description, prompt: body.prompt, tools: body.tools });
        agentLog('agent.govern', `#${id} "${a.slug}"`, 'edited');
      }
      broadcast({ type: 'agents' });
      if (action === 'approve' || action === 'revive') {
        broadcast({ type: 'info', text: `agent "${a.slug}" is active — the roster applies at the next brain start (restart button on the status page)` });
      }
      json(res, 200, { agent: a });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/privacy/local-only') {
      if (!isLocalAddress(req.socket.remoteAddress)) {
        return json(res, 403, { error: 'local-only mode is switched at this machine' });
      }
      const body = await readBody(req);
      if (typeof body.on !== 'boolean') return json(res, 400, { error: 'on must be true or false' });
      const cfg = readConfigRaw() ?? {};
      writeConfig({ ...cfg, privacy: { ...(cfg.privacy ?? {}), localOnly: body.on } });
      log('privacy', `local-only ${body.on ? 'on' : 'off'}`);
      setupLog('privacy', `local-only ${body.on ? 'on' : 'off'}`, 'set');
      if (!brain) startBrain();
      else { brainRestartRequested = true; brain.kill(); }
      broadcast({ type: 'privacy', localOnly: body.on });
      return json(res, 200, { ok: true, localOnly: body.on });
    }

    if (req.method === 'GET' && url.pathname === '/setup/state') {
      const cfg = readConfigRaw();
      const p = readProviderConfig(cfg);
      json(res, 200, {
        needsSetup: brainState === 'needs-setup',
        why: setupWhy,
        provider: p && !('error' in p) ? p : null,
        providers: Object.values(PROVIDERS).map((info) => ({
          ...info,
          keyStored: info.needsSecret || info.kind === 'claude' ? readSecret(ROOT, secretName(info.kind)) !== null : null,
        })),
        claudeLogin: hasClaudeLogin(),
        ollama: await (async () => {
          const o = await ollamaModels(p && !('error' in p) && p.kind === 'local' ? p.baseUrl! : 'http://127.0.0.1:11434');
          return localOnly() ? { ...o, models: o.models.filter((m) => !o.remote.includes(m)) } : o;
        })(),
        platform: process.platform,
        windowsOnly: WINDOWS_ONLY,
        localOnly: localOnly(),
        ramGb: Math.round(os.totalmem() / 1024 ** 3),
      });
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/setup/provider' || url.pathname === '/setup/test')) {
      if (!isLocalAddress(req.socket.remoteAddress)) {
        return json(res, 403, { error: 'the model is chosen at this machine — this route is local-only' });
      }
      const body = await readBody(req);
      if (!isProviderKind(body.kind)) return json(res, 400, { error: 'unknown provider' });
      const kind: ProviderKind = body.kind;
      const block = {
        kind,
        ...(typeof body.model === 'string' && body.model.trim() ? { model: body.model.trim() } : {}),
        ...(kind === 'local' && typeof body.baseUrl === 'string' && body.baseUrl.trim() ? { baseUrl: body.baseUrl.trim() } : {}),
      };
      const p = readProviderConfig({ brain: { provider: block } });
      if (!p || 'error' in p) return json(res, 400, { error: p ? p.error : 'invalid provider' });
      if (localOnly() && p.kind !== 'local') return json(res, 400, { error: 'local-only mode is on: only a local model can be connected' });
      if (localOnly() && p.kind === 'local') {
        const remote = isOllamaCloudModel(p.model) || (await ollamaModels(p.baseUrl!)).remote.some((m) => m === p.model || m === `${p.model}:latest`);
        if (remote) return json(res, 400, { error: CLOUD_MODEL_MSG(p.model) });
      }
      const typed = typeof body.secret === 'string' && body.secret.trim() ? body.secret.trim() : null;
      if (typed !== null && !validSecret(typed)) return json(res, 400, { error: 'that key has characters a key never carries' });
      const secret = typed ?? readSecret(ROOT, secretName(kind));
      const pe = providerEnv(p, secret);
      if ('error' in pe) return json(res, 400, { error: pe.error });
      if (kind === 'claude' && !secret && !hasClaudeLogin()) {
        return json(res, 400, { error: 'no Claude login on this machine — paste an Anthropic API key, or run claude once and log in' });
      }

      if (url.pathname === '/setup/test') {
        return json(res, 200, await testProvider(p.kind, pe.env, pe.model, secret));
      }

      if (typed !== null) {
        try {
          storeSecret(ROOT, secretName(kind), typed);
        } catch (e: any) {
          log('setup', `could not store the ${kind} key (${String(e?.message ?? e).slice(0, 120)})`);
          return json(res, 500, { error: 'the key could not be stored' });
        }
      }
      const cfg = readConfigRaw() ?? {};
      const newCfg = { ...cfg, brain: { ...(cfg.brain ?? {}), provider: { kind: p.kind, model: p.model, ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}) } } };
      writeConfig(newCfg);
      log('setup', `provider set: ${PROVIDERS[p.kind].label} (${p.model})${typed !== null ? ' — key stored' : ''}`);
      setupLog('provider', `${p.kind} ${p.model}${typed !== null ? ' key-stored' : ''}`, 'set');
      if (!brain) {
        startBrain();
      } else {
        brainRestartRequested = true;
        brain.kill();
      }
      broadcast({ type: 'setup-done', kind: p.kind });
      json(res, 200, { ok: true, provider: p });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/brain/restart') {
      if (!brain) {
        startBrain();
      } else {
        brainRestartRequested = true;
        brain.kill();
      }
      json(res, 200, { restarting: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/ops') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 80) || 80, 1), 500);
      const { rows, chainIntact } = readAudit(limit);
      const runs = workflows.list()
        .flatMap((wf) => workflows.runs(wf.id, 10).map((r) => ({ ...r, workflow: wf.name })));
      runs.sort((a, b) => String(b.startedTs).localeCompare(String(a.startedTs)));
      json(res, 200, { chainIntact, rows, runs: runs.slice(0, 40), agents: agents.list() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/news') {
      json(res, 200, {
        ...newsCache,
        countries: COUNTRY_NAMES,
        feeds: feeds.map((f) => ({ name: f.name, category: f.category, region: f.region ?? null, sub: f.sub ?? null })),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/news/refresh') {
      await newsTick(true);
      json(res, 200, { fetchedAt: newsCache.fetchedAt, errors: newsCache.errors });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/news/img') {
      const u = String(url.searchParams.get('u') ?? '');
      if (!cachedImageUrls(newsCache).has(u)) {
        return json(res, 404, { error: 'not an image in the current news cache' });
      }
      const img = await fetchNewsImage(u);
      res.writeHead(200, {
        'content-type': img.type,
        'cache-control': img.ok ? 'public, max-age=3600' : 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      return res.end(img.buf);
    }

    if (req.method === 'GET' && url.pathname === '/lens/state') {
      return json(res, 200, { panels: lensPanels });
    }

    if (req.method === 'GET' && url.pathname === '/hoard/notices') {
      json(res, 200, { pending: notices.pendingCount(), notices: notices.list() });
      return;
    }

    const noticeRoute = /^\/hoard\/notices\/(\d+)\/(keep|dismiss)$/.exec(url.pathname);
    if (noticeRoute && req.method === 'POST') {
      const id = Number(noticeRoute[1]);
      if (noticeRoute[2] === 'keep') {
        const n = notices.keep(id);
        const learnedPath = path.join(MEMORY_DIR, 'learned.md');
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
        fs.appendFileSync(learnedPath, `- ${n.fact}\n`, 'utf-8');
        hoardLog('hoard.learn', n.fact.slice(0, 150), 'kept');
        broadcast({ type: 'hoard' });
        broadcast({ type: 'hoard-notice', pending: notices.pendingCount() });
        json(res, 200, { notice: n });
      } else {
        const n = notices.dismiss(id);
        hoardLog('hoard.learn', n.fact.slice(0, 150), 'dismissed');
        broadcast({ type: 'hoard-notice', pending: notices.pendingCount() });
        json(res, 200, { notice: n });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/hoard') {
      const files: Record<string, string> = {};
      for (const f of HOARD_FILES) {
        const p = path.join(MEMORY_DIR, f);
        files[f] = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
      }
      json(res, 200, { files, editable: ['user.md'] });
      return;
    }

    if (url.pathname === '/hoard/draft' && req.method === 'GET') {
      return json(res, 200, { draft: notices.draftPending() });
    }
    if (url.pathname === '/hoard/draft' && req.method === 'POST') {
      const body = await readBody(req);
      const d = notices.draftPropose(String(body.content ?? ''));
      hoardLog('hoard.propose', `about-me draft #${d.id} (${Buffer.byteLength(d.content)} bytes)`, 'proposed');
      broadcast({ type: 'hoard-notice', pending: notices.pendingCount() });
      broadcast({ type: 'info', text: 'Aeryx drafted your About Me — read it in Approvals and apply it with a tap, or reject it' });
      return json(res, 201, { draft: d });
    }
    const draftRoute = /^\/hoard\/draft\/(\d+)\/(apply|reject)$/.exec(url.pathname);
    if (draftRoute && req.method === 'POST') {
      const id = Number(draftRoute[1]);
      if (draftRoute[2] === 'apply') {
        const d = notices.draftApply(id);
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
        fs.writeFileSync(path.join(MEMORY_DIR, 'user.md'), d.content + '\n', 'utf-8');
        hoardLog('hoard.edit', `user.md replaced from draft #${id} (${Buffer.byteLength(d.content)} bytes)`, 'applied');
        broadcast({ type: 'hoard' });
        broadcast({ type: 'hoard-notice', pending: notices.pendingCount() });
        broadcast({ type: 'info', text: 'your About Me is saved — the brain reads it at its next start' });
        return json(res, 200, { draft: d });
      }
      const d = notices.draftReject(id);
      hoardLog('hoard.propose', `about-me draft #${id}`, 'rejected');
      broadcast({ type: 'hoard-notice', pending: notices.pendingCount() });
      return json(res, 200, { draft: d });
    }

    const hoardWrite = /^\/hoard\/([a-z-]+\.md)$/.exec(url.pathname);
    if (req.method === 'POST' && hoardWrite) {
      const file = hoardWrite[1]!;
      const body = await readBody(req);
      const err = validateHoardWrite(file, body.content);
      if (err) return json(res, 400, { error: err });
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
      fs.writeFileSync(path.join(MEMORY_DIR, file), String(body.content), 'utf-8');
      hoardLog('hoard.edit', `${file} (${Buffer.byteLength(String(body.content))} bytes)`, 'edited');
      broadcast({ type: 'hoard' });
      broadcast({ type: 'info', text: `${file} updated — the brain re-reads memory at its next start` });
      json(res, 200, { saved: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ladder') {
      const body = await readBody(req);
      const action = body.action === 'revoke' ? 'revoke' : 'status';
      const ok = sendBrain({ type: 'ladder', action, lane: typeof body.lane === 'string' ? body.lane : undefined });
      json(res, ok ? 200 : 503, ok ? { sent: true } : { error: 'brain offline' });
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (e: any) {
    if (e instanceof SyntaxError) return json(res, 400, { error: 'body is not valid JSON' });
    const system =
      e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError ||
      typeof e?.code === 'string' || typeof e?.errno === 'number';
    if (system) {
      const id = Math.floor(Math.random() * 0xffff_ffff).toString(16).padStart(8, '0');
      console.error(`[daemon] request failed #${id} ${req.method ?? ''} ${req.url ?? ''}\n`, e);
      return json(res, 500, { error: `internal error #${id} — details are on the daemon console` });
    }
    json(res, 400, { error: String(e?.message ?? e).slice(0, 300) });
  }
}

const server = http.createServer(handleRequest);

let micMode: MicMode = 'wake';
let voice: ChildProcess | null = null;
const voiceSup = makeSupervisor('voice');
const childMode = (m: MicMode) => (m === 'wake' ? 'always' : m);

function toVoice(obj: unknown) {
  if (!voice?.stdin?.writable) return;
  try {
    voice.stdin.write(JSON.stringify(obj) + '\n');
  } catch {
  }
}

function setMicMode(m: MicMode) {
  micMode = m;
  toVoice({ type: 'mode', mode: childMode(m) });
  broadcast({ type: 'mic', mode: m });
}

const WINDOWS_ONLY = process.platform === 'win32' ? [] : ['voice', 'hello', 'warden'];

function startVoice() {
  if (WINDOWS_ONLY.includes('voice')) {
    log('voice', `ears are Windows-only — not started on ${process.platform}`);
    return;
  }
  const entry = path.join(ROOT, 'dist', 'voice.mjs');
  if (!fs.existsSync(entry)) {
    log('voice', `missing ${entry} — run npm run build`);
    return;
  }
  const models = path.join(ROOT, 'data', 'models');
  const earsReady = fs.existsSync(path.join(ROOT, 'data', 'whisper')) && fs.existsSync(models) && fs.readdirSync(models).some((f) => /^ggml-.+\.bin$/.test(f));
  if (!earsReady) {
    log('voice', 'not set up — run `node scripts/setup-voice.mjs` from the install folder to give Aeryx ears');
    return;
  }
  voiceSup.stderrTail = [];
  voice = spawn(process.execPath, [entry], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
    windowsHide: true,
  });
  log('voice', `started pid ${voice.pid} — wake ${WAKE_LIST}`);
  const configured = readConfigRaw()?.voice?.wakePhrase;
  for (const p of Array.isArray(configured) ? configured : [configured]) {
    const issue = wakePhraseIssue(p);
    if (issue) log('voice', `wake phrase ${JSON.stringify(p)} refused (${issue}) — answering to ${WAKE_LIST}`);
  }
  voice.stdin?.on('error', () => {});

  readline.createInterface({ input: voice.stdout! }).on('line', (line) => {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === 'mic-mode') return;
    broadcast(msg);
    if (msg.type === 'transcript') handleTranscript(String(msg.text ?? ''), String(msg.trigger ?? 'ptt'));
    if (msg.type === 'barge-in') cancelSpeech();
  });
  readline.createInterface({ input: voice.stderr! }).on('line', (l) => voiceSup.noteStderr(l));
  toVoice({ type: 'mode', mode: childMode(micMode) });

  voice.on('exit', (code, signal) => {
    voice = null;
    const delay = voiceSup.noteExit(code, signal ? String(signal) : null);
    if (delay === null) {
      broadcast({ type: 'voice-error', message: 'ears offline — too many crashes, see data/crashes.log' });
      return;
    }
    broadcast({ type: 'voice-error', message: 'ears offline, restarting' });
    log('voice', `restarting in ${delay}ms`);
    setTimeout(startVoice, delay);
  });
}

const WAKE_PHRASES = wakePhrases(readConfigRaw());
const WAKE_PHRASE = WAKE_PHRASES[0]!;
const WAKE_CUE = wakeCue(WAKE_PHRASE);
const WAKE_RE = buildWakeRe(WAKE_PHRASES);
const WAKE_LIST = WAKE_PHRASES.map((p) => `"${p}"`).join(' or ');
const SLEEP_RE = /^(sleep|stand\s*down|stop\s+listening|go\s+to\s+sleep|that'?s\s+all|dismissed)\b/i;

const ATTENTIVE_MS = 45_000;
let attentiveUntil = 0;
let attentiveTimer: NodeJS.Timeout | null = null;

function setAttentive(on: boolean) {
  if (attentiveTimer) { clearTimeout(attentiveTimer); attentiveTimer = null; }
  attentiveUntil = on ? Date.now() + ATTENTIVE_MS : 0;
  broadcast({ type: 'attentive', on });
  if (on) {
    attentiveTimer = setTimeout(() => {
      attentiveUntil = 0;
      broadcast({ type: 'attentive', on: false });
      broadcast({ type: 'info', text: `attention window closed — say ${WAKE_LIST} to get my attention` });
    }, ATTENTIVE_MS);
  }
}

function handleTranscript(text: string, trigger: string) {
  const t = text.trim();
  if (!t) return;

  const firstConfirm = pendingConfirms.keys().next();
  if (!firstConfirm.done) {
    const id = firstConfirm.value;
    const verdict = voiceConfirm(t, pendingConfirms.get(id)?.laneId ?? '', WAKE_RE);
    if (verdict === 'screen-only') {
      broadcast({ type: 'info', text: 'that approval is screen-only — answer it in the Lair' });
      return;
    }
    if (verdict !== 'not-an-answer') {
      pendingConfirms.delete(id);
      sendBrain({ type: 'confirm-response', id, approve: verdict === 'approve' });
      return;
    }
  }

  let cmd = t;
  if (trigger === 'barge') setAttentive(true);
  if (trigger === 'vad') {
    const m = t.match(WAKE_RE);
    if (micMode === 'always') {
      cmd = m ? t.slice(m[0].length).trim() : t;
      if (SLEEP_RE.test(cmd)) {
        setMicMode('wake');
        void speak(`Dropping to wake word mode. Say ${WAKE_CUE} when you need me.`);
        return;
      }
      if (!cmd) { void speak('Yes?'); return; }
    } else {
      const attentive = Date.now() < attentiveUntil;
      if (!m && !attentive) {
        log('voice', 'ignored (not addressed to Aeryx)');
        broadcast({ type: 'info', text: `heard "${t}" — start with ${WAKE_LIST} to command me` });
        return;
      }
      cmd = m ? t.slice(m[0].length).trim() : t;
      if (SLEEP_RE.test(cmd)) {
        setAttentive(false);
        void speak(`Going quiet. Say ${WAKE_CUE} when you need me.`);
        return;
      }
      if (!cmd) {
        setAttentive(true);
        void speak('Yes?');
        return;
      }
      setAttentive(true);
    }
  }
  routeAsk(cmd, 'voice');
}

function routeAsk(text: string, via: string, face?: 'aeri'): boolean {
  if (isHalted()) {
    broadcast({ type: 'info', text: `Aeryx is halted — ${haltReason() || 'stopped by you'}. Clear it in the Lair to resume.` });
    return false;
  }
  if (mind.routeTiers(text, via, face)) return true;
  const ok = sendBrain({ type: 'ask', text, via, ...(face ? { face } : {}) });
  if (ok) mind.noteAsk(text);
  return ok;
}

const remoteCfg = readRemoteConfig(readConfigRaw(), process.env);
let HOST = resolveBind(remoteCfg);
const auth = freshAuthState();

function readConfigRaw(): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'aeryx.config.json'), 'utf-8'));
  } catch {
    return {};
  }
}

function pendingProposalCounts() {
  const count = <T extends { status: string }>(rows: T[]) => rows.filter((r) => r.status === 'proposed').length;
  try {
    return {
      workflows: count(workflows.list()),
      agents: count(agents.list()),
      notices: notices.pendingCount(),
      drafts: notices.draftPending() ? 1 : 0,
      ...mind.pendingProposals(),
    };
  } catch {
    return { workflows: 0, agents: 0, notices: 0 };
  }
}

function remoteAllowed(req: http.IncomingMessage, pathname: string): boolean {
  return gateAllows(auth, req.socket.remoteAddress, pathname, {
    authorization: req.headers.authorization,
    cookie: req.headers.cookie,
  });
}

const NEWS_REFRESH_MS = 60 * 60_000;

const IMG_MAX_BYTES = 4 * 1024 * 1024;
const IMG_CACHE_MAX = 80;
const IMG_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const IMG_TTL_MS = 2 * 60 * 60_000;
const imgCache = new Map<string, { buf: Buffer; type: string; at: number }>();
let imgCacheBytes = 0;

function imgCacheEvictUntil(fits: number) {
  while (imgCache.size && (imgCache.size >= IMG_CACHE_MAX || imgCacheBytes + fits > IMG_CACHE_MAX_BYTES)) {
    const oldest = imgCache.keys().next().value!;
    imgCacheBytes -= imgCache.get(oldest)!.buf.byteLength;
    imgCache.delete(oldest);
  }
}

const IMG_PLACEHOLDER = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="#16100d"/>
    <radialGradient id="g"><stop offset="0" stop-color="#7a1e0c"/><stop offset="1" stop-color="#16100d"/></radialGradient>
    <ellipse cx="320" cy="180" rx="300" ry="150" fill="url(#g)" opacity=".55"/>
    <text x="320" y="196" text-anchor="middle" font-family="sans-serif" font-size="44" fill="#ffb638" opacity=".4">◆</text>
  </svg>`,
);

async function fetchNewsImage(u: string): Promise<{ buf: Buffer; type: string; ok: boolean }> {
  const hit = imgCache.get(u);
  if (hit && Date.now() - hit.at < IMG_TTL_MS) return { buf: hit.buf, type: hit.type, ok: true };
  try {
    const res = await gatedFetch(u, {
      timeoutMs: 12_000,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        referer: new URL(u).origin + '/',
      },
    });
    if ('error' in res) throw new Error(res.error);
    const type = String(res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (!res.ok || !/^image\/(jpe?g|png|webp|gif|avif)$/i.test(type) || !res.body) {
      throw new Error(`not a raster image (${res.status} ${type})`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > IMG_MAX_BYTES) throw new Error('image exceeds size cap');
      chunks.push(Buffer.from(chunk));
    }
    const buf = Buffer.concat(chunks);
    imgCacheEvictUntil(buf.byteLength);
    imgCache.set(u, { buf, type, at: Date.now() });
    imgCacheBytes += buf.byteLength;
    return { buf, type, ok: true };
  } catch (e: any) {
    log('news', `thumbnail fetch failed: ${String(e?.message ?? e).slice(0, 120)}`);
    return { buf: IMG_PLACEHOLDER, type: 'image/svg+xml', ok: false };
  }
}
const feeds = normalizeFeeds(readConfigRaw()?.news?.feeds);
let newsCache: NewsCache = emptyCache();
let newsFetching = false;

async function newsTick(force = false) {
  if (newsFetching || localOnly()) return;
  if (!force && newsCache.fetchedAt && Date.now() - Date.parse(newsCache.fetchedAt) < NEWS_REFRESH_MS / 2) return;
  newsFetching = true;
  try {
    newsCache = await refreshNews(feeds);
    const counts = Object.entries(newsCache.categories).map(([k, v]) => `${k}:${v.length}`).join(' ');
    log('news', `refreshed — ${counts}${newsCache.errors.length ? ` · ${newsCache.errors.length} failed` : ''}`);
    broadcast({ type: 'news', fetchedAt: newsCache.fetchedAt });
  } catch (e: any) {
    log('news', `refresh failed: ${e?.message ?? e}`);
  } finally {
    newsFetching = false;
  }
}

 const LENS_PANEL_CAP = 5;
const LENS_ROW_CAP = 20;
const lensPanels: LensPanel[] = [];

function resolveLensPanel(
  template: string, idRaw: unknown, opened: 'conversation' | 'initiative',
): LensPanel | { error: string } {
  const t = validateLensTarget(template, idRaw, { tables: mind.lensTables(), briefs: mind.lensBriefs() });
  if (!t.ok) return { error: t.error };
  const ts = new Date().toISOString();
  if (t.kind === 'hoard-page') {
    const p = path.join(MEMORY_DIR, t.file);
    if (!fs.existsSync(p)) return { error: `${t.file} has not been written yet` };
    const body = fs.readFileSync(p, 'utf-8');
    return {
      template: 'document', id: t.file, title: firstHeading(body) ?? `Hoard — ${t.file}`,
      source: `memory/${t.file}`, ts, taint: false, opened, body,
    };
  }
  if (t.kind === 'table' && t.table === 'workflows') {
    const header = ['name', 'schedule', 'status', 'last outcome'];
    const all = workflows.list().map(withWords).map((w) => [w.name, w.scheduleWords, w.status, w.lastOutcome ?? '—']);
    const rows = all.slice(0, LENS_ROW_CAP);
    return {
      template: 'table', id: t.table, title: 'Workflows', source: 'data/workflows.db',
      ts, taint: false, opened, header, rows,
      ...(all.length > rows.length ? { truncated: all.length - rows.length } : {}),
    };
  }
  return mind.lensResolve(t, opened, ts) ?? { error: 'nothing here can show that' };
}

function openLensPanel(
  template: string, idRaw: unknown, opened: 'conversation' | 'initiative',
): LensPanel | { error: string } {
  const panel = resolveLensPanel(template, idRaw, opened);
  if ('error' in panel) {
    lensLog('lens.show', `${template}:${String(idRaw).slice(0, 80)} — ${panel.error.slice(0, 100)}`, 'refused');
    return panel;
  }
  const dup = lensPanels.findIndex((q) => q.template === panel.template && q.id === panel.id);
  if (dup >= 0) lensPanels.splice(dup, 1);
  lensPanels.push(panel);
  while (lensPanels.length > LENS_PANEL_CAP) lensPanels.shift();
  lensLog('lens.show', `${panel.template}:${panel.id} — ${panel.title.slice(0, 100)}`, `shown:${opened}`);
  broadcast({ type: 'lens-panel', panel });
  if (opened === 'conversation') {
    broadcast({ type: 'info', text: `Aeryx put "${panel.title}" on the Lens.` });
  }
  return panel;
}

const audioStore = new Map<string, Buffer>();
let audioSeq = 0;

async function edgeTtsLoader(): Promise<TtsLoader> {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
  return {
    create: async () => new MsEdgeTTS() as unknown as TtsClient,
    format: OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
  };
}

let resumeTimer: NodeJS.Timeout | null = null;
const unplayedClips = new Set<string>();
let speaking = false;

function clipDone(id?: string) {
  if (id) unplayedClips.delete(id);
  else unplayedClips.clear();
  if (!speaking && unplayedClips.size === 0) voiceResume();
}

function voiceResume() {
  if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  unplayedClips.clear();
  toVoice({ type: 'resume' });
}

let speechQueue: Promise<void> = Promise.resolve();
let speechEpoch = 0;

function speak(text: string): Promise<void> {
  const epoch = speechEpoch;
  speechQueue = speechQueue.then(async () => {
    if (epoch !== speechEpoch) return;
    try {
      await speakNow(text);
    } catch (e: any) {
      log('tts', `speaking failed: ${e?.message ?? e}`);
      speaking = false;
      voiceResume();
    }
  });
  return speechQueue;
}

function cancelSpeech() {
  speechEpoch++;
  speaking = false;
  unplayedClips.clear();
  broadcast({ type: 'stop-audio' });
}

async function speakNow(text: string) {
  if (readConfigRaw().ttsEnabled === false || localOnly()) return;
  let loader: TtsLoader;
  try {
    loader = await edgeTtsLoader();
  } catch (e: any) {
    log('tts', `could not load msedge-tts: ${e?.message ?? e}`);
    return;
  }
  const epoch = speechEpoch;
  toVoice({ type: 'monitor' });
  speaking = true;
  let rendered = 0;
  const result = await synthesizeSpeech(text, loader, {
    voice: readConfigRaw().ttsVoice ?? 'en-US-AvaNeural',
    onWarn: (m) => log('tts', m),
    onChunk: (audio, index, total) => {
      if (epoch !== speechEpoch) return;
      const id = `a${++audioSeq}`;
      audioStore.set(id, audio);
      for (const k of [...audioStore.keys()].slice(0, -40)) audioStore.delete(k);
      unplayedClips.add(id);
      rendered += audio.length;
      broadcast({ type: 'speak', id, part: index + 1, parts: total, chars: text.length });
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(voiceResume, Math.min(120_000, 5_000 + rendered * 0.15));
    },
  });
  speaking = false;
  if (epoch !== speechEpoch) return;
  if (!result.complete) {
    broadcast({ type: 'info', text: `speech cut short (${result.chunksRendered}/${result.chunksTotal} parts) — the text reply is complete` });
  }
  if (unplayedClips.size === 0) voiceResume();
}

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function backupTick() {
  try {
    const r = await runBackup(ROOT);
    if (!r) return;
    const bad = r.state.filter((s) => !s.ok);
    log('backup', `${path.basename(r.file)} — ${r.rows} audit rows, chain ${r.chainIntact ? 'intact' : 'BROKEN'}, ` +
      `state ${r.state.length - bad.length}/${r.state.length} databases`);
    if (!r.chainIntact) {
      broadcast({ type: 'error', message: 'backup completed but the audit chain in it is BROKEN — the log was modified' });
    }
    if (bad.length > 0) {
      const named = bad.map((s) => `${s.name} (${s.error ?? 'unknown'})`).join(', ');
      log('backup', `NOT BACKED UP: ${named}`);
      broadcast({ type: 'error', message: `backup could not copy ${bad.length} state database(s): ${named}` });
    }
  } catch (e: any) {
    log('backup', `failed: ${e?.message ?? e}`);
    broadcast({ type: 'error', message: `backup failed: ${e?.message ?? e}` });
  }
}

server.on('error', (e: any) => {
  if (e?.code === 'EADDRNOTAVAIL' && HOST !== '127.0.0.1') {
    log('daemon', `cannot bind ${HOST} (${e.code}) — is Tailscale up? falling back to localhost only`);
    HOST = '127.0.0.1';
    server.listen(PORT, HOST);
    return;
  }
  log('daemon', `listen failed: ${e?.code ?? e}`);
  process.exit(1);
});

const mind = createMind({
  root: ROOT, dataDir: DATA_DIR, memoryDir: MEMORY_DIR, brainToken: BRAIN_TOKEN,
  windowsOnly: WINDOWS_ONLY,
  log, mkLog, broadcast, sendBrain, readConfigRaw, writeConfig, isHalted, haltReason,
  localOnly, localOnlyMsg: LOCAL_ONLY_MSG, isLocalAddress, brainTokenOk, daemonHello, helloRefusal,
  gatedFetch, json, readBody, sendStatic, readAudit, workflows, agents, notices,
  workflowLog, withWords, pendingConfirms,
  patchConfirm: (id, patch) => { const c = pendingConfirms.get(id); if (c) c.extra = { ...(c.extra ?? {}), ...patch }; },
  speak, cancelSpeech, voiceResume, setMicMode, wakeCue: WAKE_CUE,
  touchContinuity, recordLocalExchange,
  newsCategories: () => newsCache.categories, newsFetchedAt: () => newsCache.fetchedAt,
  runsOrgan: (cap) => roleRuns(ROLE, cap),
  role: ROLE,
  desk: () => (SESSION ? { port: SESSION.port, callbackToken: SESSION.callbackToken } : null),
  deskCapability: (cap) => capabilityAvailable(cap, ROLE, SESSION, Date.now()),
  deskAttached: () => sessionAttached(SESSION, Date.now()),
  dbPath: DB_PATH, edgeTtsLoader, openLensPanel, routeAsk,
});
WINDOWS_ONLY.push(...mind.windowsOnly());

server.listen(PORT, HOST, () => {
  log('daemon', `aeryxd listening on http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT} (the Lair at /lair)`);
  mind.start();
  if (HOST === '127.0.0.1') {
    log('daemon', remoteCfg.enabled
      ? 'remote access requested but no usable PIN — bound to localhost only'
      : 'localhost only (set remote.enabled in aeryx.config.json and a PIN via POST /auth/pin at this machine for Tailscale access)');
  } else {
    log('daemon', `remote access ON, bound ${HOST} — PIN required for non-local callers (Tailscale provides the network path)`);
  }
  log('daemon', `running as ${ROLE}${ROLE === 'both' ? ' (one process — the split is not installed)' : ''}`);
  mintSessionToken();
  if (roleRuns(ROLE, 'brain')) startBrain();
  if (roleRuns(ROLE, 'mic')) startVoice();
  else log('voice', 'not started — this process has no desk');
  void backupTick();
  setInterval(backupTick, BACKUP_INTERVAL_MS);
  setTimeout(workflowTick, 5_000);
  setInterval(workflowTick, WORKFLOW_TICK_MS);
  setTimeout(() => void newsTick(), 10_000);
  setInterval(() => void newsTick(), NEWS_REFRESH_MS);

  if (HOST !== '127.0.0.1' && HOST !== '0.0.0.0') {
    const localOnly = http.createServer(handleRequest);
    localOnly.on('error', (e: any) => log('daemon', `loopback listener failed (${e?.code ?? e}) — local clients must use ${HOST}`));
    localOnly.listen(PORT, '127.0.0.1', () => log('daemon', `also listening on http://127.0.0.1:${PORT} for local clients`));
  }

  if (port80Wanted(readConfigRaw())) {
    const front = http.createServer(handleRequest);
    front.on('error', (e: any) => log('daemon', `port 80 unavailable (${e?.code ?? e}) — the :${PORT} URL still works`));
    front.listen(80, HOST, () => log('daemon', 'named front door open on port 80 (http://aeryx/lair over the tailnet)'));
  }
});

function shutdown(signal: string) {
  log('daemon', `shutting down (${signal})`);
  brain?.kill();
  voice?.kill();
  workflows.close();
  agents.close();
  notices.close();
  mind.close();
  server.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
