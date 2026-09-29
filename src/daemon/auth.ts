import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface RemoteConfig {
  enabled: boolean;
  pin: string | null;
  pinHash: string | null;
  bind: string;
  allowLan: boolean;
}

export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60_000;
export const GLOBAL_LOCK_AFTER = 25;
export const MAX_SOURCES = 200;
export const TOKEN_TTL_MS = 12 * 60 * 60_000;
export const MAX_SESSIONS = 20;

export function readRemoteConfig(raw: any, env: Record<string, string | undefined> = {}): RemoteConfig {
  const block = raw?.remote ?? {};
  const envPin = String(env.AERYX_REMOTE_PIN ?? '').trim();
  const pin = envPin || (typeof block.pin === 'string' ? block.pin.trim() : '');
  const hash = typeof block.pinHash === 'string' ? block.pinHash.trim() : '';
  return {
    enabled: block.enabled === true || Boolean(envPin),
    pin: pin.length >= 6 ? pin : null,
    pinHash: validPinHash(hash) ? hash : null,
    bind: typeof block.bind === 'string' && block.bind.trim() ? block.bind.trim() : '127.0.0.1',
    allowLan: block.allowLan === true,
  };
}

const WILDCARD = new Set(['0.0.0.0', '::', '*']);

export function port80Wanted(raw: any): boolean {
  return raw?.remote?.enabled === true && raw?.remote?.port80 === true;
}

export function hasPin(cfg: RemoteConfig): boolean {
  return Boolean(cfg.pinHash || cfg.pin);
}

export function resolveBind(cfg: RemoteConfig): string {
  if (!cfg.enabled || !hasPin(cfg)) return '127.0.0.1';
  if (WILDCARD.has(cfg.bind) && !cfg.allowLan) return '127.0.0.1';
  return cfg.bind;
}

export function isLocalAddress(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export const PUBLIC_PREFIXES = ['/lair', '/orb.js', '/fonts/'];

export function bearerToken(authorization: string | undefined): string | undefined {
  const h = String(authorization ?? '');
  return h.startsWith('Bearer ') ? h.slice(7) : undefined;
}

export function remoteAllowed(
  state: AuthState,
  remoteAddress: string | undefined,
  pathname: string,
  headers: { authorization?: string; cookie?: string },
  now = Date.now(),
): boolean {
  if (isLocalAddress(remoteAddress)) return true;
  if (pathname === '/auth') return true;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : p + '/'))) return true;
  return validToken(state, bearerToken(headers.authorization) ?? tokenFromCookie(headers.cookie), now);
}

const OWN_NAMES = new Set(['localhost', '127.0.0.1', '::1']);

