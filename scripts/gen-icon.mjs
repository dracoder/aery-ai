import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const images = SIZES.map((size) => ({ size, png: readFileSync(`design/logo/png/aeryx-mark-${size}.png`) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

let offset = 6 + 16 * images.length;
const entries = images.map(({ size, png }) => {
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});

mkdirSync('src-tauri/icons', { recursive: true });
writeFileSync('src-tauri/icons/icon.ico', Buffer.concat([header, ...entries, ...images.map((i) => i.png)]));
console.log(`icon.ico written (${offset} bytes, ${images.length} sizes)`);
