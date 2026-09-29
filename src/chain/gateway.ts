import { classifyMindTool } from './mind-lanes';

export type RiskClass = 0 | 1 | 2 | 3;

export interface Guardrails {
  confirmPatterns: string[];
  denyPatterns: string[];
  selfCommandPatterns?: string[];
  localOnlyShellPatterns?: string[];
  confirmTools: string[];
  confirmOutsideDirs: string[];
  shellTools?: string[];
  selfPaths?: string[];
  scratchDirs?: string[];
  mcpRegistry?: Record<string, { minClass?: number; taints?: boolean; enabled?: boolean }>;
  sensitiveReadDirs?: string[];
  sensitiveFilePatterns?: string[];
  taintReadDirs?: string[];
  taintShellPatterns?: string[];
}

export interface Classification {
  laneId: string;
  riskClass: RiskClass;
  denyReason?: string;
  question?: string;
  taints?: boolean;
}

export interface GateState {
  tainted: boolean;
  localOnly?: boolean;
}

export const LOCAL_ONLY_REASON = 'Local-only mode is on: nothing leaves this machine. Turn it off in the Lair to use this.';

const CLASS0 = new Set([
  'Read', 'Glob', 'Grep', 'ToolSearch', 'NotebookRead',
  'TaskList', 'TaskGet', 'TaskOutput', 'CronList',
  'ReportFindings', 'TodoWrite', 'ExitPlanMode', 'EnterPlanMode',
]);

const CLASS1 = new Set([
  'Skill', 'Agent', 'Task', 'TaskCreate', 'TaskUpdate',
  'Monitor', 'ScheduleWakeup', 'BashOutput',
]);

const CLASS2 = new Set([
  'SendMessage', 'PushNotification', 'RemoteTrigger', 'SendUserFile',
  'CronCreate', 'CronDelete', 'TaskStop', 'KillShell',
  'Workflow', 'EnterWorktree', 'ExitWorktree', 'DesignSync', 'Artifact',
]);

const UNTRUSTED = new Set(['WebFetch', 'WebSearch']);

function norm(p: string): string {
  const win = p.replace(/\//g, '\\').toLowerCase();
  const prefix = /^([a-z]:\\|\\\\[^\\]+\\[^\\]+\\|\\)/.exec(win)?.[1] ?? '';
  const out: string[] = [];
  for (const seg of win.slice(prefix.length).split('\\')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!prefix) out.push('..');
      continue;
    }
    out.push(seg);
  }
  return prefix + out.join('\\');
}

export function isAbsolutePath(p: string, platform: string = process.platform): boolean {
  if (platform !== 'win32' && p.startsWith('/')) return true;
  const win = p.replace(/\//g, '\\');
  return /^[a-zA-Z]:\\/.test(win) || /^\\\\/.test(win);
}

export function resolveSafeDirs(dirs: string[], vars: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const d of dirs) {
    let ok = true;
    const resolved = d.replace(/\$\{([A-Z_]+)\}/g, (_m, name: string) => {
      const v = vars[name]?.trim();
      if (!v) ok = false;
      return v ?? '';
    });
    if (ok && resolved) out.push(resolved);
  }
  return out;
}

function under(target: string, roots: string[]): boolean {
  const t = norm(target);
  return roots.some((r) => {
    const root = norm(r).replace(/\\+$/, '');
    return t === root || t.startsWith(root + '\\');
  });
}

const SHELL_WRITE = new RegExp(
  [
    'set-content', 'add-content', 'out-file', 'copy-item', 'move-item', 'rename-item',
    'new-item', 'set-itemproperty', 'tee-object', 'clear-content',
    '\\bcp\\b', '\\bmv\\b', '\\bdd\\b', '\\btee\\b', '\\btouch\\b', 'sed\\s+-i',
    'node\\s+-e', 'node\\s+--eval', 'python\\s+-c', 'iex\\b', 'invoke-expression',
    'writefilesync', 'writefile', '>>', '>',
  ].join('|'),
  'i',
);

function touchesSelf(cmd: string, selfPaths: string[]): boolean {
  if (!SHELL_WRITE.test(cmd)) return false;
  const c = norm(cmd);
  return selfPaths.some((p) => {
    const abs = norm(p);
    if (abs && c.includes(abs)) return true;
    const cut = abs.lastIndexOf('\\', abs.lastIndexOf('\\') - 1);
    const qualified = cut > 0 ? abs.slice(cut + 1) : '';
    return qualified.length > 3 && c.includes(qualified);
  });
}

