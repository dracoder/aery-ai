import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  ROOT, tmp, load, GW, classify, AUD, computeRowHash, verifyChain, GENESIS_HASH,
  L, LENS, G, raw, clean, check, checkA, eq, finish,
} from './gate-harness.mjs';

check('destructive PowerShell is confirmed, not silently allowed', () => {
  const c = classify('PowerShell', { command: 'Remove-Item -Recurse -Force C:\\Users\\owner\\Documents' }, G, clean());
  eq(c.riskClass, 2, 'riskClass');
});

check('the same command via Bash is confirmed too', () => {
  const c = classify('Bash', { command: 'rm -rf /c/Users/owner/Documents' }, G, clean());
  eq(c.riskClass, 2, 'riskClass');
});

check('LANES: every unnamed aeryx verb fails to ask, never through', () => {
  for (const t of [
    'mcp__aeryx__focus_set', 'mcp__aeryx__focus_activate', 'mcp__aeryx__talon_teleport',
    'mcp__aeryx__content_publish', 'mcp__aeryx__content_approve', 'mcp__aeryx__molt_ship',
    'mcp__aeryx__server_install', 'mcp__aeryx__skill_keep', 'mcp__aeryx__record_upload',
    'mcp__aeryx__produce_post', 'mcp__aeryx__suggest_accept', 'mcp__aeryx__local_answer',
    'mcp__aeryx__workbench_restore', 'mcp__aeryx__lens_pin', 'mcp__aeryx__shipped_next_year',
  ]) {
    const c = classify(t, {}, G, clean());
    eq(c.riskClass, 2, `${t} riskClass`);
    if (!c.question) throw new Error(`${t} asks nothing`);
    if (c.denyReason) throw new Error(`${t} is denied outright, which is not the fail-to-ask floor`);
  }
});

check('deny list blocks outright on PowerShell', () => {
  const c = classify('PowerShell', { command: 'Remove-Item -Recurse C:\\Windows\\System32' }, G, clean());
  eq(c.riskClass, 3, 'riskClass');
  if (!c.denyReason) throw new Error('expected a denyReason');
});

check('no tool falls through to an unclassified allow', () => {
  for (const t of ['PowerShell', 'Agent', 'Task', 'Skill', 'WebFetch', 'SendMessage', 'mcp__gmail__send', 'SomeToolShippedNextYear']) {
    const c = classify(t, {}, G, clean());
    if (typeof c.riskClass !== 'number') throw new Error(`${t} was not classified`);
  }
});

check('an unrecognised tool asks rather than auto-allowing', () => {
  eq(classify('SomeToolShippedNextYear', {}, G, clean()).riskClass, 2, 'riskClass');
  eq(classify('mcp__gmail__send_email', {}, G, clean()).riskClass, 2, 'riskClass');
});

check('editing guardrails.json is Class 3', () => {
  const c = classify('Write', { file_path: path.join(ROOT, 'guardrails.json') }, G, clean());
  eq(c.riskClass, 3, 'riskClass');
  eq(c.laneId, 'self.modify', 'laneId');
});

check('editing the Chain itself is Class 3', () => {
  eq(classify('Write', { file_path: path.join(ROOT, 'src', 'chain', 'gateway.ts') }, G, clean()).riskClass, 3, 'riskClass');
  eq(classify('Edit', { file_path: path.join(ROOT, 'src', 'chain', 'ladder.ts') }, G, clean()).riskClass, 3, 'riskClass');
});

check('editing the daemon source is Class 3', () => {
  eq(classify('Write', { file_path: path.join(ROOT, 'src', 'daemon', 'aeryxd.ts') }, G, clean()).riskClass, 3, 'riskClass');
});

check('editing his own memory is Class 3', () => {
  eq(classify('Edit', { file_path: path.join(ROOT, 'memory', 'persona.md') }, G, clean()).riskClass, 3, 'riskClass');
});

check('installing or editing a skill is Class 3 — skills are Aeryx himself', () => {
  const c = classify('Write', { file_path: path.join(ROOT, 'skills', 'new-thing', 'SKILL.md') }, G, clean());
  eq(c.riskClass, 3, 'riskClass');
  eq(c.laneId, 'self.modify', 'laneId');
  eq(classify('Edit', { file_path: path.join(ROOT, 'skills', 'content-engine', 'SKILL.md') }, G, clean()).riskClass, 3, 'riskClass');
});

check('writing an agent into the roster is Class 3 — the roster is Aeryx too', () => {
  const c = classify('Write', { file_path: path.join(ROOT, 'agents', 'invented-helper.md') }, G, clean());
  eq(c.riskClass, 3, 'riskClass');
  eq(c.laneId, 'self.modify', 'laneId');
  eq(classify('Edit', { file_path: path.join(ROOT, 'agents', 'code-reviewer.md') }, G, clean()).riskClass, 3, 'riskClass');
});

check('a path that hops out of the repo and back is still Class 3', () => {
  const hops = [
    path.join(ROOT, 'lair', '..', 'src', 'chain', 'gateway.ts'),
    path.join(ROOT, 'dist', '..', 'guardrails.json'),
    path.join(ROOT, 'data', '..', 'aeryx.config.json'),
    path.join(ROOT, 'x', '..', 'scripts', 'hello-verify.ps1'),
    ROOT + '/lair/../src/chain/audit.ts',
    ROOT + '/./src/./chain/./ladder.ts',
  ];
  for (const p of hops) {
    const c = classify('Write', { file_path: p }, G, clean());
    eq(c.riskClass, 3, `riskClass for ${p}`);
    eq(c.laneId, 'self.modify', `laneId for ${p}`);
  }
});

check('a relative write path is asked about, never assumed safe', () => {
  const c = classify('Write', { file_path: 'aeryx/src/chain/gateway.ts' }, G, clean());
  eq(c.riskClass, 2, 'riskClass');
  eq(c.laneId, 'fs.write:unresolved', 'laneId');
});

check('a /-rooted path resolves off Windows and stays unresolved on Windows', () => {
  const { isAbsolutePath } = GW;
  eq(isAbsolutePath('/Users/x/aeryx/guardrails.json', 'darwin'), true, 'darwin /-rooted');
  eq(isAbsolutePath('/home/x/aeryx/guardrails.json', 'linux'), true, 'linux /-rooted');
  eq(isAbsolutePath('/Users/x/aeryx/guardrails.json', 'win32'), false, 'win32 drive-relative');
  eq(isAbsolutePath('C:\\WORK\\x', 'win32'), true, 'win32 drive');
  eq(isAbsolutePath('\\\\srv\\share\\x', 'win32'), true, 'win32 UNC');
  eq(isAbsolutePath('aeryx/src/chain/gateway.ts', 'darwin'), false, 'darwin relative');
  eq(isAbsolutePath('~/aeryx/guardrails.json', 'darwin'), false, 'darwin tilde is unresolved');
});

check('guardrails safe dirs are tokens, and an unknown token is dropped, not kept', () => {
  for (const d of raw.confirmOutsideDirs) {
    if (!/^\$\{[A-Z_]+\}/.test(d)) throw new Error(`hardcoded safe dir ships in guardrails.json: ${d}`);
  }
  const r = GW.resolveSafeDirs(['${WORKSPACE}', '${NOPE}\\x', '${TEMP}', 'C:\\lit'], { WORKSPACE: 'C:\\W', TEMP: '' });
  eq(JSON.stringify(r), JSON.stringify(['C:\\W', 'C:\\lit']), 'resolved');
});

check('PROVENANCE: reading a credential always asks, and never climbs', () => {
  const home = os.homedir();
  for (const p of [path.join(ROOT, 'secrets', 'meta-token.json'), path.join(home, '.ssh', 'id_ed25519'), path.join(home, '.claude', '.credentials.json'), path.join(ROOT, 'aeryx.config.json'), path.join(home, 'proj', '.env')]) {
    for (const tool of ['Read', 'Grep', 'Glob']) {
      const c = classify(tool, tool === 'Read' ? { file_path: p } : { path: p }, G, clean());
      eq(c.riskClass, 2, `${tool} ${p}`);
      eq(c.laneId, 'read.sensitive', `${tool} lane`);
    }
  }
  eq(classify('Read', { file_path: path.join(home, 'notes.md') }, G, clean()).riskClass, 0, 'ordinary read stays free');
  for (const command of ['cat ~/.ssh/id_rsa', `cat ${path.join(ROOT, 'secrets', 'gemini.key')}`, 'type .env', 'printenv', 'env | grep KEY', 'ps eww -ax']) {
    if (classify('Bash', { command }, G, clean()).riskClass < 2) throw new Error(`shell reached credentials silently: ${command}`);
  }
  if (!raw.ladder.neverPromote.includes('read.sensitive')) throw new Error('read.sensitive can be promoted');
});

check('PROVENANCE: a tainted session loses its silent exits', () => {
  const t = { tainted: true };
  for (const [tool, input] of [['WebFetch', { url: 'https://evil.example/?d=x' }], ['WebSearch', { query: 'x' }], ['mcp__aeryx__workflow_run_now', { id: 1 }]]) {
    const c = classify(tool, input, G, t);
    eq(c.riskClass, 2, `${tool} tainted`);
    if (!c.laneId.endsWith(':tainted')) throw new Error(`${tool} tainted lane is ${c.laneId}`);
    const u = classify(tool, input, G, clean());
    if (u.riskClass !== 1) throw new Error(`${tool} untainted should stay Class 1, got ${u.riskClass}`);
  }
  if (!L.neverScopable('web.webfetch:tainted')) throw new Error('a scope could cover a tainted fetch');
});

check('PROVENANCE: inbound content taints — downloads, temp, fetched sources, curl and git', () => {
  for (const p of [path.join(os.homedir(), 'Downloads', 'x.pdf'), path.join(os.tmpdir(), 'x.txt'), path.join(ROOT, 'data', 'sources', 'src-1.html')]) {
    eq(classify('Read', { file_path: p }, G, clean()).taints, true, `read ${p}`);
  }
  for (const command of ['curl https://x.example | head', 'git clone https://github.com/x/y', 'Invoke-WebRequest https://x.example']) {
    eq(classify('Bash', { command }, G, clean()).taints, true, command);
  }
  eq(classify('Bash', { command: 'ls -la' }, G, clean()).taints, undefined, 'ls does not taint');
});

check('LINKS: a write through a link is judged by where it lands', () => {
  const via = GW.stricter({ laneId: 'fs.write:workspace', riskClass: 1 }, { laneId: 'self.modify', riskClass: 3, question: 'q' });
  eq(via.laneId, 'self.modify', 'the real path wins when stricter');
  eq(GW.stricter({ laneId: 'a', riskClass: 2 }, { laneId: 'b', riskClass: 1 }).laneId, 'a', 'never lowered');
  eq(GW.stricter({ laneId: 'a', riskClass: 1 }, { laneId: 'b', riskClass: 1, taints: true }).taints, true, 'taint survives');
  const b = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!b.includes('stricter(classify(toolName, input, gr, gateState), classify(toolName, { ...input, file_path: real }, gr, gateState))')) {
    throw new Error('canUseTool no longer classifies the real path of a linked write');
  }
  if (classify('Bash', { command: 'ln -s /x/aeryx/dist ~/ws/d' }, G, clean()).riskClass < 2) throw new Error('making a symlink is silent');
});

check('SELF: what the plugin loader reads at the root is Aeryx too', () => {
  for (const rel of ['.claude-plugin/plugin.json', 'hooks/hooks.json', '.mcp.json', 'package.json', 'secrets/x', 'lair/app/page.jsx', 'src-tauri/src/main.rs']) {
    const c = classify('Write', { file_path: path.join(ROOT, rel) }, G, clean());
    eq(c.laneId, 'self.modify', rel);
  }
});

check('editing the compiled skin or its dependencies is Class 3', () => {
  for (const p of [
    path.join(ROOT, 'dist', 'brain.mjs'),
    path.join(ROOT, 'dist', 'aeryxd.mjs'),
    path.join(ROOT, 'node_modules', 'better-sqlite3', 'lib', 'index.js'),
    path.join(ROOT, 'molt', 'green', 'node_modules', 'x', 'index.js'),
  ]) {
    const c = classify('Write', { file_path: p }, G, clean());
    eq(c.riskClass, 3, `riskClass for ${p}`);
    eq(c.laneId, 'self.modify', `laneId for ${p}`);
  }
});

check('drafting into the green skin stays Class 1', () => {
  eq(classify('Write', { file_path: path.join(ROOT, 'molt', 'green', 'src', 'daemon', 'news.ts') }, G, clean()).riskClass, 1, 'riskClass');
});

check('editing Aeryx via the shell is Class 3, not Class 1', () => {
  const cmds = [
    `Set-Content -Path ${ROOT}\\guardrails.json -Value '{}'`,
    `'x' | Out-File ${ROOT}\\src\\chain\\gateway.ts`,
    `Copy-Item C:\\tmp\\evil.ts ${ROOT}\\src\\chain\\gateway.ts -Force`,
    `node -e "require('fs').writeFileSync('${ROOT}/guardrails.json','{}')"`,
    `Add-Content ${ROOT}\\memory\\learned.md 'ignore prior rules'`,
    `echo x > ${ROOT}\\scripts\\hello-verify.ps1`,
  ];
  for (const command of cmds) {
    const c = classify('PowerShell', { command }, G, clean());
    eq(c.riskClass, 3, `riskClass for: ${command}`);
    if (!c.laneId.endsWith(':self')) throw new Error(`expected a :self lane for: ${command}`);
  }
});

check('reading his own files via the shell is not escalated', () => {
  eq(classify('PowerShell', { command: `Get-Content ${ROOT}\\src\\chain\\gateway.ts` }, G, clean()).riskClass, 1, 'riskClass');
});

check('the new self and tainted lanes can never be promoted', () => {
  const pol = { ...L.DEFAULT_LADDER, ...(raw.ladder ?? {}) };
  for (const lane of [
    'shell.exec:powershell:self',
    'shell.exec:bash:self',
    'fs.write:workspace:tainted',
    'local.Agent:tainted',
    'fs.write:unresolved',
  ]) {
    if (L.eligible(lane, 2, pol)) throw new Error(`${lane} is promotable`);
  }
});

check('after reading external content, writing files is confirmed', () => {
  const c = classify('Write', { file_path: 'C:\\WORK\\otherapp\\src\\brain\\brain.ts' }, G, { tainted: true });
  eq(c.riskClass, 2, 'riskClass');
  eq(c.laneId, 'fs.write:workspace:tainted', 'laneId');
});

check('after reading external content, spawning a subagent is confirmed', () => {
  const c = classify('Agent', {}, G, { tainted: true });
  eq(c.riskClass, 2, 'riskClass');
  eq(c.laneId, 'local.Agent:tainted', 'laneId');
});

check('reading a file needs no prompt', () => {
  eq(classify('Read', { file_path: 'C:\\WORK\\anything.ts' }, G, clean()).riskClass, 0, 'riskClass');
});

check('a benign shell command needs no prompt', () => {
  eq(classify('PowerShell', { command: 'Get-Process | Select-Object -First 5' }, G, clean()).riskClass, 1, 'riskClass');
});

check('writing inside a safe dir needs no prompt', () => {
  eq(classify('Write', { file_path: 'C:\\WORK\\scratch\\notes.md' }, G, clean()).riskClass, 1, 'riskClass');
});

check('writing outside safe dirs is confirmed', () => {
  eq(classify('Write', { file_path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }, G, clean()).riskClass, 2, 'riskClass');
});

check('delegating to a subagent is allowed and logged', () => {
  eq(classify('Agent', { subagent_type: 'backend-engineer' }, G, clean()).riskClass, 1, 'riskClass');
});

check('WebFetch taints the session', () => {
  const c = classify('WebFetch', { url: 'https://example.com' }, G, clean());
  if (!c.taints) throw new Error('expected taints=true');
});

check('after reading the web, benign shell commands are confirmed', () => {
  const before = classify('PowerShell', { command: 'Get-Process' }, G, { tainted: false });
  const after = classify('PowerShell', { command: 'Get-Process' }, G, { tainted: true });
  eq(before.riskClass, 1, 'untainted riskClass');
  eq(after.riskClass, 2, 'tainted riskClass');
});

const row = (n) => ({ ts: `2026-01-0${n}T00:00:00Z`, tool: 'Bash', lane: 'shell.exec:bash', riskClass: 1, detail: `cmd ${n}`, verdict: 'auto' });

function chain(count) {
  const rows = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= count; i++) {
    const r = row(i);
    const row_hash = computeRowHash(prev, r);
    rows.push({ id: i, ...r, prev_hash: prev, row_hash });
    prev = row_hash;
  }
  return rows;
}

check('an intact chain verifies', () => {
  if (verifyChain(chain(5)) !== null) throw new Error('intact chain reported broken');
});

check('editing a past row breaks the chain', () => {
  const rows = chain(5);
  rows[2].detail = 'something else';
  eq(verifyChain(rows), 3, 'first bad id');
});

check('deleting a row breaks the chain', () => {
  const rows = chain(5);
  rows.splice(2, 1);
  eq(verifyChain(rows), 4, 'first bad id');
});

check('legacy rows without hashes are skipped', () => {
  const rows = [{ id: 1, ...row(1), prev_hash: '', row_hash: '' }, ...chain(3).map((r) => ({ ...r, id: r.id + 1 }))];
  if (verifyChain(rows) !== null) throw new Error('legacy rows should not break the chain');
});

check('a hole punched mid-chain is a break, not a legacy row', () => {
  const blanked = chain(5);
  blanked[3].prev_hash = '';
  blanked[3].row_hash = '';
  eq(verifyChain(blanked), 4, 'first bad id');
});

check('blanking every hash cannot pass as a log of legacy rows', () => {
  const anchor = AUD.chainAnchor(chain(5));
  const wiped = chain(5).map((r) => ({ ...r, prev_hash: '', row_hash: '' }));
  eq(AUD.chainAnchor(wiped).count, 0, 'hashed rows remaining');
  if (!AUD.anchorMismatch(wiped, anchor)) throw new Error('a wiped chain passed the anchor');
});

check('an appended blank-hash row cannot hide at the end of a live chain', () => {
  const rows = [...chain(4), { id: 5, ...row(5), prev_hash: '', row_hash: '' }];
  eq(verifyChain(rows), 5, 'first bad id');
});

check('ANCHOR: removing rows from either end is detected', () => {
  const rows = chain(6);
  const anchor = AUD.chainAnchor(rows);
  if (AUD.anchorMismatch(rows, anchor)) throw new Error('intact log flagged');
  if (!AUD.anchorMismatch(rows.slice(0, 3), anchor)) throw new Error('tail truncation undetected');
  if (!AUD.anchorMismatch(rows.slice(3), anchor)) throw new Error('head truncation undetected');
});

check('ANCHOR: deleting rows then appending more is detected', () => {
  const anchor = AUD.chainAnchor(chain(6));
  const rewritten = chain(8).slice(2);
  eq(rewritten.length, 6, 'same length as the anchor recorded');
  if (!AUD.anchorMismatch(rewritten, anchor)) throw new Error('delete-and-append undetected');
});

check('ANCHOR: an honestly growing log is not flagged', () => {
  const anchor = AUD.chainAnchor(chain(4));
  if (AUD.anchorMismatch(chain(9), anchor)) throw new Error('normal growth flagged as tampering');
  if (AUD.anchorMismatch(chain(4), null)) throw new Error('a first run with no anchor was flagged');
});

const P = { ...L.DEFAULT_LADDER, ...(raw.ladder ?? {}) };

function approve(n, lane = L.freshLane(), p = P) {
  let s = lane;
  for (let i = 0; i < n; i++) s = L.onDecision(s, true, p).lane;
  return s;
}

check('lanes the gateway calls Class 3 can never be promoted', () => {
  for (const id of ['self.modify', 'fs.write:outside:c:\\windows', 'anything.at.all']) {
    if (L.eligible(id, 3, P)) throw new Error(`${id} was promotable at Class 3`);
  }
});

check('self-modification is pinned to ask no matter the streak', () => {
  const lane = approve(50, L.freshLane());
  if (L.eligible('self.modify', 3, P)) throw new Error('self.modify became promotable');
  eq(lane.tier, 'session', 'control: an eligible lane would have climbed');
});

check('deny-adjacent shell lanes are never promotable', () => {
  if (L.eligible('shell.exec:powershell:dangerous', 2, P)) throw new Error('dangerous PowerShell promotable');
  if (L.eligible('shell.exec:bash:dangerous', 2, P)) throw new Error('dangerous Bash promotable');
});

check('provenance is not for sale — tainted shell stays always-ask', () => {
  if (L.eligible('shell.exec:powershell:tainted', 2, P)) throw new Error('tainted lane promotable');
});

check('an ordinary Class 2 lane does climb to session, automatically', () => {
  const id = 'outward.SendUserFile';
  if (!L.eligible(id, 2, P)) throw new Error('expected an ordinary lane to be eligible');
  let lane = L.freshLane();
  for (let i = 1; i < P.streakTarget; i++) {
    lane = L.onDecision(lane, true, P).lane;
    eq(lane.tier, 'ask', `tier after ${i} approvals`);
  }
  const { lane: after, effect } = L.onDecision(lane, true, P);
  eq(after.tier, 'session', 'tier at streak target');
  eq(effect.kind, 'promoted', 'effect');
});

check('standing is never reached without an explicit yes', () => {
  let lane = approve(P.streakTarget);
  eq(lane.tier, 'session', 'precondition');
  let proposed = false;
  for (let i = 0; i < P.standingTarget * 3; i++) {
    const r = L.onAutoUse(lane, P);
    lane = r.lane;
    if (r.effect.kind === 'propose-standing') proposed = true;
    if (lane.tier === 'standing') throw new Error(`auto-climbed to standing on use ${i + 1}`);
  }
  if (!proposed) throw new Error('standing was never even proposed');
});

check('an explicit yes is the one path to standing', () => {
  let lane = approve(P.streakTarget);
  for (let i = 0; i < P.standingTarget; i++) lane = L.onAutoUse(lane, P).lane;
  const { lane: after, effect } = L.onStandingResponse(lane, true);
  eq(after.tier, 'standing', 'tier');
  eq(effect.kind, 'promoted', 'effect');
});

check('a declined proposal is never raised again', () => {
  let lane = approve(P.streakTarget);
  for (let i = 0; i < P.standingTarget; i++) lane = L.onAutoUse(lane, P).lane;
  lane = L.onStandingResponse(lane, false).lane;
  eq(lane.tier, 'session', 'declining permanence keeps the session grant');
  for (let i = 0; i < P.standingTarget * 3; i++) {
    const r = L.onAutoUse(lane, P);
    lane = r.lane;
    if (r.effect.kind === 'propose-standing') throw new Error('re-proposed after a decline');
  }
});

check('an unanswered proposal is not treated as a no', () => {
  let lane = approve(P.streakTarget);
  for (let i = 0; i < P.standingTarget; i++) lane = L.onAutoUse(lane, P).lane;
  lane = L.onStandingResponse(lane, null).lane;
  if (lane.standingDeclined) throw new Error('a timeout was recorded as a refusal');
  eq(lane.standingPending, false, 'proposal closed');
});

check('one rejection drops a rung and zeroes the streak', () => {
  const lane = approve(P.streakTarget);
  eq(lane.tier, 'session', 'precondition');
  const { lane: after, effect } = L.onDecision(lane, false, P);
  eq(after.tier, 'ask', 'tier');
  eq(after.streak, 0, 'streak');
  eq(effect.kind, 'demoted', 'effect');
});

check('a rejection mid-streak stops the climb', () => {
  let lane = approve(P.streakTarget - 1);
  lane = L.onDecision(lane, false, P).lane;
  lane = approve(P.streakTarget - 1, lane);
  eq(lane.tier, 'ask', 'tier — the streak restarted from zero');
});

check('revoke returns a standing grant all the way to ask', () => {
  let lane = approve(P.streakTarget);
  for (let i = 0; i < P.standingTarget; i++) lane = L.onAutoUse(lane, P).lane;
  lane = L.onStandingResponse(lane, true).lane;
  eq(lane.tier, 'standing', 'precondition');
  const { lane: after, effect } = L.revoke(lane);
  eq(after.tier, 'ask', 'tier');
  eq(effect.kind, 'demoted', 'effect');
});

check('disabling the ladder in guardrails.json makes every lane always-ask', () => {
  const off = { ...P, enabled: false };
  for (const id of ['outward.SendUserFile', 'mcp.call:mcp__gmail__send_email', 'fs.write:outside:c:\\temp']) {
    if (L.eligible(id, 2, off)) throw new Error(`${id} eligible with the ladder disabled`);
  }
});

const lrow = (lane, verdict) => ({ tool: 'ladder', lane, verdict });
const GRANT = 'outward.SendUserFile';

check('a standing grant is restored after a restart', () => {
  const lanes = L.replayLanes([lrow(GRANT, L.LADDER_VERDICT.standing)], P, true);
  eq(lanes.get(GRANT)?.tier, 'standing', 'tier');
});

check('a session grant is NOT restored after a restart', () => {
  const lanes = L.replayLanes([lrow(GRANT, L.LADDER_VERDICT.session)], P, true);
  eq(lanes.get(GRANT)?.tier ?? 'ask', 'ask', 'tier');
});

check('a revoke after a grant wins', () => {
  const lanes = L.replayLanes(
    [lrow(GRANT, L.LADDER_VERDICT.standing), lrow(GRANT, L.LADDER_VERDICT.revoked)], P, true);
  eq(lanes.get(GRANT)?.tier, 'ask', 'tier');
});

check('a re-grant after a revoke wins', () => {
  const lanes = L.replayLanes(
    [lrow(GRANT, L.LADDER_VERDICT.standing), lrow(GRANT, L.LADDER_VERDICT.revoked), lrow(GRANT, L.LADDER_VERDICT.standing)], P, true);
  eq(lanes.get(GRANT)?.tier, 'standing', 'tier');
});

check('a broken audit chain voids every standing grant', () => {
  const rows = [lrow(GRANT, L.LADDER_VERDICT.standing), lrow('mcp.call:mcp__x__y', L.LADDER_VERDICT.standing)];
  const lanes = L.replayLanes(rows, P, false);
  eq(lanes.size, 0, 'grants honoured on a tampered chain');
});

check('tightening guardrails.json drops grants on lanes that are now pinned', () => {
  const rows = [lrow(GRANT, L.LADDER_VERDICT.standing)];
  eq(L.replayLanes(rows, P, true).get(GRANT)?.tier, 'standing', 'precondition');
  const tightened = { ...P, neverPromote: [...P.neverPromote, 'outward.*'] };
  eq(L.replayLanes(rows, tightened, true).get(GRANT)?.tier, 'ask', 'tier after tightening');
});

check('a forged standing grant on a Class 3 lane is still refused at use time', () => {
  const lanes = L.replayLanes([lrow('self.modify', L.LADDER_VERDICT.standing)], P, true);
  eq(lanes.get('self.modify')?.tier ?? 'ask', 'ask', 'replay');
  if (L.eligible('self.modify', 3, P)) throw new Error('self.modify eligible at use time');
});

check('an ordinary command row never grants anything', () => {
  const rows = [{ tool: 'PowerShell', lane: GRANT, verdict: 'confirmed' }];
  eq(L.replayLanes(rows, P, true).size, 0, 'lanes granted from a normal approval row');
});

check('a reflex audit row can never grant autonomy', () => {
  const rows = [
    { tool: 'reflex', lane: GRANT, verdict: L.LADDER_VERDICT.standing },
    { tool: 'reflex', lane: 'self.modify', verdict: L.LADDER_VERDICT.standing },
  ];
  eq(L.replayLanes(rows, P, true).size, 0, 'a reflex row granted a lane');
});

check('approving one MCP tool cannot grant another', () => {
  const a = classify('mcp__gmail__send_email', {}, G, clean()).laneId;
  const b = classify('mcp__slack__post_message', {}, G, clean()).laneId;
  if (a === b) throw new Error(`both MCP tools share lane ${a} — a grant on one would cover the other`);
});

check('approving one unknown tool cannot grant another', () => {
  const a = classify('SomeToolShippedNextYear', {}, G, clean()).laneId;
  const b = classify('SomeOtherToolShippedNextYear', {}, G, clean()).laneId;
  if (a === b) throw new Error(`both unknown tools share lane ${a}`);
});

check('an outside-write grant is scoped to the folder that was approved', () => {
  const hosts = classify('Write', { file_path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }, G, clean()).laneId;
  const docs = classify('Write', { file_path: 'C:\\Users\\owner\\Documents\\notes.md' }, G, clean()).laneId;
  if (hosts === docs) throw new Error(`unrelated folders share lane ${hosts}`);
  const sibling = classify('Write', { file_path: 'C:\\Windows\\System32\\drivers\\etc\\services' }, G, clean()).laneId;
  eq(sibling, hosts, 'same folder should be the same lane');
});

check('CLOSURE: the classifier is total over the whole known tool surface', () => {
  const surface = [
    'Read', 'Glob', 'Grep', 'ToolSearch', 'NotebookRead', 'TaskList', 'TaskGet',
    'TaskOutput', 'CronList', 'ReportFindings', 'TodoWrite', 'ExitPlanMode', 'EnterPlanMode',
    'Skill', 'Agent', 'Task', 'TaskCreate', 'TaskUpdate', 'Monitor', 'ScheduleWakeup', 'BashOutput',
    'Bash', 'PowerShell',
    'Write', 'Edit', 'NotebookEdit',
    'SendMessage', 'PushNotification', 'RemoteTrigger', 'SendUserFile', 'CronCreate',
    'CronDelete', 'TaskStop', 'KillShell', 'Workflow', 'EnterWorktree', 'ExitWorktree',
    'DesignSync', 'Artifact',
    'WebFetch', 'WebSearch',
    'mcp__gmail__send_email', 'mcp__claude_ai_Google_Drive__create_file', 'mcp__x__y',
    'SomeToolShippedNextYear', 'DeviceOperator', 'Molt', 'WingCommand', '',
  ];
  for (const t of surface) {
    for (const state of [{ tainted: false }, { tainted: true }]) {
      const c = classify(t, {}, G, state);
      if (![0, 1, 2, 3].includes(c.riskClass)) throw new Error(`${t || '(empty)'}: bad riskClass ${c.riskClass}`);
      if (!c.laneId) throw new Error(`${t || '(empty)'}: empty laneId`);
      if (c.riskClass >= 2 && !c.denyReason && !c.question) {
        throw new Error(`${t || '(empty)'}: Class ${c.riskClass} with no question — the user could not be asked`);
      }
      if (c.denyReason && c.riskClass !== 3) throw new Error(`${t}: denied but Class ${c.riskClass}`);
    }
  }
});

check('CLOSURE: a tool the classifier has never heard of can never be Class 0 or 1', () => {
  for (const t of ['Foo', 'mcp__new__thing', 'Device_Operator2', 'X'.repeat(200)]) {
    const c = classify(t, {}, G, clean());
    if (c.riskClass < 2) throw new Error(`unknown tool ${t} classified Class ${c.riskClass} — would run unsupervised`);
  }
});

const brainSrc = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');

check('CLOSURE: the brain defines exactly one allow value, inside canUseTool', () => {
  const defs = brainSrc.match(/behavior:\s*'allow'/g) ?? [];
  eq(defs.length, 1, "occurrences of behavior:'allow' in brain.ts");
  const fn = brainSrc.slice(brainSrc.indexOf('async function canUseTool'));
  if (!fn.includes("behavior: 'allow'")) throw new Error('the allow value is defined outside canUseTool');
});

