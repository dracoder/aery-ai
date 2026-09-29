const BASE = `http://127.0.0.1:${process.env.AERYX_PORT || 23799}`;
const PERSONAS = ['aeryx', 'aeri'];
const FORMS = ['core', 'dragon', 'human'];

let step = 0;
const pass = (msg) => console.log(`  ✔ ${++step}. ${msg}`);
const skip = (msg) => console.log(`  ⃝ ${++step}. SKIPPED — ${msg}`);
function fail(msg) {
  console.error(`  ✘ FAIL at step ${step + 1}: ${msg}`);
  process.exit(1);
}

function glbJson(buf) {
  if (buf.toString('latin1', 0, 4) !== 'glTF') return null;
  return JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
}

console.log(`character live proof against ${BASE}\n`);

const status = await fetch(`${BASE}/status`).catch(() => null);
if (!status?.ok) fail('daemon is not running — start it with: npm run daemon');
pass('daemon alive');

for (const persona of PERSONAS) for (const form of FORMS) {
  const name = `${persona}-${form}.glb`;
  const r = await fetch(`${BASE}/assets/characters/${name}`);
  if (r.status !== 200) fail(`${name}: ${r.status} — run npm run build`);
  if (r.headers.get('content-type') !== 'model/gltf-binary') fail(`${name} served as ${r.headers.get('content-type')}`);
  const gltf = glbJson(Buffer.from(await r.arrayBuffer()));
  if (!gltf) fail(`${name} is not a binary glTF`);
  if (gltf.extensionsRequired?.includes('EXT_meshopt_compression')) fail(`${name} needs the meshopt WASM decoder, which the CSP forbids`);
  if (form !== 'core' && !gltf.skins?.length) fail(`${name} has no skeleton`);
  if (form === 'human') {
    const clips = (gltf.animations ?? []).map((a) => a.name);
    for (const clip of ['idle', 'talk', 'listen', 'wave', 'bow', 'heart', 'dance']) if (!clips.includes(clip)) fail(`${name} lacks the ${clip} clip`);
  }
}
pass('six characters serve as binary glTF: dragons and humanoids rigged, humanoids carry their gesture clips, no WASM decoder needed');

const whole = await fetch(`${BASE}/assets/characters/aeryx-core.glb`);
const size = Number(whole.headers.get('content-length'));
const modified = whole.headers.get('last-modified');
await whole.arrayBuffer();
const part = await fetch(`${BASE}/assets/characters/aeryx-core.glb`, { headers: { range: 'bytes=0-11' } });
if (part.status !== 206 || part.headers.get('content-range') !== `bytes 0-11/${size}`) fail(`range request answered ${part.status} ${part.headers.get('content-range')}`);
if (Buffer.from(await part.arrayBuffer()).toString('latin1', 0, 4) !== 'glTF') fail('the ranged bytes are not the file head');
if (!modified) fail('no last-modified header, so every visit re-downloads the models');
const again = await fetch(`${BASE}/assets/characters/aeryx-core.glb`, { headers: { 'if-modified-since': modified } });
if (again.status !== 304) fail(`revalidation answered ${again.status}, not 304`);
pass(`models revalidate (304) instead of re-downloading, and ranged reads work (${(size / 1048576).toFixed(1)} MB core)`);

for (const [file, type] of [
  ...PERSONAS.flatMap((p) => FORMS.map((f) => [`${p}-${f}.webp`, 'image/webp'])),
  ...PERSONAS.map((p) => [`${p}-orb.png`, 'image/png']),
  ['growl.m4a', 'audio/mp4'], ['summon.m4a', 'audio/mp4'],
]) {
  const r = await fetch(`${BASE}/assets/characters/${file}`);
  if (r.status !== 200 || r.headers.get('content-type') !== type) fail(`${file}: ${r.status} ${r.headers.get('content-type')}`);
  await r.arrayBuffer();
}
pass('posters, orbs and the growl and summon cues serve with their types');

