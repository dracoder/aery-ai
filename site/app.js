const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TONES = { aeryx: ['98,216,255', '47,141,255', '255,255,255'], aeri: ['255,106,80', '255,45,72', '255,214,190'] };
const NAMES = { aeryx: ['AERYX', 'AE-01 // AERYX'], aeri: ['AERI', 'AE-02 // AERI'] };

function setPersona(p, save = true) {
  if (!TONES[p]) return;
  root.dataset.persona = p;
  for (const b of document.querySelectorAll('[data-pick]')) b.setAttribute('aria-pressed', String(b.dataset.pick === p));
  const tag = document.querySelector('[data-tag]');
  if (tag) tag.textContent = NAMES[p][1];
  for (const n of document.querySelectorAll('[data-name]')) n.textContent = NAMES[p][0];
  for (const n of document.querySelectorAll('[data-who]')) n.textContent = p === 'aeri' ? 'Aeri' : 'Aeryx';
  document.title = document.title.replace(/^(Aeryx|Aeri)\b/, p === 'aeri' ? 'Aeri' : 'Aeryx');
  for (const n of document.querySelectorAll('[data-self]')) n.textContent = p === 'aeri' ? 'herself' : 'himself';
  for (const m of document.querySelectorAll('[data-mark], link[rel="icon"]')) m[m.tagName === 'LINK' ? 'href' : 'src'] = p === 'aeri' ? 'assets/mark-aeri.svg' : 'assets/mark.svg';
  const v = document.querySelector('.hero-video');
  const src = v.dataset.personaSrc.replace('{p}', p);
  if (!save && !v.src.endsWith(src)) {
    v.poster = v.dataset.personaPoster.replace('{p}', p);
    v.src = src;
    v.play().catch(() => {});
  } else if (!v.src.endsWith(src)) {
    v.classList.add('swap');
    setTimeout(() => {
      v.poster = v.dataset.personaPoster.replace('{p}', p);
      v.src = src;
      v.play().catch(() => {});
      v.addEventListener('loadeddata', () => v.classList.remove('swap'), { once: true });
    }, 380);
  }
  if (save) {
    try { localStorage.setItem('aeryx.site.persona', p); } catch {}
    history.replaceState(null, '', `#${p}`);
  }
}
for (const b of document.querySelectorAll('[data-pick]')) b.addEventListener('click', () => setPersona(b.dataset.pick));
for (const card of document.querySelectorAll('[data-being]')) card.addEventListener('click', () => { setPersona(card.dataset.being); scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); });
setPersona(root.dataset.persona, false);
addEventListener('hashchange', () => { const h = location.hash.slice(1).toLowerCase(); if (TONES[h]) setPersona(h); });

const seen = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); seen.unobserve(e.target); }
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((el, i) => { el.style.transitionDelay = `${(i % 4) * 80}ms`; seen.observe(el); });

const clips = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const v = e.target;
    if (e.isIntersecting) { if (!v.src) v.src = v.dataset.src; if (!reduced) v.play().catch(() => {}); } else v.pause();
  }
}, { threshold: 0.3 });
document.querySelectorAll('video[data-src]').forEach((v) => clips.observe(v));

for (const pre of document.querySelectorAll('.installs pre')) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy';
  button.textContent = 'Copy';
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(pre.querySelector('code').textContent.trim()); button.textContent = 'Copied'; } catch { button.textContent = 'Select it'; }
    setTimeout(() => { button.textContent = 'Copy'; }, 1600);
  });
  pre.append(button);
}

const canvas = document.querySelector('.embers');
if (canvas && !reduced) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1;
  const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); w = canvas.width = innerWidth * dpr; h = canvas.height = innerHeight * dpr; };
  resize();
  addEventListener('resize', resize);
  const motes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 2.2, v: 0.00025 + Math.random() * 0.0009, sway: Math.random() * 6.28, k: Math.random() }));
  const tick = (t) => {
    ctx.clearRect(0, 0, w, h);
    const tone = TONES[root.dataset.persona] ?? TONES.aeryx;
    for (const m of motes) {
      m.y -= m.v; if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
      const x = (m.x + Math.sin(t / 2400 + m.sway) * 0.012) * w, y = m.y * h, r = m.r * dpr;
      const c = tone[m.k < 0.5 ? 0 : m.k < 0.85 ? 1 : 2];
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
      g.addColorStop(0, `rgba(${c},${0.55 * Math.sin(m.y * Math.PI)})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