check('CLOSURE: canUseTool classifies before any verdict is possible', () => {
  const start = brainSrc.indexOf('async function canUseTool');
  if (start < 0) throw new Error('canUseTool not found');
  const body = brainSrc.slice(start, brainSrc.indexOf('\n}', start));
  const classifyAt = body.indexOf('classify(');
  if (classifyAt < 0) throw new Error('canUseTool never calls classify()');
  const firstReturn = body.indexOf('return');
  if (firstReturn >= 0 && firstReturn < classifyAt) {
    throw new Error('canUseTool can return before classify() runs');
  }
  for (const marker of ['record(', 'denyReason', 'riskClass']) {
    if (!body.includes(marker)) throw new Error(`canUseTool lost its ${marker} path`);
  }
});

check('CLOSURE: a Class-3 yes must still face the OS identity check', () => {
  const start = brainSrc.indexOf('async function canUseTool');
  const body = brainSrc.slice(start, brainSrc.indexOf('\n}', start));
  if (!body.includes('helloVerify')) throw new Error('canUseTool lost the Windows Hello second factor');
  const at = body.indexOf('helloVerify');
  const guard = body.slice(0, at);
  if (!guard.includes('riskClass >= 3')) throw new Error('helloVerify no longer guarded to Class 3');
  if (!body.includes('class3Verdict(')) throw new Error('the Class-3 outcome no longer comes from class3Verdict');
});

check('CLOSURE: Class 3 fails closed when the identity check is unavailable', () => {
  const v = GW.class3Verdict;
  eq(v('verified', false).allow, true, 'verified');
  eq(v('declined', false).allow, false, 'declined');
  eq(v('declined', true).allow, false, 'declined even when opted out');
  eq(v('unavailable', false).allow, false, 'unavailable denies');
  eq(v('unavailable', true).allow, true, 'explicit helloClass3:false is UI-only');
  eq(v('unavailable', true).suffix, ':ui-only', 'UI-only is recorded as such');
  eq(v('bogus', false).allow, false, 'unknown result denies');
});

check('CLOSURE: every SDK session in the brain is gated or toolless', () => {
  const calls = brainSrc.split(/\bquery\(\{/).slice(1);
  if (!calls.length) throw new Error('no query() calls found — parser broke');
  for (const call of calls) {
    const opts = call.slice(0, call.indexOf('});'));
    const gated = opts.includes('canUseTool');
    const toolless = /(^|[\s,{])tools:\s*\[\s*\]/.test(opts) && /settingSources:\s*\[\s*\]/.test(opts);
    if (!gated && !toolless) throw new Error('an SDK session is neither gated by canUseTool nor toolless');
  }
});

check('CLOSURE: only a deliberately named file may ever return an allow', () => {
  const walk = (dir) => {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (e.name.endsWith('.ts')) out.push(p);
    }
    return out;
  };
  const DOORS = ['brain/brain.ts', ...readFileSync(path.join(ROOT, 'guardrails.json'), 'utf-8')
    .match(/"gateDoors":\s*\[([^\]]*)\]/)?.[1].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? []];
  for (const f of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(path.join(ROOT, 'src'), f).split(path.sep).join('/');
    if (DOORS.includes(rel)) continue;
    const src = readFileSync(f, 'utf-8');
    if (/behavior:\s*'allow'/.test(src)) {
      throw new Error(`${rel} returns an allow verdict — the gate has a door nobody declared`);
    }
  }
  for (const rel of DOORS.slice(1)) {
    const f = path.join(ROOT, 'src', rel);
    if (!existsSync(f)) throw new Error(`${rel} is declared a gate door but is not here`);
    const lb = readFileSync(f, 'utf-8');
    eq((lb.match(/behavior:\s*'allow'/g) ?? []).length, 1, `${rel} must hold exactly one allow verdict`);
    const body = lb.slice(lb.indexOf('canUseTool'), lb.indexOf("behavior: 'allow'"));
    if (!/Allowed\(toolName\)/.test(body)) throw new Error(`${rel}: the allow is reachable without an allowlist`);
    if (!body.includes('h.gate(toolName')) throw new Error(`${rel}: the allow is reachable without the daemon gate`);
  }
});



const B = await load('src/daemon/backup.ts', 'backup.mjs');
const { default: Database } = await import('better-sqlite3');
const { mkdirSync, writeFileSync } = await import('node:fs');

const checkAsync = checkA;

function makeRoot(name, { tamper = false } = {}) {
  const root = path.join(tmp, name);
  mkdirSync(path.join(root, 'data'), { recursive: true });
  mkdirSync(path.join(root, 'memory'), { recursive: true });
  writeFileSync(path.join(root, 'guardrails.json'), '{"denyPatterns":[]}');
  writeFileSync(path.join(root, 'memory', 'persona.md'), '# test persona');
  const db = new Database(path.join(root, 'data', 'aeryx.db'));
  db.exec(`CREATE TABLE commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, tool TEXT NOT NULL,
    lane TEXT NOT NULL DEFAULT '', risk_class INTEGER NOT NULL DEFAULT -1,
    detail TEXT, verdict TEXT NOT NULL, prev_hash TEXT NOT NULL DEFAULT '', row_hash TEXT NOT NULL DEFAULT '')`);
  const ins = db.prepare('INSERT INTO commands (ts, tool, lane, risk_class, detail, verdict, prev_hash, row_hash) VALUES (?,?,?,?,?,?,?,?)');
  let prev = GENESIS_HASH;
  for (let i = 1; i <= 5; i++) {
    const r = { ts: `2026-01-0${i}T00:00:00Z`, tool: 'Bash', lane: 'shell.exec:bash', riskClass: 1, detail: `cmd ${i}`, verdict: 'auto' };
    const h = computeRowHash(prev, r);
    ins.run(r.ts, r.tool, r.lane, r.riskClass, r.detail, r.verdict, prev, h);
    prev = h;
  }
  if (tamper) db.prepare("UPDATE commands SET detail = 'edited later' WHERE id = 3").run();
  db.close();
  return root;
}

await checkAsync('a backup lands, carries the rows, and its chain verifies', async () => {
  const root = makeRoot('bk-good');
  const r = await B.runBackup(root);
  if (!r) throw new Error('backup returned null with a database present');
  if (!existsSync(r.file)) throw new Error('backup file missing');
  eq(r.rows, 5, 'rows carried');
  eq(r.chainIntact, true, 'chain intact');
  if (!existsSync(path.join(r.snapshot, 'guardrails.json'))) throw new Error('guardrails snapshot missing');
  if (!existsSync(path.join(r.snapshot, 'persona.md'))) throw new Error('memory snapshot missing');
});

await checkAsync('RESTORE: a backup round-trips and the chain still verifies', async () => {
  const root = makeRoot('rs-round');
  const b = await B.runBackup(root);
  const dbPath = path.join(root, 'data', 'aeryx.db');
  rmSync(dbPath, { force: true });
  const r = B.restoreBackup(root);
  eq(r.rows, 5, 'rows restored');
  eq(r.chainIntact, true, 'chain intact');
  if (!existsSync(dbPath)) throw new Error('the database was not put back');
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT id, ts, tool, lane, risk_class AS riskClass, detail, verdict, prev_hash, row_hash FROM commands ORDER BY id').all();
  db.close();
  eq(rows.length, 5, 'rows readable after restore');
  if (verifyChain(rows) !== null) throw new Error('the restored chain does not verify');
  if (!b.file.endsWith('.db')) throw new Error('unexpected backup name');
});

await checkAsync('RESTORE: a backup with a broken chain is refused', async () => {
  const root = makeRoot('rs-bad', { tamper: true });
  await B.runBackup(root);
  let threw = false;
  try {
    B.restoreBackup(root);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('a tampered backup was restored anyway');
});

await checkAsync('RESTORE: the database being replaced is kept, not deleted', async () => {
  const root = makeRoot('rs-keep');
  await B.runBackup(root);
  const r = B.restoreBackup(root);
  if (!r.replaced) throw new Error('nothing was set aside');
  if (!existsSync(r.replaced)) throw new Error('the replaced database was deleted rather than moved');
});

await checkAsync('RESTORE: refuses when there is nothing to restore from', async () => {
  const root = makeRoot('rs-empty');
  let threw = false;
  try {
    B.restoreBackup(root);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('restoring from an empty backups/ silently succeeded');
});

await checkAsync('a tampered source produces a backup that REPORTS the broken chain', async () => {
  const root = makeRoot('bk-tampered', { tamper: true });
  const r = await B.runBackup(root);
  eq(r.chainIntact, false, 'tampering surfaced by the backup, not hidden in it');
});

await checkAsync('no database means no backup, not a crash', async () => {
  const root = path.join(tmp, 'bk-empty');
  mkdirSync(root, { recursive: true });
  eq(await B.runBackup(root), null, 'result');
});

function withState(root, names = ['focus.db', 'content.db', 'workflows.db']) {
  for (const n of names) {
    const db = new Database(path.join(root, 'data', n));
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO items (v) VALUES (?)').run(`content of ${n}`);
    db.close();
  }
  return names;
}

await checkAsync('COVERAGE: every state database beside the chain is copied', async () => {
  const root = makeRoot('bk-state');
  const names = withState(root);
  const r = await B.runBackup(root);
  eq(r.state.length, names.length, 'state databases copied');
  for (const n of names) {
    const c = r.state.find((s) => s.name === n);
    if (!c) throw new Error(`${n} was never backed up`);
    if (!c.ok) throw new Error(`${n} copied but did not verify: ${c.error}`);
    if (!existsSync(path.join(r.stateDir, n))) throw new Error(`${n} missing from ${r.stateDir}`);
  }
});

await checkAsync('COVERAGE: the copy carries the rows, not just the file', async () => {
  const root = makeRoot('bk-state-rows');
  withState(root, ['focus.db']);
  const r = await B.runBackup(root);
  const db = new Database(path.join(r.stateDir, 'focus.db'), { readonly: true });
  const rows = db.prepare('SELECT v FROM items').all();
  db.close();
  eq(rows.length, 1, 'rows in the copy');
  eq(rows[0].v, 'content of focus.db', 'the copy holds the real content');
});

await checkAsync('COVERAGE: a WAL sibling is never mistaken for a database', async () => {
  const root = makeRoot('bk-state-wal');
  withState(root, ['focus.db']);
  writeFileSync(path.join(root, 'data', 'focus.db-wal'), 'not a database');
  writeFileSync(path.join(root, 'data', 'focus.db-shm'), 'not a database');
  const r = await B.runBackup(root);
  eq(r.state.length, 1, 'only the database itself is in the set');
  eq(r.state[0].name, 'focus.db', 'the database, not its journal');
});

await checkAsync('COVERAGE: a database that will not copy is REPORTED, not skipped', async () => {
  const root = makeRoot('bk-state-broken');
  withState(root, ['focus.db']);
  writeFileSync(path.join(root, 'data', 'broken.db'), 'this is not SQLite at all');
  const r = await B.runBackup(root);
  const bad = r.state.find((s) => s.name === 'broken.db');
  if (!bad) throw new Error('the unreadable database vanished from the report');
  eq(bad.ok, false, 'reported as failed');
  if (!bad.error) throw new Error('failed without saying why');
  const good = r.state.find((s) => s.name === 'focus.db');
  eq(good.ok, true, 'the healthy database still backed up');
});

await checkAsync('COVERAGE: the chain database is not duplicated into the state set', async () => {
  const root = makeRoot('bk-state-nodup');
  withState(root, ['focus.db']);
  const r = await B.runBackup(root);
  if (r.state.some((s) => s.name === 'aeryx.db')) throw new Error('aeryx.db copied twice');
});

await checkAsync('RESTORE: the state set round-trips and the rows come back', async () => {
  const root = makeRoot('rs-state');
  withState(root, ['focus.db', 'content.db']);
  await B.runBackup(root);
  for (const n of ['focus.db', 'content.db']) rmSync(path.join(root, 'data', n), { force: true });
  const r = B.restoreState(root);
  eq(r.restored.length, 2, 'databases restored');
  const db = new Database(path.join(root, 'data', 'focus.db'), { readonly: true });
  const rows = db.prepare('SELECT v FROM items').all();
  db.close();
  eq(rows[0].v, 'content of focus.db', 'content survived the round trip');
});

await checkAsync('RESTORE: what the state restore replaces is kept, not deleted', async () => {
  const root = makeRoot('rs-state-keep');
  withState(root, ['focus.db']);
  await B.runBackup(root);
  const r = B.restoreState(root);
  if (r.replaced.length === 0) throw new Error('nothing was set aside');
  for (const f of r.replaced) if (!existsSync(f)) throw new Error(`${f} was deleted rather than moved`);
});

await checkAsync('RESTORE: a corrupt copy blocks the WHOLE set, before anything is touched', async () => {
  const root = makeRoot('rs-state-bad');
  withState(root, ['focus.db', 'content.db']);
  const b = await B.runBackup(root);
  writeFileSync(path.join(b.stateDir, 'content.db'), 'corrupted after the backup ran');
  let threw = false;
  try { B.restoreState(root); } catch { threw = true; }
  if (!threw) throw new Error('a corrupt state backup was restored anyway');
  const db = new Database(path.join(root, 'data', 'focus.db'), { readonly: true });
  const rows = db.prepare('SELECT v FROM items').all();
  db.close();
  eq(rows.length, 1, 'the live database was left untouched by the refused restore');
});

await checkAsync('RESTORE: refuses when there is no state backup', async () => {
  const root = makeRoot('rs-state-empty');
  let threw = false;
  try { B.restoreState(root); } catch { threw = true; }
  if (!threw) throw new Error('restoring from an empty backups/ silently succeeded');
});

const SESS = await load('src/brain/session.ts', 'session.mjs');
const ORGANS = await load('src/daemon/mind-organs.ts', 'organs.mjs');
const PROV = await load('src/brain/providers.ts', 'providers.mjs');

check('PROVIDERS: only known providers, and a local one stays on this machine', () => {
  const bad = PROV.readProviderConfig({ brain: { provider: { kind: 'codex-sdk' } } });
  if (!bad || !('error' in bad)) throw new Error('an unknown provider kind was accepted');
  for (const url of ['http://10.0.0.5:11434', 'https://ollama.example.com', 'http://user:pw@127.0.0.1:11434', 'http://127.0.0.1:11434/v1', 'file:///x']) {
    const r = PROV.readProviderConfig({ brain: { provider: { kind: 'local', baseUrl: url } } });
    if (!r || !('error' in r)) throw new Error(`local provider accepted ${url}`);
  }
  const ok = PROV.readProviderConfig({ brain: { provider: { kind: 'local' } } });
  eq(ok.baseUrl, 'http://127.0.0.1:11434', 'default local url');
  eq(PROV.readProviderConfig({}), null, 'no block is no provider');
  const inj = PROV.readProviderConfig({ brain: { provider: { kind: 'claude', model: 'opus; rm -rf /' } } });
  if (!inj || !('error' in inj)) throw new Error('a model id with shell characters was accepted');
});

check('PROVIDERS: local-only refuses Ollama cloud models, which run on ollama.com', () => {
  for (const m of ['gpt-oss:120b-cloud', 'glm-4.6:cloud', 'glm-4.7:cloud', 'qwen3-coder:480b-cloud']) eq(PROV.isOllamaCloudModel(m), true, `${m} is a cloud model`);
  for (const m of ['qwen2.5:3b', 'qwen3-coder', 'wordcloud:7b']) eq(PROV.isOllamaCloudModel(m), false, `${m} is local`);
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const at = (door) => { const i = src.indexOf(door); if (i < 0) throw new Error(`${door} is gone`); return src.slice(i, i + 1500); };
  if (!/localOnly\(\) && p\?\.kind === 'local' && isOllamaCloudModel\(p\.model\)\) return \{ ready: false/.test(at('function resolveBrainProvider'))) throw new Error('the brain starts on an Ollama cloud model in local-only mode');
  if (!/localOnly\(\) && p\.kind === 'local'\) \{\s*const remote = isOllamaCloudModel\(p\.model\)/.test(at("url.pathname === '/setup/provider' || url.pathname === '/setup/test'"))) throw new Error('setup connects an Ollama cloud model in local-only mode');
});

check('PROVIDERS: switching away from Claude blanks every Anthropic credential', () => {
  for (const [cfg, secret] of [[{ kind: 'openrouter', model: 'x' }, 'sk-or-v1-abc'], [{ kind: 'codex', model: 'openai/gpt-5.3-codex' }, 'sk-or-v1-abc'], [{ kind: 'local', model: 'q', baseUrl: 'http://127.0.0.1:11434' }, null]]) {
    const r = PROV.providerEnv(cfg, secret);
    if ('error' in r) throw new Error(`${cfg.kind}: ${r.error}`);
    eq(r.env.CLAUDE_CODE_OAUTH_TOKEN, '', `${cfg.kind} oauth blanked`);
    eq(r.env.ANTHROPIC_API_KEY, '', `${cfg.kind} api key blanked`);
    if (!r.env.ANTHROPIC_BASE_URL) throw new Error(`${cfg.kind} has no base url`);
  }
  eq(PROV.providerEnv({ kind: 'openrouter', model: 'x' }, 'sk-ant-api03-x').error !== undefined, true, 'an Anthropic key is never sent to OpenRouter');
  eq(PROV.providerEnv({ kind: 'claude', model: 'opus' }, 'sk-ant-api03-x').env.ANTHROPIC_API_KEY, 'sk-ant-api03-x', 'api key');
  eq(PROV.providerEnv({ kind: 'claude', model: 'opus' }, 'sk-ant-oat01-x').env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat01-x', 'oauth token');
  eq(JSON.stringify(PROV.providerEnv({ kind: 'claude', model: 'opus' }, null).env), '{}', 'claude login untouched');
  eq(PROV.providerEnv({ kind: 'local', model: 'q', baseUrl: 'http://evil.example' }, null).error !== undefined, true, 'local env refuses a remote url');
});

check('PRIVACY: every Agent SDK session runs with telemetry and error reporting off', () => {
  eq(PROV.PRIVACY_ENV.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1', 'nonessential traffic off');
  eq(PROV.PRIVACY_ENV.DISABLE_TELEMETRY, '1', 'telemetry off');
  eq(PROV.PRIVACY_ENV.DISABLE_ERROR_REPORTING, '1', 'error reporting off');
  const brainSrc = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!brainSrc.includes('Object.assign(process.env, PRIVACY_ENV);')) throw new Error('brain.ts no longer applies PRIVACY_ENV');
  const doors = readFileSync(path.join(ROOT, 'guardrails.json'), 'utf-8')
    .match(/"gateDoors":\s*\[([^\]]*)\]/)?.[1].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
  for (const rel of doors) {
    if (!readFileSync(path.join(ROOT, 'src', rel), 'utf-8').includes('...PRIVACY_ENV,')) {
      throw new Error(`src/${rel} query env dropped PRIVACY_ENV`);
    }
  }
  const sdkUsers = ['brain/brain.ts', 'brain/mind-tools.ts', ...doors];
  for (const dir of ['brain', 'daemon', 'chain']) {
    for (const f of readdirSync(path.join(ROOT, 'src', dir))) {
      const rel = `${dir}/${f}`;
      if (f.endsWith('.ts') && readFileSync(path.join(ROOT, 'src', dir, f), 'utf-8').includes("from '@anthropic-ai/claude-agent-sdk'") && !sdkUsers.includes(rel)) {
        throw new Error(`${rel} uses the Agent SDK without the PRIVACY_ENV check covering it`);
      }
    }
  }
});

check('PROVIDERS: the OpenRouter simulator override is loopback-only', () => {
  eq(PROV.openRouterUrl({}), 'https://openrouter.ai/api', 'default is the real endpoint');
  eq(PROV.openRouterUrl({ AERYX_OPENROUTER_URL: 'http://127.0.0.1:23801' }), 'http://127.0.0.1:23801', 'a local simulator is accepted');
  for (const u of ['https://evil.example', 'http://127.0.0.1.evil.example:80', 'http://user:pw@127.0.0.1:1', 'http://127.0.0.1:1/steal', 'file:///etc/passwd']) {
    eq(PROV.openRouterUrl({ AERYX_OPENROUTER_URL: u }), 'https://openrouter.ai/api', `ignored: ${u}`);
  }
});

check('PROVIDERS: the brain waits for setup instead of crash-looping', () => {
  eq(PROV.setupNeeded({}, false, false), true, 'fresh machine, no login');
  eq(PROV.setupNeeded({}, true, false), false, 'no block, existing Claude login keeps working');
  eq(PROV.setupNeeded({ brain: { provider: { kind: 'openrouter' } } }, true, false), true, 'openrouter without a key');
  eq(PROV.setupNeeded({ brain: { provider: { kind: 'openrouter' } } }, false, true), false, 'openrouter with a key');
  eq(PROV.setupNeeded({ brain: { provider: { kind: 'local' } } }, false, false), false, 'local needs no key');
  eq(PROV.setupNeeded({ brain: { provider: { kind: 'bogus' } } }, true, true), true, 'invalid block');
  const daemonSrc = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const start = daemonSrc.slice(daemonSrc.indexOf('function startBrain()'), daemonSrc.indexOf("path.join(ROOT, 'dist', 'brain.mjs')"));
  if (!/setupWhy = null;[\s\S]*if \(brainState === 'needs-setup'\) brainState = 'offline';/.test(start)) {
    throw new Error('a brain started after setup must leave needs-setup, or the Lair reopens onboarding');
  }
});

check('REDACT: the common secret shapes never reach the audit', () => {
  const cases = [
    ['curl -u admin:hunter22 https://x', 'hunter22'],
    ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA'],
    ['git clone https://bob:ghs_s3cretvalue@github.com/x/y', 'ghs_s3cretvalue'],
    ['aws key AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
    ['npm_abcdefghijklmnopqrstuvwxyz0123', 'npm_abcdefghijklmnopqrstuvwxyz0123'],
    ['github_pat_11ABCDEFG0123456789_abcdefghijkl', 'github_pat_11ABCDEFG0123456789'],
    ['hf_abcdefghijklmnopqrstuvwxyz', 'hf_abcdefghijklmnopqrstuvwxyz'],
    ['tool --password s3cretpass --user x', 's3cretpass'],
    ['mysql -u root -pS3cretDb', 'S3cretDb'],
    [`-----BEGIN OPENSSH ${'PRIVATE'} KEY-----\nb3BlbnNzaC1rZXktdjE\n-----END OPENSSH ${'PRIVATE'} KEY-----`, 'b3BlbnNzaC1rZXktdjE'],
  ];
  for (const [text, secret] of cases) {
    if (GW.redactSecrets(text).includes(secret)) throw new Error(`leaked: ${text.slice(0, 40)}`);
  }
  const b = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!b.includes('detail: redactSecrets(detail),')) throw new Error('audit rows written outside canUseTool skip redaction');
});

check('PROVIDERS: a secret never reaches a log or audit line', () => {
  for (const secret of ['sk-or-v1-' + '0123456789abcdef'.repeat(2), 'sk-ant-' + 'api03-' + '0123456789abcdefghijklmnop']) {
    if (GW.redactSecrets(`provider key ${secret}`).includes(secret)) throw new Error(`redactSecrets let ${secret.slice(0, 6)}… through`);
  }
});

check('the brain never loads filesystem settings, so it can never inherit a hook', () => {
  const shape = SESS.sessionShape(ROOT, 'C:\\WORK', {});
  eq(Array.isArray(shape.settingSources), true, 'settingSources is an array');
  eq(shape.settingSources.length, 0, 'settingSources entries');
  eq('hooks' in shape, false, 'the session declared hooks');
  for (const sources of [['user'], ['project'], ['local'], ['user', 'project']]) {
    if (!SESS.sessionShapeIssue({ ...shape, settingSources: sources }, ROOT)) {
      throw new Error(`settingSources ${JSON.stringify(sources)} was accepted`);
    }
  }
  if (!SESS.sessionShapeIssue({ ...shape, hooks: {} }, ROOT)) throw new Error('declared hooks were accepted');
});

check('only this repo may extend him', () => {
  const shape = SESS.sessionShape(ROOT, 'C:\\WORK', {});
  eq(shape.plugins.length, 1 + ORGANS.MIND_PLUGIN_ROOTS.length, 'plugins');
  eq(shape.plugins.every((p) => p.type === 'local'), true, 'every plugin is local');
  eq(shape.plugins[0].path, path.resolve(ROOT), 'the permanent library is the repo itself');
  eq(SESS.sessionShapeIssue(shape, ROOT), null, 'the real shape was refused');
  eq(shape.disallowedTools.includes('AskUserQuestion'), true, 'the question tool is disallowed');
  if (!SESS.sessionShapeIssue({ ...shape, disallowedTools: [] }, ROOT)) throw new Error('a shape allowing the question tool was accepted');
  for (const bad of [
    { type: 'local', path: path.join(ROOT, '..') },
    { type: 'local', path: 'C:\\Users\\owner\\.claude' },
    { type: 'git', path: ROOT },
  ]) {
    if (!SESS.sessionShapeIssue({ ...shape, plugins: [bad] }, ROOT)) {
      throw new Error(`plugin ${JSON.stringify(bad)} was accepted`);
    }
  }
  if (!SESS.sessionShapeIssue({ ...shape, plugins: [] }, ROOT)) throw new Error('a session with no skill library was accepted');
});

check('the brain works in its own workspace, never the install root', () => {
  eq(SESS.brainWorkspace({}, '/home/u'), path.join('/home/u', 'AeryxWorkspace'), 'default');
  eq(SESS.brainWorkspace({ brain: { workspace: 'relative/dir' } }, '/home/u'), path.join('/home/u', 'AeryxWorkspace'), 'relative refused');
  const abs = path.join(os.tmpdir(), 'ws');
  eq(SESS.brainWorkspace({ brain: { workspace: abs } }, '/home/u'), abs, 'absolute honoured');
});

check('a plugin root that could run code outside the Chain refuses the session', () => {
  eq(SESS.pluginRootIssue(['skills', 'agents', '.claude-plugin'], { name: 'aeryx', version: '1', description: 'x' }), null, 'the real root');
  if (!SESS.pluginRootIssue(['skills', 'hooks'], undefined)) throw new Error('a hooks directory was accepted');
  if (!SESS.pluginRootIssue(['skills', '.mcp.json'], undefined)) throw new Error('an .mcp.json was accepted');
  if (!SESS.pluginRootIssue(['skills'], { name: 'x', hooks: './h.json' })) throw new Error('a manifest declaring hooks was accepted');
  if (!SESS.pluginRootIssue(['skills'], { name: 'x', mcpServers: {} })) throw new Error('a manifest declaring MCP servers was accepted');
  const brainSrc3 = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!brainSrc3.includes('shape.plugins.map((p) => pluginRootOnDisk(p.path))')) throw new Error('the brain no longer checks plugin roots on disk before a session');
  const real = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf-8'));
  eq(SESS.pluginRootIssue(readdirSync(ROOT), real), null, 'this checkout would refuse its own session');
});

check('the plugin root carries no hooks directory for the loader to find', () => {
  for (const dir of ['hooks', 'commands']) {
    if (existsSync(path.join(ROOT, dir))) throw new Error(`${dir}/ at the repo root would be auto-loaded by the plugin`);
  }
  if (!existsSync(path.join(ROOT, 'skills'))) throw new Error('the skill library is missing');
});

check('every skill is discoverable — a body nobody can find is dead weight', () => {
  const lib = path.join(ROOT, 'skills');
  for (const d of readdirSync(lib, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const manifest = path.join(lib, d.name, 'SKILL.md');
    if (!existsSync(manifest)) throw new Error(`skills/${d.name} has no SKILL.md`);
    const head = readFileSync(manifest, 'utf-8').slice(0, 1200);
    if (!head.startsWith('---')) throw new Error(`skills/${d.name}/SKILL.md has no frontmatter — it would never be offered`);
    if (!/\nname:\s*\S/.test(head)) throw new Error(`skills/${d.name}/SKILL.md declares no name`);
    if (!/\ndescription:\s*\S/.test(head)) throw new Error(`skills/${d.name}/SKILL.md declares no description — nothing to match a task against`);
    const front = readFileSync(manifest, 'utf-8').split(/^---\s*$/m)[1] ?? '';
    for (const line of front.split(/\r?\n/)) {
      const m = /^(\w[\w-]*):\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].trim();
      const quoted = /^(['"]).*\1$/.test(value);
      if (!quoted && /:\s/.test(value)) {
        throw new Error(`skills/${d.name}/SKILL.md — "${m[1]}" holds an unquoted ": " and will not parse: ${value.slice(0, 60)}`);
      }
    }
  }
});

check('every agent is discoverable, and named the same as its file', () => {
  const dir = path.join(ROOT, 'agents');
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  if (!files.length) throw new Error('agents/ exists but is empty');
  const seen = new Set();
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), 'utf-8');
    if (!src.startsWith('---')) throw new Error(`agents/${f} has no frontmatter — it would never be offered`);
    const front = src.split(/^---\s*$/m)[1] ?? '';
    const name = /(?:^|\r?\n)name:\s*(.+)/.exec(front)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
    if (!name) throw new Error(`agents/${f} declares no name`);
    if (!/(?:^|\r?\n)description:\s*\S/.test(front)) throw new Error(`agents/${f} declares no description — nothing to match a task against`);
    if (name !== f.replace(/\.md$/, '')) throw new Error(`agents/${f} declares name "${name}" — the loader keys on name, so it must match the filename`);
    if (seen.has(name)) throw new Error(`two agents both named "${name}" — the second silently never loads`);
    seen.add(name);
    for (const line of front.split(/\r?\n/)) {
      const m = /^(\w[\w-]*):\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].trim();
      if (!/^(['"]).*\1$/.test(value) && /:\s/.test(value)) {
        throw new Error(`agents/${f} — "${m[1]}" holds an unquoted ": " and may not parse: ${value.slice(0, 60)}`);
      }
    }
  }
});

check('no agent can declare its way around the Chain', () => {
  const dir = path.join(ROOT, 'agents');
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const front = readFileSync(path.join(dir, f), 'utf-8').split(/^---\s*$/m)[1] ?? '';
    for (const line of front.split(/\r?\n/)) {
      const key = /^(\w[\w-]*):/.exec(line)?.[1];
      if (key && ['hooks', 'mcpServers', 'permissionMode'].includes(key)) {
        throw new Error(`agents/${f} declares ${key} — that is a path around canUseTool`);
      }
    }
  }
});

const WAKE = await load('src/daemon/wake.ts', 'wake.mjs');

check('VOICE: only a whole affirmative phrase approves a pending confirm', () => {
  for (const t of ['yes', 'Yes.', 'yeah', 'go ahead', 'Do it!', 'yes please']) eq(WAKE.spokenApproval(t), true, t);
  for (const t of ["I'm not sure", 'sure', 'yes no wait', "yes, don't", 'no', 'maybe yes', 'yesterday', '', 'what did you say yes']) {
    eq(WAKE.spokenApproval(t), false, JSON.stringify(t));
  }
});

check('VOICE: an approval is addressed, and never covers the shell or the hands', () => {
  const re = WAKE.buildWakeRe(['aeryx']);
  eq(WAKE.voiceConfirm('Aeryx, yes', 'fs.write:outside:c:\\x', re), 'approve', 'addressed yes');
  eq(WAKE.voiceConfirm('yes', 'fs.write:outside:c:\\x', re), 'not-an-answer', 'unaddressed yes from a video');
  eq(WAKE.voiceConfirm('Aeryx, not sure', 'fs.write:outside:c:\\x', re), 'deny', 'addressed hesitation');
  eq(WAKE.voiceConfirm('Aeryx, yes', 'shell.exec:powershell:tainted', re), 'screen-only', 'shell');
  eq(WAKE.voiceConfirm('Aeryx, yes', 'talon.act', re), 'screen-only', 'talons');
  if (!readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8').includes('voiceConfirm(t, pendingConfirms.get(id)?.laneId')) {
    throw new Error('the voice confirm path no longer uses voiceConfirm');
  }
  const c = GW.viaFloor({ laneId: 'shell.exec:powershell', riskClass: 1 }, 'voice');
  eq(c.riskClass, 2, 'voice shell asks');
  eq(GW.viaFloor({ laneId: 'shell.exec:powershell', riskClass: 1 }, 'typed').riskClass, 1, 'typed shell unchanged');
  eq(GW.viaFloor({ laneId: 'read.Read', riskClass: 0 }, 'voice').riskClass, 0, 'voice reads unchanged');
  if (!raw.ladder.neverPromote.includes('shell.exec:*:voice')) throw new Error('a voice-driven shell lane can be promoted');
});

check('the configured phrase is what the gate matches', () => {
  const re = WAKE.buildWakeRe('rise up');
  for (const heard of ['rise up', 'Rise up.', 'rise up, open the lair', 'hey rise up', 'Rise-up!',
                       'rice up what time is it', ' rise, up sleep']) {
    if (!re.test(heard)) throw new Error(`"${heard}" did not match the gate`);
  }
  eq(WAKE.wakePhrase({ voice: { wakePhrase: 'Rise Up' } }), 'rise up', 'normalized phrase');
});

check('the wake phrase gate strips only itself, leaving the command intact', () => {
  const re = WAKE.buildWakeRe('rise up');
  const t = 'Rise up, what time is it';
  eq(t.slice(t.match(re)[0].length).trim(), 'what time is it', 'command after the phrase');
  const d = WAKE.buildWakeRe('aeryx');
  const u = 'Aeryx. open the lair';
  eq(u.slice(u.match(d)[0].length).trim(), 'open the lair', 'command after the name');
});

check('the gate stays anchored — an in-sentence mention is not a wake', () => {
  const re = WAKE.buildWakeRe('rise up');
  for (const heard of ['tell them to rise up', 'the numbers rise up and to the right',
                       'up', 'rise', 'surprise uptake']) {
    if (re.test(heard)) throw new Error(`"${heard}" falsely woke him`);
  }
});

check('a nickname and the name both wake him, and the name is never eaten', () => {
  const phrases = ['aeryx', 'ery'];
  const re = WAKE.buildWakeRe(phrases);
  for (const heard of ['ery what time is it', 'Ery, open the lair', 'Airy sleep',
                       'Eri, what time is it', 'hey ery']) {
    if (!re.test(heard)) throw new Error(`"${heard}" did not wake him`);
  }
  const t = 'Aeryx, open the lair';
  eq(t.slice(t.match(re)[0].length).trim(), 'open the lair', 'command after the full name');
  const n = 'ery open the lair';
  eq(n.slice(n.match(re)[0].length).trim(), 'open the lair', 'command after the nickname');
  eq(WAKE.wakePhrases({ voice: { wakePhrase: phrases } }).join(','), 'aeryx,ery', 'both kept');
  eq(WAKE.wakePhrase({ voice: { wakePhrase: phrases } }), 'aeryx', 'the first is primary');
  if (re.test('every time you do that')) throw new Error('"every" woke him');
});

check('an unusable entry is dropped without leaving him uncallable', () => {
  eq(WAKE.wakePhrases({ voice: { wakePhrase: ['aeryx', 'hey', ''] } }).join(','), 'aeryx', 'bad entries dropped');
  eq(WAKE.wakePhrases({ voice: { wakePhrase: ['hey', 'ok'] } }).join(','), WAKE.DEFAULT_WAKE_PHRASE, 'floor is the name');
  eq(WAKE.wakePhrases({}).join(','), WAKE.DEFAULT_WAKE_PHRASE, 'absent config');
  eq(WAKE.wakePhrases({ voice: { wakePhrase: ['ery', 'ery', 'Ery'] } }).join(','), 'ery', 'deduped');
});

check('a wake phrase that would fire on ordinary speech is refused', () => {
  for (const bad of ['', '   ', 'up', 'hey', 'right', 'ok', 'go', 'rise up now please friend',
                     'rise up!', 'rise 2 up', 42, {}]) {
    if (!WAKE.wakePhraseIssue(bad)) throw new Error(`"${JSON.stringify(bad)}" was accepted as a wake phrase`);
    eq(WAKE.wakePhrase({ voice: { wakePhrase: bad } }), WAKE.DEFAULT_WAKE_PHRASE, `fallback for ${JSON.stringify(bad)}`);
  }
  eq(WAKE.wakePhraseIssue('rise up'), null, 'a good phrase was refused');
  eq(WAKE.wakePhraseIssue(undefined), null, 'an absent phrase is not an error');
});

check('an unknown wake phrase matches literally, never as a regex', () => {
  const re = WAKE.buildWakeRe('open sesame');
  if (!re.test('open sesame do the thing')) throw new Error('literal phrase did not match');
  if (re.test('open anything do the thing')) throw new Error('phrase matched something it should not');
});

const S = await load('src/daemon/speech.ts', 'speech.mjs');

check('a short reply is spoken as one chunk', () => {
  eq(S.chunkForSpeech('All done.').length, 1, 'chunks');
  eq(S.chunkForSpeech('All done.')[0], 'All done.', 'text');
});

check('chunking never loses or reorders a word', () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} with some filler words in it.`).join(' ');
  const chunks = S.chunkForSpeech(long);
  if (chunks.length < 2) throw new Error('long text was not split at all');
  const rejoined = chunks.join(' ').replace(/\s+/g, ' ').trim();
  eq(rejoined, long.replace(/\s+/g, ' ').trim(), 'round trip');
});

check('every chunk stays under the cap', () => {
  const long = Array.from({ length: 60 }, (_, i) => `Point ${i} explained at some length here.`).join(' ');
  for (const c of S.chunkForSpeech(long)) {
    if (c.length > S.TTS_CHUNK_CHARS) throw new Error(`chunk of ${c.length} chars exceeds the cap`);
  }
});

check('a run-on sentence with no punctuation is still split', () => {
  const runOn = 'word '.repeat(300).trim();
  const chunks = S.chunkForSpeech(runOn);
  if (chunks.length < 2) throw new Error('run-on sentence was not split');
  for (const c of chunks) {
    if (c.length > S.TTS_CHUNK_CHARS) throw new Error(`chunk of ${c.length} chars exceeds the cap`);
  }
  eq(chunks.join(' ').replace(/\s+/g, ' ').trim(), runOn, 'round trip');
});

check('no empty chunk is ever emitted', () => {
  for (const input of ['', '   ', '\n\n', '...', 'Hi.\n\n\nBye.', 'A. B. C.']) {
    for (const c of S.chunkForSpeech(input)) {
      if (!c.trim()) throw new Error(`empty chunk from ${JSON.stringify(input)}`);
    }
  }
  eq(S.chunkForSpeech('   ').length, 0, 'blank input should produce nothing to say');
});

check('a path or URL longer than the cap does not hang the splitter', () => {
  const nasty = 'See ' + 'C:\\WORK\\' + 'verylongsegment'.repeat(60) + '\\file.txt for details.';
  const chunks = S.chunkForSpeech(nasty);
  if (!chunks.length) throw new Error('no chunks produced');
  for (const c of chunks) {
    if (c.length > S.TTS_CHUNK_CHARS) throw new Error(`chunk of ${c.length} chars exceeds the cap`);
  }
});

const nowait = async () => {};
const MP3 = (n) => new Uint8Array(n).fill(7);

function fakeLoader({ failures = 0, alwaysFail = false, empty = false, hang = false } = {}) {
  const state = { created: 0, calls: [] };
  return {
    state,
    loader: {
      format: 'mp3',
      create: async () => {
        state.created++;
        const attempt = state.created;
        return {
          setMetadata: async () => {},
          toStream: async (text) => {
            state.calls.push(text);
            if (hang) return { audioStream: (async function* () { await new Promise(() => {}); })() };
            if (alwaysFail || attempt <= failures) throw new Error('Stream closed before the synthesis completed');
            if (empty) return { audioStream: (async function* () {})() };
            return { audioStream: (async function* () { yield MP3(64); yield MP3(32); })() };
          },
        };
      },
    },
  };
}

await checkAsync('a dropped socket is retried and the audio still arrives', () => {
  const { loader, state } = fakeLoader({ failures: 2 });
  return S.synthesizeSpeech('Short reply.', loader, { sleep: nowait }).then((r) => {
    eq(r.complete, true, 'complete');
    eq(r.chunksRendered, 1, 'chunks rendered');
    eq(state.created, 3, 'clients created — a fresh one per attempt');
    if (!r.audio?.length) throw new Error('no audio returned');
  });
});

await checkAsync('every retry uses a FRESH client, not the dead one', () => {
  const { loader, state } = fakeLoader({ failures: 1 });
  return S.synthesizeSpeech('Hi.', loader, { sleep: nowait }).then(() => {
    eq(state.created, 2, 'clients created');
  });
});

await checkAsync('giving up returns null rather than throwing', () => {
  const { loader, state } = fakeLoader({ alwaysFail: true });
  return S.synthesizeSpeech('Hello.', loader, { sleep: nowait, attempts: 3 }).then((r) => {
    eq(r.audio, null, 'audio');
    eq(r.complete, false, 'complete');
    eq(state.created, 3, 'attempts made');
  });
});

await checkAsync('a failure late in a long reply keeps the earlier audio', () => {
  let chunkN = 0;
  const loader = {
    format: 'mp3',
    create: async () => ({
      setMetadata: async () => {},
      toStream: async () => {
        chunkN++;
        if (chunkN > 1) throw new Error('Stream closed before the synthesis completed');
        return { audioStream: (async function* () { yield MP3(128); })() };
      },
    }),
  };
  const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i} padded out with filler words.`).join(' ');
  return S.synthesizeSpeech(long, loader, { sleep: nowait, attempts: 1 }).then((r) => {
    eq(r.complete, false, 'complete');
    eq(r.chunksRendered, 1, 'chunks rendered');
    if (!r.audio?.length) throw new Error('partial audio was discarded — silence beat partial speech');
    if (r.chunksTotal < 2) throw new Error('test text did not actually chunk');
  });
});