function targetPath(input: Record<string, unknown>): string {
  return String(input.file_path ?? input.notebook_path ?? input.path ?? '');
}

function parentDir(target: string): string {
  const n = norm(target).replace(/\\+$/, '');
  const cut = n.lastIndexOf('\\');
  return cut > 0 ? n.slice(0, cut) : n;
}

const TAINT_ESCALATES = /^(web\.|content\.research$|skill\.draft$|workflow\.run$)/;

function sensitivePath(target: string, g: Guardrails): boolean {
  if (!target) return false;
  if (under(target, g.sensitiveReadDirs ?? [])) return true;
  return (g.sensitiveFilePatterns ?? []).some((p) => new RegExp(p, 'i').test(target));
}

function sensitiveInCommand(cmd: string, g: Guardrails): boolean {
  const c = norm(cmd);
  if ((g.sensitiveReadDirs ?? []).some((d) => d && c.includes(norm(d)))) return true;
  if (/~[\\/]\.(ssh|aws|claude|gnupg)\b/i.test(cmd)) return true;
  return (g.sensitiveFilePatterns ?? []).some((p) => new RegExp(p, 'i').test(cmd));
}

export function classify(
  toolName: string,
  input: Record<string, unknown>,
  g: Guardrails,
  state: GateState,
): Classification {
  const c = classifyBase(toolName, input, g, state);
  if (c.denyReason) return c;
  const shellTools = g.shellTools ?? ['Bash', 'PowerShell'];
  if (state.localOnly) {
    const cmd = shellTools.includes(toolName) ? String(input.command ?? '') : '';
    const outward = c.taints === true || /^(web\.|content\.research)/.test(c.laneId)
      || (cmd !== '' && [...(g.taintShellPatterns ?? []), ...(g.localOnlyShellPatterns ?? [])].some((p) => new RegExp(p, 'i').test(cmd)));
    if (outward) return { laneId: c.laneId, riskClass: 3, denyReason: LOCAL_ONLY_REASON };
  }
  if (shellTools.includes(toolName)) {
    const cmd = String(input.command ?? '');
    const pulls = (g.taintShellPatterns ?? []).some((p) => new RegExp(p, 'i').test(cmd));
    const out: Classification = pulls ? { ...c, taints: true } : c;
    if (out.riskClass < 2 && sensitiveInCommand(cmd, g)) {
      return { ...out, laneId: `shell.exec:${toolName.toLowerCase()}:sensitive`, riskClass: 2, question: `Run command that touches credentials: ${cmd}` };
    }
    return out;
  }
  if (CLASS0.has(toolName)) {
    const target = targetPath(input);
    if (sensitivePath(target, g)) {
      return { laneId: 'read.sensitive', riskClass: 2, question: `Read credentials: ${target}` };
    }
    if (target && under(target, g.taintReadDirs ?? [])) return { ...c, taints: true };
    return c;
  }
  if (state.tainted && c.riskClass < 2 && TAINT_ESCALATES.test(c.laneId)) {
    return { ...c, laneId: `${c.laneId}:tainted`, riskClass: 2, question: `${toolName}${describe(input)} (after reading external content)` };
  }
  return c;
}

