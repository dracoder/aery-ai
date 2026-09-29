import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LAIR_CSS = ['lair/app/globals.css', 'lair/app/deck.css', 'lair/app/responsive.css'];
export const LAIR_PALETTE = 'lair/app/persona.css';
export const PAGES = ['src/client/hud.html', 'src/client/lens.html', 'src/client/status.html', 'src/client/quick.html', 'src/client/orb.html'];

const HUE_MAP = [[178, 20], [188, 14], [200, 4], [214, -4], [236, -12], [268, -20]];
const VIOLET_MAP = [[178, 256], [188, 260], [200, 266], [214, 272], [236, 280], [268, 290]];

function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

export const isThemed = (r, g, b) => { const [h, s] = hsl(r, g, b); return s >= .12 && h >= HUE_MAP[0][0] && h <= HUE_MAP.at(-1)[0]; };

function remap(map, r, g, b) {
  const [h, s, l] = hsl(r, g, b);
  let i = 1;
  while (i < map.length - 1 && h > map[i][0]) i++;
  const [h0, t0] = map[i - 1], [h1, t1] = map[i];
  const hue = t0 + (t1 - t0) * Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
  if (l > .82) return rgb(hue, s * .55, l);
  if (l < .3) return rgb(hue, s * .8, l * .88);
  return rgb(hue, Math.min(1, s * 1.06), l);
}

export const aeri = (r, g, b) => remap(HUE_MAP, r, g, b);
export const violet = (r, g, b) => remap(VIOLET_MAP, r, g, b);

const hex = (c) => c.map((v) => v.toString(16).padStart(2, '0')).join('');
const COLOR = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+%?)\s*)?\)/g;

function convertColors(text) {
  return text.replace(COLOR, (m, h, r, g, b, a) => {
    let c, alpha = a;
    if (h) {
      const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h;
      c = [0, 2, 4].map((k) => parseInt(full.slice(k, k + 2), 16));
      if (full.length === 8) alpha = +(parseInt(full.slice(6), 16) / 255).toFixed(3) + '';
    } else c = [+r, +g, +b];
    if (!isThemed(...c)) return m;
    return alpha === undefined ? `rgb(var(--c-${hex(c)}))` : `rgb(var(--c-${hex(c)}) / ${alpha})`;
  });
}

export function convertCss(css) {
  let out = '', i = 0;
  const skip = /\/\*[\s\S]*?\*\/|url\((?:'[^']*'|"[^"]*"|[^)]*)\)/g;
  for (const m of css.matchAll(skip)) {
    out += convertColors(css.slice(i, m.index)) + m[0];
    i = m.index + m[0].length;
  }
  return out + convertColors(css.slice(i));
}

export function paletteVars(text) {
  return [...new Set([...text.matchAll(/var\(--c-([0-9a-f]{6})\)/g)].map((m) => m[1]))].sort();
}

export function paletteCss(vars) {
  const line = (f) => vars.map((v) => { const c = [0, 2, 4].map((k) => parseInt(v.slice(k, k + 2), 16)); return `  --c-${v}: ${f(c).join(' ')};`; }).join('\n');
  return `:root {\n${line((c) => c)}\n}\n:root[data-persona="aeri"] {\n${line((c) => aeri(...c))}\n}\n:root[data-persona="violet"] {\n${line((c) => violet(...c))}\n}\n`;
}

const STYLE = /(<style>)([\s\S]*?)(<\/style>)/g;
const STYLE_ATTR = /(\sstyle=")([^"]*)(")/g;
const PALETTE_BLOCK = /<style id="persona-palette">[\s\S]*?<\/style>\n?/;

export function convertPage(html) {
  let body = html.replace(PALETTE_BLOCK, '').replace(STYLE, (m, a, css, z) => a + convertCss(css) + z).replace(STYLE_ATTR, (m, a, css, z) => a + convertCss(css) + z);
  const vars = paletteVars(body);
  if (!vars.length) return body;
  const at = body.indexOf('<style>');
  if (at < 0) throw new Error('a page uses palette colours but has no <style> to put the palette before');
  return body.slice(0, at) + `<style id="persona-palette">\n${paletteCss(vars)}</style>\n` + body.slice(at);
}

function jsxSources() {
  const out = [];
  for (const dir of ['lair/app', 'lair/app/mind']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).sort()) if (f.endsWith('.jsx')) out.push(`${dir}/${f}`);
  }
  return out;
}

export function plan() {
  const files = new Map();
  let lairVars = [];
  for (const rel of LAIR_CSS) {
    const next = convertCss(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
    files.set(rel, next);
    lairVars = lairVars.concat(paletteVars(next));
  }
  for (const rel of jsxSources()) {
    lairVars = lairVars.concat(paletteVars(fs.readFileSync(path.join(ROOT, rel), 'utf-8')));
  }
  files.set(LAIR_PALETTE, paletteCss([...new Set(lairVars)].sort()));
  for (const rel of PAGES) files.set(rel, convertPage(fs.readFileSync(path.join(ROOT, rel), 'utf-8')));
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stale = [];
  for (const [rel, next] of plan()) {
    const abs = path.join(ROOT, rel);
    const now = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
    if (now === next) continue;
    stale.push(rel);
    if (!process.argv.includes('--check')) fs.writeFileSync(abs, next);
  }
  if (process.argv.includes('--check')) {
    if (stale.length) { console.error(`persona palette stale in: ${stale.join(', ')} — run node scripts/persona-theme.mjs`); process.exit(1); }
    console.log('persona palette up to date');
  } else console.log(stale.length ? `updated ${stale.join(', ')}` : 'nothing to update');
}
