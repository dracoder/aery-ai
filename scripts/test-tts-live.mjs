import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'aeryx-tts-'));
const out = path.join(tmp, 'speech.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/daemon/speech.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent',
});
const S = await import(pathToFileURL(out).href);

const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
const loader = {
  create: async () => new MsEdgeTTS(),
  format: OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
};

const SHORT = 'Systems check complete.';
const LONG = [
  "It's 5:00 a.m. and the gateway is green — 100% of tool calls classified.",
  'The autonomy ladder is holding at session tier for two lanes, and standing for none.',
  'I checked the audit chain at startup; it verified clean across every row, so no grants were voided.',
  'Voice input is landing through Whisper, and the reply is spoken back in the same voice.',
  'Nothing in the crash log since the last restart, which is the first quiet stretch in a while.',
  'That is everything worth reporting, unless you want the detail on any one of them.',
].join(' ');

let failed = 0;

async function trial(name, text) {
  const started = Date.now();
  const warnings = [];
  try {
    const r = await S.synthesizeSpeech(text, loader, {
      voice: 'en-US-AvaNeural',
      onWarn: (m) => warnings.push(m),
    });
    const secs = ((Date.now() - started) / 1000).toFixed(1);

    if (!r.audio) throw new Error('no audio at all');
    if (!r.complete) throw new Error(`incomplete: ${r.chunksRendered}/${r.chunksTotal} chunks`);
    if (r.audio.length < 2000) throw new Error(`suspiciously small audio: ${r.audio.length} bytes`);

    console.log(`PASS  ${name}`);
    console.log(`      ${text.length} chars -> ${r.chunksTotal} chunk(s), ` +
                `${r.attemptsUsed} attempt(s), ${r.audio.length} bytes, ${secs}s`);
    if (warnings.length) console.log(`      retried: ${warnings.join(' | ')}`);
    return r.audio;
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}\n      ${e.message}`);
    if (warnings.length) console.error(`      warnings: ${warnings.join(' | ')}`);
    return null;
  }
}

console.log('live msedge-tts check — needs network\n');
await trial('short reply', SHORT);
const audio = await trial('long reply (the case that used to truncate)', LONG);

if (audio) {
  mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  const dest = path.join(ROOT, 'data', 'tts-live-check.mp3');
  writeFileSync(dest, audio);
  console.log(`\nwrote ${dest} — play it to confirm the whole sentence is there`);
}

rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
