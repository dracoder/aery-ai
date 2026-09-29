import fs from 'node:fs';
import path from 'node:path';

export const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const SKIN_FILE = /^\/skins\/([a-z0-9][a-z0-9-]{0,31})\/(core|dragon|human)\.(glb|webp)$/;
export const SKIN_THEMES = ['aeryx', 'aeri', 'violet'] as const;
export const SKIN_FX = ['convergence'] as const;
const BUILT_IN = new Set(['aeryx', 'aeri']);
const FORMS = ['core', 'dragon', 'human'] as const;
const MAX_MODEL = 96 * 1024 * 1024;
const MAX_POSTER = 8 * 1024 * 1024;
const MAX_SKINS = 16;

export interface Skin {
  id: string;
  name: string;
  theme: (typeof SKIN_THEMES)[number];
  forms: string[];
  posters: string[];
  emotes: [string, string][];
  hints: Record<string, string>;
  tag?: string;
  credit?: string;
  fx?: (typeof SKIN_FX)[number];
  tap?: string;
}

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v && v.length <= max && !/[\u0000-\u001f<>]/.test(v) ? v : undefined;
};

const plainFile = (file: string, max: number): boolean => {
  try { const st = fs.lstatSync(file); return st.isFile() && st.size > 0 && st.size <= max; } catch { return false; }
};

export function readSkin(dir: string, id: string): Skin | null {
  if (!SKIN_ID.test(id) || BUILT_IN.has(id)) return null;
  const base = path.join(dir, id);
  let raw: Record<string, unknown>;
  try {
    if (!fs.lstatSync(base).isDirectory() || !plainFile(path.join(base, 'skin.json'), 64 * 1024)) return null;
    raw = JSON.parse(fs.readFileSync(path.join(base, 'skin.json'), 'utf-8'));
  } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = text(raw.name, 24);
  if (!name) return null;
  const forms = FORMS.filter((f) => plainFile(path.join(base, `${f}.glb`), MAX_MODEL));
  if (!forms.length) return null;
  const emotes = (Array.isArray(raw.emotes) ? raw.emotes : [])
    .filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === 'string' && /^[a-z0-9_-]{1,24}$/.test(e[0]) && !!text(e[1], 16))
    .slice(0, 6)
    .map(([clip, label]) => [clip, text(label, 16)!] as [string, string]);
  const hints: Record<string, string> = {};
  const rawHints = raw.hints && typeof raw.hints === 'object' ? raw.hints as Record<string, unknown> : {};
  for (const f of forms) { const h = text(rawHints[f], 40); if (h) hints[f] = h; }
  const theme = SKIN_THEMES.find((t) => t === raw.theme) ?? 'aeryx';
  const fx = SKIN_FX.find((t) => t === raw.fx);
  const tap = emotes.find(([clip]) => clip === raw.tap)?.[0];
  return {
    id, name, theme, forms,
    posters: forms.filter((f) => plainFile(path.join(base, `${f}.webp`), MAX_POSTER)),
    emotes, hints,
    ...(text(raw.tag, 20) ? { tag: text(raw.tag, 20) } : {}),
    ...(text(raw.credit, 160) ? { credit: text(raw.credit, 160) } : {}),
    ...(fx ? { fx } : {}),
    ...(tap ? { tap } : {}),
  };
}

export function listSkins(dir: string): Skin[] {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => SKIN_ID.test(n)).sort().slice(0, MAX_SKINS).map((n) => readSkin(dir, n)).filter((s): s is Skin => !!s);
}

export function skinFile(dir: string, pathname: string): string | null {
  const m = SKIN_FILE.exec(pathname);
  if (!m) return null;
  const [, id, form, ext] = m as unknown as [string, string, string, string];
  const skin = readSkin(dir, id);
  if (!skin || !(ext === 'glb' ? skin.forms : skin.posters).includes(form)) return null;
  return path.join(dir, id, `${form}.${ext}`);
}
