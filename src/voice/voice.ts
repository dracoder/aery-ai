import { PvRecorder } from '@picovoice/pvrecorder-node';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import { wakePhrase } from '../daemon/wake';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

function send(obj: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

interface Config {
  picovoiceAccessKey?: string; wakewordPath?: string; micDevice?: number; whisperModel?: string;
  voice?: { wakePhrase?: string; micDevice?: number; micGain?: number };
}
let config: Config = {};
const configPath = path.join(ROOT, 'aeryx.config.json');
if (fs.existsSync(configPath)) {
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { }
}

const WAKE_PHRASE = wakePhrase(config);

function findModel(): string {
  const want = path.join(DATA, 'models', `ggml-${config.whisperModel ?? 'small.en'}.bin`);
  if (fs.existsSync(want)) return want;
  const fallback = path.join(DATA, 'models', 'ggml-base.en.bin');
  console.error(`[stt] model ${path.basename(want)} missing — using ${path.basename(fallback)}`);
  return fallback;
}
const MODEL = findModel();

let porcupine: any = null;
async function initWakeWord() {
  if (!config.picovoiceAccessKey) return;
  const ppn = config.wakewordPath ? path.join(ROOT, config.wakewordPath) : null;
  if (!ppn || !fs.existsSync(ppn)) {
    send({
      type: 'voice-error',
      message: `no wake-word model for "${WAKE_PHRASE}" — train a .ppn at console.picovoice.ai, drop it in data/, and set voice.wakewordPath. Listening over the open mic instead.`,
    });
    return;
  }
  try {
    const { Porcupine } = await import('@picovoice/porcupine-node');
    porcupine = new Porcupine(config.picovoiceAccessKey, [ppn], [0.6]);
  } catch (e: any) {
    send({ type: 'voice-error', message: `wake word init failed: ${e.message}` });
  }
}

function findWhisperExe(): string | null {
  const bin = path.join(DATA, 'whisper');
  if (!fs.existsSync(bin)) return null;
  const walk = (dir: string, name: RegExp): string | null => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { const r = walk(p, name); if (r) return r; }
      else if (name.test(f.name)) return p;
    }
    return null;
  };
  return walk(bin, /^whisper-cli\.exe$/i) ?? walk(bin, /^main\.exe$/i);
}
const whisperExe = findWhisperExe();

function transcribe(wavPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!whisperExe) return reject(new Error('whisper binary not found — run scripts/setup-voice.mjs'));
    const p = spawn(
      whisperExe,
      [
        '-m', MODEL, '-f', wavPath, '--no-timestamps', '--language', 'en',
        '-t', String(Math.min(8, Math.max(4, os.cpus().length - 2))),
        '-bs', '5',
        '--prompt', `Talking to Aeryx, my AI assistant. ${WAKE_PHRASE}. ${WAKE_PHRASE}, run this. ${WAKE_PHRASE} sleep.`,
      ],
      { cwd: path.dirname(whisperExe), windowsHide: true }
    );
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`whisper exit ${code}: ${err.slice(-200)}`));
      resolve(out.replace(/\[.*?\]/g, '').trim());
    });
  });
}

function writeWav(frames: Int16Array[], file: string) {
  const samples = frames.reduce((n, f) => n + f.length, 0);
  let peak = 1;
  for (const f of frames) for (let i = 0; i < f.length; i++) peak = Math.max(peak, Math.abs(f[i]));
  const gain = Math.min(14, 26000 / peak);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  let off = 44;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) {
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(f[i] * gain))), off);
      off += 2;
    }
  }
  fs.writeFileSync(file, buf);
  console.error(`[gain] peak=${peak} gain=${gain.toFixed(1)}x`);
}

function rms(frame: Int16Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / frame.length);
}

type Mode = 'wake' | 'record' | 'muted' | 'monitor';
type MicMode = 'ptt' | 'always' | 'off';
let mode: Mode = 'wake';
let micMode: MicMode = 'ptt';
let wantListen = false;

const BARGE_FRAMES = 5;
let bargeRun = 0;

const SILENCE_FRAMES = 38;
const NO_SPEECH_WAIT = 220;
const MAX_FRAMES = 380;
const MIN_SPEECH_FRAMES = 5;
const RING_SIZE = 12;

let noiseFloor = 60;
function speechThreshold(): number {
  return Math.min(1500, Math.max(140, noiseFloor * 3));
}

const MIC_GAIN = Math.max(1, Math.min(16, Number(config.voice?.micGain ?? 1) || 1));
function amplify(frame: Int16Array): Int16Array {
  const out = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, frame[i]! * MIC_GAIN));
  }
  return out;
}

let lastLevelSent = 0;
function emitLevel(level: number) {
  const now = Date.now();
  if (now - lastLevelSent < 100) return;
  lastLevelSent = now;
  send({ type: 'mic-level', level: Math.round(level) });
}