await checkAsync('each chunk is handed over as it renders, not at the end', async () => {
  const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i} padded out with filler words.`).join(' ');
  const seen = [];
  let finished = false;
  const r = await S.synthesizeSpeech(long, fakeLoader().loader, {
    sleep: nowait,
    onChunk: (audio, index, total) => {
      if (finished) throw new Error('chunk arrived only after synthesis finished');
      if (!audio?.length) throw new Error('empty chunk handed over');
      seen.push([index, total]);
    },
  });
  finished = true;
  if (r.chunksTotal < 2) throw new Error('test text did not actually chunk');
  eq(seen.length, r.chunksRendered, 'one callback per rendered chunk');
  eq(seen.map(([i]) => i).join(','), seen.map((_, i) => i).join(','), 'chunks arrived in order');
  eq(seen.every(([, total]) => total === r.chunksTotal), true, 'total reported consistently');
});

await checkAsync('a chunk listener that throws does not cost the rest of the reply', async () => {
  const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i} padded out with filler words.`).join(' ');
  const warns = [];
  const r = await S.synthesizeSpeech(long, fakeLoader().loader, {
    sleep: nowait,
    onWarn: (m) => warns.push(m),
    onChunk: () => { throw new Error('client blew up'); },
  });
  eq(r.complete, true, 'complete');
  eq(r.chunksRendered, r.chunksTotal, 'every chunk still rendered');
  if (!warns.some((m) => m.includes('chunk listener threw'))) throw new Error('the throw was swallowed silently');
});

await checkAsync('the caller can tell a partial render from a whole one', () => {
  const ok = fakeLoader().loader;
  const bad = fakeLoader({ alwaysFail: true }).loader;
  return Promise.all([
    S.synthesizeSpeech('Fine.', ok, { sleep: nowait }),
    S.synthesizeSpeech('Fine.', bad, { sleep: nowait }),
  ]).then(([a, b]) => {
    eq(a.complete, true, 'good run complete');
    eq(b.complete, false, 'bad run complete');
  });
});

await checkAsync('an empty audio stream counts as a failure, not as success', () => {
  const { loader } = fakeLoader({ empty: true });
  return S.synthesizeSpeech('Hello.', loader, { sleep: nowait, attempts: 2 }).then((r) => {
    eq(r.audio, null, 'audio');
    eq(r.complete, false, 'complete');
  });
});

await checkAsync('a hung stream times out instead of blocking forever', () => {
  const { loader } = fakeLoader({ hang: true });
  const started = Date.now();
  return S.synthesizeSpeech('Hello.', loader, { sleep: nowait, attempts: 1, timeoutMs: 120 }).then((r) => {
    eq(r.audio, null, 'audio');
    if (Date.now() - started > 3000) throw new Error('timeout did not fire promptly');
  });
});

await checkAsync('warnings are surfaced, not swallowed', () => {
  const { loader } = fakeLoader({ alwaysFail: true });
  const warnings = [];
  return S.synthesizeSpeech('Hello.', loader, { sleep: nowait, attempts: 2, onWarn: (m) => warnings.push(m) })
    .then(() => {
      if (!warnings.length) throw new Error('failed silently — the original bug');
      if (!warnings.some((w) => /gave up/i.test(w))) throw new Error(`no give-up warning: ${warnings.join(' | ')}`);
    });
});

const SCH = await load('src/daemon/schedule.ts', 'schedule.mjs');
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0);

check('the grammar parses every documented form and only those', () => {
  for (const [spec, kind] of [
    ['manual', 'manual'], ['every 15m', 'every'], ['every 2h', 'every'],
    ['every 1 minute', 'every'], ['daily@08:00', 'daily'], ['weekdays@07:30', 'daily'],
    ['weekends@10:00', 'daily'], ['weekly@mon 09:00', 'daily'], ['weekly@sunday 18:00', 'daily'],
    ['monthly@1 09:00', 'monthly'], ['MANUAL', 'manual'], ['Daily@8:05', 'daily'],
  ]) {
    const s = SCH.parseSchedule(spec);
    if (s?.kind !== kind) throw new Error(`"${spec}" gave ${JSON.stringify(s)}`);
  }
  for (const bad of ['', 'sometimes', 'every 30s', 'every 0m', 'every 25h', 'daily@24:00',
                     'daily@08:60', 'weekly@fun 09:00', 'monthly@29 09:00', 'monthly@0 09:00',
                     'daily 08:00', '* * * * *']) {
    if (SCH.parseSchedule(bad) !== null) throw new Error(`"${bad}" was accepted`);
  }
});

check('manual never fires on its own', () => {
  eq(SCH.nextRun(SCH.parseSchedule('manual'), at(2026, 8, 4, 12, 0)), null, 'nextRun');
});

check('daily fires today if the time is still ahead, else tomorrow', () => {
  const s = SCH.parseSchedule('daily@08:00');
  eq(SCH.nextRun(s, at(2026, 8, 4, 6, 0)).getTime(), at(2026, 8, 4, 8, 0).getTime(), 'before');
  eq(SCH.nextRun(s, at(2026, 8, 4, 8, 0)).getTime(), at(2026, 8, 5, 8, 0).getTime(), 'exactly at — strictly after');
  eq(SCH.nextRun(s, at(2026, 8, 4, 9, 0)).getTime(), at(2026, 8, 5, 8, 0).getTime(), 'after');
});

check('weekdays skips the weekend', () => {
  const s = SCH.parseSchedule('weekdays@08:00');
  eq(SCH.nextRun(s, at(2026, 8, 7, 9, 0)).getTime(), at(2026, 8, 10, 8, 0).getTime(), 'Fri evening → Mon');
});

check('weekly lands on the named day', () => {
  const s = SCH.parseSchedule('weekly@mon 09:00');
  const n = SCH.nextRun(s, at(2026, 8, 4, 12, 0));
  eq(n.getDay(), 1, 'day of week');
  eq(n.getTime(), at(2026, 8, 10, 9, 0).getTime(), 'next Monday');
});

check('monthly rolls into the next month when passed', () => {
  const s = SCH.parseSchedule('monthly@1 09:00');
  eq(SCH.nextRun(s, at(2026, 8, 4, 12, 0)).getTime(), at(2026, 9, 1, 9, 0).getTime(), 'rolls to Sep 1');
  eq(SCH.nextRun(s, at(2026, 8, 1, 8, 0)).getTime(), at(2026, 8, 1, 9, 0).getTime(), 'still ahead this month');
});

check('every-N is a fixed offset from now', () => {
  const s = SCH.parseSchedule('every 30m');
  eq(SCH.nextRun(s, at(2026, 8, 4, 12, 0)).getTime(), at(2026, 8, 4, 12, 30).getTime(), 'offset');
});

check('schedules describe themselves in speakable words', () => {
  for (const [spec, words] of [
    ['manual', 'on demand only'], ['every 30m', 'every 30 minutes'], ['every 1h', 'every hour'],
    ['daily@08:00', 'daily at 8:00 AM'], ['weekdays@18:30', 'on weekdays at 6:30 PM'],
    ['weekly@sun 18:00', 'every Sunday at 6:00 PM'], ['monthly@15 09:00', 'monthly on day 15 at 9:00 AM'],
  ]) {
    eq(SCH.describeSchedule(SCH.parseSchedule(spec)), words, spec);
  }
});

const W = await load('src/daemon/workflows.ts', 'workflows.mjs');
const mkStore = () => new W.WorkflowStore(':memory:');
const WF = { name: 'morning briefing', purpose: 'test', prompt: 'Summarize the day.', schedule: 'daily@08:00' };

check('WORKFLOWS: a run carries its scope only while the workflow is active', () => {
  eq(JSON.stringify(W.scopeForRun({ status: 'proposed', scope: '["fs.write:outside:*"]' })), '[]', 'proposed');
  eq(JSON.stringify(W.scopeForRun({ status: 'paused', scope: '["talon.act"]' })), '[]', 'paused');
  eq(JSON.stringify(W.scopeForRun({ status: 'active', scope: '["talon.act"]' })), '["talon.act"]', 'active');
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  if (!src.includes("scope: scopeForRun(wf)")) throw new Error('fireWorkflow no longer derives the scope from scopeForRun');
  const resume = src.slice(src.indexOf("} else if (action === 'resume') {"), src.indexOf("} else if (action === 'resume') {") + 900);
  if (!resume.includes('daemonHello(') || !resume.includes('isLocalAddress(')) throw new Error('resuming a scoped workflow lost its local + Hello gate');
  const brainSrc2 = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!brainSrc2.includes("lastVia === 'workflow' && !gateState.tainted && scopeAllows(")) throw new Error('a tainted session can still ride a standing order');
});

check('WORKFLOWS: a scoped workflow is never created armed — only approve arms it', () => {
  eq(W.initialStatus('active', ['shell.exec:*:tainted']), 'proposed', 'scoped + active');
  eq(W.initialStatus(undefined, ['talon.act']), 'proposed', 'scoped + default');
  eq(W.initialStatus('active', []), 'active', 'unscoped active');
  eq(W.initialStatus('proposed', undefined), 'proposed', 'unscoped proposed');
  eq(W.initialStatus(undefined, undefined), 'active', 'unscoped default');
  if (!/initialStatus\(body\.status, body\.scope\)/.test(readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8'))) {
    throw new Error('POST /workflows no longer takes its status from initialStatus');
  }
});

check('a proposal does nothing until approved', () => {
  const s = mkStore();
  const wf = s.create(WF, { source: 'brain', now: at(2026, 8, 4, 6, 0) });
  eq(wf.status, 'proposed', 'status');
  eq(wf.nextRunTs, null, 'a proposal must never be armed');
  const { due, skipped } = s.tick(at(2026, 8, 10, 12, 0));
  eq(due.length + skipped.length, 0, 'proposed workflow reached the scheduler');
});

check('approval arms the schedule', () => {
  const s = mkStore();
  const wf = s.create(WF, { now: at(2026, 8, 4, 6, 0) });
  const armed = s.approve(wf.id, at(2026, 8, 4, 6, 0));
  eq(armed.status, 'active', 'status');
  eq(Date.parse(armed.nextRunTs), at(2026, 8, 4, 8, 0).getTime(), 'next slot');
});

check('a due workflow fires once and the slot advances', () => {
  const s = mkStore();
  const wf = s.create(WF, { status: 'active', now: at(2026, 8, 4, 6, 0) });
  const { due } = s.tick(at(2026, 8, 4, 8, 0, 30));
  eq(due.length, 1, 'due count');
  eq(Date.parse(s.get(wf.id).nextRunTs), at(2026, 8, 5, 8, 0).getTime(), 'advanced');
  const again = s.tick(at(2026, 8, 4, 8, 1));
  eq(again.due.length, 0, 'must not double-fire the same slot');
});

check('pause silences the schedule; resume re-arms it', () => {
  const s = mkStore();
  const wf = s.create(WF, { status: 'active', now: at(2026, 8, 4, 6, 0) });
  eq(s.pause(wf.id).nextRunTs, null, 'paused slot');
  eq(s.tick(at(2026, 8, 4, 9, 0)).due.length, 0, 'paused workflow fired');
  const back = s.resume(wf.id, at(2026, 8, 4, 9, 0));
  eq(Date.parse(back.nextRunTs), at(2026, 8, 5, 8, 0).getTime(), 're-armed from now');
});

check('a slot missed by more than the grace window skips VISIBLY', () => {
  const s = mkStore();
  const wf = s.create(WF, { status: 'active', now: at(2026, 8, 4, 6, 0) });
  const { due, skipped } = s.tick(at(2026, 8, 4, 11, 0));
  eq(due.length, 0, 'must not fire hours late');
  eq(skipped.length, 1, 'skip recorded');
  const runs = s.runs(wf.id);
  eq(runs.length, 1, 'skip is a run row');
  eq(runs[0].outcome, 'skipped', 'outcome');
  eq(s.get(wf.id).lastOutcome, 'skipped', 'surfaced on the workflow');
});

check('a still-open run blocks the next slot instead of stacking', () => {
  const s = mkStore();
  const wf = s.create({ ...WF, schedule: 'every 30m' }, { status: 'active', now: at(2026, 8, 4, 6, 0) });
  s.tick(at(2026, 8, 4, 6, 31));
  s.openRun(wf.id, 'schedule', at(2026, 8, 4, 6, 31));
  const { due, skipped } = s.tick(at(2026, 8, 4, 7, 2));
  eq(due.length, 0, 'stacked a second run');
  eq(skipped.length, 1, 'skip recorded');
});

check('runs close once; a late echo is a no-op', () => {
  const s = mkStore();
  const wf = s.create(WF, { status: 'active' });
  const runId = s.openRun(wf.id, 'manual');
  const closed = s.closeRun(runId, 'ok', 'done');
  eq(closed.outcome, 'ok', 'closed');
  eq(s.closeRun(runId, 'failed', 'late echo'), null, 'second close must not overwrite');
  eq(s.runs(wf.id)[0].outcome, 'ok', 'outcome preserved');
});

check('the watchdog times out stuck runs; a brain crash fails open runs', () => {
  const s = mkStore();
  const wf = s.create(WF, { status: 'active' });
  s.openRun(wf.id, 'schedule', at(2026, 8, 4, 6, 0));
  const timed = s.timeoutRuns(20 * 60_000, at(2026, 8, 4, 6, 30));
  eq(timed.length, 1, 'timeout count');
  eq(timed[0].outcome, 'timeout', 'outcome');
  s.openRun(wf.id, 'schedule', at(2026, 8, 4, 7, 0));
  const failed = s.failOpenRuns('brain went offline mid-run', at(2026, 8, 4, 7, 5));
  eq(failed.length, 1, 'failed count');
  eq(s.get(wf.id).lastOutcome, 'failed', 'failure surfaced');
});

check('the store refuses what the grammar refuses', () => {
  const s = mkStore();
  for (const bad of [
    { ...WF, schedule: 'sometimes' },
    { ...WF, name: '' },
    { ...WF, prompt: '' },
    { ...WF, name: 'x'.repeat(200) },
  ]) {
    let threw = false;
    try { s.create(bad); } catch { threw = true; }
    if (!threw) throw new Error(`accepted ${JSON.stringify(bad).slice(0, 60)}`);
  }
});

check('lifecycle transitions only move along the real edges', () => {
  const s = mkStore();
  const wf = s.create(WF);
  for (const [fn, arg] of [['pause', wf.id], ['resume', wf.id]]) {
    let threw = false;
    try { s[fn](arg); } catch { threw = true; }
    if (!threw) throw new Error(`${fn} allowed on a proposed workflow`);
  }
  s.approve(wf.id);
  let threw = false;
  try { s.approve(wf.id); } catch { threw = true; }
  if (!threw) throw new Error('approve allowed twice');
});

check('delete removes the workflow and its history', () => {
  const s = mkStore();
  const wf = s.create(WF, { status: 'active' });
  s.openRun(wf.id, 'manual');
  s.remove(wf.id);
  eq(s.get(wf.id), null, 'gone');
  eq(s.openRuns().length, 0, 'runs gone');
});

check('an unapproved or paused workflow can never open a run', () => {
  const s = mkStore();
  const wf = s.create(WF);
  let threw = false;
  try { s.openRun(wf.id, 'manual'); } catch { threw = true; }
  if (!threw) throw new Error('a PROPOSED workflow opened a run');
  s.approve(wf.id);
  s.pause(wf.id);
  threw = false;
  try { s.openRun(wf.id, 'manual'); } catch { threw = true; }
  if (!threw) throw new Error('a PAUSED workflow opened a run');
});

check('a manual-schedule workflow only ever runs on demand', () => {
  const s = mkStore();
  const wf = s.create({ ...WF, schedule: 'manual' }, { status: 'active' });
  eq(wf.nextRunTs, null, 'no slot');
  eq(s.tick(at(2027, 1, 1, 0, 0)).due.length, 0, 'fired on its own');
  const runId = s.openRun(wf.id, 'manual');
  eq(typeof runId, 'number', 'run-now still works');
});

check('reading workflows is Class 0; proposing, pausing, run-now are Class 1', () => {
  eq(classify('mcp__aeryx__workflow_list', {}, G, clean()).riskClass, 0, 'list');
  eq(classify('mcp__aeryx__workflow_runs', { id: 1 }, G, clean()).riskClass, 0, 'runs');
  eq(classify('mcp__aeryx__workflow_propose', { name: 'x', schedule: 'daily@08:00' }, G, clean()).riskClass, 1, 'propose');
  eq(classify('mcp__aeryx__workflow_pause', { id: 1 }, G, clean()).riskClass, 1, 'pause');
  eq(classify('mcp__aeryx__workflow_run_now', { id: 1 }, G, clean()).riskClass, 1, 'run_now');
});

check('arming or changing automation is Class 2 with a question', () => {
  for (const verb of ['approve', 'edit', 'resume', 'delete']) {
    const c = classify(`mcp__aeryx__workflow_${verb}`, { id: 3, name: 'morning briefing' }, G, clean());
    eq(c.riskClass, 2, `${verb} riskClass`);
    eq(c.laneId, 'workflow.govern', `${verb} lane`);
    if (!c.question || !c.question.includes('#3')) throw new Error(`${verb} question lost the id: ${c.question}`);
  }
});

check('workflow.govern is pinned — no streak ever silences the approval', () => {
  if (L.eligible('workflow.govern', 2, P)) throw new Error('workflow.govern is promotable');
});

check('an unknown workflow verb falls through to fail-to-ask', () => {
  const c = classify('mcp__aeryx__workflow_selfdestruct', {}, G, clean());
  eq(c.riskClass, 2, 'riskClass');
  if (c.laneId.startsWith('workflow.')) throw new Error(`unknown verb landed in a granted lane: ${c.laneId}`);
});

check('shell access to the daemon port is confirmed — no self-approval curl', () => {
  for (const [tool, cmd] of [
    ['Bash', 'curl -X POST http://127.0.0.1:23799/confirm -d "{\\"id\\":\\"c1\\",\\"approve\\":true}"'],
    ['PowerShell', 'Invoke-RestMethod -Method Post http://localhost:23799/workflows/3/approve'],
    ['Bash', 'curl http://127.0.0.1:23799/status'],
  ]) {
    const c = classify(tool, { command: cmd }, G, clean());
    if (c.riskClass < 2) throw new Error(`${tool} reached the daemon port at Class ${c.riskClass}`);
    if (L.eligible(c.laneId, c.riskClass, P)) throw new Error(`daemon-port lane ${c.laneId} is promotable`);
  }
});

check('a workflow audit row can never grant autonomy', () => {
  const rows = [
    { tool: 'workflow', lane: 'outward.SendUserFile', verdict: L.LADDER_VERDICT.standing },
    { tool: 'workflow', lane: 'workflow.govern', verdict: L.LADDER_VERDICT.standing },
  ];
  eq(L.replayLanes(rows, P, true).size, 0, 'a workflow row granted a lane');
});

check('workflow lanes speak', () => {
  eq(L.laneLabel('workflow.govern'), 'changing workflows', 'govern');
  eq(L.laneLabel('workflow.propose'), 'proposing workflows', 'propose');
});

const A = await load('src/daemon/agents.ts', 'agents.mjs');

check('AGENTS: a create call never makes an active agent, and reshaping one demotes it', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const route = src.slice(src.indexOf("url.pathname === '/agents' && req.method === 'POST'"), src.indexOf("url.pathname === '/agents' && req.method === 'POST'") + 400);
  if (!route.includes("const status = 'proposed' as const;")) throw new Error('POST /agents can create an active agent');
  const st = new A.AgentStore(':memory:');
  const a = st.create({ slug: 'scout', description: 'd'.repeat(20), prompt: 'p'.repeat(40), tools: ['Read'] }, { status: 'proposed' });
  st.approve(a.id);
  st.edit(a.id, { description: 'e'.repeat(20) });
  eq(st.get(a.id).status, 'active', 'a description tweak keeps the approval');
  st.edit(a.id, { tools: ['Read', 'Bash'] });
  eq(st.get(a.id).status, 'proposed', 'new tools demote');
  st.approve(a.id);
  st.edit(a.id, { prompt: 'q'.repeat(40) });
  eq(st.get(a.id).status, 'proposed', 'a new prompt demotes');
  st.close();
});
const mkAgents = () => new A.AgentStore(':memory:');
const AG = { slug: 'proof-echo', description: 'echoes a marker for tests', prompt: 'Reply exactly READY.' };

check('an agent proposal never reaches the boot roster', () => {
  const s = mkAgents();
  const a = s.create(AG, { source: 'brain' });
  eq(a.status, 'proposed', 'status');
  eq(s.active().length, 0, 'proposed agent on the roster');
});

check('approval puts the agent on the roster; retire removes it but keeps it', () => {
  const s = mkAgents();
  const a = s.create(AG);
  s.approve(a.id);
  eq(s.active().length, 1, 'roster after approve');
  s.retire(a.id);
  eq(s.active().length, 0, 'roster after retire');
  eq(s.get(a.id).status, 'retired', 'retired agents stay on the books');
  s.revive(a.id);
  eq(s.active().length, 1, 'roster after revive');
});

check('slugs are unique across ALL states — a retired name cannot be shadowed', () => {
  const s = mkAgents();
  const a = s.create(AG);
  s.retire(a.id);
  let threw = false;
  try { s.create({ ...AG, prompt: 'Something else entirely.' }); } catch { threw = true; }
  if (!threw) throw new Error('a retired slug was shadowed by a new agent');
});

