import { DESKTOP_CAPABILITIES, type Capability } from '../daemon/core';

export const HEARTBEAT_MS = 10_000;

export function agentId(random: string): string {
  const clean = String(random).replace(/[^a-z0-9]/gi, '').slice(0, 40);
  return `desk-${clean || 'anonymous'}`;
}

export function deskCapabilities(platform: string, locked: boolean): Capability[] {
  if (platform !== 'win32') return [];
  if (!locked) return [...DESKTOP_CAPABILITIES];
  return ['mic', 'hello'];
}

export function deskRefusal(capability: string, locked: boolean): string {
  if (locked) {
    return `The screen is locked, so ${capability} would only reach the lock screen, not your actual desktop — I'd be acting on the wrong picture. I haven't tried it.`;
  }
  return `This desk isn't offering ${capability} right now, so I haven't tried it.`;
}
