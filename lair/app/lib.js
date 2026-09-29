'use client';

import { createContext, useContext } from 'react';
import { PERSONA_PRONOUNS } from './CharacterStage';
import { isDemo, demoFetch } from './demo';

let notifyLocked = () => {};
export const onLocked = (fn) => { notifyLocked = fn; };

export const call = (p, init) => (isDemo() ? demoFetch(p, init) : fetch(p, init));
export const get = (p) =>
  call(p).then((r) => {
    if (r.status === 401) { notifyLocked(); throw new Error('PIN required'); }
    return r.json();
  });
export const post = (p, body) =>
  call(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => {
    if (r.status === 401) notifyLocked();
    return r;
  });

export const decide = (p, body) =>
  post(p, body).then(async (r) => {
    if (r.ok) return null;
    const detail = await r.json().catch(() => ({}));
    return detail.error ?? `that didn't go through (${r.status})`;
  }).catch(() => 'the daemon did not answer');

export const fmtTs = (iso) =>
  iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const winOnly = (status, id) => status?.windowsOnly?.includes(id) === true;
export const NEEDS_HELLO = 'needs Windows Hello — Windows only for now';
export const LOCAL_ONLY = 'sit at the machine — this one needs Windows Hello';

export const leftWords = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`) + ' left to answer';

export const whoOf = (name, persona) => ({ name, NAME: name.toUpperCase(), ...(PERSONA_PRONOUNS[persona] ?? PERSONA_PRONOUNS.aeryx) });
export const WhoContext = createContext(whoOf('Aeryx', 'aeryx'));
export const useWho = () => useContext(WhoContext);
