const BASE = process.env.AERYX_URL || 'http://127.0.0.1:23799';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const res = await fetch(`${BASE}/lens`);
const body = await res.text();
ok('GET /lens answers 200 html', res.status === 200 && (res.headers.get('content-type') || '').includes('text/html'), `status ${res.status}`);
const csp = res.headers.get('content-security-policy') || '';
ok('CSP header rides the page', csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"), csp.slice(0, 80));
ok('honest-empty state present', body.includes('Nothing on the table'));
ok('shared orb renderer used', body.includes('/orb.js') && body.includes('AeryxOrb.attach'));
ok('no approval surface', !body.includes('/confirm') && !/method:\s*['"]POST/.test(body));

const st = await (await fetch(`${BASE}/status`)).json();
ok('rail source /status carries its fields',
  'brain' in st && 'chainIntact' in st && 'uptimeSec' in st && Array.isArray(st.pendingConfirms),
  Object.keys(st).join(','));
const mt = await (await fetch(`${BASE}/usage`)).json();
ok('rail source /usage carries its fields', typeof mt.today?.costUsd === 'number' && typeof mt.basis === 'string', JSON.stringify(mt));

const head = await fetch(`${BASE}/lens`, { method: 'HEAD' });
ok('HEAD does not match (GET-only, the documented shape)', head.status === 404, `status ${head.status}`);

ok('page carries the panel machinery', body.includes('lens-panel') && body.includes('/lens/state') && body.includes('textContent'));
ok('page renders no markup from content', !body.includes('innerHTML'));

const ls = await fetch(`${BASE}/lens/state`);
const lsBody = await ls.json();
ok('GET /lens/state replays held panels', ls.status === 200 && Array.isArray(lsBody.panels), `status ${ls.status}: ${JSON.stringify(lsBody).slice(0, 80)}`);

const show = await fetch(`${BASE}/internal/lens-show`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ template: 'table', id: 'workflows' }),
});
ok('POST /internal/lens-show without the brain token is refused', show.status === 403, `status ${show.status}`);
const showBad = await fetch(`${BASE}/internal/lens-show`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: 'not-the-brain', template: 'document', id: '../../secrets/warden.cred' }),
});
ok('a wrong token with a hostile id dies at the token, 403', showBad.status === 403, `status ${showBad.status}`);

ok('page carries the waveform', body.includes('mic-level') && body.includes('id="wave"'));

let micLevels = 0;
try {
  const ac = new AbortController();
  const ev = await fetch(`${BASE}/events`, { signal: ac.signal, headers: { accept: 'text/event-stream' } });
  const reader = ev.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && micLevels < 5) {
    const r = await Promise.race([reader.read(), new Promise((res) => setTimeout(() => res(null), 700))]);
    if (!r) continue;
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const m = JSON.parse(line.slice(6));
        if (m.type === 'mic-level' && typeof m.level === 'number') micLevels++;
      } catch { }
    }
  }
  ac.abort();
} catch { }
ok('the ears feed real amplitude over /events', micLevels >= 5, `${micLevels} mic-level frames in 5s`);

console.log(fail === 0 ? `ALL PASS ${pass}/${pass}` : `${fail} FAILED (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
