import path from 'node:path';
import { MIND_CORE_CAPABILITIES, MIND_DESKTOP_CAPABILITIES, MIND_QUEUEABLE } from './mind-organs';

export type Role = 'core' | 'session' | 'both';

export function daemonRole(argv: readonly string[], config?: any): Role {
  const flag = findRoleFlag(argv);
  const named = flag ?? config?.residency?.role;
  return named === 'core' || named === 'session' || named === 'both' ? named : 'both';
}

function findRoleFlag(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] ?? '');
    if (a === '--role' && i + 1 < argv.length) return String(argv[i + 1]);
    const inline = /^--role=(.+)$/.exec(a);
    if (inline) return inline[1];
  }
  return null;
}

export const DESKTOP_CAPABILITIES = ['mic', 'hello', ...MIND_DESKTOP_CAPABILITIES] as const;
export type Capability = string;

export function needsDesktop(capability: string): boolean {
  return !CORE_CAPABILITIES.has(String(capability));
}

const CORE_CAPABILITIES = new Set([
  'brain', 'workflow', 'news', 'hoard', 'audit', 'speech', 'backup', 'http',
  ...MIND_CORE_CAPABILITIES,
]);

export function roleRuns(role: Role, capability: string): boolean {
  if (role === 'both') return true;
  return role === 'session' ? needsDesktop(capability) : !needsDesktop(capability);
}

export function sessionTokenPath(root: string): string {
  return path.join(root, 'secrets', 'session.token');
}

export interface AttachedSession {
  id: string;
  lastBeatMs: number;
  capabilities: readonly string[];
  port: number;
  callbackToken: string;
}

export const SESSION_STALE_MS = 35_000;

export function sessionAttached(session: AttachedSession | null | undefined, nowMs: number): boolean {
  if (!session || typeof session.lastBeatMs !== 'number') return false;
  if (!Number.isFinite(nowMs)) return false;
  const age = nowMs - session.lastBeatMs;
  return age >= 0 && age <= SESSION_STALE_MS;
}

const QUEUEABLE = new Set<string>(MIND_QUEUEABLE);

export function queueable(capability: string): boolean {
  return QUEUEABLE.has(String(capability));
}

export interface CapabilityVerdict {
  ok: boolean;
  reason: string;
  queue: boolean;
}

export function capabilityAvailable(
  capability: string,
  role: Role,
  session: AttachedSession | null | undefined,
  nowMs: number,
): CapabilityVerdict {
  if (!needsDesktop(capability)) return { ok: true, reason: '', queue: false };

  if (role === 'both') return { ok: true, reason: '', queue: false };

  if (role === 'session') return { ok: true, reason: '', queue: false };

  const canWait = queueable(capability);
  const held = canWait ? " I'll hold it until a desk is there." : '';

  if (!sessionAttached(session, nowMs)) {
    return {
      ok: false,
      queue: canWait,
      reason: `I can think, but I can't reach the screen — nobody is signed in at the machine, so ${capability} has nowhere to land.${held}`,
    };
  }

  if (!session!.capabilities.includes(capability)) {
    return {
      ok: false,
      queue: canWait,
      reason: `Someone is signed in, but the desk isn't offering ${capability} right now — a locked screen does this.${held}`,
    };
  }

  return { ok: true, reason: '', queue: false };
}

export function validSessionRegistration(body: any): { id: string; capabilities: string[]; port: number } | null {
  const id = String(body?.id ?? '');
  if (!/^[a-z0-9-]{8,64}$/i.test(id)) return null;
  const raw = body?.capabilities;
  if (!Array.isArray(raw)) return null;
  const port = Number(body?.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  const caps = raw
    .map((c: unknown) => String(c ?? ''))
    .filter((c: string) => (DESKTOP_CAPABILITIES as readonly string[]).includes(c));
  return { id, capabilities: Array.from(new Set(caps)), port };
}

export function deskEndpoint(port: number, verb: string): string {
  return `http://127.0.0.1:${port}/desk/${encodeURIComponent(verb)}`;
}

export function sessionStatus(role: Role, session: AttachedSession | null | undefined, nowMs: number) {
  const attached = role === 'both' ? true : sessionAttached(session, nowMs);
  const agent = sessionAttached(session, nowMs) ? session!.id : null;
  return {
    role,
    attached,
    agent,
    capabilities: role === 'both'
      ? [...DESKTOP_CAPABILITIES]
      : attached ? [...(session!.capabilities)] : [],
    lastBeatMs: session?.lastBeatMs ?? null,
    hands: attached
      ? 'the desk is there'
      : 'no desk — thinking only until someone signs in',
  };
}