function hostOf(value: string): string {
  const noScheme = value.replace(/^[a-z]+:\/\//i, '').split('/')[0];
  const noPort = noScheme.replace(/:\d+$/, '');
  return noPort.replace(/^\[|\]$/g, '').toLowerCase();
}

function nameAllowed(name: string, extraNames: readonly string[]): boolean {
  if (!name) return false;
  if (OWN_NAMES.has(name) || extraNames.includes(name)) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || (/^[0-9a-f:]+$/.test(name) && (name.match(/:/g) ?? []).length >= 2);
}

export function extraHostNames(remote: any): string[] {
  if (remote?.enabled !== true || !Array.isArray(remote.hostNames)) return [];
  return remote.hostNames
    .map((n: unknown) => String(n).trim().toLowerCase())
    .filter((n: string) => /^[a-z0-9][a-z0-9.-]{0,252}$/.test(n));
}

export function crossOriginRefusal(
  method: string | undefined,
  headers: Record<string, string | string[] | undefined>,
  extraNames: readonly string[] = [],
): string | null {
  const one = (k: string) => {
    const v = headers[k];
    return String((Array.isArray(v) ? v[0] : v) ?? '');
  };

  if (!nameAllowed(hostOf(one('host')), extraNames)) return 'unrecognised Host';

  const site = one('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return 'cross-site request';

  const origin = one('origin');
  if (origin && !nameAllowed(hostOf(origin), extraNames)) return 'cross-origin request';

  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(String(method ?? 'GET').toUpperCase());
  if (mutating) {
    const ct = one('content-type').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return 'body must be application/json';
  }
  return null;
}

interface SourceFailures {
  count: number;
  lastAt: number;
  lockedUntil: number;
}

export interface AuthState {
  failures: Map<string, SourceFailures>;
  globalLockedUntil: number;
  sessions: Map<string, number>;
}

export const freshAuthState = (): AuthState => ({ failures: new Map(), globalLockedUntil: 0, sessions: new Map() });

function pruneFailures(state: AuthState, now: number): void {
  for (const [src, f] of state.failures) {
    if (now >= f.lockedUntil && now - f.lastAt > LOCK_MS) state.failures.delete(src);
  }
  while (state.failures.size > MAX_SOURCES) {
    const oldest = state.failures.keys().next().value as string;
    state.failures.delete(oldest);
  }
}

function digest(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

export function pinsMatch(expected: string, attempt: string): boolean {
  return timingSafeEqual(digest(expected), digest(attempt));
}

const SCRYPT_KEYLEN = 32;
const SCRYPT_N = 16384;

export function validPinHash(s: unknown): boolean {
  return /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(String(s ?? ''));
}

export function hashPin(pin: string, salt = randomBytes(16).toString('hex')): string {
  const key = scryptSync(String(pin), salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export function pinHashMatches(stored: string, attempt: string): boolean {
  if (!validPinHash(stored)) return false;
  const [, salt, want] = stored.split('$');
  const got = scryptSync(String(attempt ?? ''), salt!, SCRYPT_KEYLEN, { N: SCRYPT_N }).toString('hex');
  return timingSafeEqual(Buffer.from(want!, 'hex'), Buffer.from(got, 'hex'));
}

export function pinAccepted(cfg: RemoteConfig, attempt: string): boolean {
  if (cfg.pinHash) return pinHashMatches(cfg.pinHash, attempt);
  if (cfg.pin) return pinsMatch(cfg.pin, String(attempt ?? ''));
  return false;
}

export function validNewPin(pin: unknown): pin is string {
  const s = String(pin ?? '');
  return s.length >= 8 && s.length <= 128 && s.trim() === s && !/[\r\n]/.test(s) && !/^\d+$/.test(s);
}

export function applyPinToConfig(cfg: any, pinHash: string): any {
  if (!validPinHash(pinHash)) throw new Error('refusing to store something that is not a scrypt hash');
  const base = cfg && typeof cfg === 'object' ? cfg : {};
  const remote = { ...(base.remote ?? {}), pinHash };
  delete (remote as any).pin;
  return { ...base, remote };
}

export type PinResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; reason: 'locked' | 'wrong-pin' | 'no-pin-configured'; retryAfterMs?: number };

export function tryPin(
  state: AuthState,
  cfg: RemoteConfig,
  attempt: string,
  source: string | undefined,
  now = Date.now(),
  makeToken: () => string = () => randomBytes(32).toString('hex'),
): PinResult {
  if (!hasPin(cfg)) return { ok: false, reason: 'no-pin-configured' };
  const src = String(source ?? 'unknown');
  pruneFailures(state, now);
  if (now < state.globalLockedUntil) {
    return { ok: false, reason: 'locked', retryAfterMs: state.globalLockedUntil - now };
  }
  const f = state.failures.get(src);
  if (f && now < f.lockedUntil) {
    return { ok: false, reason: 'locked', retryAfterMs: f.lockedUntil - now };
  }
  if (!pinAccepted(cfg, String(attempt ?? ''))) {
    const next: SourceFailures = { count: (f?.count ?? 0) + 1, lastAt: now, lockedUntil: f?.lockedUntil ?? 0 };
    if (next.count >= LOCK_AFTER) {
      next.count = 0;
      next.lockedUntil = now + LOCK_MS;
    }
    state.failures.set(src, next);
    let total = 0;
    for (const v of state.failures.values()) total += v.count === 0 && v.lockedUntil > now ? LOCK_AFTER : v.count;
    if (total >= GLOBAL_LOCK_AFTER) {
      state.globalLockedUntil = now + LOCK_MS;
      state.failures.clear();
      return { ok: false, reason: 'locked', retryAfterMs: LOCK_MS };
    }
    return next.lockedUntil > now
      ? { ok: false, reason: 'locked', retryAfterMs: LOCK_MS }
      : { ok: false, reason: 'wrong-pin' };
  }
  state.failures.delete(src);
  evictExpiredSessions(state, now);
  const token = makeToken();
  const expiresAt = now + TOKEN_TTL_MS;
  state.sessions.set(token, expiresAt);
  while (state.sessions.size > MAX_SESSIONS) {
    const oldest = state.sessions.keys().next().value as string;
    state.sessions.delete(oldest);
  }
  return { ok: true, token, expiresAt };
}

export function brainTokenOk(expected: string, presented: string): boolean {
  if (!expected || !presented) return false;
  return pinsMatch(expected, presented);
}

export function tokenFromCookie(cookieHeader: string | undefined): string | undefined {
  const m = /(?:^|;\s*)aeryx=([a-f0-9]{64})(?:;|$)/.exec(cookieHeader ?? '');
  return m?.[1];
}

export function evictExpiredSessions(state: AuthState, now = Date.now()): void {
  for (const [t, exp] of state.sessions) {
    if (now >= exp) state.sessions.delete(t);
  }
}

export function revokeToken(state: AuthState, token: string | undefined): boolean {
  return token ? state.sessions.delete(token) : false;
}

export function revokeAllSessions(state: AuthState): number {
  const n = state.sessions.size;
  state.sessions.clear();
  return n;
}

export function validToken(state: AuthState, token: string | undefined, now = Date.now()): boolean {
  evictExpiredSessions(state, now);
  return token !== undefined && state.sessions.has(token);
}

export const HOARD_FILES = ['user.md', 'learned.md', 'persona.md'] as const;
export const HOARD_EDITABLE = new Set<string>(['user.md']);
export const MAX_HOARD_BYTES = 64 * 1024;

export function validateHoardWrite(file: string, content: unknown): string | null {
  if (!HOARD_EDITABLE.has(file)) {
    return (HOARD_FILES as readonly string[]).includes(file)
      ? `${file} is not editable from the Lair — learned.md is machine-appended, persona.md is Aeryx himself`
      : 'no such hoard file';
  }
  if (typeof content !== 'string') return 'content must be a string';
  if (Buffer.byteLength(content, 'utf-8') > MAX_HOARD_BYTES) return `too large (max ${MAX_HOARD_BYTES / 1024}KB)`;
  return null;
}
