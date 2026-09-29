import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';

const DATA = path.resolve(import.meta.dirname, '..', 'data');
const MODELS = path.join(DATA, 'models');
const BIN = path.join(DATA, 'whisper');
fs.mkdirSync(MODELS, { recursive: true });
fs.mkdirSync(BIN, { recursive: true });

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log('exists:', path.basename(dest));
    return;
  }
  console.log('downloading', url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await pipeline(res.body, fs.createWriteStream(dest));
  console.log('done:', path.basename(dest), fs.statSync(dest).size, 'bytes');
}

await download(
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  path.join(MODELS, 'ggml-base.en.bin')
);

if (!fs.existsSync(path.join(BIN, 'whisper-cli.exe')) && !fs.existsSync(path.join(BIN, 'main.exe'))) {
  const rel = await (await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest')).json();
  const asset = rel.assets.find((a) => /bin.*x64.*\.zip$/i.test(a.name) || /x64.*bin.*\.zip$/i.test(a.name))
    ?? rel.assets.find((a) => /win.*x64.*\.zip$/i.test(a.name));
  if (!asset) {
    console.error('No Windows x64 binary asset found in release', rel.tag_name);
    console.error('Assets:', rel.assets.map((a) => a.name).join(', '));
    process.exit(1);
  }
  const zipPath = path.join(BIN, asset.name);
  await download(asset.browser_download_url, zipPath);
  execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zipPath}' '${BIN}'"`);
  fs.unlinkSync(zipPath);
  console.log('extracted whisper binaries');
}
console.log('voice setup complete');