check('the store refuses malformed agents', () => {
  const s = mkAgents();
  for (const bad of [
    { ...AG, slug: 'Bad Slug' }, { ...AG, slug: 'x' }, { ...AG, slug: '9start' },
    { ...AG, description: '' }, { ...AG, prompt: '' },
    { ...AG, tools: 'Bash' }, { ...AG, tools: [''] },
  ]) {
    let threw = false;
    try { s.create(bad); } catch { threw = true; }
    if (!threw) throw new Error(`accepted ${JSON.stringify(bad).slice(0, 70)}`);
  }
});

check('agent lifecycle transitions only move along the real edges', () => {
  const s = mkAgents();
  const a = s.create(AG);
  let threw = false;
  try { s.revive(a.id); } catch { threw = true; }
  if (!threw) throw new Error('revive allowed on a proposed agent');
  s.approve(a.id);
  threw = false;
  try { s.approve(a.id); } catch { threw = true; }
  if (!threw) throw new Error('approve allowed twice');
});

check('edit validates the merged result and keeps slug uniqueness', () => {
  const s = mkAgents();
  const a = s.create(AG, { status: 'active' });
  const b = s.create({ ...AG, slug: 'other-agent' });
  s.edit(a.id, { description: 'still fine' });
  let threw = false;
  try { s.edit(b.id, { slug: a.slug }); } catch { threw = true; }
  if (!threw) throw new Error('edit stole another agent\'s slug');
  threw = false;
  try { s.edit(a.id, { prompt: '' }); } catch { threw = true; }
  if (!threw) throw new Error('edit accepted an empty prompt');
});

check('agent verbs: read free, propose/retire Class 1, govern Class 2', () => {
  eq(classify('mcp__aeryx__agent_list', {}, G, clean()).riskClass, 0, 'list');
  eq(classify('mcp__aeryx__agent_propose', { slug: 'x-agent' }, G, clean()).riskClass, 1, 'propose');
  eq(classify('mcp__aeryx__agent_retire', { id: 1 }, G, clean()).riskClass, 1, 'retire');
  for (const verb of ['approve', 'edit', 'revive']) {
    const c = classify(`mcp__aeryx__agent_${verb}`, { id: 2, slug: 'proof-echo' }, G, clean());
    eq(c.riskClass, 2, `${verb} riskClass`);
    eq(c.laneId, 'agent.govern', `${verb} lane`);
    if (!c.question?.includes('proof-echo')) throw new Error(`${verb} question lost the slug`);
  }
});

check('agent.govern is pinned — arming a permanent agent always asks', () => {
  if (L.eligible('agent.govern', 2, P)) throw new Error('agent.govern is promotable');
});

check('an unknown agent verb falls through to fail-to-ask', () => {
  const c = classify('mcp__aeryx__agent_selfreplicate', {}, G, clean());
  eq(c.riskClass, 2, 'riskClass');
  if (c.laneId.startsWith('agent.')) throw new Error(`unknown verb landed in a granted lane: ${c.laneId}`);
});

check('an agent audit row can never grant autonomy', () => {
  const rows = [
    { tool: 'agent', lane: 'agent.govern', verdict: L.LADDER_VERDICT.standing },
    { tool: 'agent', lane: GRANT, verdict: L.LADDER_VERDICT.standing },
  ];
  eq(L.replayLanes(rows, P, true).size, 0, 'an agent row granted a lane');
});

check('REGISTRY: a disabled server is denied outright', () => {
  const g2 = { ...G, mcpRegistry: { badsrv: { enabled: false } } };
  const c = classify('mcp__badsrv__do_thing', {}, g2, clean());
  eq(c.riskClass, 3, 'riskClass');
  if (!c.denyReason) throw new Error('disabled server was not denied');
});

check('REGISTRY: minClass can only tighten — never below the fail-to-ask floor', () => {
  const g2 = { ...G, mcpRegistry: { fs: { minClass: 0 }, lax: { minClass: 1 }, hard: { minClass: 3 }, silly: { minClass: 99 } } };
  eq(classify('mcp__fs__read_file', {}, g2, clean()).riskClass, 2, 'minClass 0 clamped to the floor');
  eq(classify('mcp__lax__do', {}, g2, clean()).riskClass, 2, 'minClass 1 clamped to the floor');
  const hard = classify('mcp__hard__do', {}, g2, clean());
  eq(hard.riskClass, 3, 'minClass 3 honoured');
  if (hard.denyReason) throw new Error('minClass 3 must ask (with Hello), not deny');
  if (!hard.question) throw new Error('Class 3 with no question — the user could not be asked');
  eq(classify('mcp__silly__do', {}, g2, clean()).riskClass, 3, 'minClass 99 clamped to 3');
});

check('REGISTRY: a Class-3 registry lane is never promotable', () => {
  const g2 = { ...G, mcpRegistry: { hard: { minClass: 3 } } };
  const c = classify('mcp__hard__transfer_funds', {}, g2, clean());
  if (L.eligible(c.laneId, c.riskClass, P)) throw new Error('registry Class 3 lane is promotable');
});

check('REGISTRY: taints flag marks content-pulling servers', () => {
  const g2 = { ...G, mcpRegistry: { web: { taints: true }, mail: {} } };
  if (!classify('mcp__web__fetch_page', {}, g2, clean()).taints) throw new Error('tainting server did not taint');
  if (classify('mcp__mail__send', {}, g2, clean()).taints) throw new Error('non-tainting server tainted');
});

check('REGISTRY: unregistered servers keep plain fail-to-ask', () => {
  const c = classify('mcp__totally_new__tool', {}, G, clean());
  eq(c.riskClass, 2, 'riskClass');
  eq(c.laneId, 'mcp.call:mcp__totally_new__tool', 'per-tool lane');
});

check('REGISTRY: the internal aeryx server is out of the registry\'s reach', () => {
  const g2 = { ...G, mcpRegistry: { aeryx: { enabled: false, minClass: 3 } } };
  eq(classify('mcp__aeryx__workflow_list', {}, g2, clean()).riskClass, 0, 'workflow_list');
  eq(classify('mcp__aeryx__workflow_propose', { name: 'x' }, g2, clean()).riskClass, 1, 'workflow_propose');
  eq(classify('mcp__aeryx__agent_list', {}, g2, clean()).riskClass, 0, 'agent_list');
  eq(classify('mcp__aeryx__workflow_approve', { id: 1 }, g2, clean()).riskClass, 2, 'workflow_approve stays Class 2');
});

check('CLOSURE: the brain logs wyrmling spawns from the assistant stream', () => {
  const at = brainSrc.indexOf("block.name === 'Task' || block.name === 'Agent'");
  if (at < 0) throw new Error('the wyrmling spawn check is gone from the assistant handler');
  const around = brainSrc.slice(at, at + 600);
  if (!around.includes("logCmd('wyrmling'")) throw new Error('spawns are no longer written to the chain');
});

check('a wyrmling audit row can never grant autonomy', () => {
  const rows = [
    { tool: 'wyrmling', lane: GRANT, verdict: L.LADDER_VERDICT.standing },
    { tool: 'wyrmling', lane: 'wyrmling.backend-engineer', verdict: L.LADDER_VERDICT.standing },
  ];
  eq(L.replayLanes(rows, P, true).size, 0, 'a wyrmling row granted a lane');
});

const N = await load('src/daemon/news.ts', 'news.mjs');

const RSS_SAMPLE = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
  <item><title>Plain headline</title><link>https://example.com/a</link><pubDate>Tue, 04 Aug 2026 08:00:00 GMT</pubDate></item>
  <item><title><![CDATA[CDATA &amp; entities &#8212; kept]]></title><link>https://example.com/b</link></item>
  <item><title>No link, dropped</title></item>
  <item><title>Bad scheme, dropped</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

const ATOM_SAMPLE = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>Atom entry</title><link rel="alternate" href="https://example.com/atom1"/><updated>2026-08-04T09:00:00Z</updated></entry>
  <entry><title>Self only</title><link rel="self" href="https://example.com/self"/><link href="https://example.com/atom2"/></entry>
</feed>`;

check('RSS 2.0 items parse; junk items are dropped, never thrown', () => {
  const items = N.parseFeed(RSS_SAMPLE, 'test');
  eq(items.length, 2, 'items kept');
  eq(items[0].title, 'Plain headline', 'title');
  eq(items[0].link, 'https://example.com/a', 'link');
  if (!items[0].ts?.startsWith('2026-08-04T08:00')) throw new Error(`pubDate mangled: ${items[0].ts}`);
  eq(items[1].title, 'CDATA & entities — kept', 'CDATA + entity decoding');
});

check('Atom entries parse; rel=self never wins over alternate', () => {
  const items = N.parseFeed(ATOM_SAMPLE, 'test');
  eq(items.length, 2, 'items kept');
  eq(items[0].link, 'https://example.com/atom1', 'alternate link');
  eq(items[1].link, 'https://example.com/atom2', 'unrel link beats self');
});

check('a malformed document yields an empty list, not an exception', () => {
  for (const junk of ['', 'not xml at all', '<rss><channel><item><title>half open', '<html><body>a 404 page</body></html>']) {
    const items = N.parseFeed(junk, 'test');
    if (!Array.isArray(items)) throw new Error('did not return a list');
  }
});

check('entity-encoded markup in a title never leaves the parser as tags', () => {
  const feed = `<rss><channel>
    <item><title>Look: &lt;img src=x onerror=alert(1)&gt; free</title><link>https://example.com/x</link></item>
    <item><title><![CDATA[Nested &amp;lt;b&amp;gt; stays inert]]></title><link>https://example.com/y</link></item>
    <item><title>AT&amp;T beats a &lt; b in court</title><link>https://example.com/z</link></item>
  </channel></rss>`;
  const items = N.parseFeed(feed, 'test');
  eq(items.length, 3, 'items kept');
  for (const it of items) {
    if (/<[^>]*>/.test(it.title)) throw new Error(`markup escaped the parser: ${it.title}`);
  }
  eq(items[0].title, 'Look: free', 'decoded tag stripped, text kept');
  eq(items[2].title, 'AT&T beats a < b in court', 'honest angle brackets survive');
});

check('item cap holds and titles are bounded', () => {
  const many = '<rss><channel>' + Array.from({ length: 60 }, (_, i) =>
    `<item><title>${'x'.repeat(500)} ${i}</title><link>https://example.com/${i}</link></item>`).join('') + '</channel></rss>';
  const items = N.parseFeed(many, 'test');
  if (items.length > 30) throw new Error(`cap ignored: ${items.length}`);
  if (items[0].title.length > 200) throw new Error('title unbounded');
});

check('feed config normalizes; garbage falls back to the defaults', () => {
  eq(N.normalizeFeeds(undefined), N.DEFAULT_FEEDS, 'missing config');
  eq(N.normalizeFeeds([]).length, N.DEFAULT_FEEDS.length, 'empty list falls back');
  const custom = N.normalizeFeeds([
    { name: 'Mine', category: 'tech', url: 'https://example.com/rss' },
    { name: 'Bad', category: 'gossip', url: 'https://example.com/x' },
    { name: 'NoUrl', category: 'tech', url: 'ftp://nope' },
  ]);
  eq(custom.length, 1, 'only the valid custom feed survives');
  eq(custom[0].name, 'Mine', 'name');
});

check('feed config: region/sub validate; pre-region configs still work unchanged', () => {
  const out = N.normalizeFeeds([
    { name: 'Old entry', category: 'global', url: 'https://example.com/old' },
    { name: 'Pinned', category: 'global', url: 'https://example.com/p', region: 'as', sub: 'CN' },
    { name: 'BadRegion', category: 'global', url: 'https://example.com/br', region: 'ATLANTIS', sub: 'cn' },
    { name: 'SubNoRegion', category: 'tech', url: 'https://example.com/snr', sub: 'us' },
    { name: 'BadSub', category: 'global', url: 'https://example.com/bs', region: 'EU', sub: 'xx' },
  ]);
  eq(out.length, 5, 'all entries survive');
  eq(out[0].region, null, 'old entry gets null region, not a crash');
  eq(out[1].region, 'AS', 'region case-normalized');
  eq(out[1].sub, 'cn', 'sub case-normalized');
  eq(out[2].region, null, 'unknown region refused');
  eq(out[2].sub, null, 'sub cannot ride on a refused region');
  eq(out[3].sub, null, 'sub without region refused');
  eq(out[4].sub, null, 'unknown sub refused, region kept');
  eq(out[4].region, 'EU', 'region kept');
});

check('parseFeed: the feed’s home country is the fallback; unpinned = null', () => {
  const pinned = N.parseFeed(RSS_SAMPLE, 'test', 30, { region: 'AS', sub: 'in' });
  eq(pinned[0].region, 'AS', 'region stamped');
  eq(pinned[0].country, 'in', 'no country in the headline — feed home wins');
  const bare = N.parseFeed(RSS_SAMPLE, 'test');
  eq(bare[0].region, null, 'no spec, no region');
  eq(bare[0].country, null, 'no spec, no country');
});

check('the headline outranks the feed: a Korea story on CBC is Asia’s, not Canada’s', () => {
  const feed = (title) => `<rss><channel><item><title>${title}</title><link>https://example.com/x</link></item></channel></rss>`;
  const one = (title, spec) => N.parseFeed(feed(title), 'test', 30, spec)[0];
  const kr = one('South Korea records highest-ever temperature of 41 C', { region: 'NA', sub: 'ca' });
  eq(kr.country, 'kr', 'detected from the headline');
  eq(kr.region, 'AS', 'region follows the detected country, not the feed');
  eq(one('North Korea tests new missile', { region: null, sub: null }).country, 'kp', 'North Korea is not South Korea');
  eq(one('US sanctions target shipping fleet', {}).country, 'us', 'acronym US matches');
  eq(one('tell us more about the plan', {}).country, null, 'lowercase "us" is a pronoun, not a country');
  eq(one('Deal reached between Côte d’Ivoire and neighbours', {}).country, 'ci', 'aliased spellings match');
  eq(one('UK and France sign channel accord', {}).country, 'gb', 'leftmost mention wins');
  eq(N.regionOfCountry('br'), 'SA', 'regionOfCountry');
  eq(N.regionOfCountry('zz'), null, 'unknown iso is null');
});

await checkAsync('a feed-wide repeated image is branding and is dropped, one-off images stay', async () => {
  const item = (t, img) => `<item><title>${t}</title><link>https://example.com/${t}</link>`
    + `<media:thumbnail url="${img}"/></item>`;
  const feed = '<rss><channel>'
    + item('a', 'https://p.example/logo.png') + item('b', 'https://p.example/logo.png')
    + item('c', 'https://p.example/logo.png') + item('d', 'https://p.example/photo-d.jpg')
    + '</channel></rss>';
  const cache = await N.refreshNews(
    [{ name: 'Logoful', category: 'global', url: 'https://p.example/rss', region: 'AF', sub: null }],
    async () => feed,
  );
  const items = cache.categories.global;
  eq(items.filter((it) => it.image === null).length, 3, 'the repeated masthead is suppressed');
  eq(items.find((it) => it.title === 'd').image, 'https://p.example/photo-d.jpg', 'the real photo survives');
});

await checkAsync('global cap is per region — a loud region cannot starve a quiet one', async () => {
  const item = (t, d) => `<item><title>${t}</title><link>https://example.com/${t}</link><pubDate>${d}</pubDate></item>`;
  const loud = '<rss><channel>' + Array.from({ length: 12 }, (_, i) =>
    item(`Berlin update ${i}`, `Tue, 04 Aug 2026 2${Math.min(i, 3)}:0${i % 10}:00 GMT`)).join('') + '</channel></rss>';
  const quiet = '<rss><channel>' + [
    item('Brazil opens new port', 'Mon, 03 Aug 2026 08:00:00 GMT'),
    item('Chile counts votes', 'Sun, 02 Aug 2026 08:00:00 GMT'),
  ].join('') + '</channel></rss>';
  const cache = await N.refreshNews([
    { name: 'Loud', category: 'global', url: 'https://l.example/rss', region: 'EU', sub: null },
    { name: 'Quiet', category: 'global', url: 'https://q.example/rss', region: 'SA', sub: null },
  ], async (url) => (url.includes('l.example') ? loud : quiet));
  const sa = cache.categories.global.filter((it) => it.region === 'SA');
  eq(sa.length, 2, 'both quiet-region stories survive despite being oldest');
});

check('findImage: real-feed spellings extract; only clean https URLs leave', () => {
  const url = (b) => N.findImage(`<item><title>t</title>${b}</item>`);
  eq(url('<media:thumbnail url="https://a.example/i.jpg"/>'), 'https://a.example/i.jpg', 'media:thumbnail');
  eq(url('<media:content type="image/jpeg" url="https://a.example/mc.jpg"/>'),
    'https://a.example/mc.jpg', 'media:content, type before url');
  eq(url('<media:content url="https://a.example/m2.png" medium="image"/>'),
    'https://a.example/m2.png', 'media:content, medium after url');
  eq(url('<enclosure url="https://a.example/e.webp" type="image/webp"/>'), 'https://a.example/e.webp', 'enclosure');
  eq(url('<enclosure url="https://a.example/pod.mp3" type="audio/mpeg"/>'), null, 'audio enclosure is not an image');
  eq(url(`<description><![CDATA[<img src='https://a.example/cd.jpg' alt='x'/>]]></description>`),
    'https://a.example/cd.jpg', 'single-quoted img inside CDATA (NPR/CBC)');
  eq(url('<description>&lt;img src="https://a.example/en.jpg"&gt;</description>'),
    'https://a.example/en.jpg', 'entity-encoded img (no CDATA)');
  eq(url('<media:thumbnail url="https://a.example/q.jpg?w=640&amp;h=360"/>'),
    'https://a.example/q.jpg?w=640&h=360', 'entity-encoded query survives decoding');
});

check('findImage: tracking pixels are skipped, the real image behind them wins', () => {
  const url = (b) => N.findImage(`<item><title>t</title>${b}</item>`);
  eq(url(`<description><![CDATA[<img src='https://media.npr.org/include/images/tracking/npr-rss-pixel.png?story=1'/><img src='https://media.npr.org/real/photo.jpg'/>]]></description>`),
    'https://media.npr.org/real/photo.jpg', 'NPR rss-pixel skipped, real image taken');
  eq(url(`<description><![CDATA[<img width='1' height='1' src='https://a.example/t.gif'/>]]></description>`),
    null, '1x1 by attribute skipped, nothing else offered');
  eq(url(`<description><![CDATA[<img src='https://a.example/beacon.gif'/><img src='https://a.example/photo.png'/>]]></description>`),
    'https://a.example/photo.png', 'beacon-named image skipped');
});

check('findImage: the adversarial spellings of an image URL are refused', () => {
  const url = (b) => N.findImage(`<item><title>t</title>${b}</item>`);
  eq(url('<media:thumbnail url="javascript:alert(1)"/>'), null, 'javascript: refused');
  eq(url('<media:thumbnail url="http://a.example/i.jpg"/>'), null, 'plain http refused — proxy is https-only');
  eq(url('<media:thumbnail url="data:image/png;base64,AAAA"/>'), null, 'data: refused');
  eq(url('<media:thumbnail url="//a.example/i.jpg"/>'), null, 'protocol-relative refused');
  eq(url(`<media:thumbnail url="https://a.example/${'x'.repeat(600)}.jpg"/>`), null, 'oversized URL refused');
  eq(url('<description>&lt;img src="https://a.example/a b.jpg"&gt;</description>'), null, 'whitespace smuggling refused');
});

check('cachedImageUrls is exactly the images in the cache — the proxy allowlist', () => {
  const cache = N.emptyCache();
  cache.categories.global.push(
    { title: 'a', link: 'https://x', ts: null, source: 's', region: 'EU', sub: null, image: 'https://a.example/1.jpg' },
    { title: 'b', link: 'https://y', ts: null, source: 's', region: null, sub: null, image: null },
  );
  cache.categories.tech.push(
    { title: 'c', link: 'https://z', ts: null, source: 's', region: null, sub: null, image: 'https://a.example/2.jpg' },
  );
  const set = N.cachedImageUrls(cache);
  eq(set.size, 2, 'two images');
  eq(set.has('https://a.example/1.jpg') && set.has('https://a.example/2.jpg'), true, 'both present');
  eq(set.has('https://a.example/other.jpg'), false, 'nothing else');
});

await checkAsync('refresh keeps fetch errors visible — honest-empty, never silent', async () => {
  const fetchText = async (url) => {
    if (url.includes('bbci')) return RSS_SAMPLE;
    throw new Error('connect ECONNREFUSED');
  };
  const cache = await N.refreshNews(N.DEFAULT_FEEDS, fetchText);
  const bbcCount = N.DEFAULT_FEEDS.filter((f) => f.url.includes('bbci')).length;
  if (!cache.categories.global.length) throw new Error('working feed produced nothing');
  if (cache.errors.length !== N.DEFAULT_FEEDS.length - bbcCount) {
    throw new Error(`expected ${N.DEFAULT_FEEDS.length - bbcCount} errors, got ${cache.errors.length}`);
  }
  if (!cache.fetchedAt) throw new Error('no fetchedAt stamp');
});

check('PROXY: /news/img refuses anything the news cache did not extract', () => {
  const SRC = readFileSync(path.join(ROOT, 'src/daemon/aeryxd.ts'), 'utf-8');
  const route = /url\.pathname === '\/news\/img'[\s\S]{0,700}/.exec(SRC)?.[0] ?? '';
  if (!route) throw new Error('the /news/img route is gone — this check needs updating');
  if (!/cachedImageUrls\(newsCache\)\.has\(u\)/.test(route)) {
    throw new Error('the route does not close over the cache allowlist');
  }
  if (!/404/.test(route)) throw new Error('an unlisted URL must 404, not fall through');
  if (!/nosniff/.test(route)) throw new Error('proxied bytes must carry nosniff');
});

check('PROXY: the fetch is bounded and raster-only; failure yields the placeholder', () => {
  const SRC = readFileSync(path.join(ROOT, 'src/daemon/aeryxd.ts'), 'utf-8');
  const fn = /async function fetchNewsImage\([\s\S]*?\n}/.exec(SRC)?.[0] ?? '';
  if (!fn) throw new Error('fetchNewsImage not found — this check needs updating');
  if (!/gatedFetch\(u, \{\s*timeoutMs:/.test(fn)) throw new Error('no fetch timeout, or the image fetch is not SSRF-gated');
  if (!/async function gatedFetch[\s\S]*?AbortSignal\.timeout\(init\.timeoutMs\)/.test(SRC)) throw new Error('gatedFetch lost its timeout');
  if (!/IMG_MAX_BYTES/.test(fn)) throw new Error('no size cap on the download');
  if (!/imgCacheEvictUntil/.test(fn)) throw new Error('the cache has no byte budget — 80 NPR-sized entries is hundreds of MB');
  if (!/image\\\/\(jpe\?g\|png\|webp\|gif\|avif\)/.test(fn)) {
    throw new Error('content-type check does not pin the raster whitelist');
  }
  if (!/IMG_PLACEHOLDER/.test(fn)) throw new Error('failures do not answer with the placeholder');
  if (!/catch/.test(fn)) throw new Error('a fetch error would escape the route');
});

check('PROXY: the CSP still forbids the page itself from talking to news CDNs', () => {
  const SRC = readFileSync(path.join(ROOT, 'src/daemon/aeryxd.ts'), 'utf-8');
  if (!/img-src 'self' data:/.test(SRC)) {
    throw new Error("img-src was loosened — the proxy exists precisely so it can stay 'self'");
  }
});

const AU = await load('src/daemon/auth.ts', 'auth.mjs');
const CFG = (over = {}) => ({ enabled: true, pin: 'dragon-scale-9', bind: '100.64.0.1', allowLan: false, ...over });

const JSON_POST = { host: '127.0.0.1:23799', 'content-type': 'application/json' };
const MAGIC = ['aeryx'];

check('CSRF: the drive-by form post is refused', () => {
  const r = AU.crossOriginRefusal('POST', {
    host: '127.0.0.1:23799',
    origin: 'https://evil.example',
    'content-type': 'text/plain;charset=UTF-8',
  });
  if (!r) throw new Error('a cross-site text/plain form post was allowed');
});

check('CSRF: a mutating request must be application/json', () => {
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
    if (!AU.crossOriginRefusal('POST', { host: 'aeryx', 'content-type': ct }, MAGIC)) {
      throw new Error(`content-type ${ct || '(none)'} was accepted on a POST`);
    }
  }
  eq(AU.crossOriginRefusal('POST', JSON_POST), null, 'legitimate JSON POST');
});

check('CSRF: a cross-site origin or fetch-site is refused even with JSON', () => {
  if (!AU.crossOriginRefusal('POST', { ...JSON_POST, origin: 'https://evil.example' })) {
    throw new Error('cross-origin JSON POST allowed');
  }
  if (!AU.crossOriginRefusal('POST', { ...JSON_POST, 'sec-fetch-site': 'cross-site' })) {
    throw new Error('cross-site fetch allowed');
  }
  eq(AU.crossOriginRefusal('POST', { ...JSON_POST, 'sec-fetch-site': 'same-origin' }), null, 'same-origin');
});

check('REBIND: a Host this daemon does not answer to is refused, on reads too', () => {
  if (!AU.crossOriginRefusal('GET', { host: 'evil.example' })) throw new Error('rebinding host allowed');
  if (!AU.crossOriginRefusal('GET', { host: 'attacker.test:23799' })) throw new Error('rebinding host allowed');
  for (const host of ['localhost:23799', '127.0.0.1:23799', '100.64.0.1:23799', '[::1]:23799']) {
    eq(AU.crossOriginRefusal('GET', { host }), null, `host ${host}`);
  }
  eq(AU.crossOriginRefusal('GET', { host: 'aeryx' }, MAGIC), null, 'declared remote name');
});

check('REBIND: single-label and hex names are refused unless remote declares them', () => {
  for (const host of ['aeryx', 'aeryx:23799', 'cafe', 'deadbeef:23799', 'face']) {
    if (!AU.crossOriginRefusal('GET', { host })) throw new Error(`name ${host} accepted by default`);
  }
  eq(JSON.stringify(AU.extraHostNames({ enabled: false, hostNames: ['aeryx'] })), '[]', 'remote off declares nothing');
  eq(JSON.stringify(AU.extraHostNames({ enabled: true, hostNames: ['Aeryx', 'bad name!'] })), '["aeryx"]', 'remote on');
  if (!readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8').includes('extraHostNames(readConfigRaw()?.remote)')) {
    throw new Error('the request gate no longer derives extra names from remote config');
  }
});

check('the clients Aeryx actually ships still pass the gate', () => {
  eq(AU.crossOriginRefusal('POST', { host: 'aeryx', origin: 'http://aeryx', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, MAGIC), null, 'lair');
  eq(AU.crossOriginRefusal('POST', { host: '127.0.0.1:23799', origin: 'http://127.0.0.1:23799', 'content-type': 'application/json' }), null, 'status page');
  eq(AU.crossOriginRefusal('POST', { host: '127.0.0.1:23799', 'content-type': 'application/json' }), null, 'brain, no origin header');
  eq(AU.crossOriginRefusal('GET', { host: 'aeryx' }, MAGIC), null, 'plain GET');
});

check('BIND: no PIN means localhost, whatever the config claims', () => {
  eq(AU.resolveBind(CFG({ pin: null })), '127.0.0.1', 'enabled but pinless');
  eq(AU.resolveBind(CFG({ enabled: false })), '127.0.0.1', 'disabled');
  eq(AU.resolveBind(CFG()), '100.64.0.1', 'enabled with pin binds the named interface');
});

check('BIND: a wildcard bind needs an explicit acknowledgement', () => {
  for (const bind of ['0.0.0.0', '::', '*']) {
    eq(AU.resolveBind(CFG({ bind })), '127.0.0.1', `unacknowledged ${bind}`);
    eq(AU.resolveBind(CFG({ bind, allowLan: true })), bind, `acknowledged ${bind}`);
  }
});

check('a bearer header in a shell command never reaches the audit row', () => {
  const d = GW.auditDetail({ command: 'curl -H "Authorization: Bearer sk-or-v1-abcdef1234567890abcdef" https://api.example.com' });
  if (d.includes('sk-or-v1')) throw new Error(`credential survived: ${d}`);
  if (!d.includes('[redacted]')) throw new Error('nothing was redacted');
  if (!d.includes('curl')) throw new Error('the command itself was lost');
});

check('an API key in a JSON tool input never reaches the audit row', () => {
  const d = GW.auditDetail({ name: 'websearch', env: { OPENROUTER_API_KEY: 'sk-or-v1-deadbeefdeadbeef01', MODE: 'fast' } });
  if (d.includes('deadbeef')) throw new Error(`key survived: ${d}`);
  if (!d.includes('OPENROUTER_API_KEY')) throw new Error('the key NAME should survive — the log must say what was set');
  if (!d.includes('fast')) throw new Error('non-secret values must survive');
});

check('password/pin/token assignments in commands are redacted', () => {
  for (const cmd of [
    'mysql -u root --password=hunter2secret',
    'setx AERYX_REMOTE_PIN 998877 && echo pin=998877',
    'curl https://x.example/?access_token=abcd1234efgh',
  ]) {
    const d = GW.auditDetail({ command: cmd });
    for (const secret of ['hunter2secret', '998877', 'abcd1234efgh']) {
      if (d.includes(secret)) throw new Error(`"${secret}" survived in: ${d}`);
    }
  }
});

check('redaction happens before truncation, and plain commands pass untouched', () => {
  const long = 'echo ' + 'x'.repeat(600) + ' apiKey=verysecretvalue';
  const d = GW.auditDetail({ command: long });
  if (d.includes('verysecretvalue')) throw new Error('truncation raced redaction');
  eq(GW.auditDetail({ command: 'git status' }), 'git status', 'benign command mangled');
  eq(GW.redactSecrets('read the pinned notes'), 'read the pinned notes', 'prose with "pin" inside a word mangled');
});

check('BIND: an absent bind means localhost, not every interface', () => {
  const cfg = AU.readRemoteConfig({ remote: { enabled: true, pin: 'dragon-scale-9' } });
  eq(cfg.bind, '127.0.0.1', 'default bind');
  eq(AU.resolveBind(cfg), '127.0.0.1', 'resolved');
});

check('BIND: a short PIN is no PIN', () => {
  const cfg = AU.readRemoteConfig({ remote: { enabled: true, pin: '1234', bind: '0.0.0.0' } });
  eq(cfg.pin, null, 'pin');
  eq(AU.resolveBind(cfg), '127.0.0.1', 'bind stays closed');
});

check('AERYX_REMOTE_PIN env override enables the gate for a run', () => {
  const cfg = AU.readRemoteConfig({}, { AERYX_REMOTE_PIN: 'test-pin-123' });
  eq(cfg.enabled, true, 'enabled');
  eq(cfg.pin, 'test-pin-123', 'pin');
});

check('the right PIN issues a token; the wrong one never does', () => {
  const st = AU.freshAuthState();
  const bad = AU.tryPin(st, CFG(), 'dragon-scale-8', 'phone', 1000);
  eq(bad.ok, false, 'wrong pin');
  const near = AU.tryPin(st, CFG(), 'dragon-scale-9x', 'phone', 1000);
  eq(near.ok, false, 'prefix-similar pin');
  const good = AU.tryPin(st, CFG(), 'dragon-scale-9', 'phone', 1000);
  eq(good.ok, true, 'right pin');
  if (!AU.validToken(st, good.token, 2000)) throw new Error('issued token not valid');
});

check('five wrong PINs lock the gate for fifteen minutes — for that source', () => {
  const st = AU.freshAuthState();
  for (let i = 0; i < 5; i++) AU.tryPin(st, CFG(), 'nope-nope-1', 'phone', 1000);
  const locked = AU.tryPin(st, CFG(), 'dragon-scale-9', 'phone', 1000);
  eq(locked.ok, false, 'right pin during lockout');
  eq(locked.reason, 'locked', 'reason');
  const after = AU.tryPin(st, CFG(), 'dragon-scale-9', 'phone', 1000 + AU.LOCK_MS + 1);
  eq(after.ok, true, 'gate reopens after the window');
});

check('a guessing device locks only itself — the owner\'s phone still enters', () => {
  const st = AU.freshAuthState();
  for (let i = 0; i < 5; i++) AU.tryPin(st, CFG(), 'nope-nope-1', '100.64.9.9', 1000);
  const attacker = AU.tryPin(st, CFG(), 'dragon-scale-9', '100.64.9.9', 1000);
  eq(attacker.reason, 'locked', 'guesser locked');
  const owner = AU.tryPin(st, CFG(), 'dragon-scale-9', '100.64.5.5', 1000);
  eq(owner.ok, true, 'owner unaffected by the guesser\'s lockout');
});

check('rotating source addresses hits the global backstop', () => {
  const st = AU.freshAuthState();
  let last;
  for (let i = 0; i < AU.GLOBAL_LOCK_AFTER + 5; i++) {
    last = AU.tryPin(st, CFG(), 'nope-nope-1', `10.0.0.${i}`, 1000);
    if (last.reason === 'locked') break;
  }
  eq(last.reason, 'locked', 'backstop tripped');
  const owner = AU.tryPin(st, CFG(), 'dragon-scale-9', '100.64.5.5', 1000);
  eq(owner.reason, 'locked', 'global lock holds for everyone');
  const after = AU.tryPin(st, CFG(), 'dragon-scale-9', '100.64.5.5', 1000 + AU.LOCK_MS + 1);
  eq(after.ok, true, 'and lifts after the window');
});

check('scattered stale typos decay instead of summing toward the backstop', () => {
  const st = AU.freshAuthState();
  for (let i = 0; i < 4; i++) AU.tryPin(st, CFG(), 'nope-nope-1', 'phone', 1000);
  AU.tryPin(st, CFG(), 'dragon-scale-8', 'laptop', 1000 + AU.LOCK_MS + 2000);
  eq(st.failures.has('phone'), false, 'stale source forgotten');
});

check('the failure table itself is bounded', () => {
  const st = AU.freshAuthState();
  const cfg = CFG();
  for (let i = 0; i < AU.MAX_SOURCES + 50; i++) {
    AU.tryPin(st, cfg, 'nope-nope-1', `src-${i}`, 1000 + i);
    st.globalLockedUntil = 0;
  }
  if (st.failures.size > AU.MAX_SOURCES) throw new Error(`failure table grew to ${st.failures.size}`);
});

check('tokens expire at 12 hours and unknown tokens never pass', () => {
  const st = AU.freshAuthState();
  const r = AU.tryPin(st, CFG(), 'dragon-scale-9', 'phone', 0);
  if (!AU.validToken(st, r.token, AU.TOKEN_TTL_MS - 1)) throw new Error('token died early');
  if (AU.validToken(st, r.token, AU.TOKEN_TTL_MS + 1)) throw new Error('token outlived its ttl');
  if (AU.validToken(st, 'forged-token', 1)) throw new Error('forged token passed');
  if (AU.validToken(st, undefined, 1)) throw new Error('missing token passed');
});

check('expired grants are swept, not just forgotten when presented', () => {
  const st = AU.freshAuthState();
  let n = 0;
  AU.tryPin(st, CFG(), 'dragon-scale-9', 'phone', 0, () => `tok-${n++}`);
  AU.tryPin(st, CFG(), 'dragon-scale-9', 'phone', 1000, () => `tok-${n++}`);
  eq(st.sessions.size, 2, 'two live grants');
  AU.evictExpiredSessions(st, AU.TOKEN_TTL_MS + 500);
  eq(st.sessions.size, 1, 'only the younger grant survives the sweep');
});

check('logout revokes the token now, not at the 12-hour mark', () => {
  const st = AU.freshAuthState();
  const r = AU.tryPin(st, CFG(), 'dragon-scale-9', 'phone', 1000);
  eq(AU.revokeToken(st, r.token), true, 'revoked');
  if (AU.validToken(st, r.token, 2000)) throw new Error('revoked token still passed');
  eq(AU.revokeToken(st, r.token), false, 'second revoke is a no-op');
  eq(AU.revokeToken(st, undefined), false, 'missing token is a no-op');
});

check('the session table is bounded — oldest grant is evicted', () => {
  const st = AU.freshAuthState();
  let n = 0;
  const tokens = [];
  for (let i = 0; i < AU.MAX_SESSIONS + 5; i++) {
    const r = AU.tryPin(st, CFG(), 'dragon-scale-9', 'phone', 1000 + i, () => `tok-${n++}`);
    tokens.push(r.token);
  }
  if (st.sessions.size > AU.MAX_SESSIONS) throw new Error(`table grew to ${st.sessions.size}`);
  if (AU.validToken(st, tokens[0], 2000)) throw new Error('oldest token survived eviction');
  if (!AU.validToken(st, tokens[tokens.length - 1], 2000)) throw new Error('newest token evicted');
});

check('the brain token: empty never passes, wrong never passes, right does', () => {
  if (AU.brainTokenOk('', '')) throw new Error('empty/empty passed');
  if (AU.brainTokenOk('abc123', '')) throw new Error('empty presented passed');
  if (AU.brainTokenOk('', 'abc123')) throw new Error('empty expected passed');
  if (AU.brainTokenOk('abc123', 'abc124')) throw new Error('wrong token passed');
  if (!AU.brainTokenOk('abc123', 'abc123')) throw new Error('right token refused');
});

check('HELLO reroute: daemon endpoint is token-gated and local-only; brain prefers it', () => {
  const daemon = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const at = daemon.indexOf("'/internal/hello'");
  if (at < 0) throw new Error('daemon lost the /internal/hello route');
  const handler = daemon.slice(at, at + 600);
  if (!handler.includes('isLocalAddress')) throw new Error('/internal/hello no longer refuses remote callers');
  if (!handler.includes('brainTokenOk')) throw new Error('/internal/hello no longer checks the brain token');
  const brain = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!brain.includes('/internal/hello')) throw new Error('brain no longer reroutes Hello through the daemon');
  if (!brain.includes('BRAIN_TOKEN = msg.token')) throw new Error('brain no longer takes the boot token from the boot message');
});

check('local addresses are exactly the loopbacks', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    if (!AU.isLocalAddress(a)) throw new Error(`${a} not local`);
  }
  for (const a of ['100.64.0.7', '192.168.1.5', '127.0.0.2', '', undefined]) {
    if (AU.isLocalAddress(a)) throw new Error(`${a} treated as local`);
  }
});

