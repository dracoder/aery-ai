export type Tier = 'ask' | 'session' | 'standing';

const ORDER: Tier[] = ['ask', 'session', 'standing'];

export interface LadderPolicy {
  enabled: boolean;
  streakTarget: number;
  standingTarget: number;
  neverPromote: string[];
}

export const DEFAULT_LADDER: LadderPolicy = {
  enabled: true,
  streakTarget: 3,
  standingTarget: 8,
  neverPromote: ['self.modify', 'shell.exec:*:dangerous', 'shell.exec:*:tainted'],
};

export interface LaneState {
  tier: Tier;
  streak: number;
  standingPending: boolean;
  standingDeclined: boolean;
}

export const freshLane = (): LaneState => ({
  tier: 'ask',
  streak: 0,
  standingPending: false,
  standingDeclined: false,
});

export type LadderEffect =
  | { kind: 'none' }
  | { kind: 'promoted'; to: Tier }
  | { kind: 'propose-standing' }
  | { kind: 'demoted'; from: Tier; to: Tier };

export interface LadderResult {
  lane: LaneState;
  effect: LadderEffect;
}

const NONE = { kind: 'none' } as const;

export function prevTier(t: Tier): Tier | null {
  const i = ORDER.indexOf(t);
  return i > 0 ? ORDER[i - 1]! : null;
}

function laneMatches(laneId: string, pattern: string): boolean {
  const rx = pattern
    .split('*')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^:]*');
  return new RegExp(`^${rx}$`, 'i').test(laneId);
}

export const NEVER_SCOPABLE = [
  'workflow.govern',
  'agent.govern',
  'server.*',
  'molt.*',
  'self.modify',
  'shell.exec:*:self',
  'shell.exec:*:dangerous',
  'hoard.learn',
  'skill.*',
  'ladder.*',
  'daemon.*',
  'content.learn',
  'publish.send',
  'focus.set',
  'suggest.accept',
  '*:tainted',
] as const;

export function neverScopable(laneId: string): boolean {
  const l = String(laneId).toLowerCase();
  if (l === 'workflow.govern' || l === 'agent.govern' || l === 'self.modify' || l === 'hoard.learn') return true;
  if (l === 'content.learn' || l === 'publish.send') return true;
  if (l === 'focus.set' || l === 'suggest.accept') return true;
  if (/^(ladder|daemon|molt|server|skill)\./.test(l)) return true;
  if (/^shell\.exec:.*:(self|dangerous)$/.test(l)) return true;
  if (l.endsWith(':tainted')) return true;
  return false;
}

export function validScopePattern(pattern: unknown): boolean {
  const p = String(pattern ?? '').trim();
  if (!p || p.length > 64) return false;
  if (!/^[a-z0-9.:*_-]+$/i.test(p)) return false;
  if (p.replace(/[*:.]/g, '') === '') return false;
  return true;
}

export function scopeAllows(laneId: string, scope: readonly string[]): boolean {
  if (neverScopable(laneId)) return false;
  return scope.some((pat) => validScopePattern(pat) && laneMatches(laneId, pat));
}

export function eligible(laneId: string, riskClass: number, p: LadderPolicy): boolean {
  if (!p.enabled) return false;
  if (riskClass >= 3) return false;
  return !p.neverPromote.some((pat) => laneMatches(laneId, pat));
}

export function onDecision(lane: LaneState, approved: boolean, p: LadderPolicy): LadderResult {
  if (!approved) return demote(lane);

  const streak = lane.streak + 1;
  if (lane.tier === 'ask' && streak >= p.streakTarget) {
    return {
      lane: { ...lane, tier: 'session', streak: 0 },
      effect: { kind: 'promoted', to: 'session' },
    };
  }
  return { lane: { ...lane, streak }, effect: NONE };
}

export function onAutoUse(lane: LaneState, p: LadderPolicy): LadderResult {
  if (lane.tier !== 'session') return { lane, effect: NONE };

  const streak = lane.streak + 1;
  const ripe = streak >= p.standingTarget && !lane.standingPending && !lane.standingDeclined;
  return {
    lane: { ...lane, streak, standingPending: ripe || lane.standingPending },
    effect: ripe ? { kind: 'propose-standing' } : NONE,
  };
}