async function run() {
  await initWakeWord();
  const frameLength = porcupine ? porcupine.frameLength : 512;
  const devices = PvRecorder.getAvailableDevices();
  console.error('[mic] devices:', devices.map((d, i) => `${i}:${d}`).join(' | '));
  if (MIC_GAIN !== 1) console.error(`[mic] gain ${MIC_GAIN}x (voice.micGain)`);
  const devIndex = config.voice?.micDevice ?? config.micDevice ?? -1;
  const recorder = new PvRecorder(frameLength, devIndex);
  recorder.start();
  send({
    type: 'voice-ready',
    wake: porcupine ? 'porcupine' : 'push-to-talk',
    device: devIndex >= 0 ? devices[devIndex] : devices[0] ?? 'default',
  });

  const ring: Int16Array[] = [];
  let recFrames: Int16Array[] = [];
  let silentRun = 0;
  let spokeFrames = 0;
  let consecLoud = 0;
  let maxRms = 0;
  let curTrigger = 'ptt';

  let healthFrames = 0, healthMax = 0, healthReported = false;

  const startRecording = (reason: string) => {
    mode = 'record';
    curTrigger = reason;
    recFrames = [...ring];
    silentRun = 0; spokeFrames = 0; maxRms = 0;
    if (reason === 'wake') send({ type: 'wake' });
    send({ type: 'listening' });
  };

  let heldSince = 0;
  while (true) {
    let frame = await recorder.read();
    if (MIC_GAIN !== 1) frame = amplify(frame);
    if (mode === 'muted' || mode === 'monitor') {
      if (!heldSince) heldSince = Date.now();
      else if (Date.now() - heldSince > 45_000) {
        console.error(`[watchdog] stuck in ${mode} — forcing wake`);
        mode = 'wake';
        heldSince = 0;
      }
    } else {
      heldSince = 0;
    }
    if (mode === 'muted' || micMode === 'off') { wantListen = wantListen && micMode !== 'off'; continue; }
    const level = rms(frame);
    emitLevel(level);

    if (!healthReported && healthFrames < 95) {
      healthFrames++;
      healthMax = Math.max(healthMax, level);
      if (healthFrames === 95) {
        healthReported = true;
        if (healthMax < 5) {
          send({
            type: 'voice-error',
            message: `microphone is delivering silence (ambient peak ${healthMax.toFixed(1)}) — check the input device and its level, and Windows Settings → Privacy → Microphone (allow desktop apps)`,
          });
          console.error(`[mic] DEAD — ambient peak ${healthMax.toFixed(1)} over ~3s`);
        } else {
          console.error(`[mic] health ok — ambient peak ${Math.round(healthMax)}`);
        }
      }
    }

    if (mode === 'monitor') {
      ring.push(Int16Array.from(frame));
      if (ring.length > RING_SIZE) ring.shift();
      const bargeThr = Math.max(280, speechThreshold() * 1.5);
      bargeRun = level > bargeThr ? bargeRun + 1 : 0;
      if (bargeRun >= BARGE_FRAMES) {
        bargeRun = 0;
        send({ type: 'barge-in' });
        startRecording('barge');
      }
      continue;
    }

    if (mode === 'wake') {
      ring.push(Int16Array.from(frame));
      if (ring.length > RING_SIZE) ring.shift();
      noiseFloor = noiseFloor * 0.98 + level * 0.02;

      if (wantListen) { wantListen = false; startRecording('ptt'); continue; }
      if (porcupine && porcupine.process(frame) >= 0) { startRecording('wake'); continue; }
      if (micMode === 'always') {
        consecLoud = level > speechThreshold() ? consecLoud + 1 : 0;
        if (consecLoud >= 2) { consecLoud = 0; startRecording('vad'); }
      }
      continue;
    }

    recFrames.push(Int16Array.from(frame));
    maxRms = Math.max(maxRms, level);
    if (level > speechThreshold()) {
      spokeFrames++; silentRun = 0;
    } else if (spokeFrames > 0) {
      silentRun++;
    }

    const spoke = spokeFrames >= MIN_SPEECH_FRAMES;
    const utteranceOver = spoke && silentRun >= SILENCE_FRAMES;
    const neverSpoke = !spoke && recFrames.length >= NO_SPEECH_WAIT;
    const hitCap = recFrames.length >= MAX_FRAMES;

    if (utteranceOver || neverSpoke || hitCap) {
      console.error(`[vad] frames=${recFrames.length} spoke=${spokeFrames} maxRms=${Math.round(maxRms)} floor=${Math.round(noiseFloor)} thr=${Math.round(speechThreshold())}`);
      mode = 'muted';
      if (!spoke) {
        send({ type: 'no-speech', level: Math.round(maxRms) });
        mode = 'wake';
        continue;
      }
      const wav = path.join(DATA, 'last-utterance.wav');
      try {
        writeWav(recFrames, wav);
        const text = await transcribe(wav);
        console.error(`[stt] ${text.length} chars`);
        if (text && !/^\s*[\[(]?\s*(BLANK_AUDIO|silence|inaudible)/i.test(text)) {
          send({ type: 'transcript', text, trigger: curTrigger });
          if (micMode === 'always') mode = 'wake';
        } else {
          send({ type: 'no-speech', level: Math.round(maxRms) });
          mode = 'wake';
        }
      } catch (e: any) {
        console.error('[stt-error]', e.message);
        send({ type: 'voice-error', message: e.message });
        mode = 'wake';
      }
    }
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg: any;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type === 'listen') {
    if (micMode === 'off') return;
    if (mode === 'wake') wantListen = true;
    else if (mode === 'muted') { mode = 'wake'; wantListen = true; }
  } else if (msg.type === 'mute') {
    mode = 'muted';
  } else if (msg.type === 'monitor') {
    bargeRun = 0;
    mode = 'monitor';
  } else if (msg.type === 'resume') {
    if (mode === 'muted' || mode === 'monitor') mode = 'wake';
  } else if (msg.type === 'mode' && ['ptt', 'always', 'off'].includes(msg.mode)) {
    micMode = msg.mode;
    if (micMode === 'off') mode = 'wake';
    console.error('[mic] mode applied:', micMode);
    send({ type: 'mic-mode', mode: micMode });
  }
});

run().catch((e) => {
  send({ type: 'voice-error', message: String(e?.message ?? e) });
  process.exit(1);
});