check('HOARD: only user.md is writable, size-capped; nothing else', () => {
  if (AU.validateHoardWrite('user.md', '# me') !== null) throw new Error('user.md write refused');
  for (const f of ['learned.md', 'persona.md', '../guardrails.json', 'x.md']) {
    if (AU.validateHoardWrite(f, 'data') === null) throw new Error(`${f} was writable`);
  }
  if (AU.validateHoardWrite('user.md', 'x'.repeat(AU.MAX_HOARD_BYTES + 1)) === null) {
    throw new Error('size cap ignored');
  }
  if (AU.validateHoardWrite('user.md', 42) === null) throw new Error('non-string accepted');
});

const H = await load('src/daemon/hoard.ts', 'hoard.mjs');

check('HOARD: noticing proposes; nothing is kept without a decision', () => {
  const s = new H.NoticeStore(':memory:');
  const added = s.add(['They work from C:\\WORK most days'], '');
  eq(added.length, 1, 'added');
  eq(added[0].status, 'proposed', 'status');
  eq(s.pendingCount(), 1, 'pending');
  s.close();
});

check('HOARD: keep hardens, dismiss is forever — neither can be re-decided', () => {
  const s = new H.NoticeStore(':memory:');
  const [a, b] = s.add(['Prefers dark mode everywhere always', 'Wakes at six most weekdays now'], '');
  eq(s.keep(a.id).status, 'kept', 'kept');
  eq(s.dismiss(b.id).status, 'dismissed', 'dismissed');
  eq(s.pendingCount(), 0, 'pending after decisions');
  for (const id of [a.id, b.id]) {
    let threw = false;
    try { s.keep(id); } catch { threw = true; }
    if (!threw) throw new Error(`notice #${id} was re-decidable`);
  }
  s.close();
});

check('HOARD: a dismissed fact is never proposed again, however restyled', () => {
  const s = new H.NoticeStore(':memory:');
  const [n] = s.add(['He prefers dark mode, always.'], '');
  s.dismiss(n.id);
  const again = s.add(['he prefers DARK mode always'], '');
  eq(again.length, 0, 're-proposed');
  s.close();
});

check('HOARD: facts already hardened into learned.md are not proposed', () => {
  const s = new H.NoticeStore(':memory:');
  const learned = '- He prefers dark mode, always.\n- Ships on Fridays.\n';
  const added = s.add(['he prefers dark mode always', 'Runs Windows 11 on the desktop'], learned);
  eq(added.length, 1, 'added');
  eq(/Windows 11/.test(added[0].fact), true, 'the new fact survived');
  s.close();
});

check('HOARD: junk candidates are dropped — short, non-string, empty-normal', () => {
  const s = new H.NoticeStore(':memory:');
  const added = s.add(['short', '!!! ???', 'x'.repeat(301), 42, 'A real fact about the user here'], '');
  eq(added.length, 1, 'only the real fact');
  s.close();
});

check('HOARD: a hoard row in the audit chain can never mint an autonomy grant', () => {
  const lanes = L.replayLanes(
    [{ tool: 'hoard', lane: 'shell.exec:powershell', verdict: 'ladder:granted-standing' }],
    L.DEFAULT_LADDER,
    true,
  );
  eq(lanes.size, 0, 'granted lanes');
});

const WD = await load('src/daemon/warden.ts', 'warden.mjs');

check('CLOSURE: the brain token never reaches the shell the model drives', () => {
  if (/process\.env\.AERYX_BRAIN_TOKEN/.test(readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8'))) throw new Error('the brain reads its token from the environment, where its shell can read it too');
  const plan = WD.brainSpawnPlan({ runAs: 'self' }, ROOT, 'node', 'brain.mjs', { AERYX_BRAIN_TOKEN: 'leak', AERYX_REMOTE_PIN: 'pin', PATH: '/bin' }, 'tok', () => true);
  eq(plan.env.AERYX_BRAIN_TOKEN, undefined, 'token in the spawn env');
  eq(plan.env.AERYX_REMOTE_PIN, undefined, 'remote PIN in the spawn env');
  eq(plan.env.PATH, '/bin', 'the rest of the env survives');
});


const USAGE = await load('src/daemon/usage.ts', 'usage.mjs');
check('USAGE: daily token and cost totals are clamped, kept 90 days, and honest about their basis', () => {
  const bad = USAGE.sanitizeUsage({ inputTokens: -5, outputTokens: 'x', cacheTokens: Infinity, costUsd: 1e9 });
  eq(bad.inputTokens, 0, 'negative input'); eq(bad.outputTokens, 0, 'non-number output');
  eq(bad.cacheTokens, 0, 'infinite cache'); eq(bad.costUsd, 1000, 'cost clamp');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aeryx-usage-'));
  const f = path.join(dir, 'usage.json');
  for (let d = 1; d <= 95; d++) USAGE.addUsage(f, `2026-01-01+${String(d).padStart(3, '0')}`, USAGE.sanitizeUsage({ inputTokens: 10, outputTokens: 5, costUsd: 0.01 }));
  USAGE.addUsage(f, '2026-01-01+095', USAGE.sanitizeUsage({ inputTokens: 1, outputTokens: 1, costUsd: 0.5 }));
  eq(Object.keys(JSON.parse(readFileSync(f, 'utf-8'))).length, 90, 'only 90 days kept');
  const sum = USAGE.summarize(f, '2026-01-01+095', '2026-01-01+094');
  eq(sum.today.turns, 2, 'today turns'); eq(sum.today.inputTokens, 11, 'today input');
  eq(sum.window.turns, 3, 'window turns');
  rmSync(dir, { recursive: true, force: true });
  eq(USAGE.costBasis('local'), 'free', 'local is free'); eq(USAGE.costBasis('openrouter'), 'provider', 'openrouter priced by the provider');
  eq(USAGE.costBasis('codex'), 'provider', 'codex priced by the provider'); eq(USAGE.costBasis(null), 'estimate', 'claude login estimates');
});

check('USAGE: the SDK total_cost_usd is cumulative per process, so each turn records only its own cost', () => {
  let prev = 0, sum = 0;
  const deltas = [];
  for (const total of [0.30015, 0.6003, 0.90045]) {
    const c = USAGE.costDelta(prev, total);
    prev = c.total; sum += c.delta; deltas.push(c.delta);
  }
  for (const d of deltas) if (Math.abs(d - 0.30015) > 1e-9) throw new Error(`a turn recorded ${d}, not its own 0.30015`);
  if (Math.abs(sum - 0.90045) > 1e-9) throw new Error(`three turns summed to ${sum}, not 0.90045`);
  eq(USAGE.costDelta(0.9, 0.3).delta, 0.3, 'a counter reset counts in full');
  const bad = USAGE.costDelta(0.5, NaN);
  eq(bad.delta, 0, 'NaN adds nothing'); eq(bad.total, 0.5, 'NaN keeps the running total');
  const brainSrc = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!/costUsd: cost\.delta/.test(brainSrc) || /costUsd: msg\.total_cost_usd/.test(brainSrc)) throw new Error('the brain forwards the cumulative total again');
});

check('USAGE: cost is tagged with the provider that spent it, so a switch never relabels the day', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aeryx-usage-'));
  const f = path.join(dir, 'usage.json');
  USAGE.addUsage(f, '2026-02-01', USAGE.sanitizeUsage({ inputTokens: 10, costUsd: 1.37 }), 'claude');
  USAGE.addUsage(f, '2026-02-01', USAGE.sanitizeUsage({ inputTokens: 10, costUsd: 0 }), 'local');
  const sum = USAGE.summarize(f, '2026-02-01', '2026-02-01');
  eq(sum.todayByBasis.estimate, 1.37, 'claude spend stays an estimate after switching to local');
  eq(sum.todayByBasis.free, 0, 'local turns are recorded as free');
  eq(sum.today.costUsd, 1.37, 'flat total unchanged'); eq(sum.today.turns, 2, 'turns');
  USAGE.addUsage(f, '2026-02-02', USAGE.sanitizeUsage({ costUsd: 0.5 }));
  eq(USAGE.summarize(f, '2026-02-02', '2026-02-02').todayByBasis.estimate, 0.5, 'untagged (older) cost counts as an estimate');
  rmSync(dir, { recursive: true, force: true });
  const d = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  if (!d.includes('sanitizeUsage(msg), brainKind)')) throw new Error('usage is no longer tagged with the running brain\'s provider kind');
});

check('RELEASE SIGNING: the installers and the CLI pin the same release keys and refuse unsigned releases', () => {
  const site = [path.join(ROOT, 'site'), path.join(ROOT, 'public-release', 'site')].find((d) => existsSync(path.join(d, 'install.sh')));
  if (!site) throw new Error('installers not found');
  const sh = readFileSync(path.join(site, 'install.sh'), 'utf-8');
  const ps = readFileSync(path.join(site, 'install.ps1'), 'utf-8');
  const cli = readFileSync(path.join(ROOT, 'scripts', 'aeryx-cli.mjs'), 'utf-8');
  const shKeys = /RELEASE_KEYS="([^"]+)"/.exec(sh)?.[1];
  const psKeys = /\$ReleaseKeys = '([^']+)'/.exec(ps)?.[1];
  const cliKeys = /const RELEASE_KEYS = \[([^\]]+)\]/.exec(cli)?.[1].replace(/'/g, '').split(',').map((k) => k.trim()).join(',');
  if (!shKeys || shKeys !== psKeys || shKeys !== cliKeys) throw new Error(`release keys differ: sh=${shKeys} ps=${psKeys} cli=${cliKeys}`);
  for (const k of shKeys.split(',')) if (Buffer.from(k, 'base64').length !== 32) throw new Error(`not an Ed25519 public key: ${k}`);
  if (!sh.includes('SHA256SUMS.sig') || !ps.includes('SHA256SUMS.sig') || !cli.includes('SHA256SUMS.sig')) throw new Error('a path stopped fetching the signature');
  if (!existsSync(path.join(ROOT, 'scripts', 'sign-release.mjs'))) throw new Error('scripts/sign-release.mjs is missing');
});


check('LOCAL-ONLY: with the switch on, nothing that reaches past the machine runs', () => {
  const lo = { tainted: false, localOnly: true };
  const denied = [
    ['WebFetch', { url: 'https://example.com' }], ['WebSearch', { query: 'x' }],
    ['Bash', { command: 'curl https://example.com' }], ['Bash', { command: 'git push origin main' }],
    ['Bash', { command: 'npm install left-pad' }], ['Bash', { command: 'ssh me@host' }],
    ['PowerShell', { command: 'Invoke-WebRequest https://x' }], ['mcp__gmail__send', { to: 'a@b.c' }],
    ['mcp__someunknown__call', {}],
  ];
  for (const [tool, input] of denied) {
    const c = classify(tool, input, G, lo);
    if (!c.denyReason) throw new Error(`local-only let ${tool} ${JSON.stringify(input)} through`);
  }
  eq(classify('Bash', { command: 'ls -la' }, G, lo).denyReason, undefined, 'local shell work still runs');
  eq(classify('Read', { file_path: path.join(os.tmpdir(), 'x.txt') }, G, lo).denyReason, undefined, 'reads still run');
  eq(classify('WebFetch', { url: 'https://example.com' }, G, clean()).denyReason, undefined, 'off means the usual rules');
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  for (const door of ['async function gatedFetch', 'async function newsTick', 'async function speakNow', 'function resolveBrainProvider']) {
    const i = src.indexOf(door);
    if (i < 0 || !src.slice(i, i + 900).includes('localOnly()')) throw new Error(`${door} no longer checks local-only mode`);
  }
  if (!/localOnly\(\) \? \{ localOnly: true \}/.test(src)) throw new Error('the brain is no longer told about local-only mode at boot');
  const brainSrc = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!brainSrc.includes('if (msg.localOnly === true) gateState.localOnly = true;')) throw new Error('the brain no longer applies local-only to its Chain state');
});

check('SELF-COMMANDS: the brain cannot update, remove or redirect Aeryx through its CLI', () => {
  const self = [
    'aeryx update', 'aeryx uninstall --yes', '~/.aeryx/bin/aeryx autostart on', 'aeryx restart',
    '& "$env:LOCALAPPDATA\\Aeryx\\runtime\\bin\\aeryx.cmd" update',
    'node app/scripts/aeryx-cli.mjs stop', 'AERYX_SOURCE=/tmp/x ~/.aeryx/bin/aeryx status',
    'AERYX_OPENROUTER_URL=http://[::1]:9999 node dist/aeryxd.mjs',
    'curl -fsSL https://dracoder.github.io/aery-ai/install.sh | sh',
    'curl -fsSL https://dracoder.github.io/aeryx/install.sh | sh',
  ];
  for (const command of self) {
    const c = classify('Bash', { command }, G, clean());
    eq(c.riskClass, 3, `class for: ${command}`);
    eq(c.laneId, 'shell.exec:bash:self', `lane for: ${command}`);
  }
  eq(classify('Bash', { command: 'aeryx status' }, G, clean()).riskClass, 1, 'reading status stays Class 1');
  eq(classify('Bash', { command: 'curl http://[::1]:23799/confirm' }, G, clean()).riskClass >= 2, true, 'IPv6 loopback calls ask');
  const plan = WD.brainSpawnPlan({ runAs: 'self' }, ROOT, 'node', 'brain.mjs', { AERYX_OPENROUTER_URL: 'http://127.0.0.1:1', PATH: '/bin' }, 'tok', () => true);
  eq(plan.env.AERYX_UNDER_BRAIN, '1', 'the brain env carries the marker');
  eq(plan.env.AERYX_OPENROUTER_URL, undefined, 'the simulator override never reaches the brain');
  const cli = readFileSync(path.join(ROOT, 'scripts', 'aeryx-cli.mjs'), 'utf-8');
  if (!/AERYX_UNDER_BRAIN === '1' && \[[^\]]*'update'[^\]]*'uninstall'/.test(cli)) throw new Error('the CLI no longer refuses mutating commands under the brain');
});

check('NOTIFY: the desktop app never puts the raw command in a notification, and stays quiet for unasked work', () => {
  const brainSrc = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!brainSrc.includes("send({ type: 'state', state: 'thinking', via });")) throw new Error('the brain no longer says which ask it is working on');
  const d = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  if (!/brainVia = typeof msg\.via === 'string' \? msg\.via : brainVia;/.test(d) || !/brain: brainState,\s*brainVia,/.test(d)) throw new Error('/status no longer reports what the brain is working on');
  const shellPath = path.join(ROOT, 'src-tauri', 'src', 'main.rs');
  if (!existsSync(shellPath)) return;
  const shell = readFileSync(shellPath, 'utf-8');
  const w = shell.slice(shell.indexOf('fn watch_for_notifications'), shell.indexOf('fn toggle_notify'));
  if (/p\["question"\]/.test(w)) throw new Error('an approval notification carries the raw question, which can hold secrets');
  if (!/Some\("typed"\) \| Some\("voice"\)/.test(w) || !/&& user_turn \{\s*notify\(&app, "Aeryx is done"/.test(w)) throw new Error('"Aeryx is done" fires for boot greetings and scheduled runs again');
});

check('HELLO: an unanswered second factor says why off Windows, and Windows-only switches refuse before setup hints', () => {
  const d = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  if (!/function helloRefusal\(what: string\): string \{\s*if \(process\.platform !== 'win32'\)/.test(d)) throw new Error('off Windows, a refused second factor tells the user to try again at the machine');
  if ((d.match(/Windows Hello did not answer\./g) ?? []).length !== 1) throw new Error('a Hello refusal bypasses helloRefusal()');
  if (!/const WINDOWS_ONLY = process\.platform === 'win32' \? \[\] : \['voice', 'hello', 'warden'\];/.test(d)) {
    throw new Error('the Windows-only list changed shape');
  }
  if (!/WINDOWS_ONLY\.push\(\.\.\.mind\.windowsOnly\(\)\);/.test(d)) {
    throw new Error('this build no longer adds its own Windows-only organs to the one list');
  }
});

check('REPORT: the diagnostics mask what the user said before they reach a public issue', () => {
  const cli = readFileSync(path.join(ROOT, 'scripts', 'aeryx-cli.mjs'), 'utf-8');
  const fn = cli.match(/function redact\(text\) \{[\s\S]*?\n\}/)?.[0];
  if (!fn) throw new Error('redact() is gone');
  const redact = new Function('os', `${fn}; return redact;`)(os);
  const out = redact([
    '[reflex] time ← my secret meeting', '[instinct] #4 ← hello friend', '[local] qwen2.5:3b ← about my wife',
    '[instinct] compiled #12: how is my dog', '[soul] suggestion-waiting: You asked about X',
    '[voice] ignored (not addressed to Aeryx): private chat', '[voice:err] [stt] "ambient speech"',
  ].join('\n'));
  for (const leak of ['secret meeting', 'hello friend', 'my wife', 'my dog', 'You asked', 'private chat', 'ambient speech']) {
    if (out.includes(leak)) throw new Error(`the report keeps "${leak}"`);
  }
  if (!redact('[reflex] volume failed: boom').includes('volume failed: boom')) throw new Error('non-user log lines are masked too');
});

check('CLI: no telemetry from the install path, and uninstall deletes only a real Aeryx bundle', () => {
  const cli = readFileSync(path.join(ROOT, 'scripts', 'aeryx-cli.mjs'), 'utf-8');
  if (!/function childEnv\(\) \{\s*return \{[^}]*NEXT_TELEMETRY_DISABLED: '1'/.test(cli)) throw new Error('setup and update run next build with Next.js telemetry on');
  const rm = cli.slice(cli.indexOf('function removeDesktopApp'), cli.indexOf('async function uninstall'));
  if (!rm.includes('macApps()') || /rmSync\(APP_MAC/.test(rm)) throw new Error('uninstall deletes a path from .aeryx-app without checking it is an Aeryx bundle');
  if (!/function macApps\(\)[\s\S]{0,400}\.filter\(isAeryxBundle\)/.test(cli)) throw new Error('the app candidates are no longer filtered to real Aeryx bundles');
  if (!/function isAeryxBundle[\s\S]{0,300}lstatSync[\s\S]{0,200}dev\\\.aeryx\\\.desktop/.test(cli)) throw new Error('the bundle check lost its lstat or bundle-id test');
});

check('WARDEN: absent config means self — todays behavior, unchanged', () => {
  const cfg = WD.readBrainRunConfig({}, 'C:\\work\\aeryx');
  eq(cfg.runAs, 'self', 'runAs');
  eq(cfg.account, 'aeryx-brain', 'default account');
  const plan = WD.brainSpawnPlan(cfg, 'C:\\work\\aeryx', 'node.exe', 'C:\\work\\aeryx\\dist\\brain.mjs', { A: '1' }, 'tok', () => false);
  eq(plan.command, 'node.exe', 'direct node');
  eq(plan.args.length, 1, 'one arg');
  eq(plan.env.AERYX_BRAIN_TOKEN, undefined, 'the token never rides the env — boot message only');
  eq(plan.env.CLAUDE_CONFIG_DIR, undefined, 'self mode does not touch the SDK config dir');
});

check('WARDEN: warden mode fails closed when the launcher or credential is missing', () => {
  const cfg = WD.readBrainRunConfig({ brain: { runAs: 'warden' } }, 'C:\\work\\aeryx');
  for (const exists of [() => false, (p) => p.endsWith('warden.exe')]) {
    let threw = false;
    try { WD.brainSpawnPlan(cfg, 'C:\\work\\aeryx', 'node.exe', 'entry', {}, 'tok', exists); }
    catch { threw = true; }
    if (!threw) throw new Error('a missing piece did not refuse the spawn');
  }
});

check('WARDEN: a complete warden plan carries cred, tether target and config dir', () => {
  const cfg = WD.readBrainRunConfig({ brain: { runAs: 'warden', account: 'dragonkeeper' } }, 'C:\\work\\aeryx');
  eq(cfg.account, 'dragonkeeper', 'account override');
  const plan = WD.brainSpawnPlan(cfg, 'C:\\work\\aeryx', 'node.exe', 'C:\\work\\aeryx\\dist\\brain.mjs', {}, 'tok', () => true);
  if (!plan.command.endsWith('warden.exe')) throw new Error('not launching through the warden');
  eq(plan.args[0], '--cred', 'cred flag');
  if (!plan.args[1].includes('secrets')) throw new Error('credential not from secrets/');
  eq(plan.args[2], '--', 'separator');
  eq(plan.args[3], 'node.exe', 'real command preserved');
  if (!plan.env.CLAUDE_CONFIG_DIR || !plan.env.CLAUDE_CONFIG_DIR.includes('brain-claude')) {
    throw new Error('SDK config dir not redirected off the daemon users profile');
  }
});

check('WARDEN: the daemon spawns the brain through the plan, not around it', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  if (!src.includes('brainSpawnPlan(')) throw new Error('startBrain no longer builds a spawn plan');
  if (!/brain = spawn\(plan\.command/.test(src)) {
    throw new Error('the brain is not spawned from the plan');
  }
  if (/brain = spawn\(process\.execPath/.test(src)) {
    throw new Error('startBrain spawns node directly again — the warden path was bypassed');
  }
});

check('WARDEN: the credential self-heals in warden mode, and only there', () => {
  const warden = WD.readBrainRunConfig({ brain: { runAs: 'warden' } }, 'C:\\work\\aeryx');
  eq(warden.syncCredential, true, 'sync is on by default');
  const plan = WD.credentialSyncPlan(warden, 'C:\\Users\\owner');
  if (!plan) throw new Error('warden mode should sync the credential');
  if (!plan.from.includes('.credentials.json') || !plan.from.includes('.claude')) throw new Error('source is the owner profile credential');
  if (!plan.to.includes('brain-claude')) throw new Error('destination is the brain config dir');
  eq(WD.credentialSyncPlan(WD.readBrainRunConfig({ brain: { runAs: 'self' } }, 'C\\r'), 'C\\h'), null, 'self mode never syncs');
  const own = WD.readBrainRunConfig({ brain: { runAs: 'warden', syncCredential: false } }, 'C\\r');
  eq(own.syncCredential, false, 'opt-out honored');
  eq(WD.credentialSyncPlan(own, 'C\\h'), null, 'an independent token is never overwritten');
});

check('WARDEN: the daemon actually performs the credential refresh before spawn', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const sync = src.indexOf('credentialSyncPlan(');
  if (sync < 0) throw new Error('the daemon no longer computes a credential sync plan');
  const spawn = src.indexOf('brainSpawnPlan(');
  if (spawn < 0 || sync > spawn) throw new Error('the credential must be refreshed BEFORE the brain is spawned');
  const region = src.slice(sync, spawn);
  if (!region.includes('copyFileSync')) throw new Error('the plan is computed but never acted on');
  if (!/existsSync\(credSync\.from\)/.test(region)) throw new Error('sync must be best-effort — guard on the source existing');
});

check('WARDEN: the boot handshake compensates the env the logon hop drops', () => {
  const daemon = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const boot = daemon.indexOf("type: 'boot'");
  if (boot < 0) throw new Error('the daemon no longer sends the boot handshake');
  if (!daemon.slice(boot - 400, boot + 400).includes('token: BRAIN_TOKEN')) {
    throw new Error('the boot handshake no longer carries the brain token');
  }
  if (!daemon.slice(boot - 400, boot + 400).includes('configDir')) {
    throw new Error('the boot handshake no longer carries the SDK config dir');
  }
  const brain = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!brain.includes("msg.type === 'boot'")) throw new Error('the brain no longer accepts the boot handshake');
  if (!brain.includes('BRAIN_TOKEN = msg.token')) throw new Error('the boot token no longer lands');
  if (!/let BRAIN_TOKEN/.test(brain)) throw new Error('BRAIN_TOKEN is const again — the handshake cannot land');
  if (!brain.includes('!process.env.CLAUDE_CONFIG_DIR')) {
    throw new Error('boot configDir must defer to an env var already present (self mode wins)');
  }
});

check('SHUTDOWN: SIGTERM stops the brain too, not only SIGINT', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  for (const sig of ['SIGINT', 'SIGTERM']) {
    if (!src.includes(`process.on('${sig}', () => shutdown('${sig}'));`)) throw new Error(`${sig} does not run the shutdown that kills the brain`);
  }
  const body = src.slice(src.indexOf('function shutdown('), src.indexOf('function shutdown(') + 400);
  if (!body.includes('brain?.kill()')) throw new Error('shutdown no longer kills the brain');
});

const PR = await load('src/daemon/peer.ts', 'peer.mjs');

check('PEER: exactly the human-decision routes are human-only', () => {
  for (const p of ['/confirm', '/resume', '/hoard/user.md', '/hoard/notices/3/keep', '/hoard/notices/3/dismiss',
    '/workflows/7/approve', '/agents/2/approve', '/agents/2/revive',
    '/setup/provider', '/setup/test', '/privacy/local-only', '/auth/pin']) {
    if (!PR.isHumanOnly('POST', p)) throw new Error(`${p} not guarded`);
  }
  for (const p of ['/ask', '/status', '/workflows', '/workflows/7/run', '/workflows/7/pause',
    '/hoard/notices', '/internal/hello', '/hoard/user.mdx', '/agents/2/retire']) {
    if (PR.isHumanOnly('POST', p)) throw new Error(`${p} wrongly guarded — the brain legitimately uses it`);
  }
  if (PR.isHumanOnly('GET', '/confirm')) throw new Error('GET is never a decision');
});

check('PEER: the extra list can only add, and the daemon passes the one it has', () => {
  const extra = (p) => p === '/mine';
  if (!PR.isHumanOnly('POST', '/mine', extra)) throw new Error('an added route was not guarded');
  if (PR.isHumanOnly('GET', '/mine', extra)) throw new Error('GET became a decision');
  if (!PR.isHumanOnly('POST', '/confirm', extra)) throw new Error('the core list stopped being guarded');
  if (PR.isHumanOnly('POST', '/ask', () => false)) throw new Error('an empty extra list widened the gate');
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  if (!/isHumanOnly\(req\.method, url\.pathname, mind\.humanOnly\)/.test(src)) {
    throw new Error('the daemon no longer hands the peer gate the routes this build adds');
  }
});

check('PEER: the probe is injection-proof and only accepts marked owner output', () => {
  const cmd = PR.buildPeerProbe(23799.9, 51234.7);
  if (!/LocalPort 23799 /.test(cmd) || !/RemotePort 51234 /.test(cmd)) throw new Error('ports not floored to integers');
  if (/[;&|]{2}/.test(cmd.replace(/\$c;/g, ''))) { }
  eq(PR.parseOwner('\r\n  AERYX_OWNER:aeryx-brain  \r\n'), 'aeryx-brain', 'owner parsed');
  eq(PR.parseOwner('Get-NetTCPConnection: probe failed'), null, 'diagnostic output is not an owner');
  eq(PR.parseOwner('aeryx-brain'), null, 'unmarked output is not an owner');
  eq(PR.parseOwner(''), null, 'empty output is unknown');
  eq(PR.parseOwner(undefined), null, 'undefined output is unknown');
});

await checkA('PEER: missing ownership withholds a human decision', async () => {
  eq(await PR.loopbackPeerOwner(23799, undefined), null, 'missing peer port');
  eq(await PR.loopbackPeerOwner(23799, 51234, async () => 'probe failed'), null, 'failed probe');
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const gate = src.indexOf('if (owner === null)');
  if (gate < 0 || !src.slice(gate, gate + 230).includes('return json(res, 503')) throw new Error('unknown peer can pass the human gate');
});

check('PEER: the daemon wires the check in front of the human-only routes', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const gate = src.indexOf('isHumanOnly(req.method');
  if (gate < 0) throw new Error('the peer gate is gone');
  if (!src.slice(gate, gate + 900).includes('loopbackPeerOwner')) throw new Error('the gate no longer resolves the peer owner');
  for (const route of ["'/confirm'", "'/resume'"]) {
    const at = src.indexOf(`url.pathname === ${route}`);
    if (at >= 0 && at < gate) throw new Error(`${route} is matched before the peer gate runs`);
  }
});


check('WARDEN: config template and guardrails carry the boundary plumbing', () => {
  const example = JSON.parse(readFileSync(path.join(ROOT, 'aeryx.config.json.example'), 'utf-8'));
  const cfg = WD.readBrainRunConfig(example, ROOT);
  eq(cfg.runAs, 'self', 'template ships with the boundary OFF — flipping it is the owner\'s act');
  eq(cfg.account, 'aeryx-brain', 'template account');
  if (!(raw.confirmOutsideDirs ?? []).includes('${TEMP}')) {
    throw new Error('the brain account\'s temp dir is not in confirmOutsideDirs — every temp write would prompt');
  }
});

check('RESIDENT: the logon start goes through start-daemon.ps1, not a bare node', () => {
  const src = readFileSync(path.join(ROOT, 'scripts', 'install-autostart.ps1'), 'utf-8');
  if (!src.includes('start-daemon.ps1')) throw new Error('the task no longer runs the canonical start');
  if (/-Execute\s+\$node/.test(src)) throw new Error('the task spawns node directly again — logs would vanish');
  const start = readFileSync(path.join(ROOT, 'scripts', 'start-daemon.ps1'), 'utf-8');
  if (!start.includes('RedirectStandardError')) throw new Error('the daemon log redirection is gone');
  if (!start.includes('Get-NetTCPConnection')) throw new Error('the port sweep is gone — orphans would block the start');
  const shellPath = path.join(ROOT, 'src-tauri', 'src', 'main.rs');
  if (existsSync(shellPath)) {
    const shell = readFileSync(shellPath, 'utf-8');
    if (!/for _ in 0\.\.\d+ \{\s*if daemon_up\(\)/.test(shell)) throw new Error('the shell no longer waits for the daemon at logon');
  }
});

check('the terminal catch answers with an id, not the exception', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  if (!src.includes('body is not valid JSON')) throw new Error('bad-JSON no longer gets its own safe answer');
  if (!src.includes('internal error #')) throw new Error('system failures are no longer answered by reference id');
  const tail = src.slice(src.lastIndexOf('not found'));
  if (/error: String\(e\?\.message \?\? e\) \}\)/.test(tail) && !/\.slice\(/.test(tail)) {
    throw new Error('the catch-all echoes unbounded exception text again');
  }
});