const engine = await fetch(`${BASE}/familiar.js`);
const engineText = await engine.text();
if (engine.status !== 200 || !/javascript/.test(engine.headers.get('content-type') ?? '') || !engineText.includes('createFamiliar')) fail(`/familiar.js: ${engine.status} — run npm run build:lair`);
pass(`the HUD's engine bundle serves (${(engineText.length / 1024).toFixed(0)} KB)`);

for (const evil of ['/assets/characters/../aeryxd.mjs', '/assets/characters/..%2f..%2fguardrails.json', '/assets/aeryx-winged-dragon.png', '/assets/characters/aeryx-dragon.glb.map', '/familiar.js.map']) {
  const r = await fetch(`${BASE}${evil}`);
  const body = await r.text();
  if (r.status === 200 && !/<html/i.test(body.slice(0, 200))) fail(`${evil} was served`);
}
pass('traversal, retired art and unlisted names are refused');

const rawStatus = (path) => new Promise((resolve) => {
  import('node:http').then(({ request }) => {
    const u = new URL(BASE);
    const req = request({ host: u.hostname, port: u.port, path, method: 'GET' }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.end();
  });
});
const skinList = await fetch(`${BASE}/skins`).then((r) => r.json()).catch(() => null);
if (!Array.isArray(skinList?.skins)) fail('/skins did not answer with a list');
const skin = skinList.skins[0];
if (!skin) skip('no local skin in data/skins — the skin checks need one installed');
else {
  for (const f of skin.forms) {
    const r = await fetch(`${BASE}/skins/${skin.id}/${f}.glb`);
    if (r.status !== 200 || r.headers.get('content-type') !== 'model/gltf-binary') fail(`skin ${skin.id} ${f}.glb: ${r.status} ${r.headers.get('content-type')}`);
    if (!glbJson(Buffer.from(await r.arrayBuffer()))) fail(`skin ${skin.id} ${f}.glb is not a binary glTF`);
  }
  for (const bad of [`/skins/${skin.id}/skin.json`, `/skins/${skin.id}/../../aeryx.config.json`, `/skins/${skin.id}/..%2f..%2faeryx.config.json`, '/skins/aeryx/core.glb', `/skins/${skin.id}/${skin.forms[0]}.glb.map`]) {
    const code = await rawStatus(bad);
    if (code !== 404) fail(`${bad} answered ${code}, not 404`);
  }
  pass(`local skin "${skin.name}" serves ${skin.forms.join(' + ')} as glTF; its manifest, traversal, built-in names and unlisted files are refused`);
}

const entry = process.env.AERYX_PLAYWRIGHT;
const pw = entry ? await import(entry).catch(() => null) : await import('playwright').catch(() => null);
if (!pw) {
  skip('no Playwright available — set AERYX_PLAYWRIGHT to render in a real browser');
} else {
  const browser = await pw.chromium.launch({
    channel: process.env.AERYX_BROWSER_CHANNEL || 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  const requested = new Set();
  page.on('request', (req) => { const m = /\/assets\/characters\/([a-z-]+\.glb)$/.exec(req.url()); if (m) requested.add(m[1]); });
  await page.addInitScript(() => { localStorage.setItem('aeryx.persona', 'aeri'); localStorage.setItem('aeryx.form', 'dragon'); });
  await page.goto(`${BASE}/lair/#overview`);
  await page.addStyleTag({ content: '.onboard { display: none !important; }' });
  await page.waitForSelector('.character-stage.is-live', { timeout: 45000 }).catch(() => fail(`the live stage never came up: ${problems.join(' | ') || 'no console output'}`));
  await page.waitForTimeout(2500);
  if (!requested.has('aeri-dragon.glb')) fail(`the saved persona and form were not honoured; requested ${[...requested].join(', ') || 'nothing'}`);
  const eager = [...requested].filter((f) => f !== 'aeri-dragon.glb');
  if (eager.length) fail(`forms nobody asked for were downloaded: ${eager.join(', ')}`);
  pass('the Lair loads only the saved persona and form (aeri-dragon), nothing else');

  const theme = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const rgb = (v) => (v.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    return { attr: document.documentElement.dataset.persona, text: rgb(getComputedStyle(document.body).color), accent: root.getPropertyValue('--c-63dcff').trim() };
  });
  const [tr, tg, tb] = theme.text, accent = theme.accent.split(/\s+/).map(Number);
  if (theme.attr !== 'aeri') fail(`the page did not switch to Aeri's theme before paint (data-persona=${theme.attr})`);
  if (!(tr > tb && accent[0] > accent[2])) fail(`Aeri's theme is not red: text rgb(${theme.text}), accent ${theme.accent}`);
  pass(`Aeri's red theme applies under the daemon's CSP (text rgb(${theme.text}), accent ${theme.accent})`);

  await page.addStyleTag({ content: '.hero-particles, .hud-scan { display: none !important; }' });
  const stage = page.locator('.character-stage');
  const shot = async () => (await stage.screenshot()).toString('base64');
  const lit = await shot();
  await page.evaluate(() => { document.querySelector('.stage-canvas').style.visibility = 'hidden'; });
  const bare = await shot();
  await page.evaluate(() => { document.querySelector('.stage-canvas').style.visibility = ''; });
  const diff = await page.evaluate(async ([a, b]) => {
    const load = async (s) => { const img = new Image(); img.src = `data:image/png;base64,${s}`; await img.decode(); const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height); };
    const [x, y] = [await load(a), await load(b)];
    const region = (x0, y0, x1, y1) => {
      let changed = 0, total = 0;
      for (let py = Math.floor(y0 * x.height); py < y1 * x.height; py += 2) for (let px = Math.floor(x0 * x.width); px < x1 * x.width; px += 2) {
        const i = (py * x.width + px) * 4; total++;
        if (Math.abs(x.data[i] - y.data[i]) + Math.abs(x.data[i + 1] - y.data[i + 1]) + Math.abs(x.data[i + 2] - y.data[i + 2]) > 24) changed++;
      }
      return changed / total;
    };
    return { centre: region(0.3, 0.3, 0.7, 0.7), corner: region(0, 0, 0.12, 0.12) };
  }, [lit, bare]);
  if (diff.centre < 0.15) fail(`the canvas drew almost nothing over the stage centre (${(diff.centre * 100).toFixed(1)}% changed)`);
  if (diff.corner > 0.02) fail(`the canvas is not see-through at the corner (${(diff.corner * 100).toFixed(1)}% changed) — the backdrop is being veiled`);
  pass(`WebGL draws the dragon (${(diff.centre * 100).toFixed(0)}% of the stage centre) over a transparent canvas (${(diff.corner * 100).toFixed(1)}% at the corner)`);

  await page.evaluate(() => [...document.querySelectorAll('.hero-forms button')].find((b) => /humanoid/i.test(b.textContent)).click());
  await page.waitForFunction(() => document.querySelector('.hero-forms button[aria-pressed="true"]')?.textContent.match(/humanoid/i), null, { timeout: 5000 }).catch(() => fail('the Humanoid control did not take'));
  await page.waitForResponse((r) => r.url().endsWith('/assets/characters/aeri-human.glb') && r.status() === 200, { timeout: 30000 }).catch(() => {
    if (!requested.has('aeri-human.glb')) fail('switching to Humanoid did not fetch aeri-human.glb');
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => [...document.querySelectorAll('.hero-emotes button')].find((b) => /heart/i.test(b.textContent)).click());
  await page.waitForTimeout(1500);
  if (problems.length) fail(`console errors: ${problems.slice(0, 3).join(' | ')}`);
  pass('switching form streams the humanoid on demand and the heart gesture plays with a clean console');

  if (skin) {
    const skinFetched = new Set();
    page.on('request', (req) => { const m = new RegExp(`/skins/${skin.id}/([a-z]+)\\.glb$`).exec(req.url()); if (m) skinFetched.add(m[1]); });
    await page.evaluate((name) => [...document.querySelectorAll('.rail-dragon-style button')].find((b) => b.textContent === name).click(), skin.name);
    await page.waitForFunction((t) => document.documentElement.dataset.persona === t, skin.theme, { timeout: 5000 }).catch(() => fail(`choosing ${skin.name} did not apply its ${skin.theme} theme`));
    const shown = await page.evaluate(() => [...document.querySelectorAll('.hero-forms button')].map((b) => b.textContent.replace(/^\d+/, '').trim().toLowerCase()));
    const want = skin.forms.map((f) => ({ core: 'core', dragon: 'dragon', human: 'humanoid' })[f]);
    if (shown.join(',') !== want.join(',')) fail(`the hero offers ${shown.join(',')} for ${skin.name}, which ships ${want.join(',')}`);
    await page.evaluate(() => document.querySelector('.hero-full').click());
    await page.waitForTimeout(800);
    const cover = await page.evaluate(() => { const r = document.querySelector('.character-stage').getBoundingClientRect(); return [r.width / innerWidth, r.height / innerHeight]; });
    if (cover[0] < 0.99 || cover[1] < 0.99) fail(`the full-screen stage covers only ${cover.map((v) => (v * 100).toFixed(0) + '%').join(' x ')} of the viewport`);
    const controls = () => page.evaluate(() => ({ bare: document.querySelector('.overview-hero').classList.contains('stage-bare'), forms: getComputedStyle(document.querySelector('.overview-hero-copy')).opacity }));
    await page.keyboard.press('h');
    await page.waitForTimeout(500);
    const hidden = await controls();
    if (!hidden.bare || hidden.forms !== '0') fail(`H did not hide the stage controls (${JSON.stringify(hidden)})`);
    await page.keyboard.press('h');
    await page.waitForTimeout(500);
    if ((await controls()).bare) fail('H did not bring the stage controls back');
    await page.waitForTimeout(1500);
    if (skin.forms.length > 1) {
      await page.evaluate(() => document.querySelector('.hero-forms button').click());
      await page.waitForTimeout(2500);
      await page.evaluate(() => document.querySelector('.character-stage').click());
      if (skin.fx) await page.waitForSelector('.hero-fx', { timeout: 9000 }).catch(() => fail(`${skin.name}'s summon effect never fired`));
      await page.waitForTimeout(4000);
      if (!skinFetched.has(skin.forms[1])) fail(`summoning did not stream ${skin.forms[1]}.glb from the skin folder`);
      if (skin.tap && skin.fx && skin.forms[1] === 'human') {
        await page.waitForFunction(() => !document.querySelector('.hero-fx'), null, { timeout: 4000 }).catch(() => {});
        await page.evaluate(() => document.querySelector('.character-stage').click());
        await page.waitForSelector('.hero-fx-blast', { timeout: 7000 }).catch(() => fail(`tapping ${skin.name} did not fire its ${skin.tap} move`));
      }
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await page.evaluate(() => document.querySelector('.overview-hero').classList.contains('stage-full'))) fail('Escape did not leave the full-screen stage');
    if (problems.length) fail(`console errors: ${problems.slice(0, 3).join(' | ')}`);
    pass(`${skin.name} applies its ${skin.theme} theme, offers only its own forms, fills a full-screen stage (H hides its controls)${skin.fx ? ', fires its summon effect' : ''}${skin.tap ? `, fires ${skin.tap} when tapped` : ''} and streams its next form from the skin folder`);
  }
  await browser.close();
}

console.log('\ncharacter live proof passed');
