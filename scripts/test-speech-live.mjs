import http from 'node:http';

const PORT = Number(process.env.AERYX_PORT || 23799);
const HOST = '127.0.0.1';
const LONG_ASK = process.argv[2]
  || 'Count out loud from one to sixty, in words, separated by commas. No other text.';
const SHORT_ASK = 'what time is it';

const post = (path, body) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: HOST, port: PORT, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); },
    );
    req.on('error', reject);
    req.end(data);
  });

const events = [];
const started = Date.now();
let stream;

await new Promise((resolve, reject) => {
  const req = http.get({ host: HOST, port: PORT, path: '/events' }, (res) => {
    if (res.statusCode !== 200) return reject(new Error(`/events returned ${res.statusCode} — is the daemon up?`));
    stream = res;
    let buf = '';
    res.on('data', (c) => {
      buf += c;
      for (const line of buf.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try { events.push({ ...JSON.parse(line.slice(6)), at: Date.now() - started }); } catch { }
      }
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });
    resolve();
  });
  req.on('error', reject);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clips = () => events.filter((e) => e.type === 'speak');

console.log('live speech check — daemon, msedge-tts and the brain all real\n');

if (await post('/ask', { text: LONG_ASK, via: 'voice' }) !== 202) {
  console.error('FAIL  the daemon refused the ask (halted, or the brain is offline)');
  process.exit(1);
}

const firstClipDeadline = Date.now() + 120_000;
while (!clips().length && Date.now() < firstClipDeadline) await wait(100);
if (!clips().length) {
  console.error('FAIL  no audio at all within 120s');
  process.exit(1);
}
await post('/ask', { text: SHORT_ASK, via: 'voice' });

let lastCount = -1;
for (let quiet = 0; quiet < 80 && clips().length !== lastCount ? true : quiet < 80; quiet++) {
  if (clips().length !== lastCount) { lastCount = clips().length; quiet = 0; }
  await wait(500);
  if (clips().length === lastCount && quiet > 15) break;
}
stream?.destroy();

const seq = clips().map((c) => ({ part: c.part, parts: c.parts, at: c.at }));
console.log('clips broadcast:');
for (const c of seq) console.log(`      part ${c.part}/${c.parts} at +${(c.at / 1000).toFixed(1)}s`);

let failed = 0;
const fail = (m) => { failed++; console.error(`FAIL  ${m}`); };
const pass = (m) => console.log(`PASS  ${m}`);

const long = seq.filter((c) => c.parts > 1);
if (long.length < 2) {
  console.log('\nINCONCLUSIVE  the long reply came back as one chunk — the lag claim needs a multi-chunk reply.');
  console.log('              re-run, or lengthen LONG_ASK.');
} else {
  const first = long[0], last = long[long.length - 1];
  if (first.at >= last.at) fail('the first clip did not precede the last');
  else pass(`speech starts at +${(first.at / 1000).toFixed(1)}s, last clip at +${(last.at / 1000).toFixed(1)}s ` +
            `— audio begins ${((last.at - first.at) / 1000).toFixed(1)}s earlier than waiting for the whole reply`);
  if (long.map((c) => c.part).join(',') !== long.map((_, i) => i + 1).join(',')) fail('the long reply\'s clips arrived out of order');
  else pass('the long reply\'s clips arrived in order');
}

const shortIdx = seq.findIndex((c) => c.parts === 1);
const lastLongIdx = seq.map((c) => c.parts > 1).lastIndexOf(true);
if (shortIdx === -1) {
  console.log('INCONCLUSIVE  the second reply produced no clip (spoken only on the voice route?)');
} else if (lastLongIdx === -1) {
  console.log('INCONCLUSIVE  no multi-chunk reply to interleave with');
} else if (shortIdx < lastLongIdx) {
  fail(`the second reply's clip landed at index ${shortIdx}, inside the first reply — they overlapped`);
} else {
  pass('the second reply waited for the first to finish — no overlap');
}

process.exit(failed ? 1 : 0);
