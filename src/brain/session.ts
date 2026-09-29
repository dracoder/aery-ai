import * as path from 'node:path';
import { MIND_PLUGIN_ROOTS } from '../daemon/mind-organs';

export type EffortName = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface PluginRef {
  type: 'local';
  path: string;
}

export interface SessionShape {
  cwd: string;
  model: string;
  effort: EffortName;
  maxTurns: number;
  settingSources: never[];
  skills: 'all';
  plugins: PluginRef[];
  disallowedTools: string[];
}

export const NO_TERMINAL_TOOLS = ['AskUserQuestion'];
export const DEFAULT_MODEL = 'opus';
export const DEFAULT_EFFORT: EffortName = 'xhigh';
export const DEFAULT_MAX_TURNS = 400;
const MAX_TURNS_CEILING = 5000;

const EFFORTS: readonly EffortName[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function brainWorkspace(config: any, home: string): string {
  const w = config?.brain?.workspace;
  return typeof w === 'string' && path.isAbsolute(w) ? w : path.join(home, 'AeryxWorkspace');
}

export function sessionShape(root: string, cwd: string, env: NodeJS.ProcessEnv = {}): SessionShape {
  const effort = env.AERYX_EFFORT as EffortName | undefined;
  const turns = Number(env.AERYX_MAX_TURNS);
  return {
    cwd,
    model: env.AERYX_MODEL?.trim() || DEFAULT_MODEL,
    effort: effort && EFFORTS.includes(effort) ? effort : DEFAULT_EFFORT,
    maxTurns: Number.isFinite(turns) && turns >= 1 ? Math.min(turns, MAX_TURNS_CEILING) : DEFAULT_MAX_TURNS,
    settingSources: [],
    skills: 'all',
    plugins: [
      { type: 'local', path: path.resolve(root) },
      ...MIND_PLUGIN_ROOTS.map((rel) => ({ type: 'local' as const, path: path.resolve(root, rel) })),
    ],
    disallowedTools: [...NO_TERMINAL_TOOLS],
  };
}

const MANIFEST_KEYS = new Set(['name', 'version', 'description', 'author', 'homepage', 'license', 'keywords']);

export function pluginRootIssue(entries: string[], manifest: unknown): string | null {
  for (const bad of ['hooks', '.mcp.json']) {
    if (entries.includes(bad)) return `plugin root carries ${bad} — it would run outside the Chain`;
  }
  if (manifest === undefined || manifest === null) return null;
  if (typeof manifest !== 'object' || Array.isArray(manifest)) return 'plugin.json is not an object';
  const extra = Object.keys(manifest).filter((k) => !MANIFEST_KEYS.has(k));
  return extra.length ? `plugin.json declares ${extra.join(', ')} — only descriptive keys are allowed` : null;
}

export function sessionShapeIssue(shape: SessionShape, root: string): string | null {
  if (!Array.isArray(shape.settingSources) || shape.settingSources.length) {
    return 'settingSources must be empty — filesystem settings carry hooks, and a hook never reaches canUseTool';
  }
  if ('hooks' in shape) return 'the session must never declare hooks';
  if (!shape.plugins.length) return 'no plugin — the skill library would be unreachable';
  for (const p of shape.plugins) {
    if (p.type !== 'local') return `plugin type "${p.type}" is not local — only this repo may extend him`;
    if (!path.isAbsolute(p.path)) return `plugin path is not absolute: ${p.path}`;
    const rel = path.relative(path.resolve(root), path.resolve(p.path));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return `plugin path escapes the install root: ${p.path}`;
  }
  if (!NO_TERMINAL_TOOLS.every((t) => shape.disallowedTools?.includes(t))) return 'the terminal-only question tool must stay disallowed';
  if (shape.maxTurns < 1 || shape.maxTurns > MAX_TURNS_CEILING) return `maxTurns ${shape.maxTurns} is outside 1..${MAX_TURNS_CEILING}`;
  if (!EFFORTS.includes(shape.effort)) return `effort "${shape.effort}" is not a known level`;
  return null;
}