function classifyBase(
  toolName: string,
  input: Record<string, unknown>,
  g: Guardrails,
  state: GateState,
): Classification {
  const shellTools = g.shellTools ?? ['Bash', 'PowerShell'];
  const selfPaths = g.selfPaths ?? [];

  if (shellTools.includes(toolName)) {
    const cmd = String(input.command ?? '');
    if (g.denyPatterns.some((p) => new RegExp(p, 'i').test(cmd))) {
      return {
        laneId: `shell.exec:${toolName.toLowerCase()}`,
        riskClass: 3,
        denyReason: 'Blocked by Aeryx guardrails — this command is on the deny list.',
      };
    }
    if ((g.selfCommandPatterns ?? []).some((p) => new RegExp(p, 'i').test(cmd))) {
      return {
        laneId: `shell.exec:${toolName.toLowerCase()}:self`,
        riskClass: 3,
        question: `Act on Aeryx itself via ${toolName}: ${cmd}`,
      };
    }
    if (g.confirmPatterns.some((p) => new RegExp(p, 'i').test(cmd))) {
      return {
        laneId: `shell.exec:${toolName.toLowerCase()}:dangerous`,
        riskClass: 2,
        question: `Run command: ${cmd}`,
      };
    }
    if (touchesSelf(cmd, selfPaths)) {
      return {
        laneId: `shell.exec:${toolName.toLowerCase()}:self`,
        riskClass: 3,
        question: `Modify Aeryx's own files via ${toolName}: ${cmd}`,
      };
    }
    if (state.tainted) {
      return {
        laneId: `shell.exec:${toolName.toLowerCase()}:tainted`,
        riskClass: 2,
        question: `Run command (after reading external content): ${cmd}`,
      };
    }
    return { laneId: `shell.exec:${toolName.toLowerCase()}`, riskClass: 1 };
  }

  if (g.confirmTools.includes(toolName)) {
    const target = targetPath(input);
    if (target && !isAbsolutePath(target)) {
      return {
        laneId: 'fs.write:unresolved',
        riskClass: 2,
        question: `Modify file by relative path — cannot be checked against Aeryx's own files: ${target}`,
      };
    }
    if (target && under(target, g.scratchDirs ?? [])) {
      return { laneId: 'fs.scratch', riskClass: 1 };
    }
    if (target && under(target, selfPaths)) {
      return {
        laneId: 'self.modify',
        riskClass: 3,
        question: `Modify Aeryx's own configuration: ${target}`,
      };
    }
    if (target && !under(target, g.confirmOutsideDirs)) {
      return {
        laneId: `fs.write:outside:${parentDir(target)}`,
        riskClass: 2,
        question: `Modify file outside safe dirs: ${target}`,
      };
    }
    if (state.tainted) {
      return {
        laneId: 'fs.write:workspace:tainted',
        riskClass: 2,
        question: `Write file (after reading external content): ${target}`,
      };
    }
    return { laneId: 'fs.write:workspace', riskClass: 1 };
  }

  if (UNTRUSTED.has(toolName)) {
    return { laneId: `web.${toolName.toLowerCase()}`, riskClass: 1, taints: true };
  }
  if (CLASS0.has(toolName)) return { laneId: `read.${toolName}`, riskClass: 0 };
  if (CLASS1.has(toolName)) {
    if (state.tainted) {
      return {
        laneId: `local.${toolName}:tainted`,
        riskClass: 2,
        question: `Run ${toolName} (after reading external content)`,
      };
    }
    return { laneId: `local.${toolName}`, riskClass: 1 };
  }
  if (CLASS2.has(toolName)) {
    return {
      laneId: `outward.${toolName}`,
      riskClass: 2,
      question: `Use ${toolName}${describe(input)}`,
    };
  }

  const wf = /^mcp__aeryx__workflow_([a-z_]+)$/.exec(toolName);
  if (wf) {
    const verb = wf[1]!;
    const what = [input.id !== undefined ? `#${input.id}` : '', input.name ? `"${input.name}"` : '']
      .filter(Boolean).join(' ');
    if (verb === 'list' || verb === 'runs') return { laneId: 'read.workflow', riskClass: 0 };
    if (verb === 'propose') return { laneId: 'workflow.propose', riskClass: 1 };
    if (verb === 'pause') return { laneId: 'workflow.pause', riskClass: 1 };
    if (verb === 'run_now') return { laneId: 'workflow.run', riskClass: 1 };
    if (['approve', 'edit', 'resume', 'delete'].includes(verb)) {
      return {
        laneId: 'workflow.govern',
        riskClass: 2,
        question: `Workflow ${verb}: ${what || 'unnamed'}${input.schedule ? ` — ${input.schedule}` : ''} (details on the status page)`,
      };
    }
  }

  const ag = /^mcp__aeryx__agent_([a-z_]+)$/.exec(toolName);
  if (ag) {
    const verb = ag[1]!;
    const what = [input.id !== undefined ? `#${input.id}` : '', input.slug ? `"${input.slug}"` : '']
      .filter(Boolean).join(' ');
    if (verb === 'list') return { laneId: 'read.agent', riskClass: 0 };
    if (verb === 'propose') return { laneId: 'agent.propose', riskClass: 1 };
    if (verb === 'retire') return { laneId: 'agent.retire', riskClass: 1 };
    if (['approve', 'edit', 'revive'].includes(verb)) {
      return {
        laneId: 'agent.govern',
        riskClass: 2,
        question: `Agent ${verb}: ${what || 'unnamed'} — joins Aeryx's permanent roster at next brain start (details on the status page)`,
      };
    }
  }

  const ab = /^mcp__aeryx__about_me_([a-z_]+)$/.exec(toolName);
  if (ab && ab[1] === 'draft') {
    return { laneId: 'hoard.propose', riskClass: 1 };
  }

  const lz = /^mcp__aeryx__lens_([a-z_]+)$/.exec(toolName);
  if (lz) {
    if (lz[1] === 'show') return { laneId: 'lens.show', riskClass: 1 };
  }

  const extra = classifyMindTool(toolName, input, g, state);
  if (extra) return extra;

  if (toolName.startsWith('mcp__')) {
    const serverKey = toolName.split('__')[1] ?? '';
    const reg = g.mcpRegistry?.[serverKey];
    if (reg) {
      if (reg.enabled === false) {
        return {
          laneId: `mcp.call:${toolName}`,
          riskClass: 3,
          denyReason: `MCP server "${serverKey}" is disabled in the Aeryx registry.`,
        };
      }
      const riskClass = (Math.max(2, Math.min(3, Math.round(reg.minClass ?? 2))) as RiskClass);
      return {
        laneId: `mcp.call:${toolName}`,
        riskClass,
        question: `Use ${toolName}${describe(input)}`,
        taints: reg.taints === true || undefined,
      };
    }
    return {
      laneId: `mcp.call:${toolName}`,
      riskClass: 2,
      question: `Use ${toolName}${describe(input)}`,
      taints: true,
    };
  }
  return {
    laneId: `unknown.tool:${toolName}`,
    riskClass: 2,
    question: `Use ${toolName}${describe(input)}`,
  };
}