export function onStandingResponse(lane: LaneState, accept: boolean | null): LadderResult {
  if (!lane.standingPending) return { lane, effect: NONE };
  if (accept === null) return { lane: { ...lane, standingPending: false }, effect: NONE };
  if (!accept) {
    return {
      lane: { ...lane, standingPending: false, standingDeclined: true, streak: 0 },
      effect: NONE,
    };
  }
  return {
    lane: { ...lane, tier: 'standing', streak: 0, standingPending: false },
    effect: { kind: 'promoted', to: 'standing' },
  };
}

export function demote(lane: LaneState): LadderResult {
  const from = lane.tier;
  const to = prevTier(from) ?? from;
  return {
    lane: { ...lane, tier: to, streak: 0, standingPending: false },
    effect: from === to ? NONE : { kind: 'demoted', from, to },
  };
}

export function revoke(lane: LaneState): LadderResult {
  const from = lane.tier;
  return {
    lane: { ...freshLane(), standingDeclined: lane.standingDeclined },
    effect: from === 'ask' ? NONE : { kind: 'demoted', from, to: 'ask' },
  };
}

export const LADDER_VERDICT = {
  session: 'ladder:granted-session',
  standing: 'ladder:granted-standing',
  declined: 'ladder:declined-standing',
  demoted: 'ladder:demoted',
  revoked: 'ladder:revoked',
} as const;

export interface LadderRow {
  tool: string;
  lane: string;
  verdict: string;
}

export function replayLanes(
  rows: LadderRow[],
  p: LadderPolicy,
  chainIntact: boolean,
): Map<string, LaneState> {
  const lanes = new Map<string, LaneState>();
  if (!p.enabled || !chainIntact) return lanes;

  const get = (id: string) => lanes.get(id) ?? freshLane();
  for (const row of rows) {
    if (row.tool !== 'ladder' || !row.lane) continue;
    const lane = get(row.lane);
    switch (row.verdict) {
      case LADDER_VERDICT.standing:
        lanes.set(row.lane, { ...freshLane(), tier: 'standing' });
        break;
      case LADDER_VERDICT.declined:
        lanes.set(row.lane, { ...lane, standingDeclined: true });
        break;
      case LADDER_VERDICT.demoted:
      case LADDER_VERDICT.revoked:
        lanes.set(row.lane, { ...freshLane(), standingDeclined: lane.standingDeclined });
        break;
      default:
        break;
    }
  }

  for (const [id, lane] of lanes) {
    if (lane.tier !== 'ask' && !eligible(id, 2, p)) {
      lanes.set(id, { ...freshLane(), standingDeclined: lane.standingDeclined });
    }
  }
  return lanes;
}

export function laneLabel(laneId: string): string {
  const [head, ...rest] = laneId.split(':');
  const tail = rest.join(':');
  switch (head) {
    case 'fs.write':
      return tail.startsWith('outside:') ? `writing to ${tail.slice(8)}` : 'writing files';
    case 'shell.exec':
      return `${rest[0] ?? 'shell'} commands`;
    case 'self.modify':
      return 'editing his own configuration';
    case 'workflow.govern':
      return 'changing workflows';
    case 'workflow.propose':
      return 'proposing workflows';
    case 'workflow.pause':
      return 'pausing workflows';
    case 'workflow.run':
      return 'running workflows on demand';
    case 'agent.govern':
      return 'changing his agent roster';
    case 'agent.propose':
      return 'proposing agents';
    case 'agent.retire':
      return 'retiring agents';
    case 'content.read':
      return 'reading the content library';
    case 'content.propose':
      return 'drafting content';
    case 'content.research':
      return 'researching sources';
    case 'content.visuals':
      return 'generating visuals';
    case 'content.learn':
      return 'growing the style profile';
    case 'lens.show':
      return 'putting a panel on the Lens';
    case 'talon.look':
      return 'looking at the screen';
    case 'talon.move':
      return 'moving the pointer';
    case 'talon.act':
      return 'acting on the screen';
    default:
      if (head.startsWith('outward.')) return `using ${head.slice(8)}`;
      if (head === 'mcp.call' || head === 'unknown.tool') return `using ${tail || head}`;
      return laneId;
  }
}