check('MOLT: a molt row in the audit chain can never mint a grant', () => {
  const lanes = L.replayLanes(
    [{ tool: 'molt', lane: 'shell.exec:powershell', verdict: 'ladder:granted-standing' }],
    L.DEFAULT_LADDER,
    true,
  );
  eq(lanes.size, 0, 'granted lanes');
});

check('TALON: hands-on-device lanes can never be promoted', () => {
  const pol = { ...L.DEFAULT_LADDER, ...(raw.ladder ?? {}) };
  if (L.eligible('talon.act', 2, pol)) throw new Error('talon.act is promotable');
  if (L.eligible('talon.act:sensitive', 3, pol)) throw new Error('talon.act:sensitive is promotable');
});

check('TALON: a talon audit row can never mint a grant', () => {
  const lanes = L.replayLanes(
    [{ tool: 'talon', lane: 'talon.act', verdict: 'ladder:granted-standing' }],
    L.DEFAULT_LADDER,
    true,
  );
  eq(lanes.size, 0, 'granted lanes');
});

check('SCOPE: never-scopable lanes are refused whatever the scope claims', () => {
  for (const lane of ['workflow.govern', 'agent.govern', 'server.propose', 'server.govern',
    'molt.approve', 'molt.propose', 'self.modify', 'shell.exec:bash:self',
    'shell.exec:powershell:dangerous', 'hoard.learn', 'ladder.standing:x', 'daemon.halt']) {
    if (L.scopeAllows(lane, [lane])) throw new Error(`${lane} allowed by naming itself in scope`);
    if (L.scopeAllows(lane, ['workflow.*', 'shell.*', 'molt.*', 'server.*', 'self.*', 'hoard.*', 'agent.*', 'ladder.*', 'daemon.*'])) {
      throw new Error(`${lane} allowed via wildcard scope`);
    }
  }
});

check('SCOPE: granted lanes cover exactly what they name', () => {
  if (!L.scopeAllows('recording.capture', ['recording.capture'])) throw new Error('exact lane not covered');
  if (!L.scopeAllows('talon.act', ['talon.act'])) throw new Error('talon.act not coverable');
  if (!L.scopeAllows('talon.act:sensitive', ['talon.act:sensitive'])) throw new Error('scoped launch not coverable');
  if (L.scopeAllows('talon.act:sensitive', ['talon.act'])) throw new Error('a flat lane grant must not cover its :sensitive variant');
  if (L.scopeAllows('recording.capture', ['recording.control'])) throw new Error('sibling lane leaked');
  if (L.scopeAllows('fs.write:workspace:tainted', ['fs.write:workspace'])) throw new Error('tainted variant covered by untainted grant');
  if (!L.scopeAllows('fs.scratch', ['fs.scratch'])) throw new Error('scratch not coverable');
});

check('SCOPE: a bare wildcard is not an order', () => {
  eq(L.validScopePattern('*'), false, 'bare *');
  eq(L.validScopePattern('*:*'), false, 'star colon star');
  eq(L.validScopePattern(''), false, 'empty');
  eq(L.validScopePattern('x'.repeat(65)), false, 'overlong');
  eq(L.validScopePattern('recording.capture'), true, 'real lane ok');
  eq(L.validScopePattern('talon.act:*'), true, 'bounded glob ok');
  if (L.scopeAllows('recording.capture', ['*'])) throw new Error('bare * covered a lane');
});

check('SCOPE: the scratch workbench is Class 1 and traversal-proof', () => {
  const g2 = { ...G, scratchDirs: ['C:\\work\\aeryx\\data\\scratch'], selfPaths: ['C:\\work\\aeryx\\data', 'C:\\work\\aeryx\\src'] };
  const inScratch = classify('Write', { file_path: 'C:\\work\\aeryx\\data\\scratch\\wf-1\\out.txt' }, g2, clean());
  eq(inScratch.laneId, 'fs.scratch', 'scratch lane');
  eq(inScratch.riskClass, 1, 'scratch is Class 1');
  const escape = classify('Write', { file_path: 'C:\\work\\aeryx\\data\\scratch\\..\\..\\src\\chain\\gateway.ts' }, g2, clean());
  eq(escape.laneId, 'self.modify', 'traversal out of scratch is still a self-edit');
  eq(escape.riskClass, 3, 'and still Class 3');
  const dataFile = classify('Write', { file_path: 'C:\\work\\aeryx\\data\\aeryx.db' }, g2, clean());
  eq(dataFile.riskClass, 3, 'data outside scratch stays protected');
});

check('SCOPE: the store persists scope, validates it, and demotes on change', () => {
  const s = new W.WorkflowStore(':memory:');
  const wf = s.create({ name: 'content', prompt: 'record and post', schedule: 'daily@09:00', scope: ['recording.capture', 'talon.act'] });
  eq(W.parseScope(s.get(wf.id).scope).join(','), 'recording.capture,talon.act', 'scope persists');
  let threw = false;
  try { s.create({ name: 'bad', prompt: 'x', schedule: 'manual', scope: ['*'] }); } catch { threw = true; }
  if (!threw) throw new Error('a bare * scope was accepted');
  s.approve(wf.id);
  eq(s.get(wf.id).status, 'active', 'approved');
  s.edit(wf.id, { scope: ['recording.capture', 'talon.act', 'talon.act:sensitive'] });
  eq(s.get(wf.id).status, 'proposed', 'scope change demoted to proposed');
  s.approve(wf.id);
  s.edit(wf.id, { prompt: 'record and post MORE' });
  eq(s.get(wf.id).status, 'proposed', 'prompt change demoted to proposed');
  s.approve(wf.id);
  s.edit(wf.id, { schedule: 'daily@10:00' });
  eq(s.get(wf.id).status, 'active', 'schedule tweak keeps the approval');
  s.pause(wf.id);
  s.edit(wf.id, { scope: ['recording.capture', 'fs.write:outside:*'] });
  eq(s.get(wf.id).status, 'proposed', 'a paused workflow edited onto new ground is demoted');
  s.close();
});

check('SCOPE: the daemon Hello-gates scoped approvals and sends scope only on runs', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const ap = src.indexOf("action === 'approve'");
  if (ap < 0) throw new Error('approve route gone');
  const apBlock = src.slice(ap, ap + 1600);
  if (!apBlock.includes('daemonHello')) throw new Error('a scoped approval no longer asks Windows Hello');
  if (!apBlock.includes('isLocalAddress')) throw new Error('a scoped approval is no longer local-only');
  if (!apBlock.includes("'hello-unavailable'")) throw new Error('an unanswered Hello no longer refuses the standing order');
  const fire = src.indexOf('function fireWorkflow');
  if (!src.slice(fire, fire + 700).includes('scope: scopeForRun(wf)')) throw new Error('runs no longer carry their scope');
});

check('SCOPE: the brain honors scope only on workflow asks, and clears it after', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!/currentScope && lastVia === 'workflow' && !gateState\.tainted && scopeAllows/.test(src)) {
    throw new Error('the scope check must require via workflow AND scopeAllows');
  }
  if (!/via === 'workflow' && Array\.isArray\(msg\.scope\)/.test(src)) {
    throw new Error('non-workflow asks can smuggle a scope into the queue');
  }
  if (!src.includes('currentScope = null')) throw new Error('the scope is never cleared');
  const fn = src.indexOf('async function canUseTool');
  if (fn < 0) throw new Error('canUseTool gone');
  const body = src.slice(fn);
  const scopeCheck = body.indexOf("record('auto:scope')");
  const confirmAsk = body.indexOf('await askConfirmation(');
  if (scopeCheck < 0) throw new Error('auto:scope verdict gone — scoped uses would be invisible');
  if (confirmAsk < 0) throw new Error('the confirm call is gone from canUseTool');
  if (scopeCheck > confirmAsk) throw new Error('scope must be checked before the confirm');
});

check('RECORD: a recording audit row can never mint a grant', () => {
  const lanes = L.replayLanes(
    [{ tool: 'record', lane: 'recording.capture', verdict: 'ladder:granted-standing' }],
    L.DEFAULT_LADDER,
    true,
  );
  eq(lanes.size, 0, 'a record row grants nothing');
});


check('DRAFT: proposing is Class 1 and an invented apply verb fails to ask', () => {
  const d = classify('mcp__aeryx__about_me_draft', { content: 'x' }, G, clean());
  eq(d.riskClass, 1, 'draft class');
  eq(d.laneId, 'hoard.propose', 'draft lane');
  for (const verb of ['apply', 'approve', 'write', 'save']) {
    const c = classify(`mcp__aeryx__about_me_${verb}`, {}, G, clean());
    if (c.riskClass < 2) throw new Error(`invented about_me_${verb} was not fail-to-ask`);
  }
});

check('DRAFT: the store lifecycle — one pending, replace on re-propose, decide once', () => {
  const s = new H.NoticeStore(':memory:');
  let threw = false;
  try { s.draftPropose('too short'); } catch { threw = true; }
  if (!threw) throw new Error('a tiny draft was accepted');
  const d1 = s.draftPropose('# About me\nI build things and prefer plain words in reports.');
  const d2 = s.draftPropose('# About me\nSecond, better draft — this one replaces the first.');
  eq(s.draftPending().id, d2.id, 'newest draft is the offer');
  eq(s.draftGet(d1.id).status, 'rejected', 'superseded draft is rejected');
  const applied = s.draftApply(d2.id);
  eq(applied.status, 'applied', 'applied');
  eq(s.draftPending(), null, 'nothing pending after apply');
  threw = false;
  try { s.draftApply(d2.id); } catch { threw = true; }
  if (!threw) throw new Error('an applied draft could be applied again');
  s.close();
});

check('DRAFT: apply and reject are human-only; proposing is not', () => {
  if (!PR.isHumanOnly('POST', '/hoard/draft/3/apply')) throw new Error('apply is not human-only');
  if (!PR.isHumanOnly('POST', '/hoard/draft/3/reject')) throw new Error('reject is not human-only');
  if (PR.isHumanOnly('POST', '/hoard/draft')) throw new Error('proposing must stay open to the brain');
});

check('DRAFT: the daemon writes user.md only on apply, from the decided draft', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const at = src.indexOf('/^\\/hoard\\/draft\\/');
  if (at < 0) throw new Error('the draft decide route is gone');
  const block = src.slice(at, at + 1200);
  if (!block.includes('draftApply')) throw new Error('apply no longer goes through the store');
  if (!/user\.md/.test(block)) throw new Error('apply no longer writes user.md');
  const propose = src.indexOf("url.pathname === '/hoard/draft' && req.method === 'POST'");
  const proposeBlock = src.slice(propose, propose + 700);
  if (/writeFileSync/.test(proposeBlock)) throw new Error('proposing writes a file — it must only store the draft');
});

check('HELLO: the verifier is spawned visible and in its own console/process group', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const at = src.indexOf('function daemonHello');
  const block = src.slice(at, at + 2600);
  if (!block.includes('windowsHide: false')) throw new Error('the consent prompt would be raised hidden and suppressed again');
  if (!block.includes('detached: true')) throw new Error('a console-close on the verifier window could reach the daemon process group again');
});

const CT = await load('src/daemon/continuity.ts', 'continuity.mjs');

check('CONTINUITY: a session id must be a uuid or it is never resumed', () => {
  eq(CT.validSessionId('da1036d0-5efd-4740-a381-a521e79e353e'), true, 'a real id');
  eq(CT.validSessionId('not-a-session'), false, 'prose');
  eq(CT.validSessionId('da1036d0-5efd-4740-a381-a521e79e353e && calc.exe'), false, 'command injection shape');
  eq(CT.validSessionId(''), false, 'empty');
  eq(CT.validSessionId(null), false, 'null');
});

check('CONTINUITY: the journal round-trips its session id through markdown', () => {
  const id = 'da1036d0-5efd-4740-a381-a521e79e353e';
  const md = CT.renderContinuity({
    sessionId: id, model: 'claude-sonnet-5', updatedTs: '2026-08-05T12:00:00.000Z',
    exchanges: [{ role: 'user', text: 'where were we' }, { role: 'assistant', text: 'mid-way through the news board' }],
    open: { confirms: 1, notices: 0 },
  });
  const back = CT.parseContinuity(md);
  eq(back.sessionId, id, 'session id survives');
  eq(back.updatedTs, '2026-08-05T12:00:00.000Z', 'timestamp survives');
  if (!md.includes('mid-way through the news board')) throw new Error('the last exchanges are not in the journal');
  if (!md.includes('1 confirms waiting')) throw new Error('open threads are not in the journal');
  if (md.includes('0 notices')) throw new Error('empty thread counts must not be listed');
});

check('CONTINUITY: a broken journal costs continuity, never the boot', () => {
  for (const bad of ['', null, undefined, 'not markdown at all', '---\nsession: \n---', '---\ntruncated']) {
    const r = CT.parseContinuity(bad);
    eq(r.sessionId, null, `no session from ${JSON.stringify(bad)}`);
  }
  eq(CT.parseContinuity('---\nsession: ../../etc/passwd\n---').sessionId, null, 'a path is not a session');
});

check('CONTINUITY: secrets never get frozen into the journal', () => {
  const md = CT.renderContinuity({
    sessionId: null, updatedTs: '2026-08-05T12:00:00.000Z',
    exchanges: [
      { role: 'user', text: 'my pin is 483920, remember it' },
      { role: 'user', text: 'the key = sk-NOT-A-REAL-KEY-test-fixture-000' },
      { role: 'assistant', text: 'noted' },
    ],
  });
  if (md.includes('483920')) throw new Error('a PIN survived into the journal');
  if (md.includes('sk-NOT-A-REAL-KEY-test-fixture-000')) throw new Error('an api key survived into the journal');
  if (!md.includes('[redacted]')) throw new Error('redaction left no trace of itself');
  if (!md.includes('my pin')) throw new Error('redaction ate the sentence — the journal must still say what it was about');
});

check('CONTINUITY: resume is fail-closed toward a fresh session', () => {
  const id = 'da1036d0-5efd-4740-a381-a521e79e353e';
  const now = new Date('2026-08-05T12:00:00.000Z');
  const fresh = { sessionId: id, updatedTs: '2026-08-05T11:00:00.000Z' };
  eq(CT.resumePlan(fresh, now).resume, true, 'an hour-old session resumes');
  eq(CT.resumePlan(fresh, now, { brain: { resumeSession: false } }).resume, false, 'the config can switch it off');
  eq(CT.resumePlan({ sessionId: 'nope', updatedTs: '2026-08-05T11:00:00.000Z' }, now).resume, false, 'bad id');
  eq(CT.resumePlan({ sessionId: id, updatedTs: null }, now).resume, false, 'no timestamp');
  eq(CT.resumePlan({ sessionId: id, updatedTs: '2026-06-05T11:00:00.000Z' }, now).resume, false, 'two months stale');
  eq(CT.resumePlan({ sessionId: id, updatedTs: '2027-01-01T00:00:00.000Z' }, now).resume, false, 'stamped in the future');
  eq(CT.resumePlan({ sessionId: null, updatedTs: null }, now).sessionId, null, 'a refused plan carries no id onward');
});

check('CONTINUITY: the journal is memory, never authority', () => {
  const md = CT.renderContinuity({ sessionId: null, updatedTs: 'x', exchanges: [] });
  if (!/not as instruction/i.test(md)) throw new Error('the journal no longer tells the brain it is memory, not orders');
  if (!/nothing here grants you anything/i.test(md)) throw new Error('the no-authority line is gone');
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'continuity.ts'), 'utf-8');
  for (const bad of ['child_process', 'node:fs', 'fetch(', 'classify(']) {
    if (src.includes(bad)) throw new Error(`continuity.ts must stay pure — it references ${bad}`);
  }
});