function describe(input: Record<string, unknown>): string {
  const cmd = input.command ?? input.query ?? input.url ?? input.prompt;
  const target = targetPath(input);
  if (typeof cmd === 'string' && cmd) return `: ${cmd.slice(0, 120)}`;
  if (target) return `: ${target}`;
  return '';
}

export function stricter(a: Classification, b: Classification): Classification {
  if (a.denyReason) return a;
  if (b.denyReason) return b;
  const pick = b.riskClass > a.riskClass ? b : a;
  return a.taints || b.taints ? { ...pick, taints: true } : pick;
}

export function viaFloor(c: Classification, via: string): Classification {
  if (via !== 'voice' || c.denyReason || c.riskClass >= 2 || !c.laneId.startsWith('shell.exec')) return c;
  return { ...c, laneId: `${c.laneId}:voice`, riskClass: 2, question: c.question ?? 'Run a command you asked for by voice' };
}

export function class3Verdict(hello: string, optedOut: boolean): { allow: boolean; suffix: string } {
  if (hello === 'verified') return { allow: true, suffix: '+hello' };
  if (hello === 'declined') return { allow: false, suffix: ':hello-declined' };
  if (hello === 'unavailable' && optedOut) return { allow: true, suffix: ':ui-only' };
  return { allow: false, suffix: ':hello-unavailable' };
}

export function redactSecrets(text: string): string {
  return text
    .replace(/\bbearer\s+[a-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(
      /\b(setx?|export)(\s+)([a-z0-9_]*(?:pass(?:word)?|secret|token|api[-_]?key|pin|credential)[a-z0-9_]*)(\s+)\S+/gi,
      (_m, verb, s1, name, s2) => `${verb}${s1}${name}${s2}[redacted]`,
    )
    .replace(
      /("?)([a-z0-9_-]*(?:pass(?:word)?|secret|token|api[-_]?key|pin|credential)[a-z0-9_-]*)("?\s*[=:]\s*)("?)([^"\s&;,]{4,})/gi,
      (_m, q1, key, sep, q3) => `${q1}${key}${sep}${q3}[redacted]`,
    )
    .replace(/\b(?:sk|pk|ghp|gho|glpat|xox[bap])[-_][a-z0-9_-]{12,}/gi, '[redacted]')
    .replace(/\bEAA[a-zA-Z0-9]{16,}/g, '[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted private key]')
    .replace(/\b(authorization\s*:\s*)(basic|token|bearer)\s+\S+/gi, '$1$2 [redacted]')
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi, '$1$2:[redacted]@')
    .replace(/(\s-u\s+|\s--user\s+)([^\s:]+):\S+/g, '$1$2:[redacted]')
    .replace(/(--(?:password|passwd|token|api-key|secret)[=\s]+)\S+/gi, '$1[redacted]')
    .replace(/(\bmysql\b[^\n]*?\s-p)(\S+)/g, '$1[redacted]')
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted]')
    .replace(/\b(?:npm_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|hf_[A-Za-z0-9]{20,}|sk-or-v1-[a-f0-9]{20,})/g, '[redacted]');
}

export function auditDetail(input: Record<string, unknown>): string {
  const cmd = input.command;
  if (typeof cmd === 'string') return redactSecrets(cmd).slice(0, 500);
  const target = targetPath(input);
  if (target) return target;
  return redactSecrets(JSON.stringify(input)).slice(0, 500);
}
