import * as fs from 'node:fs';

export interface Usage {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
}

type Basis = 'estimate' | 'free' | 'provider';
type Day = Usage & { byKind?: Record<string, number> };

const ZERO: Usage = { turns: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0 };
const KEEP_DAYS = 90;

const count = (v: unknown, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};

export function sanitizeUsage(msg: any): Usage {
  return {
    turns: 1,
    inputTokens: Math.round(count(msg?.inputTokens, 10_000_000)),
    outputTokens: Math.round(count(msg?.outputTokens, 10_000_000)),
    cacheTokens: Math.round(count(msg?.cacheTokens, 100_000_000)),
    costUsd: count(msg?.costUsd, 1_000),
  };
}

export function costDelta(prevTotal: number, total: unknown): { delta: number; total: number } {
  const t = Number(total);
  if (!Number.isFinite(t) || t < 0) return { delta: 0, total: prevTotal };
  return { delta: t >= prevTotal ? t - prevTotal : t, total: t };
}

function read(file: string): Record<string, Day> {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

const add = (a: Usage, b: Usage): Usage => ({
  turns: a.turns + b.turns,
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheTokens: a.cacheTokens + b.cacheTokens,
  costUsd: a.costUsd + b.costUsd,
});

export function addUsage(file: string, day: string, u: Usage, kind: string | null = null): void {
  const all = read(file);
  const byKind = { ...(all[day]?.byKind ?? {}) };
  if (kind) byKind[kind] = (byKind[kind] ?? 0) + u.costUsd;
  all[day] = { ...add({ ...ZERO, ...all[day] }, u), ...(Object.keys(byKind).length ? { byKind } : {}) };
  const days = Object.keys(all).sort();
  for (const old of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete all[old];
  fs.writeFileSync(file, JSON.stringify(all));
}

export function summarize(file: string, today: string, windowStart: string): { today: Usage; window: Usage; todayByBasis: Partial<Record<Basis, number>> } {
  const all = read(file);
  let window = { ...ZERO };
  for (const [day, u] of Object.entries(all)) if (day >= windowStart) window = add(window, { ...ZERO, ...u });
  const { byKind, ...t } = { ...ZERO, ...all[today] };
  const todayByBasis: Partial<Record<Basis, number>> = {};
  let tagged = 0;
  for (const [kind, c] of Object.entries(byKind ?? {})) {
    const cost = count(c, 1_000);
    tagged += cost;
    const b = costBasis(kind);
    todayByBasis[b] = (todayByBasis[b] ?? 0) + cost;
  }
  const untagged = t.costUsd - tagged;
  if (untagged > 1e-9) todayByBasis.estimate = (todayByBasis.estimate ?? 0) + untagged;
  return { today: t, window, todayByBasis };
}

export function costBasis(kind: string | null): Basis {
  if (kind === 'local') return 'free';
  if (kind === 'openrouter' || kind === 'codex') return 'provider';
  return 'estimate';
}
