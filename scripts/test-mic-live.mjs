import { PvRecorder } from '@picovoice/pvrecorder-node';

const SECONDS = Number(process.argv[2] ?? 3);
const FRAME = 512;
const SAMPLE_RATE = 16000;
const FRAMES = Math.ceil((SECONDS * SAMPLE_RATE) / FRAME);

const DEAD = 5;

function rms(frame) {
  let sum = 0;
  for (const s of frame) sum += s * s;
  return Math.sqrt(sum / frame.length);
}

const devices = PvRecorder.getAvailableDevices();
console.log('\nMIC — live, through the recorder the daemon actually uses\n');
console.log(`  devices: ${devices.map((d, i) => `${i}:${d}`).join(' | ')}\n`);

const results = [];
for (let i = 0; i < devices.length; i++) {
  const rec = new PvRecorder(FRAME, i);
  let peak = 0;
  let total = 0;
  let n = 0;
  try {
    rec.start();
    for (let f = 0; f < FRAMES; f++) {
      const frame = await rec.read();
      const r = rms(frame);
      if (r > peak) peak = r;
      total += r;
      n++;
    }
  } catch (e) {
    console.log(`  ${i}: ${devices[i]} — COULD NOT OPEN (${e.message})`);
    results.push({ i, name: devices[i], peak: -1, mean: -1 });
    continue;
  } finally {
    try { rec.stop(); rec.release(); } catch {}
  }
  const mean = total / Math.max(1, n);
  const verdict = peak < DEAD ? 'DEAD (digital silence)' : 'LIVE';
  results.push({ i, name: devices[i], peak, mean });
  console.log(`  ${i}: ${devices[i]}`);
  console.log(`     peak ${peak.toFixed(1)} · mean ${mean.toFixed(1)} · ${verdict}`);
}

const live = results.filter((r) => r.peak >= DEAD);
const best = live.sort((a, b) => b.peak - a.peak)[0];

console.log('');
if (!best) {
  console.log('  NO DEVICE CARRIES SIGNAL — this one really is the hardware.');
  console.log('  Check the physical connection and the Windows input level.\n');
  process.exit(1);
}
console.log(`  USE micDevice: ${best.i}   (${best.name})`);
console.log(`  Set it in aeryx.config.json under "voice", then restart the daemon.\n`);
process.exit(0);