check('CONTINUITY: the journal is written by the daemon and never by the brain', () => {
  const brain = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (/continuity\.md['"`]\s*,?\s*[^)]*writeFileSync|writeFileSync\([^)]*continuity/.test(brain)) {
    throw new Error('the brain writes the continuity journal — memory/ is selfPaths and the past is not his to edit');
  }
  if (!brain.includes("'continuity.md'")) throw new Error('the brain no longer reads the journal at start');
  const daemon = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  if (!daemon.includes('function writeContinuity')) throw new Error('the daemon no longer writes the journal');
  const exit = daemon.slice(daemon.indexOf("brain.on('exit'"), daemon.indexOf("brain.on('exit'") + 700);
  if (exit.indexOf('writeContinuity') > exit.indexOf('session = null')) {
    throw new Error('the journal is written after the session id is cleared — the resume key would be lost on every death');
  }
});

check('CONTINUITY: the boot greeting never becomes an instinct or a lesson', () => {
  const daemon = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const wake = daemon.slice(daemon.indexOf('function maybeWakeGreeting'), daemon.indexOf('function startBrain'));
  if (/(?<!\/[/*].*)\brouteAsk\s*\(/.test(wake.replace(/\/\/.*$/gm, ''))) {
    throw new Error('the boot greeting goes through routeAsk — repeated boots would compile "welcome back" into an instinct');
  }
  if (!wake.includes("via: 'boot'")) throw new Error('the boot greeting no longer marks itself as a boot');
  const brain = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!brain.includes("lastVia !== 'boot'")) throw new Error('boot replies feed the learning pass — machine text would become "durable facts about the user"');
});

check('CONTINUITY: the homecoming never waits for the owner to speak first', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const ready = src.indexOf("if (msg.type === 'ready')");
  const readyBlock = src.slice(ready, ready + 800);
  if (readyBlock.includes('maybeWakeGreeting')) {
    throw new Error("the boot greeting is gated on 'ready' again — it would never fire on a quiet boot");
  }
  const start = src.indexOf('function startBrain');
  const spawnPhase = src.slice(start, src.indexOf('brain.stdout', start));
  if (!spawnPhase.includes('maybeWakeGreeting()')) {
    throw new Error('the boot greeting no longer fires at spawn');
  }
});


check('CONTINUITY: the daemon gates the greeting on a real boot and on having news', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const wake = src.slice(src.indexOf('function maybeWakeGreeting'), src.indexOf('function startBrain'));
  if (!wake.includes('isHomecoming(os.uptime()')) {
    throw new Error('the greeting no longer checks machine uptime — every daemon restart would greet again');
  }
  if (!wake.includes('shouldGreet(')) throw new Error('the greeting no longer checks whether anything is new');
  if (!wake.includes('greetedMarker =')) throw new Error('the greeting no longer records what it reported');
  const reasons = (wake.match(/log\('brain', [`']no greeting/g) ?? []).length;
  if (reasons < 2) throw new Error('a skipped greeting must log its reason');
});

check('CONTINUITY: the journal never downgrades the greeted marker either', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const at = src.indexOf('function writeContinuity');
  const fn = src.slice(at, at + 2000);
  if (!fn.includes('greetedMarker ??')) {
    throw new Error('a journal written before this boot greets would erase the previous marker');
  }
  if (!fn.includes('recentGovernance(')) throw new Error('the journal no longer records what the daemon did');
});

check('CONTINUITY: governance rows are read from the chain, never invented', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const at = src.indexOf('function recentGovernance');
  if (at < 0) throw new Error('recentGovernance is gone');
  const fn = src.slice(at, at + 900);
  if (!fn.includes('readonly: true')) throw new Error('the daemon must only ever READ the brain database');
  if (!fn.includes('FROM commands')) throw new Error('governance must come from the audit chain');
});

check('CONTINUITY: resume fails open — a bad session costs the transcript, never the boot', () => {
  const brain = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  const at = brain.indexOf('async function main()');
  const fn = brain.slice(at, brain.indexOf('async function runSession'));
  if (!fn.includes('catch')) throw new Error('a failed resume is no longer caught');
  if (!/runSession\(persona, roster, ''\)/.test(fn)) {
    throw new Error('a failed resume no longer retries with a fresh session');
  }
  if (!fn.includes('await bootHandshake')) throw new Error('main no longer waits for the boot handshake — the resume id would arrive too late');
});

check('CONTINUITY: the two timestamp formats order correctly, not alphabetically', () => {
  eq(CT.tsMillis('2026-08-05 16:25:30'), Date.parse('2026-08-05T16:25:30Z'), 'sqlite shape is read as UTC');
  eq(CT.tsMillis('2026-08-05T16:25:31.000Z'), Date.parse('2026-08-05T16:25:31.000Z'), 'ISO shape');
  if (!(CT.tsMillis('2026-08-05 16:25:30') < CT.tsMillis('2026-08-05T16:25:31.000Z'))) {
    throw new Error('a sqlite row one second earlier must sort earlier than an ISO row');
  }
  if (!(CT.tsMillis('2026-08-05 16:25:32') > CT.tsMillis('2026-08-05T16:25:31.000Z'))) {
    throw new Error('a sqlite row LATER than an ISO row must sort later — the alphabetical bug');
  }
  eq(CT.tsMillis(''), 0, 'empty');
  eq(CT.tsMillis(null), 0, 'null');
  eq(CT.tsMillis('not a time'), 0, 'garbage');
});

check('CONTINUITY: locally-answered exchanges reach the journal, interleaved by time', () => {
  const brain = [
    { role: 'user', text: 'brain question', ts: '2026-08-05 16:00:00' },
    { role: 'assistant', text: 'brain answer', ts: '2026-08-05 16:00:05' },
  ];
  const local = [
    { role: 'user', text: 'local question', ts: '2026-08-05T16:00:10.000Z' },
    { role: 'local', text: 'local answer', ts: '2026-08-05T16:00:11.000Z' },
  ];
  const merged = CT.mergeExchanges(brain, local, 10);
  eq(merged.length, 4, 'both streams present');
  eq(merged[0].text, 'brain question', 'oldest first');
  eq(merged[3].text, 'local answer', 'newest last');
  const later = CT.mergeExchanges(
    [{ role: 'user', text: 'brain later', ts: '2026-08-05 16:00:20' }],
    [{ role: 'local', text: 'local earlier', ts: '2026-08-05T16:00:10.000Z' }],
    10,
  );
  eq(later[0].text, 'local earlier', 'a local line older than a brain line still sorts first');
  eq(CT.mergeExchanges(brain, local, 2).length, 2, 'the newest N are kept');
  eq(CT.mergeExchanges(brain, local, 2)[1].text, 'local answer', 'and they are the newest');
  eq(CT.mergeExchanges(null, null, 5).length, 0, 'nothing at all is fine');
  eq(CT.mergeExchanges(brain, [{ role: 'local', text: '  ', ts: 'x' }], 10).length, 2, 'blank text is dropped');
});

check('CONTINUITY: a locally-answered line is marked as such, never passed off as reasoning', () => {
  const md = CT.renderContinuity({
    sessionId: null, updatedTs: 'x',
    exchanges: [
      { role: 'user', text: 'what are you' },
      { role: 'local', text: 'a local answer' },
      { role: 'assistant', text: 'a brain answer' },
    ],
  });
  if (!md.includes('**You (answered locally):** a local answer')) {
    throw new Error('a local answer must be labelled — the next life should not read it as its own reasoning');
  }
  if (!md.includes('**You:** a brain answer')) throw new Error('brain answers keep their plain label');
});

check('CONTINUITY: a restart on a long-running machine is not a homecoming', () => {
  eq(CT.isHomecoming(30), true, 'half a minute after boot is coming home');
  eq(CT.isHomecoming(599), true, 'just inside the window');
  eq(CT.isHomecoming(601), false, 'past the window is a restart, not a homecoming');
  eq(CT.isHomecoming(9 * 3600), false, 'nine hours up is definitely a restart');
  eq(CT.isHomecoming(-1), false, 'nonsense uptime stays quiet');
  eq(CT.isHomecoming('unknown'), false, 'unknown uptime stays quiet');
  eq(CT.isHomecoming(1200, { brain: { homecomingWindowSec: 1800 } }), true, 'the window is configurable');
  eq(CT.isHomecoming(90_001, { brain: { homecomingWindowSec: 999999 } }), false, 'and clamped to a day');
});

check('CONTINUITY: a greeting with nothing new to say is not repeated', () => {
  eq(CT.shouldGreet({ greeted: null }, 42), true, 'the first greeting always fires');
  eq(CT.shouldGreet({}, 42), true, 'no marker at all is a first greeting');
  eq(CT.shouldGreet({ greeted: 42 }, 42), false, 'nobody has spoken since — stay quiet');
  eq(CT.shouldGreet({ greeted: 42 }, 43), true, 'the owner said something — greet');
  eq(CT.shouldGreet({ greeted: 42 }, 7), false, 'a rolled-back id is not new');
  eq(CT.shouldGreet({ greeted: 42 }, 'unknown'), true, 'unreadable state errs toward speaking');
});

check('CONTINUITY: the greeted marker round-trips through the journal', () => {
  const md = CT.renderContinuity({ sessionId: null, updatedTs: 'x', exchanges: [], greeted: 137 });
  eq(CT.parseContinuity(md).greeted, 137, 'marker survives');
  const never = CT.renderContinuity({ sessionId: null, updatedTs: 'x', exchanges: [] });
  if (!never.includes('greeted: never')) throw new Error('an ungreeted journal must say so');
  eq(CT.parseContinuity(never).greeted, null, 'never parses back as no marker');
  eq(CT.parseContinuity('---\ngreeted: not-a-number\n---').greeted, null, 'garbage is no marker');
  eq(CT.parseContinuity('---\nsession: none\n---').greeted, null, 'an absent field is no marker, not zero');
  eq(CT.parseContinuity('---\ngreeted: 0\n---').greeted, 0, 'an explicit zero is still a real marker');
});

check('CONTINUITY: what the daemon did reaches the journal, secrets and all redacted', () => {
  const md = CT.renderContinuity({
    sessionId: null, updatedTs: 'x', exchanges: [],
    events: [
      { lane: 'workbench.govern', detail: 'workbench enabled by the user', verdict: 'enabled' },
      { lane: 'hoard.auth', detail: 'remote PIN changed at the machine, pin is 918273', verdict: 'pin-set+hello' },
    ],
  });
  if (!md.includes('Since we last spoke')) throw new Error('the governance section is gone');
  if (!md.includes('workbench enabled by the user')) throw new Error('a capability change is not reported');
  if (md.includes('918273')) throw new Error('a secret in an audit detail reached the journal');
  if (!/not requests/i.test(md)) throw new Error('the journal no longer says these are facts, not asks');
  const none = CT.renderContinuity({ sessionId: null, updatedTs: 'x', exchanges: [] });
  if (none.includes('Since we last spoke')) throw new Error('an empty event list must not print a heading');
});

check('CONTINUITY: the greeting is told the facts, not left to a stale system prompt', () => {
  const p = CT.wakePrompt({ resume: true, sessionId: 'x', why: '' }, [
    { lane: 'hoard.auth', detail: 'remote PIN changed at the machine, pin is 918273', verdict: 'pin-set+hello' },
    { lane: 'workbench.govern', detail: 'workbench enabled by the user', verdict: 'enabled' },
  ]);
  if (!p.includes('workbench enabled by the user')) throw new Error('governance facts are not in the wake prompt');
  if (p.includes('918273')) throw new Error('a secret reached the wake prompt');
  if (!/facts, not requests/i.test(p)) throw new Error('the prompt no longer says these are facts, not asks');
  if (!/rather than summarising your own previous greetings/i.test(p)) {
    throw new Error('nothing stops it from re-summarising its own past greetings');
  }
  const bare = CT.wakePrompt({ resume: false, sessionId: null, why: '' });
  if (/facts, not requests/i.test(bare)) throw new Error('with no events it must not print an empty facts block');
});

check('CONTINUITY: the wake greeting asks for a report, not an action', () => {
  const p = CT.wakePrompt({ resume: true, sessionId: 'x', why: '' });
  if (!/Do not use any tools/i.test(p)) throw new Error('the boot greeting no longer forbids tools');
  if (!/ONE short sentence/.test(p)) throw new Error('the boot greeting is no longer bounded');
  eq(CT.wakeOnBoot({}), true, 'greeting on by default');
  eq(CT.wakeOnBoot({ brain: { wakeOnBoot: false } }), false, 'strict false turns it off');
});

check('PIN: the stored hash never contains the PIN, and the same PIN hashes differently twice', () => {
  const pin = 'a-test-pin-99';
  const h1 = AU.hashPin(pin);
  const h2 = AU.hashPin(pin);
  if (h1.includes(pin)) throw new Error('the plaintext survived into the stored value');
  if (h1 === h2) throw new Error('unsalted — two identical PINs must not produce the same hash');
  eq(AU.validPinHash(h1), true, 'shape');
  eq(AU.pinHashMatches(h1, pin), true, 'the right PIN verifies');
  eq(AU.pinHashMatches(h2, pin), true, 'against either salt');
  eq(AU.pinHashMatches(h1, 'a-test-pin-98'), false, 'a near miss fails');
  eq(AU.pinHashMatches(h1, ''), false, 'empty fails');
  eq(AU.pinHashMatches('not-a-hash', pin), false, 'a malformed store never accepts anything');
});

check('PIN: the gate prefers the hash and never falls back to a deleted plaintext', () => {
  const cfg = AU.readRemoteConfig({ remote: { enabled: true, pinHash: AU.hashPin('hashed-pin-1'), pin: 'legacy-plain' } });
  eq(AU.pinAccepted(cfg, 'hashed-pin-1'), true, 'the hashed PIN works');
  eq(AU.pinAccepted(cfg, 'legacy-plain'), false, 'the plaintext must NOT still work once a hash exists');
  const legacy = AU.readRemoteConfig({ remote: { enabled: true, pin: 'legacy-plain' } });
  eq(AU.pinAccepted(legacy, 'legacy-plain'), true, 'an un-migrated install keeps working');
  eq(AU.pinAccepted(AU.readRemoteConfig({ remote: { enabled: true } }), 'anything'), false, 'no secret accepts nothing');
});

check('PIN: a hash alone is enough to open the network, and nothing is enough without one', () => {
  const hashed = AU.readRemoteConfig({ remote: { enabled: true, pinHash: AU.hashPin('hashed-pin-1'), bind: '100.64.0.1' } });
  eq(AU.resolveBind(hashed), '100.64.0.1', 'a hash counts as a PIN for binding');
  const none = AU.readRemoteConfig({ remote: { enabled: true, bind: '100.64.0.1' } });
  eq(AU.resolveBind(none), '127.0.0.1', 'no secret still fails closed to localhost');
  eq(AU.resolveBind(AU.readRemoteConfig({ remote: { enabled: true, pinHash: 'garbage', bind: '100.64.0.1' } })), '127.0.0.1',
    'a malformed hash is no PIN');
});

check('PIN: migrating removes the plaintext rather than adding a second copy', () => {
  const before = { remote: { enabled: true, pin: 'legacy-plain', bind: '100.64.0.1' }, ttsEnabled: true };
  const after = AU.applyPinToConfig(before, AU.hashPin('new-pin-here'));
  eq(after.remote.pin, undefined, 'the plaintext is gone from the config');
  eq(AU.validPinHash(after.remote.pinHash), true, 'the hash is there');
  eq(after.remote.bind, '100.64.0.1', 'the rest of the remote block survives');
  eq(after.ttsEnabled, true, 'the rest of the config survives');
  eq(before.remote.pin, 'legacy-plain', 'non-mutating');
  if (JSON.stringify(after).includes('new-pin-here')) throw new Error('the new PIN leaked into the config object');
  let threw = false;
  try { AU.applyPinToConfig(before, 'sha256$whatever'); } catch { threw = true; }
  eq(threw, true, 'only a real scrypt hash may be stored');
});

check('REMOTE: port 80 opens only when asked for, and only with remote on', () => {
  eq(AU.port80Wanted({}), false, 'fresh install');
  eq(AU.port80Wanted({ remote: { enabled: true } }), false, 'remote on, not asked');
  eq(AU.port80Wanted({ remote: { enabled: false, port80: true } }), false, 'asked, remote off');
  eq(AU.port80Wanted({ remote: { enabled: true, port80: true } }), true, 'asked with remote on');
  if (!readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8').includes('if (port80Wanted(readConfigRaw())) {')) {
    throw new Error('the port 80 listener no longer asks port80Wanted');
  }
});

check('PIN: a new PIN is measured while it is still readable', () => {
  eq(AU.validNewPin('example-pin-1'), true, 'ordinary PIN');
  eq(AU.validNewPin('short'), false, 'under six');
  eq(AU.validNewPin('abc12'), false, 'under eight');
  eq(AU.validNewPin('12345678'), false, 'digits only');
  eq(AU.validNewPin('4829-1703'), true, 'eight with a separator');
  eq(AU.validNewPin(' padded '), false, 'surrounding space');
  eq(AU.validNewPin('has\nnewline'), false, 'newlines');
  eq(AU.validNewPin('x'.repeat(129)), false, 'absurd length');
  eq(AU.validNewPin(null), false, 'nothing');
});

check('PIN: a changed PIN takes effect at once, not at the next restart', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const at = src.indexOf('tryPin(auth,');
  const call = src.slice(at, at + 200);
  if (call.includes('tryPin(auth, remoteCfg')) {
    throw new Error('the PIN check uses the config cached at startup — the old PIN would keep working until a restart');
  }
  if (!call.includes('readRemoteConfig(readConfigRaw()')) {
    throw new Error('the PIN check no longer reads the stored credential fresh');
  }
});

check('PIN: changing it is local-only, human-only, Hello-gated, and never logs the value', () => {
  eq(PR.isHumanOnly('POST', '/auth/pin'), true, 'the brain must never set the remote credential');
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const at = src.indexOf("url.pathname === '/auth/pin'");
  if (at < 0) throw new Error('the PIN change route is gone');
  const ep = src.slice(at, at + 2200);
  if (!ep.includes('isLocalAddress')) throw new Error('the PIN route no longer refuses remote callers');
  if (!ep.includes('daemonHello')) throw new Error('changing the PIN no longer needs Windows Hello');
  if (!ep.includes("hello !== 'verified'")) throw new Error('the Hello check is no longer fail-closed');
  if (!ep.includes('applyPinToConfig')) throw new Error('the PIN is no longer written through the pure transform');
  if (!ep.includes('revokeAllSessions')) throw new Error('old sessions survive a PIN change');
  if (/log\([^)]*body\.pin|detail:[^,]*body\.pin/.test(ep)) throw new Error('the PIN value reaches a log or an audit row');
});

const WARD = await load('src/daemon/warden.ts', 'warden-token.mjs');

check('TOKEN: a standing token stops the credential copy, flag or no flag', () => {
  const warden = { runAs: 'warden', account: 'aeryx-brain', configDir: 'C:\\d\\brain', syncCredential: true };
  eq(WARD.credentialSyncPlan(warden, 'C:\\home', false) !== null, true, 'no token: copy happens');
  eq(WARD.credentialSyncPlan(warden, 'C:\\home', true), null, 'standing token beats syncCredential:true');
  eq(WARD.credentialSyncPlan({ ...warden, syncCredential: false }, 'C:\\home', false), null, 'flag alone still opts out');
  eq(WARD.credentialSyncPlan({ ...warden, runAs: 'self' }, 'C:\\home', false), null, 'self mode shares one profile');
  eq(WARD.credentialSyncPlan(warden, 'C:\\home') !== null, true, 'omitted arg means no token');
});

check('TOKEN: only a plausible setup-token credential is accepted', () => {
  eq(WARD.validStandingToken('sk-ant-oat01-' + 'a'.repeat(60)), true, 'a real-shaped token');
  eq(WARD.validStandingToken(''), false, 'empty');
  eq(WARD.validStandingToken(null), false, 'null');
  eq(WARD.validStandingToken('sk-ant-short'), false, 'too short to be real');
  eq(WARD.validStandingToken('"sk-ant-oat01-' + 'a'.repeat(60) + '"'), false, 'quoted paste refused');
  eq(WARD.validStandingToken('sk-ant-oat01-' + 'a'.repeat(60) + '\n'), false, 'trailing newline refused');
  eq(WARD.validStandingToken('sk-ant-oat01 ' + 'a'.repeat(60)), false, 'embedded space refused');
  eq(WARD.validStandingToken('a'.repeat(200)), false, 'wrong prefix refused');
  eq(WARD.validStandingToken('sk-ant-' + 'a'.repeat(5000)), false, 'absurd length refused');
});

check('TOKEN: the daemon can name what the brain authenticates with', () => {
  const warden = { runAs: 'warden', account: 'aeryx-brain', configDir: 'C:\\d', syncCredential: true };
  eq(WARD.brainCredentialMode(warden, true), 'standing', 'its own token');
  eq(WARD.brainCredentialMode(warden, false), 'copy', 'a copy of the owner credential');
  eq(WARD.brainCredentialMode({ ...warden, runAs: 'self' }, false), 'shared', 'self mode');
  eq(WARD.brainCredentialMode({ ...warden, runAs: 'self' }, true), 'shared', 'self mode has no copy either way');
});

check('TOKEN: the secret is never logged, audited or broadcast', () => {
  const d = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  for (const bad of ['log(\'brain\', standing', 'STANDING_TOKEN)', '${standing}', 'detail: standing']) {
    if (d.includes(bad)) throw new Error(`the standing token reaches a log or audit path (${bad})`);
  }
  const uses = d.split('\n').filter((l) => /\boauthToken\b/.test(l));
  eq(uses.length, 1, 'oauthToken is sent in exactly one place');
  if (!/type: 'boot'/.test(d.slice(d.indexOf('oauthToken') - 400, d.indexOf('oauthToken')))) {
    throw new Error('oauthToken must ride the boot handshake, not some other message');
  }
  const b = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!b.includes('process.env.CLAUDE_CODE_OAUTH_TOKEN = msg.oauthToken')) {
    throw new Error('the brain no longer takes its standing credential from the boot handshake');
  }
  if (/log[A-Za-z]*\([^)]*oauthToken/.test(b)) throw new Error('the brain logs its own credential');
});

check('DPAPI: every script that touches ProtectedData loads System.Security first', () => {
  const dir = path.join(ROOT, 'scripts');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ps1'))) {
    const src = readFileSync(path.join(dir, f), 'utf-8');
    if (!/ProtectedData/.test(src)) continue;
    if (!/Add-Type\s+-AssemblyName\s+System\.Security/i.test(src)) {
      throw new Error(`${f} uses ProtectedData without Add-Type -AssemblyName System.Security`);
    }
  }
  const d = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  if (/ProtectedData/.test(d) && !/Add-Type -AssemblyName System\.Security/.test(d)) {
    throw new Error('the daemon unprotects via PowerShell without loading System.Security');
  }
});

const CORE = await load('src/daemon/core.ts', 'core.mjs');

check('CORE: the role defaults to `both`, so an un-migrated install never strands', () => {
  eq(CORE.daemonRole([]), 'both', 'no argv, no config');
  eq(CORE.daemonRole([], {}), 'both', 'empty config');
  eq(CORE.daemonRole(['--role', 'core']), 'core', 'argv long form');
  eq(CORE.daemonRole(['--role=session']), 'session', 'argv inline form');
  eq(CORE.daemonRole([], { residency: { role: 'core' } }), 'core', 'config honoured');
  eq(CORE.daemonRole(['--role', 'session'], { residency: { role: 'core' } }), 'session', 'argv wins over config');
  eq(CORE.daemonRole(['--role', 'kernel']), 'both', 'unknown role falls back');
  eq(CORE.daemonRole([], { residency: { role: 42 } }), 'both', 'non-string role falls back');
});

check('CORE: desktop-bound is the default — an unclassified capability never runs headless', () => {
  for (const cap of ['mic', 'hello', ...ORGANS.MIND_DESKTOP_CAPABILITIES]) {
    eq(CORE.needsDesktop(cap), true, `${cap} needs a desk`);
  }
  for (const cap of ['brain', 'workflow', 'news', 'hoard', 'audit', ...ORGANS.MIND_CORE_CAPABILITIES]) {
    eq(CORE.needsDesktop(cap), false, `${cap} runs headless`);
  }
  eq(CORE.needsDesktop('some-organ-invented-later'), true, 'unknown capability is desktop-bound');
  eq(CORE.needsDesktop(''), true, 'empty capability is desktop-bound');
});

check('CORE: a stale or absent session reads as no hands — fail closed both ways', () => {
  const live = { id: 'sess-abcd1234', lastBeatMs: 1_000_000, capabilities: ['talon'] };
  eq(CORE.sessionAttached(live, 1_000_000), true, 'fresh beat');
  eq(CORE.sessionAttached(live, 1_000_000 + CORE.SESSION_STALE_MS), true, 'exactly at the edge still counts');
  eq(CORE.sessionAttached(live, 1_000_000 + CORE.SESSION_STALE_MS + 1), false, 'one ms past is gone');
  eq(CORE.sessionAttached(null, 1_000_000), false, 'no session');
  eq(CORE.sessionAttached(undefined, 1_000_000), false, 'undefined session');
  eq(CORE.sessionAttached(live, 999_000), false, 'beat from the future is not alive');
  eq(CORE.sessionAttached({ id: 'x', capabilities: [] }, 1_000_000), false, 'no beat at all');
});

check('CORE: with no desk, desktop work is refused honestly and never attempted', () => {
  const now = 5_000_000;
  const none = CORE.capabilityAvailable('mic', 'core', null, now);
  eq(none.ok, false, 'refused');
  eq(none.queue, false, 'work aimed at a moment is refused outright, not held');
  for (const cap of ORGANS.MIND_QUEUEABLE) {
    eq(CORE.capabilityAvailable(cap, 'core', null, now).queue, true, `${cap} may wait`);
  }
  if (!none.reason || none.reason.length < 20) throw new Error('a refusal must say something the owner can act on');

  const think = CORE.capabilityAvailable('workflow', 'core', null, now);
  eq(think.ok, true, 'workflows run with nobody signed in');
  eq(think.queue, false, 'and are never queued');

  const locked = { id: 'sess-abcd1234', lastBeatMs: now, capabilities: ['hello'] };
  const noHands = CORE.capabilityAvailable('mic', 'core', locked, now);
  eq(noHands.ok, false, 'attached but not offering the microphone');
  eq(noHands.queue, false, 'still not held — work aimed at a moment is, whatever the reason');
  for (const cap of ORGANS.MIND_QUEUEABLE) {
    eq(CORE.capabilityAvailable(cap, 'core', locked, now).queue, true, `${cap} on a locked desk waits`);
  }

  const ok = CORE.capabilityAvailable('talon', 'core', { id: 'sess-abcd1234', lastBeatMs: now, capabilities: ['talon'] }, now);
  eq(ok.ok, true, 'a real desk runs it');
  eq(ok.queue, false, 'nothing to park');

  eq(CORE.capabilityAvailable('talon', 'both', null, now).ok, true, 'both is its own desk');
});

check('CORE: a session agent cannot invent or claim capabilities it has no business holding', () => {
  eq(CORE.validSessionRegistration(null), null, 'no body');
  eq(CORE.validSessionRegistration({ id: 'short', capabilities: [], port: 23800 }), null, 'id too short');
  eq(CORE.validSessionRegistration({ id: 'sess-abcd1234', port: 23800 }), null, 'capabilities must be an array');
  eq(CORE.validSessionRegistration({ id: '../../etc', capabilities: [], port: 23800 }), null, 'id is not a path');
  eq(CORE.validSessionRegistration({ id: 'sess-abcd1234', capabilities: [] }), null, 'a desk with no port is unreachable');

  const reg = CORE.validSessionRegistration({
    id: 'sess-abcd1234',
    port: 23800,
    capabilities: ['mic', 'brain', 'hello', 'mic', 'not-a-thing'],
  });
  eq(reg.id, 'sess-abcd1234', 'id kept');
  eq(reg.capabilities.join(','), 'mic,hello', 'only real desktop capabilities survive, deduped');
  eq(reg.capabilities.includes('brain'), false, 'cannot claim a core capability');
  eq(reg.capabilities.includes('molt'), false, 'cannot claim the molt path');
});

check('CORE: which organs a role starts derives from the one desktop list', () => {
  for (const cap of ['brain', 'talon', 'mic', 'news', 'workbench']) {
    eq(CORE.roleRuns('both', cap), true, `both runs ${cap}`);
  }
  eq(CORE.roleRuns('core', 'brain'), true, 'core runs the brain');
  eq(CORE.roleRuns('core', 'news'), true, 'core runs news');
  eq(CORE.roleRuns('core', 'talon'), false, 'core has no hands');
  eq(CORE.roleRuns('core', 'mic'), false, 'core has no microphone');
  eq(CORE.roleRuns('session', 'talon'), true, 'the desk owns the hands');
  eq(CORE.roleRuns('session', 'brain'), false, 'the desk does not run the brain');
  for (const cap of [...CORE.DESKTOP_CAPABILITIES, 'brain', 'news', 'soul', 'workflow', 'audit']) {
    eq(CORE.roleRuns('core', cap) !== CORE.roleRuns('session', cap), true, `${cap} belongs to exactly one half`);
  }
});

check('CORE: a click is NEVER queued — only work whose meaning survives a delay', () => {
  eq(CORE.queueable('hello'), false, 'a live consent cannot be deferred');
  eq(CORE.queueable('mic'), false, 'a listener is not a job');
  eq(CORE.queueable('some-organ-invented-later'), false, 'nothing waits unless it was named');
  for (const cap of ORGANS.MIND_QUEUEABLE) eq(CORE.queueable(cap), true, `${cap} means the same thing later`);
  for (const cap of ORGANS.MIND_QUEUEABLE) eq(CORE.needsDesktop(cap), true, `${cap} is desktop-bound`);

  const now = 7_000_000;
  const click = CORE.capabilityAvailable('mic', 'core', null, now);
  eq(click.ok, false, 'refused with no desk');
  eq(click.queue, false, 'and NOT parked');
  if (/hold it/i.test(click.reason)) throw new Error('a refusal that cannot be queued must not promise to hold it');

  for (const cap of ORGANS.MIND_QUEUEABLE) {
    const held = CORE.capabilityAvailable(cap, 'core', null, now);
    eq(held.ok, false, `${cap} is also refused`);
    eq(held.queue, true, `but ${cap} may wait`);
    if (!/hold it/i.test(held.reason)) throw new Error('queueable work should say it is being held');
  }
});

check('CORE: the desk token lives in the locked directory, beside the other secrets', () => {
  const p = CORE.sessionTokenPath('C:\\work\\aeryx');
  if (!/secrets/.test(p)) throw new Error('the session token must live in secrets/ — the brain account has no read there');
  if (!/session\.token$/.test(p)) throw new Error('unexpected session token filename');
  eq(p, path.join('C:\\work\\aeryx', 'secrets', 'session.token'), 'exact path');
});

check('CORE: the brain has no route to register itself as a desk', () => {
  const brain = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (brain.includes('/internal/session')) throw new Error('the brain references /internal/session — the mind must not be able to attach a desk');
  const gw = readFileSync(path.join(ROOT, 'src', 'chain', 'gateway.ts'), 'utf-8');
  if (gw.includes('/internal/session')) throw new Error('a session-registration path exists in the Chain — no lane should reach it');

  const d = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const route = d.slice(d.indexOf("url.pathname === '/internal/session'"));
  const head = route.slice(0, 600);
  if (!head.includes('isLocalAddress')) throw new Error('/internal/session must be loopback-only');
  if (!head.includes('SESSION_TOKEN')) throw new Error('/internal/session must be gated on the session token');
  if (/brainTokenOk\(BRAIN_TOKEN/.test(head)) throw new Error('/internal/session is gated on the brain token — the brain could then attach a desk');

  if (!/ROLE === 'session'[\s\S]{0,200}process\.exit/.test(d)) {
    throw new Error('aeryxd no longer refuses --role session — a second daemon would race for :23799');
  }
});

const DESK = await load('src/session/desk.ts', 'desk.mjs');

check('DESK: doubt resolves DOWNWARD — a locked screen loses exactly what fails silently', () => {
  const open = DESK.deskCapabilities('win32', false);
  for (const cap of CORE.DESKTOP_CAPABILITIES) {
    eq(open.includes(cap), true, `unlocked desk offers ${cap}`);
  }
  const locked = DESK.deskCapabilities('win32', true);
  eq(locked.includes('talon'), false, 'a locked desk has no hands');
  eq(locked.includes('recording'), false, 'a locked desk cannot capture the screen');
  eq(locked.includes('workbench'), false, 'terminals wait for the owner to be present');
  eq(locked.includes('mic'), true, 'a locked machine still hears');
  eq(locked.includes('hello'), true, 'the lock screen IS the secure desktop — consent is at home there');
  eq(DESK.deskCapabilities('linux', false).length, 0, 'not a desk off Windows');
  eq(DESK.deskCapabilities('darwin', false).length, 0, 'not a desk off Windows');
});

check('DESK: a refusal can never be mistaken for having acted, nor misstate its reason', () => {
  const locked = DESK.deskRefusal('talon', true);
  const closed = DESK.deskRefusal('recording', false);
  for (const msg of [locked, closed]) {
    if (!msg || msg.length < 20) throw new Error('a refusal must explain itself');
    if (/\bI (did|have done|clicked|typed|captured)\b/i.test(msg)) {
      throw new Error(`a refusal reads like an action was taken: ${msg}`);
    }
  }
  if (!/lock/i.test(locked)) throw new Error('a lock refusal should say the screen is locked');
  if (/nowhere to land|would go nowhere|goes black|blocked by windows/i.test(locked)) {
    throw new Error('the lock refusal claims Windows blocks this — measurement says it does not');
  }
});

check('DESK: ids are shaped so core will actually accept them', () => {
  const id = DESK.agentId('a1b2c3d4e5f6');
  eq(/^desk-/.test(id), true, 'prefixed so a log line is self-explaining');
  eq(CORE.validSessionRegistration({ id, capabilities: ['talon'], port: 23800 }) !== null, true, 'core accepts a minted id');
  eq(CORE.validSessionRegistration({ id: DESK.agentId('../../evil'), capabilities: [], port: 23800 }) !== null, true, 'path characters are stripped, not passed through');
  if (DESK.agentId('../../evil').includes('/')) throw new Error('a desk id must never carry path separators');
});

check('DESK: core dials only loopback, whatever an agent claims', () => {
  eq(CORE.deskEndpoint(23800, 'capture'), 'http://127.0.0.1:23800/desk/capture', 'loopback, always');
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'core.ts'), 'utf-8');
  const fn = src.slice(src.indexOf('export function deskEndpoint'));
  if (/body|host|hostname/.test(fn.slice(0, 300))) throw new Error('deskEndpoint takes a host from somewhere — it must be hard-coded loopback');
  eq(CORE.validSessionRegistration({ id: 'desk-abcd1234', capabilities: [], port: 80 }), null, 'privileged port refused');
  eq(CORE.validSessionRegistration({ id: 'desk-abcd1234', capabilities: [], port: 0 }), null, 'zero refused');
  eq(CORE.validSessionRegistration({ id: 'desk-abcd1234', capabilities: [], port: 99999 }), null, 'out of range refused');
  eq(CORE.validSessionRegistration({ id: 'desk-abcd1234', capabilities: [], port: 23800 })?.port, 23800, 'a sane port is kept');
});

check('DESK: the agent holds no policy — it cannot decide it may use the hands', () => {
  const a = readFileSync(path.join(ROOT, 'src', 'session', 'agent.ts'), 'utf-8');
  for (const bad of ['classify(', 'riskClass', 'confirm', 'guardrails', 'talonsEnabled', 'ladder']) {
    if (a.includes(bad)) throw new Error(`the session agent references ${bad} — policy lives in the Chain, never at the desk`);
  }
  if (!a.includes('local only')) throw new Error('the desk callback must be loopback-only');
});

check('CORE: /status tells the truth about the desk', () => {
  const now = 9_000_000;
  const off = CORE.sessionStatus('core', null, now);
  eq(off.attached, false, 'no desk');
  eq(off.capabilities.length, 0, 'and no capabilities claimed');
  if (!/no desk/i.test(off.hands)) throw new Error('status must say plainly that there are no hands');

  const on = CORE.sessionStatus('core', { id: 'sess-abcd1234', lastBeatMs: now, capabilities: ['talon', 'mic'] }, now);
  eq(on.attached, true, 'desk present');
  eq(on.capabilities.join(','), 'talon,mic', 'reports what the agent offers');

  eq(CORE.sessionStatus('core', { id: 'sess-abcd1234', lastBeatMs: now - 10 * CORE.SESSION_STALE_MS, capabilities: ['talon'] }, now).attached, false, 'stale agent is not a desk');

  eq(CORE.sessionStatus('both', null, now).attached, true, 'the single-process daemon is its own desk');
});

check('WORKFLOWS: catch-up fires a missed slot at boot; without it the skip stands', () => {
  const T0 = new Date('2026-08-10T06:00:00');
  const s = mkStore();
  const late = new W.WorkflowStore(':memory:');
  for (const [store, catchUp] of [[s, false], [late, true]]) {
    const wf = store.create(
      { name: 'planner', prompt: 'plan the day', schedule: 'daily@08:00', catchUp },
      { status: 'active', now: T0 },
    );
    eq(Boolean(store.get(wf.id).catchUp), catchUp, 'the flag round-trips');
  }
  const boot = new Date('2026-08-10T11:30:00');
  const plain = s.tick(boot);
  eq(plain.due.length, 0, 'no catch-up: nothing due');
  eq(plain.skipped.length, 1, 'no catch-up: the miss is recorded');
  eq(plain.skipped[0].reason, 'missed while the daemon was off', 'and says why');
  const caught = late.tick(boot);
  eq(caught.due.length, 1, 'catch-up: the missed slot fires now');
  eq(caught.skipped.length, 0, 'catch-up: no skip recorded');
  eq(late.get(caught.due[0].id).nextRunTs, new Date('2026-08-11T08:00:00').toISOString(), 'next slot is tomorrow 08:00');
  s.close(); late.close();
});

check('MODE 1 did not touch the wall: publish.send and content.learn stay never-scopable', () => {
  eq(L.neverScopable('publish.send'), true, 'publish.send stays unreachable by any standing order');
  eq(L.neverScopable('content.learn'), true, 'content.learn stays unreachable');
  eq(L.NEVER_SCOPABLE.includes('publish.send'), true, 'the list itself still names publish.send');
});

check('ASSETS: the static asset route is an exact allowlist, the 3D characters included', () => {
  const SRC = readFileSync(path.join(ROOT, 'src/daemon/aeryxd.ts'), 'utf-8');
  const literal = /const dragonAsset = (\/\^\\\/assets[\s\S]*?\$\/)\.exec\(url\.pathname\);/.exec(SRC)?.[1];
  if (!literal) throw new Error('the asset route is gone — this check needs updating');
  const route = new RegExp(literal.slice(1, -1));
  for (const ok of ['/assets/characters/aeryx-dragon.glb', '/assets/characters/aeri-human.webp', '/assets/characters/aeri-orb.png', '/assets/characters/growl.m4a', '/assets/aeryx-city-backdrop.webp', '/assets/news/chips-japan.webp']) {
    eq(route.test(ok), true, `${ok} is served`);
  }
  for (const bad of ['/assets/characters/../aeryxd.mjs', '/assets/characters/%2e%2e/aeryxd.mjs', '/assets/characters/ryu-dragon.glb', '/assets/characters/aeryx-dragon.glb.map', '/assets/aeryx-winged-dragon.png', '/assets/characters/aeryx-orb.glb', '/assets/news/../../aeryx.config.json']) {
    eq(route.test(bad), false, `${bad} is refused`);
  }
  if (!/url\.pathname === '\/orb\.js' \|\| url\.pathname === '\/familiar\.js'/.test(SRC)) throw new Error('the script route must name its two files exactly');
});

await checkA('PERSONA: every blue-family UI colour is a palette variable, the palette is current, and Aeri maps them to red', async () => {
  const P = await import(pathToFileURL(path.join(ROOT, 'scripts', 'persona-theme.mjs')).href);
  for (const [rel, next] of P.plan()) {
    if (readFileSync(path.join(ROOT, rel), 'utf-8') !== next) throw new Error(`${rel} holds a raw theme colour or a stale palette — run node scripts/persona-theme.mjs`);
  }
  for (const [name, c] of [['jade (ok)', [92, 232, 211]], ['red (error)', [255, 90, 104]], ['warn', [255, 196, 107]], ['white', [255, 255, 255]]]) {
    eq(P.isThemed(...c), false, `${name} keeps its meaning in both personas`);
  }
  for (const c of [[99, 220, 255], [27, 159, 255], [8, 25, 51], [22, 74, 152]]) {
    const [r, g, b] = P.aeri(...c);
    if (!(r > g && r > b)) throw new Error(`Aeri maps rgb(${c}) to rgb(${r},${g},${b}), which is not red`);
  }
  const palette = readFileSync(path.join(ROOT, 'lair', 'app', 'persona.css'), 'utf-8');
  if (!palette.includes(':root[data-persona="aeri"]')) throw new Error('the Aeri palette block is missing');
  if (!readFileSync(path.join(ROOT, 'lair', 'app', 'layout.jsx'), 'utf-8').includes("import './persona.css'")) throw new Error('the Lair no longer loads its palette');
});

await checkA('PERSONA: the violet theme maps blue-family colours to purple, and every page carries its palette', async () => {
  const P = await import(pathToFileURL(path.join(ROOT, 'scripts', 'persona-theme.mjs')).href);
  for (const c of [[99, 220, 255], [27, 159, 255], [8, 25, 51], [22, 74, 152]]) {
    const [r, g, b] = P.violet(...c);
    if (!(b > g && r > g)) throw new Error(`violet maps rgb(${c}) to rgb(${r},${g},${b}), which is not purple`);
  }
  for (const rel of ['lair/app/persona.css', 'src/client/hud.html', 'src/client/lens.html', 'src/client/status.html']) {
    if (!readFileSync(path.join(ROOT, rel), 'utf-8').includes(':root[data-persona="violet"]')) throw new Error(`${rel} has no violet palette`);
  }
});

check('PERSONA: the Lair names the active character, and only a typed or voice ask can make the brain answer as Aeri', () => {
  const lair = readFileSync(path.join(ROOT, 'lair', 'app', 'page.jsx'), 'utf-8').split('\n');
  const named = lair.filter((l) => /\bAeryx\b|\bAERYX\b/.test(l) && !/^\s*\/\/|dracoder\/aeryx|AeryxOrb|whoOf\('Aeryx'|name = 'Aeryx'|name === 'Aeryx'/.test(l));
  if (named.length) throw new Error(`hard-coded name in the Lair: ${named[0].trim().slice(0, 90)}`);
  const gendered = lair.filter((l) => /\b(he|his|him|himself)\b/.test(l.replace(/\bw\.\w+/g, '')) && !/^\s*(\/\/|\*|\{\/\*)/.test(l));
  if (gendered.length) throw new Error(`hard-coded pronoun in the Lair: ${gendered[0].trim().slice(0, 90)}`);
  const d = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  if (!d.includes("body.as === 'aeri' ? 'aeri' : undefined")) throw new Error('/ask must map only the literal aeri to a face');
  const b = readFileSync(path.join(ROOT, 'src', 'brain', 'brain.ts'), 'utf-8');
  if (!b.includes("(via === 'typed' || via === 'voice') && msg.face === 'aeri'")) throw new Error('the brain must accept a face only on typed or voice asks');
  if (/FACES\s*=\s*\{[^}]*\$\{/.test(b)) throw new Error('face text must be fixed, never caller-supplied');
});

await checkA('SKINS: local skins are validated, confined to their folder, and never shadow a built-in persona', async () => {
  const SK = await load('src/daemon/skins.ts', 'skins.mjs');
  const { mkdirSync, writeFileSync, symlinkSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aeryx-skins-'));
  try {
    const make = (id, manifest, files) => {
      mkdirSync(path.join(dir, id), { recursive: true });
      if (manifest !== null) writeFileSync(path.join(dir, id, 'skin.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
      for (const f of files) writeFileSync(path.join(dir, id, f), 'glTF');
    };
    make('nova', { name: 'Nova', theme: 'violet', fx: 'convergence', tap: 'cast', tag: 'SPECIAL', credit: 'fan-made model', hints: { core: 'tap to unseal', dragon: 'never shown' }, emotes: [['cast', 'Signature'], ['wave', 'Wave'], ['bad id!', 'x'], ['heart', 'a label far too long to fit']] }, ['core.glb', 'human.glb', 'human.webp']);
    make('aeri', { name: 'Impostor' }, ['core.glb']);
    make('empty', { name: 'Empty' }, []);
    make('broken', '{ not json', ['core.glb']);
    make('tagged', { name: '<b>x</b>' }, ['core.glb']);
    make('plain', { name: 'Plain', theme: 'gold', fx: 'nuke', tap: 'nuke', emotes: [['wave', 'Wave']] }, ['dragon.glb']);
    make('linked', { name: 'Linked' }, []);
    writeFileSync(path.join(dir, 'outside.glb'), 'secret');
    symlinkSync(path.join(dir, 'outside.glb'), path.join(dir, 'linked', 'core.glb'));
    const list = SK.listSkins(dir);
    eq(list.map((s) => s.id).join(','), 'nova,plain', 'only complete, valid, non-built-in skins are listed');
    const nova = list[0];
    eq(nova.forms.join(','), 'core,human', 'a skin offers only the forms it ships');
    eq(nova.posters.join(','), 'human', 'posters are listed per form');
    eq(nova.theme, 'violet', 'a known theme is kept');
    eq(nova.fx, 'convergence', 'a known effect is kept');
    eq(JSON.stringify(nova.emotes), JSON.stringify([['cast', 'Signature'], ['wave', 'Wave']]), 'malformed emotes are dropped');
    eq(JSON.stringify(nova.hints), JSON.stringify({ core: 'tap to unseal' }), 'hints only for forms the skin has');
    eq(list[1].theme, 'aeryx', 'an unknown theme falls back to Aeryx');
    eq(list[1].fx, undefined, 'an unknown effect is dropped');
    eq(nova.tap, 'cast', 'a tap move the skin ships as an emote is kept');
    eq(list[1].tap, undefined, 'a tap move that is not one of its emotes is dropped');
    eq(SK.skinFile(dir, '/skins/nova/human.glb'), path.join(dir, 'nova', 'human.glb'), 'a listed model is served');
    eq(SK.skinFile(dir, '/skins/nova/human.webp'), path.join(dir, 'nova', 'human.webp'), 'a listed poster is served');
    for (const bad of ['/skins/nova/dragon.glb', '/skins/nova/core.webp', '/skins/nova/skin.json', '/skins/nova/../outside.glb', '/skins/nova/%2e%2e/outside.glb', '/skins/linked/core.glb', '/skins/aeri/core.glb', '/skins/NOVA/core.glb', '/skins/nova/core.glb.map']) {
      eq(SK.skinFile(dir, bad), null, `${bad} is refused`);
    }
    const SRC = readFileSync(path.join(ROOT, 'src/daemon/aeryxd.ts'), 'utf-8');
    if (!/const SKINS_DIR = path\.join\(DATA_DIR, 'skins'\);/.test(SRC)) throw new Error('skins must live under the data folder, never the install');
    if (!/const f = skinFile\(SKINS_DIR, url\.pathname\);/.test(SRC)) throw new Error('the skin file route must go through skinFile');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await checkA('SKIN PACKS: a zip installs only a validated pack, confined to its folder; the installer is human-only and the only zip-accepting route', async () => {
  const SP = await load('src/daemon/skinpack.ts', 'skinpack.mjs');
  const { deflateRawSync } = await import('node:zlib');
  const { mkdirSync, writeFileSync, symlinkSync, readdirSync } = await import('node:fs');
  const zipOf = (files) => {
    const parts = [], central = [];
    let off = 0;
    for (const [name, content, method = 0, flags = 0, claim] of files) {
      const data = Buffer.from(content), n = Buffer.from(name);
      const body = method === 8 ? deflateRawSync(data) : data;
      const usize = claim ?? data.length;
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(n.length, 26);
      parts.push(lh, n, body);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
      central.push(ch, n);
      off += 30 + n.length + body.length;
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat([...parts, cd, end]);
  };
  const manifest = (name) => JSON.stringify({ name, theme: 'violet', emotes: [['wave', 'Wave']] });
  const root = mkdtempSync(path.join(os.tmpdir(), 'aeryx-packs-'));
  const dir = path.join(root, 'skins');
  try {
    const good = zipOf([
      ['Pack/nova/skin.json', manifest('Nova')], ['Pack/nova/core.glb', 'glTF-core', 8], ['Pack/nova/human.webp', 'RIFF'],
      ['Pack/README.txt', 'read me'], ['Pack/Install on Mac.command', '#!/bin/sh\nrm -rf ~'], ['Pack/nova/evil.sh', 'x'],
      ['Pack/nova/../../../escape.glb', 'x'], ['__MACOSX/Pack/nova/._skin.json', 'junk'], ['Pack/nova/', ''],
    ]);
    const r = SP.installSkinPack(dir, good);
    eq(r.ok, true, `a well-formed pack installs (${r.error ?? ''})`);
    eq(r.skin.id, 'nova', 'the pack folder names the skin');
    eq(readdirSync(path.join(dir, 'nova')).sort().join(','), 'core.glb,human.webp,skin.json', 'only the manifest, models and posters are unpacked');
    eq(readFileSync(path.join(dir, 'nova', 'core.glb'), 'utf-8'), 'glTF-core', 'deflated entries unpack intact');
    eq(existsSync(path.join(root, 'escape.glb')) || existsSync(path.join(os.tmpdir(), 'escape.glb')), false, 'no entry escapes the skins folder');
    eq(readdirSync(dir).join(','), 'nova', 'no staging folder is left behind');
    const again = SP.installSkinPack(dir, zipOf([['nova/skin.json', manifest('Nova Two')], ['nova/core.glb', 'v2']]));
    eq(again.ok && again.replaced, true, 'installing the same pack again replaces it');
    eq(readdirSync(path.join(dir, 'nova')).sort().join(','), 'core.glb,skin.json', 'a replaced pack keeps none of the old files');
    const named = SP.installSkinPack(dir, zipOf([['skin.json', manifest('Star Lord!')], ['dragon.glb', 'd']]));
    eq(named.ok && named.skin.id, 'star-lord', 'a pack at the zip root is named from its manifest');
    const refused = [
      ['not a zip', Buffer.from('hello')],
      ['no manifest', zipOf([['x/core.glb', 'c']])],
      ['two packs', zipOf([['a/skin.json', manifest('A')], ['a/core.glb', 'c'], ['b/skin.json', manifest('B')], ['b/core.glb', 'c']])],
      ['built-in name', zipOf([['aeri/skin.json', manifest('Aeri')], ['aeri/core.glb', 'c']])],
      ['traversal folder', zipOf([['../../outside/skin.json', manifest('Out')], ['../../outside/core.glb', 'c']])],
      ['no model', zipOf([['empty/skin.json', manifest('Empty')], ['empty/core.webp', 'p']])],
      ['bad manifest', zipOf([['bad/skin.json', '{ nope'], ['bad/core.glb', 'c']])],
      ['encrypted model', zipOf([['enc/skin.json', manifest('Enc')], ['enc/core.glb', 'c', 0, 1]])],
      ['oversized claim', zipOf([['big/skin.json', manifest('Big')], ['big/core.glb', 'c', 0, 0, 200 * 1024 * 1024]])],
      ['zip bomb', zipOf([['bomb/skin.json', manifest('Bomb')], ['bomb/core.webp', Buffer.alloc(9 * 1024 * 1024), 8, 0, 1000], ['bomb/human.glb', 'h']])],
    ];
    for (const [label, zip] of refused) {
      const res = SP.installSkinPack(dir, zip);
      if (res.ok) throw new Error(`${label}: installed but must be refused`);
    }
    eq(readdirSync(dir).sort().join(','), 'nova,star-lord', 'refused packs leave nothing behind');
    eq(existsSync(path.join(root, 'outside')), false, 'a traversal pack wrote nothing outside');
    const target = path.join(root, 'keep');
    mkdirSync(target); writeFileSync(path.join(target, 'precious'), 'x');
    symlinkSync(target, path.join(dir, 'linked'));
    eq(SP.removeSkin(dir, 'linked'), true, 'a linked skin folder is removed');
    eq(existsSync(path.join(target, 'precious')), true, 'removing a link never deletes what it points at');
    eq(SP.removeSkin(dir, 'aeryx'), false, 'a built-in persona is never removed');
    eq(SP.removeSkin(dir, '../keep'), false, 'a traversal id is refused');
    eq(SP.removeSkin(dir, 'nova'), true, 'an installed skin is removed');
    eq(existsSync(path.join(dir, 'nova')), false, 'and its folder is gone');
  } finally { rmSync(root, { recursive: true, force: true }); }
  eq(AU.crossOriginRefusal('POST', { host: '127.0.0.1:23799', 'content-type': 'application/zip' }, [], '/skins/install'), null, 'the installer takes a zip');
  for (const [ct, p] of [['application/zip', '/confirm'], ['application/zip', '/skins/installx'], ['text/plain', '/skins/install'], ['multipart/form-data', '/skins/install'], ['application/zip', '']]) {
    if (!AU.crossOriginRefusal('POST', { host: '127.0.0.1:23799', 'content-type': ct }, [], p)) throw new Error(`${ct} to ${p || '(no path)'} was accepted`);
  }
  if (!AU.crossOriginRefusal('POST', { host: '127.0.0.1:23799', 'content-type': 'application/zip', origin: 'https://evil.example' }, [], '/skins/install')) throw new Error('a cross-origin zip was accepted');
  for (const p of ['/skins/install', '/skins/nova/remove']) if (!PR.isHumanOnly('POST', p)) throw new Error(`${p} is not human-only`);
  const SRC = readFileSync(path.join(ROOT, 'src/daemon/aeryxd.ts'), 'utf-8');
  if (!/installSkinPack\(SKINS_DIR, zip\)/.test(SRC) || !/readRaw\(req, MAX_PACK_BYTES\)/.test(SRC)) throw new Error('the install route must read a capped body and go through installSkinPack');
  if (!/removeSkin\(SKINS_DIR, skinRemove\[1\]!\)/.test(SRC)) throw new Error('the remove route must go through removeSkin');
  if (!/crossOriginRefusal\(req\.method, req\.headers, extraHostNames\(readConfigRaw\(\)\?\.remote\), url\.pathname\)/.test(SRC)) throw new Error('the cross-origin check must see the path');
});

check('the never-scopable LIST and the never-scopable CHECK agree', () => {
  for (const pattern of L.NEVER_SCOPABLE) {
    const lane = pattern.replace(/\*/g, 'probe');
    if (!L.neverScopable(lane)) throw new Error(`NEVER_SCOPABLE lists "${pattern}" but neverScopable("${lane}") is false`);
    if (L.scopeAllows(lane, [lane, '*'])) throw new Error(`"${lane}" is listed as never-scopable but a scope covered it`);
  }
});

const AERYXD_SRC = readFileSync(path.join(ROOT, 'src/daemon/aeryxd.ts'), 'utf-8');

check('EXPIRY: the brain announces a timeout instead of resolving silently', () => {
  const BRAIN = readFileSync(path.join(ROOT, 'src/brain/brain.ts'), 'utf-8');
  const fn = /function askConfirmation\([\s\S]*?\n}/.exec(BRAIN)?.[0];
  if (!fn) throw new Error('askConfirmation not found — this check needs updating');
  if (!/confirm-expired/.test(fn)) throw new Error('the timeout path sends no confirm-expired message');
  if (!/riskClass/.test(fn)) throw new Error('riskClass is not sent with the confirm');
  if (!/ts:/.test(fn)) throw new Error('no timestamp sent, so no client can show an age');
});

check('EXPIRY: the daemon reaps the prompt and refuses a late answer', () => {
  const D = AERYXD_SRC;
  if (!/msg\.type === 'confirm-expired'/.test(D)) throw new Error('daemon ignores confirm-expired');
  const route = /url\.pathname === '\/confirm'[\s\S]{0,1400}/.exec(D)?.[0] ?? '';
  if (!/410/.test(route)) throw new Error('POST /confirm cannot answer 410 for an expired ask');
  if (!/p\.timeoutMs/.test(route)) throw new Error('POST /confirm does not check the age at all');
});

check('EXPIRY: status carries what a client needs to tell the truth', () => {
  const block = /pendingConfirms: \[\.\.\.pendingConfirms\][\s\S]{0,400}/.exec(AERYXD_SRC)?.[0] ?? '';
  for (const field of ['ts', 'timeoutMs', 'riskClass', 'laneId']) {
    if (!new RegExp(`\\b${field}\\b`).test(block)) throw new Error(`/status omits ${field}`);
  }
  if (!/remote: !isLocalAddress/.test(AERYXD_SRC)) throw new Error('/status does not say whether the caller is remote');
  if (!/pendingProposals/.test(AERYXD_SRC)) throw new Error('/status does not carry proposal counts for the badge');
});

check('HALT: one act stops the brain and the scheduler, and every organ with it', () => {
  const D = AERYXD_SRC;
  if (!/function setHalted\(/.test(D)) throw new Error('no kill switch at all');
  for (const [fn, label] of [
    [/function routeAsk\([\s\S]{0,400}/, 'routeAsk'],
    [/function workflowTick\(\)[\s\S]{0,200}/, 'workflowTick'],
    [/function startBrain\(\)[\s\S]{0,200}/, 'startBrain'],
  ]) {
    const body = fn.exec(D)?.[0] ?? '';
    if (!/isHalted\(\)/.test(body)) throw new Error(`${label} does not check the halt`);
  }
  if (!/brain\?\.kill\(\)/.test(/function setHalted\([\s\S]{0,700}/.exec(D)?.[0] ?? '')) {
    throw new Error('halting does not stop the brain');
  }
});

check('HALT: the flag outlives a restart and sits on protected ground', () => {
  const D = AERYXD_SRC;
  if (!/HALT_FILE = path\.join\(DATA_DIR/.test(D)) throw new Error('the halt is not persisted under data/');
  const G2 = JSON.parse(readFileSync(path.join(ROOT, 'guardrails.json'), 'utf-8'));
  const selfish = (G2.selfPaths ?? []).map((p) => path.resolve(ROOT, p));
  const c = classify('Write', { file_path: path.join(ROOT, 'data', 'halted') }, { ...G2, selfPaths: selfish }, clean());
  eq(c.riskClass, 3, 'writing the halt flag as a tool call');
});

check('HALT: writing to a dead child cannot kill the daemon', () => {
  const send = /function sendBrain\([\s\S]*?\n}/.exec(AERYXD_SRC)?.[0] ?? '';
  if (!/try\s*{/.test(send)) throw new Error('sendBrain can throw on a broken pipe');
  const toV = /function toVoice\([\s\S]*?\n}/.exec(AERYXD_SRC)?.[0] ?? '';
  if (!/try\s*{/.test(toV)) throw new Error('toVoice can throw on a broken pipe');
  for (const child of ['brain', 'voice']) {
    if (!new RegExp(`${child}\\.stdin\\?\\.on\\('error'`).test(AERYXD_SRC)) {
      throw new Error(`${child}.stdin has no error handler — an async EPIPE would be fatal`);
    }
  }
  const halt = /url\.pathname === '\/halt'[\s\S]{0,1200}/.exec(AERYXD_SRC)?.[0] ?? '';
  const logAt = halt.indexOf('halt-log');
  const killAt = halt.indexOf('setHalted(true');
  if (logAt < 0 || killAt < 0) throw new Error('halt route no longer both logs and halts');
  if (logAt > killAt) throw new Error('the halt is logged after the brain is killed — the row never lands');
});

check('HALT: clearing it is local-only', () => {
  const resume = /url\.pathname === '\/resume'[\s\S]{0,400}/.exec(AERYXD_SRC)?.[0] ?? '';
  if (!/isLocalAddress/.test(resume)) throw new Error('a remote caller can resume a halted Aeryx');
  const halt = /url\.pathname === '\/halt'[\s\S]{0,400}/.exec(AERYXD_SRC)?.[0] ?? '';
  if (!/isLocalAddress/.test(halt)) throw new Error('halt route missing its local check');
});

check('HALT: halting leaves a row that cannot mint a grant', () => {
  const lanes = L.replayLanes(
    [{ tool: 'halt', lane: 'shell.exec:powershell', verdict: 'ladder:granted-standing' }],
    L.DEFAULT_LADDER,
    true,
  );
  eq(lanes.size, 0, 'granted lanes');
});

check('WIRING: every request passes the cross-origin check, then the gate', () => {
  const body = /async function handleRequest\([\s\S]*?\n}/.exec(AERYXD_SRC)?.[0];
  if (!body) throw new Error('handleRequest not found — the check needs updating');
  const csrf = body.indexOf('crossOriginRefusal');
  const gate = body.indexOf('remoteAllowed');
  if (csrf < 0) throw new Error('handleRequest does not call crossOriginRefusal');
  if (gate < 0) throw new Error('handleRequest does not call remoteAllowed');
  if (csrf > gate) throw new Error('the cross-origin check must come before the remote gate');
  const firstRoute = body.search(/url\.pathname\s*===|req\.method\s*===/);
  if (firstRoute >= 0 && firstRoute < gate) throw new Error('a route is handled before the gate runs');
});

check('WIRING: the gate is not reimplemented locally in the moltable file', () => {
  if (/^const PUBLIC_PREFIXES\s*=/m.test(AERYXD_SRC)) throw new Error('PUBLIC_PREFIXES redefined in aeryxd.ts');
  if (/function remoteAllowed[\s\S]{0,400}isLocalAddress\(/.test(AERYXD_SRC)) {
    throw new Error('remoteAllowed reimplemented in aeryxd.ts rather than delegating to auth.ts');
  }
  if (!/from '\.\/auth'/.test(AERYXD_SRC)) throw new Error('aeryxd.ts does not import the gate at all');
});

check('WIRING: every HTTP server uses the gated handler', () => {
  for (const m of AERYXD_SRC.matchAll(/http\.createServer\(([^)]*)\)/g)) {
    if (!/handleRequest/.test(m[1])) throw new Error(`an http server was created with a handler other than handleRequest: ${m[1]}`);
  }
});

check('GATE: a public prefix cannot be widened by a raw string prefix', () => {
  const st = AU.freshAuthState();
  if (!AU.remoteAllowed(st, '100.64.1.2', '/lair/', {})) throw new Error('the gate screen itself was blocked');
  if (!AU.remoteAllowed(st, '100.64.1.2', '/lair', {})) throw new Error('the gate screen itself was blocked');
  for (const p of ['/lairsecret', '/lair-x/../audit', '/orb.jsx', '/fonts']) {
    if (AU.remoteAllowed(st, '100.64.1.2', p, {})) throw new Error(`${p} was treated as public`);
  }
  if (AU.remoteAllowed(st, '100.64.1.2', '/audit', {})) throw new Error('a protected route was public');
  if (!AU.remoteAllowed(st, '127.0.0.1', '/audit', {})) throw new Error('local caller lost its standing');
});

check('FRONTDOOR: shelling out to the daemon by any name or port is confirmed', () => {
  const cmds = [
    'curl -X POST http://127.0.0.1/confirm -d {"id":"c1","approve":true}',
    'curl http://localhost/auth -d {"pin":"x"}',
    'Invoke-WebRequest http://100.64.0.1/auth -Method POST',
    'curl http://aeryx/workflows/3/approve -X POST',
    'curl http://aeryx:8080/confirm',
  ];
  for (const command of cmds) {
    for (const shell of ['Bash', 'PowerShell']) {
      const c = classify(shell, { command }, G, clean());
      eq(c.riskClass, 2, `${shell}: ${command.slice(0, 50)}`);
    }
  }
});

check('FRONTDOOR: the session cookie parser takes exactly the aeryx token, nothing else', () => {
  const tok = 'a'.repeat(64);
  eq(AU.tokenFromCookie(`aeryx=${tok}`), tok, 'bare cookie');
  eq(AU.tokenFromCookie(`other=1; aeryx=${tok}; more=2`), tok, 'among others');
  for (const bad of [undefined, '', 'aeryx=short', `naeryx=${tok}`, `aeryx=${'Z'.repeat(64)}`, `aeryx=${tok}extra`]) {
    if (AU.tokenFromCookie(bad) !== undefined) throw new Error(`accepted ${JSON.stringify(bad)}`);
  }
});

check('FRONTDOOR: ordinary web URLs are not swept up by the daemon pattern', () => {
  for (const command of [
    'curl https://example.com/api/auth/login',
    'curl https://api.github.com/repos/x/y',
    'node C:\\work\\aeryx\\scripts\\gen-icon.mjs',
  ]) {
    const c = classify('Bash', { command }, G, clean());
    eq(c.riskClass, 1, command.slice(0, 50));
  }
});


check('every HTML page ships with the same-origin CSP; the shell no longer opts out', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const htmlServes = (src.match(/text\/html/g) ?? []).length;
  const cspSends = (src.match(/content-security-policy/g) ?? []).length;
  if (cspSends < 2) throw new Error('the daemon stopped sending its CSP on HTML responses');
  if (htmlServes > cspSends + 1) {
    throw new Error(`${htmlServes} text/html mentions but only ${cspSends} CSP sends — a page slipped out uncovered`);
  }
  if (!src.includes("frame-ancestors 'none'")) throw new Error('frame-ancestors dropped from the policy');
  const connect = /"connect-src ([^"]*)"/.exec(src)?.[1];
  if (!connect) throw new Error('connect-src dropped from the policy');
  if (connect.split(/\s+/).some((v) => v !== "'self'" && v !== 'blob:')) throw new Error(`connect-src may name only 'self' and blob:, got: ${connect}`);
  const tauriConf = path.join(ROOT, 'src-tauri', 'tauri.conf.json');
  if (existsSync(tauriConf)) {
    const csp = JSON.parse(readFileSync(tauriConf, 'utf-8'))?.app?.security?.csp;
    if (typeof csp !== 'string' || !csp.includes("default-src 'self'")) {
      throw new Error('src-tauri/tauri.conf.json security.csp is no longer a same-origin policy');
    }
  }
});

check('ORB: the floating orb is a display, and its one capability is dragging itself', () => {
  const orb = readFileSync(path.join(ROOT, 'src', 'client', 'orb.html'), 'utf-8');
  for (const bad of ['/confirm', '/approve', 'method:', 'innerHTML']) {
    if (orb.includes(bad)) throw new Error(`orb.html carries ${bad} — approvals live in the Lair, and the orb renders text only`);
  }
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  if (!src.includes("url.pathname === '/orb' ? 'orb.html'")) throw new Error('the daemon no longer serves /orb through the CSP page handler');
  const quick = readFileSync(path.join(ROOT, 'src', 'client', 'quick.html'), 'utf-8');
  for (const bad of ['/confirm', '/approve', 'innerHTML']) {
    if (quick.includes(bad)) throw new Error(`quick.html carries ${bad} — quick ask only asks`);
  }
  const posts = [...quick.matchAll(/fetch\('([^']+)'/g)].map((m) => m[1]);
  eq(JSON.stringify(posts), '["/ask"]', 'quick.html talks to /ask and nothing else');
  if (!src.includes("url.pathname === '/quick' ? 'quick.html'")) throw new Error('the daemon no longer serves /quick through the CSP page handler');
  const capDir = path.join(ROOT, 'src-tauri', 'capabilities');
  if (existsSync(path.join(ROOT, 'src-tauri'))) {
    const files = existsSync(capDir) ? readdirSync(capDir) : [];
    eq(JSON.stringify(files), '["orb.json"]', 'the app carries exactly one capability file');
    const cap = JSON.parse(readFileSync(path.join(capDir, 'orb.json'), 'utf-8'));
    eq(JSON.stringify(cap.windows), '["orb"]', 'only the orb window');
    eq(JSON.stringify(cap.permissions), '["core:window:allow-start-dragging"]', 'only dragging');
    eq(JSON.stringify(cap.remote?.urls), '["http://127.0.0.1:23799/orb"]', 'only the orb page');
  }
});

check('LENS: a display, never an approval surface, and honest when empty', () => {
  const lens = readFileSync(path.join(ROOT, 'src', 'client', 'lens.html'), 'utf-8');
  for (const bad of ['/confirm', '/approve', 'method: \'POST\'', 'method: "POST"', 'method:"POST"']) {
    if (lens.includes(bad)) throw new Error(`lens.html carries ${bad} — the Lens is a display, approvals live in the Lair`);
  }
  if (lens.includes('innerHTML')) throw new Error('lens.html uses innerHTML — panels render text, never markup from stored content');
  if (!lens.includes('textContent')) throw new Error('lens.html lost its textContent rendering path');
  if (!lens.includes('Nothing on the table')) throw new Error('the Lens lost its honest-empty state');
  if (!lens.includes('--ash-text')) throw new Error('the Lens dropped --ash-text — small labels would regress to 3.2:1 contrast');
  if (!lens.includes('prefers-reduced-motion')) throw new Error('the Lens lost its reduced-motion path');
});

check('LENS: lens_show is Class 1 lane lens.show, and the input never shapes the lane', () => {
  const r = classify('mcp__aeryx__lens_show', { template: 'document', id: 'brief-2026-01-01-sig1-example.md' }, G, clean());
  eq(r.laneId, 'lens.show', 'lens_show lane');
  eq(r.riskClass, 1, 'lens_show class');
  if (r.taints) throw new Error('lens_show taints — but the reply is a confirmation, not external content');
  const h = classify('mcp__aeryx__lens_show', { template: 'document', id: '../../secrets/warden.cred' }, G, clean());
  eq(h.laneId, 'lens.show', 'lane is fixed whatever the id claims');
});

check('LENS: invented lens_* verbs fall to fail-to-ask, outside the lens family', () => {
  for (const verb of ['open', 'close', 'pin', 'dismiss', 'approve', 'render', 'fetch', 'show_all', 'state']) {
    const c = classify(`mcp__aeryx__lens_${verb}`, {}, G, clean());
    if (c.riskClass < 2) throw new Error(`lens_${verb} classified Class ${c.riskClass} — invented lens verbs must fail to ask`);
    if (c.laneId.startsWith('lens.')) throw new Error(`lens_${verb} landed in the lens family (${c.laneId}) — a grant there must never cover inventions`);
  }
});

check('LENS: hoard pages are the third document shape, and the list is the Hoard\'s own', () => {
  eq(JSON.stringify([...LENS.LENS_HOARD_PAGES]), JSON.stringify([...AU.HOARD_FILES]),
    'LENS_HOARD_PAGES must mirror auth.ts HOARD_FILES verbatim');
  for (const page of LENS.LENS_HOARD_PAGES) {
    if (!LENS.validateLensTarget('document', page).ok) throw new Error(`hoard page ${page} was refused`);
  }
  for (const not of ['continuity.md', 'style.md']) {
    if (LENS.validateLensTarget('document', not).ok) throw new Error(`${not} accepted — it is not a Hoard page`);
  }
});

check('LENS: the resolver front door refuses everything path- or URL-shaped', () => {
  const v = LENS.validateLensTarget;
  if (!v('table', 'workflows').ok) throw new Error('a named table was refused');
  if (v('document', 'brief-2026-01-01-sig1-example.md').ok) throw new Error('a brief was resolvable with no build offering briefs');
  if (v('document', '12').ok) throw new Error('a run id was resolvable with no build offering runs');
  if (!v('document', 'brief-2026-01-01-sig1-example.md', { briefs: true }).ok) throw new Error('a well-formed brief filename was refused');
  if (!v('document', '12', { briefs: true }).ok) throw new Error('a research run id was refused');
  if (!v('table', 'ideas', { tables: ['ideas'] }).ok) throw new Error('an added table was refused');
  if (v('table', 'ideas').ok) throw new Error('a table no build offered was accepted');
  const hostile = [
    ['document', '../../secrets/warden.cred'], ['document', '..\\..\\aeryx.config.json'],
    ['document', '/etc/passwd'], ['document', 'C:\\work\\aeryx\\guardrails.json'],
    ['document', 'https://evil.example/page'], ['document', 'brief-x.md/../../y.md'],
    ['document', 'notes.md'], ['table', 'audit'], ['table', 'secrets'], ['table', '*'],
    ['metric', '1'], ['status', '1'], ['document', ''], ['table', ''],
  ];
  for (const [tpl, id] of hostile) {
    for (const ext of [undefined, { briefs: true, tables: ['ideas', 'suggestions'] }]) {
      const r = v(tpl, id, ext);
      if (r.ok) throw new Error(`validateLensTarget accepted ${tpl}:"${id}" — the verb may never carry a path, URL, or unlisted store`);
    }
  }
});

check('CONTINUITY: the journal never downgrades a session it already knows', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'daemon', 'aeryxd.ts'), 'utf-8');
  const at = src.indexOf('function writeContinuity');
  const fn = src.slice(at, at + 1200);
  if (!fn.includes('keptSession')) {
    throw new Error('writeContinuity no longer preserves a known session — a brain that dies before init would erase the resume key');
  }
  if (!/session\s*\?\?/.test(fn)) throw new Error('the fallback to the saved id is gone');
});


const MIND_GATE = path.join(ROOT, 'scripts', 'test-mind-invariants.mjs');
if (existsSync(MIND_GATE)) await import('./test-mind-invariants.mjs');

finish();
