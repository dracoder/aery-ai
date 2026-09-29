const BASE = `http://127.0.0.1:${process.env.AERYX_PORT || 23799}`;

async function call(method, route, headers = {}) {
  const base = method === 'POST' ? { 'content-type': 'application/json' } : {};
  const res = await fetch(BASE + route, { method, headers: { ...base, ...headers } });
  const buf = Buffer.from(await res.arrayBuffer());
  let data;
  try { data = JSON.parse(buf.toString('utf-8')); } catch { data = null; }
  return { status: res.status, data, buf, type: res.headers.get('content-type') ?? '' };
}

let step = 0;
const pass = (msg) => console.log(`  ✔ ${++step}. ${msg}`);
function fail(msg) {
  console.error(`  ✘ FAIL at step ${step + 1}: ${msg}`);
  process.exit(1);
}

console.log(`interactive-news live proof against ${BASE}\n`);

const status = await call('GET', '/status');
if (status.status !== 200) fail('daemon is not running — start it with: npm run daemon');
pass(`daemon alive (brain: ${status.data.brain})`);

const refreshed = await call('POST', '/news/refresh');
if (refreshed.status !== 200) fail(`news refresh: ${refreshed.status}`);
let news, all = [];
for (let attempt = 0; attempt < 5; attempt++) {
  news = await call('GET', '/news');
  if (news.status !== 200) fail(`GET /news: ${news.status}`);
  all = Object.values(news.data.categories).flat();
  if (all.length) break;
  await new Promise((r) => setTimeout(r, 3000));
}
if (!all.length) {
  const why = (news.data.errors ?? []).map((e) => `${e.feed}: ${e.error}`).join('; ');
  fail(`no items from any feed — ${why || 'and no errors reported either, which is worse'}`);
}
const counts = Object.entries(news.data.categories).map(([k, v]) => `${k}:${v.length}`).join(' ');
pass(`news fetched — ${counts}${news.data.errors.length ? ` · ${news.data.errors.length} feed(s) failed, surfaced` : ''}`);

const perRegion = {};
for (const it of all) if (it.region) perRegion[it.region] = (perRegion[it.region] ?? 0) + 1;
const regions = Object.keys(perRegion);
if (regions.length < 4) fail(`only ${regions.length} region(s) populated: ${JSON.stringify(perRegion)} — the regional feed set is not landing`);
pass(`${regions.length} regions carry stories: ${Object.entries(perRegion).map(([k, v]) => `${k}:${v}`).join(' ')}`);

const perCountry = {};
for (const it of all) if (it.country) perCountry[it.country] = (perCountry[it.country] ?? 0) + 1;
const distinct = Object.keys(perCountry);
if (!distinct.length) fail('no items carry a country');
if (!perCountry.in) fail('The Hindu is not lighting India (country "in" empty)');
if (distinct.length < 8) fail(`only ${distinct.length} countries attributed — detection is not reaching beyond the feed homes`);
const namedSix = ['us', 'ca', 'ru', 'cn', 'in', 'jp'];
if (!distinct.some((c) => !namedSix.includes(c))) fail('every country is one of the six named feeds — headline detection is dead');
pass(`${distinct.length} countries attributed: ${Object.entries(perCountry).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join(' ')}…`);

const withImage = all.filter((it) => it.image);
if (!withImage.length) fail('no item carries an image — extraction is dead');
for (const it of withImage) {
  if (!/^https:\/\//.test(it.image)) fail(`non-https image escaped the parser: ${it.image}`);
}
pass(`${withImage.length}/${all.length} items carry https thumbnails`);

const target = withImage[0].image;
const img = await call('GET', `/news/img?u=${encodeURIComponent(target)}`);
if (img.status !== 200) fail(`proxy refused a cached image: ${img.status}`);
if (!/^image\//.test(img.type)) fail(`proxy answered non-image type: ${img.type}`);
if (img.type.includes('svg') === false && img.buf.length < 200) fail(`suspiciously tiny image (${img.buf.length}B)`);
pass(`proxy served a cached thumbnail (${img.type}, ${(img.buf.length / 1024).toFixed(0)}KB)`);

const evil = await call('GET', `/news/img?u=${encodeURIComponent('https://example.com/not-in-cache.jpg')}`);
if (evil.status !== 404) fail(`an uncached URL was fetchable through the proxy (${evil.status})`);
pass('an uncached URL is refused — the cache is the whole allowlist');

const lair = await call('GET', '/lair/');
const csp = (await fetch(BASE + '/lair/')).headers.get('content-security-policy') ?? '';
if (!/img-src 'self' data:/.test(csp)) fail(`the Lair's CSP no longer pins img-src 'self': ${csp}`);
if (lair.status !== 200) fail(`the Lair did not serve: ${lair.status}`);
pass("the Lair serves with img-src 'self' — thumbnails can only come through the proxy");

console.log('\nALL PASS — regional news lands with images, and the proxy serves the cache and nothing else.');
