import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { SKIN_ID, readSkin, listSkins, type Skin } from './skins';

export const MAX_PACK_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 4096;
const MAX_SKINS = 16;
const BUILT_IN = new Set(['aeryx', 'aeri']);
const PACK_FILE = /^(skin\.json|(core|dragon|human)\.(glb|webp))$/;
const LIMITS: Record<string, number> = { json: 64 * 1024, glb: 96 * 1024 * 1024, webp: 8 * 1024 * 1024 };

export interface PackResult { ok: true; skin: Skin; replaced: boolean }
export interface PackError { ok: false; error: string }

interface ZipEntry { name: string; method: number; flags: number; csize: number; usize: number; offset: number }

function entries(buf: Buffer): ZipEntry[] | string {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return 'not a zip file';
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) return 'zip64 archives are not supported';
  if (count > MAX_ENTRIES) return 'the zip has too many files';
  if (cdOffset + cdSize > buf.length) return 'the zip is damaged';
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return 'the zip is damaged';
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf-8', p + 46, p + 46 + nlen);
    out.push({ name, method, flags, csize, usize, offset });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

function extract(buf: Buffer, e: ZipEntry, limit: number): Buffer | string {
  if (e.flags & 1) return 'encrypted zips are not supported';
  if (e.csize === 0xffffffff || e.usize === 0xffffffff) return 'zip64 archives are not supported';
  if (e.usize > limit) return `${e.name} is too large`;
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) return 'the zip is damaged';
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  if (start + e.csize > buf.length) return 'the zip is damaged';
  const raw = buf.subarray(start, start + e.csize);
  let data: Buffer;
  if (e.method === 0) data = Buffer.from(raw);
  else if (e.method === 8) {
    try { data = inflateRawSync(raw, { maxOutputLength: limit }); } catch { return `${e.name} could not be unpacked`; }
  } else return `${e.name} uses an unsupported compression`;
  if (data.length !== e.usize) return 'the zip is damaged';
  return data;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

export function installSkinPack(skinsDir: string, zip: Buffer): PackResult | PackError {
  if (zip.length > MAX_PACK_BYTES) return { ok: false, error: 'the zip is too large' };
  const list = entries(zip);
  if (typeof list === 'string') return { ok: false, error: list };
  const usable = list.filter((e) => !e.name.endsWith('/') && !e.name.split('/').some((seg) => seg === '__MACOSX' || seg.startsWith('._')));
  const manifests = usable.filter((e) => path.posix.basename(e.name) === 'skin.json');
  if (manifests.length !== 1) return { ok: false, error: manifests.length ? 'the zip holds more than one skin pack' : 'no skin.json in the zip — is this a skin pack?' };
  const folder = path.posix.dirname(manifests[0]!.name);
  if (folder !== '.' && (/(^|\/)\.\.?(\/|$)/.test(folder) || folder.includes('\\') || folder.startsWith('/'))) return { ok: false, error: 'the zip has an unsafe path' };
  if (folder.split('/').length > 3) return { ok: false, error: 'skin.json is buried too deep in the zip' };
  const files = usable.filter((e) => path.posix.dirname(e.name) === folder && PACK_FILE.test(path.posix.basename(e.name)));

  const manifestData = extract(zip, manifests[0]!, LIMITS.json!);
  if (typeof manifestData === 'string') return { ok: false, error: manifestData };
  let name = '';
  try { name = String(JSON.parse(manifestData.toString('utf-8'))?.name ?? ''); } catch { return { ok: false, error: 'skin.json is not valid JSON' }; }
  const base = folder === '.' ? '' : path.posix.basename(folder);
  const id = SKIN_ID.test(base) ? base : slug(name);
  if (!SKIN_ID.test(id)) return { ok: false, error: 'the skin needs a name' };
  if (BUILT_IN.has(id)) return { ok: false, error: `"${id}" is a built-in persona and cannot be replaced` };

  const exists = fs.existsSync(path.join(skinsDir, id));
  if (!exists && listSkins(skinsDir).length >= MAX_SKINS) return { ok: false, error: `at most ${MAX_SKINS} skins can be installed` };

  fs.mkdirSync(skinsDir, { recursive: true });
  const staging = path.join(skinsDir, `.install-${randomBytes(6).toString('hex')}`);
  try {
    fs.mkdirSync(path.join(staging, id), { recursive: true });
    for (const e of files) {
      const file = path.posix.basename(e.name);
      const data = file === 'skin.json' ? manifestData : extract(zip, e, LIMITS[file.split('.').pop()!]!);
      if (typeof data === 'string') return { ok: false, error: data };
      fs.writeFileSync(path.join(staging, id, file), data, { flag: 'wx' });
    }
    const skin = readSkin(staging, id);
    if (!skin) return { ok: false, error: 'the skin pack did not pass validation (it needs a name and at least one model)' };
    const dest = path.join(skinsDir, id);
    const old = path.join(staging, '.previous');
    if (exists) fs.renameSync(dest, old);
    try { fs.renameSync(path.join(staging, id), dest); } catch (e) { if (exists) fs.renameSync(old, dest); throw e; }
    return { ok: true, skin, replaced: exists };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export function removeSkin(skinsDir: string, id: string): boolean {
  if (!SKIN_ID.test(id) || BUILT_IN.has(id)) return false;
  const dir = path.join(skinsDir, id);
  let st: fs.Stats;
  try { st = fs.lstatSync(dir); } catch { return false; }
  if (st.isSymbolicLink()) fs.unlinkSync(dir);
  else if (st.isDirectory()) fs.rmSync(dir, { recursive: true, force: true });
  else return false;
  return true;
}
