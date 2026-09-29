window.AeryxOrb = (() => {
  const TAU = Math.PI * 2;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const assetRoot = new URL('./assets/', document.currentScript.src);
  const coreArt = { aeryx: new Image(), aeri: new Image() };
  coreArt.aeryx.src = new URL('characters/aeryx-orb.png', assetRoot).href;
  coreArt.aeri.src = new URL('characters/aeri-orb.png', assetRoot).href;
  const THEMES = ['aeryx', 'aeri', 'violet'];
  const storedTheme = () => {
    try {
      const t = localStorage.getItem('aeryx.theme');
      if (THEMES.includes(t)) return t;
      return localStorage.getItem('aeryx.persona') === 'aeri' ? 'aeri' : 'aeryx';
    } catch { return 'aeryx'; }
  };
  let visualStyle = storedTheme();

  const PALETTES = {
    aeryx: { HEAT: [197, 245, 255], GOLD: [66, 215, 255], EMBER: [29, 116, 255], EMBER_LO: [12, 34, 92], SCALE: [12, 23, 43], VOID: [4, 9, 23], ASH: [91, 129, 163], JADE: [68, 240, 255], CYAN: [108, 115, 255], GRAY: [104, 116, 134] },
    aeri: { HEAT: [255, 222, 198], GOLD: [255, 98, 66], EMBER: [255, 29, 48], EMBER_LO: [74, 18, 25], SCALE: [35, 13, 15], VOID: [19, 5, 7], ASH: [165, 89, 90], JADE: [255, 170, 60], CYAN: [255, 108, 138], GRAY: [135, 103, 106] },
    violet: { HEAT: [236, 214, 255], GOLD: [178, 108, 255], EMBER: [138, 58, 255], EMBER_LO: [40, 16, 92], SCALE: [24, 13, 43], VOID: [11, 5, 23], ASH: [132, 104, 168], JADE: [206, 120, 255], CYAN: [255, 96, 214], GRAY: [118, 106, 138] },
  };
  let HEAT, GOLD, EMBER, EMBER_LO, SCALE, VOID, ASH, JADE, CYAN, GRAY;
  const usePalette = (style) => ({ HEAT, GOLD, EMBER, EMBER_LO, SCALE, VOID, ASH, JADE, CYAN, GRAY } = PALETTES[style]);
  usePalette(visualStyle);
  addEventListener('storage', (event) => {
    if (event.key !== 'aeryx.theme' && event.key !== 'aeryx.persona') return;
    visualStyle = storedTheme();
    usePalette(visualStyle);
    document.documentElement.dataset.persona = visualStyle;
  });
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  const ease = (x) => x * x * (3 - 2 * x);

  const STATES = {
    idle:      { hz: .15, energy: .55, spin: .05, eye: .30, chain: 0, flare: 0, wyrm: 0, ash: 0 },
    listening: { hz: .45, energy: .95, spin: .10, eye: 1,   chain: 0, flare: 0, wyrm: 0, ash: 0 },
    working:   { hz: .30, energy: 1,   spin: .45, eye: .15, chain: 0, flare: 0, wyrm: 4, ash: 0 },
    awaiting:  { hz: .25, energy: .80, spin: .06, eye: .80, chain: 1, flare: 0, wyrm: 0, ash: 0 },
    manifest:  { hz: .50, energy: 1.4, spin: .75, eye: .10, chain: 0, flare: 1, wyrm: 0, ash: 0 },
    offline:   { hz: .05, energy: .28, spin: .01, eye: 0,   chain: 0, flare: 0, wyrm: 0, ash: 1 },
  };
  const KEYS = Object.keys(STATES.idle);

  const C = 80, R = 54;

  function hide(ctx, t, m, rot, rad, glow, tone, n) {
    const gold = tone(GOLD), ember = tone(EMBER), heat = tone(HEAT), cy = tone(CYAN);

    let g = ctx.createRadialGradient(C, C, 0, C, C, rad * .95);
    g.addColorStop(0, rgba(heat, .85 * glow));
    g.addColorStop(.45, rgba(gold, .3 * glow));
    g.addColorStop(1, rgba(ember, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(C, C, rad * .95, 0, TAU); ctx.fill();

    const tilt = .42;
    const pass = (dx, dy, col, alpha, fill) => {
      for (let i = 0; i < n; i++) {
        const yy = 1 - (i / (n - 1)) * 2;
        const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
        const th = i * 2.399963 + rot;
        const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
        const y2 = yy * Math.cos(tilt) - z * Math.sin(tilt);
        const zd = yy * Math.sin(tilt) + z * Math.cos(tilt);
        const sx = C + x * rad, sy = C + y2 * rad;
        const front = zd > 0 ? 1 : .13;
        const wave = .3 + .7 * Math.max(0, Math.sin(t * 2.2 - yy * 4.2));
        const a = alpha * front * (.3 + wave * .7) * glow;
        if (a < .015) continue;
        const sz = (rad / 54) * (1.5 + 1.9 * (zd * .5 + .5));
        ctx.beginPath();
        for (let v = 0; v < 6; v++) {
          const va = (v / 6) * TAU + Math.PI / 6;
          const vx = sx + dx + Math.cos(va) * sz, vy = sy + dy + Math.sin(va) * sz;
          v ? ctx.lineTo(vx, vy) : ctx.moveTo(vx, vy);
        }
        ctx.closePath();
        if (fill && zd > 0) { ctx.fillStyle = rgba(mix(col, heat, wave * .5), a * .3); ctx.fill(); }
        ctx.strokeStyle = rgba(col, a);
        ctx.lineWidth = zd > 0 ? .75 : .45;
        ctx.stroke();
      }
    };
    pass(-.8, 0, cy, .24, false);
    pass(.8, 0, ember, .24, false);
    pass(0, 0, gold, .72, true);

    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, rad * 1.06, 0, TAU); ctx.clip();
    ctx.fillStyle = rgba(VOID, .28);
    for (let y = (t * 10) % 3; y < 160; y += 3) ctx.fillRect(C - rad * 1.1, y, rad * 2.2, 1);
    ctx.restore();

    if (m.eye > .05) {
      const open = ease(m.eye), ry = rad * .34 * open, rx = rad * .095 * open;
      g = ctx.createRadialGradient(C, C, 0, C, C, Math.max(.1, ry * 1.6));
      g.addColorStop(0, rgba(m.ash > .5 ? GRAY : JADE, .7 * open));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(C, C, rx * 3, ry * 1.4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba([4, 8, 6], .92 * open);
      ctx.beginPath(); ctx.ellipse(C, C, Math.max(.1, rx), Math.max(.1, ry), 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(m.ash > .5 ? GRAY : JADE, .9 * open);
      ctx.lineWidth = .9; ctx.stroke();
    }
  }

  function collar(ctx, t, m, rot, rad, glow, tone, lite) {
    const gold = tone(GOLD), heat = tone(HEAT);
    const cin = rad * 1.02, cout = rad * 1.16;
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(rot * .25);
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * TAU + .06, a1 = a0 + TAU / 10 - .13;
      ctx.beginPath();
      ctx.arc(0, 0, cout, a0, a1);
      ctx.arc(0, 0, cin, a1, a0, true);
      ctx.closePath();
      const lit = Math.max(0, -Math.sin(a0 + .4));
      ctx.fillStyle = rgba(mix(SCALE, tone(ASH), .18 + lit * .3), .95);
      ctx.fill();
      ctx.strokeStyle = rgba(mix(tone(ASH), gold, lit), .35 + lit * .5 * glow);
      ctx.lineWidth = .9;
      ctx.stroke();
      const vg = ctx.createLinearGradient(
        Math.cos(a1) * cin, Math.sin(a1) * cin, Math.cos(a1) * cout, Math.sin(a1) * cout);
      vg.addColorStop(0, rgba(heat, .5 * glow));
      vg.addColorStop(1, rgba(tone(EMBER), 0));
      ctx.strokeStyle = vg;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(0, 0, (cin + cout) / 2, a1, a1 + .09); ctx.stroke();
    }
    ctx.restore();
    if (lite) return;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + rot * .25;
      ctx.fillStyle = rgba(tone(ASH), .55);
      ctx.beginPath();
      ctx.arc(C + Math.cos(a) * ((cin + cout) / 2), C + Math.sin(a) * ((cin + cout) / 2), 1.3, 0, TAU);
      ctx.fill();
    }
  }

  function clamps(ctx, t, m, rest, glow, tone) {
    const gold = tone(GOLD), grip = ease(m.chain);
    const r = rest - grip * (rest * .14);
    const pulse = .5 + .5 * Math.sin(t * TAU * .5);
    ctx.save();
    ctx.translate(C, C);
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.rotate(k * Math.PI / 2 + Math.PI / 4);
      ctx.strokeStyle = rgba(grip > .25 ? gold : tone(ASH), (.4 + grip * (.35 + .25 * pulse)) * glow);
      ctx.lineWidth = 2.8;
      if (grip > .25) { ctx.shadowBlur = 8; ctx.shadowColor = rgba(gold, .7 * grip); }
      ctx.beginPath(); ctx.arc(0, 0, r, -.28, .28); ctx.stroke();
      ctx.lineWidth = 1.8;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(s * .28) * r, Math.sin(s * .28) * r);
        ctx.lineTo(Math.cos(s * .34) * (r + 8), Math.sin(s * .34) * (r + 8));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.restore();
    }
    ctx.restore();
  }

  function readout(ctx, t, m, r, glow, tone) {
    const cy = tone(CYAN);
    ctx.strokeStyle = rgba(cy, .36);
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU, r0 = r, r1 = r + (i % 10 === 0 ? 6 : 2.4);
      ctx.beginPath();
      ctx.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
      ctx.lineTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
      ctx.stroke();
    }
    const sw = t * 1.2 * (1 + m.spin * 2);
    ctx.strokeStyle = rgba(cy, .85 * glow);
    ctx.lineWidth = 2;
    ctx.shadowBlur = 9; ctx.shadowColor = rgba(cy, 1);
    ctx.beginPath(); ctx.arc(C, C, r + 2, sw, sw + .42); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function wyrmlings(ctx, t, m, glow, tone) {
    const count = Math.round(m.wyrm);
    if (count < 1) return;
    const TYPES = [tone(GOLD), tone(EMBER), tone(GOLD), mix(tone(ASH), tone(GOLD), .35)];
    for (let i = 0; i < count; i++) {
      const sp = .5 + i * .13;
      const a = t * sp + i * (TAU / count) + i * .7;
      const rr = R * (1.30 + .07 * i) + Math.sin(t * 1.3 + i) * 2.5;
      const px = C + Math.cos(a) * rr, py = C + Math.sin(a) * rr;
      const tx = px - Math.cos(a + Math.PI / 2) * 9 * sp, ty = py - Math.sin(a + Math.PI / 2) * 9 * sp;
      const col = TYPES[i % TYPES.length];
      const grad = ctx.createLinearGradient(px, py, tx, ty);
      grad.addColorStop(0, rgba(col, .8 * glow));
      grad.addColorStop(1, rgba(col, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = rgba(mix(col, tone(HEAT), .5), .9 * glow);
      ctx.shadowBlur = 6; ctx.shadowColor = rgba(col, 1);
      ctx.beginPath(); ctx.arc(px, py, 1.6, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function draw(o, t, dt) {
    const { ctx, cur } = o;
    for (const k of KEYS) cur[k] += (o.target[k] - cur[k]) * Math.min(1, dt * 2.2);
    o.rot += cur.spin * dt * 2.2;

    const tone = (c) => mix(c, GRAY, cur.ash);
    const ember = tone(EMBER), lo = tone(EMBER_LO);
    const breath = ease((Math.sin(t * TAU * cur.hz) + 1) / 2);
    const glow = cur.energy * (.7 + .3 * breath);
    const rad = R * .80 * (1 + breath * .025 + cur.flare * .04);

    ctx.clearRect(0, 0, 160, 160);

    const g = ctx.createRadialGradient(C, C, rad * .3, C, C, R * 1.5);
    g.addColorStop(0, rgba(ember, .2 * glow));
    g.addColorStop(1, rgba(lo, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 160, 160);

    const art = coreArt[visualStyle] ?? coreArt.aeryx;
    if (art.complete && art.naturalWidth) {
      ctx.save();
      ctx.translate(C, C);
      ctx.scale(1 + breath * .012, 1 + breath * .012);
      ctx.beginPath(); ctx.arc(0, 0, 72, 0, TAU); ctx.clip();
      ctx.filter = (cur.ash > .5 ? 'saturate(.55) brightness(.72)' : `brightness(${.65 + .35 * glow})`) + (visualStyle === 'violet' ? ' hue-rotate(68deg)' : '');
      ctx.drawImage(art, -72, -72, 144, 144);
      ctx.filter = 'none';
      ctx.restore();
    } else {
      hide(ctx, t, cur, o.rot * 1.1, rad, glow, tone, o.tiles);
      collar(ctx, t, cur, o.rot, rad, glow, tone, o.lite);
    }
    if (!o.lite) wyrmlings(ctx, t, cur, glow, tone);
    clamps(ctx, t, cur, R * 1.26, glow, tone);
    if (!o.lite) readout(ctx, t, cur, R * 1.32, glow, tone);

    if (cur.flare > .02) {
      ctx.strokeStyle = rgba(ember, .45 * cur.flare * (.5 + .5 * Math.sin(t * 9)));
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(C, C, R * 1.2, 0, TAU); ctx.stroke();
    }
  }

  const instances = [];
  let running = false, last = 0;

  function frame(now) {
    const t = now / 1000;
    const dt = Math.min(.05, t - last || .016);
    last = t;
    for (const o of instances) draw(o, t, dt);
    if (!REDUCED) requestAnimationFrame(frame);
  }

  return {
    STATES: Object.keys(STATES),
    setVisualStyle(style) {
      if (!THEMES.includes(style)) return;
      visualStyle = style;
      try { localStorage.setItem('aeryx.theme', style); } catch { }
      usePalette(style);
      document.documentElement.dataset.persona = style;
      if (REDUCED) requestAnimationFrame(frame);
    },
    attach(canvas, size, opts = {}) {
      const ctx = canvas.getContext('2d');
      const DPR = window.devicePixelRatio || 1;
      canvas.width = size * DPR;
      canvas.height = size * DPR;
      canvas.style.width = canvas.style.height = size + 'px';
      ctx.scale(size * DPR / 160, size * DPR / 160);
      const initial = STATES[opts.state] ? opts.state : 'offline';
      const lite = opts.lite ?? size < 110;
      const o = {
        ctx, lite,
        tiles: lite ? 130 : size < 200 ? 260 : 460,
        state: initial,
        target: { ...STATES[initial] },
        cur: { ...STATES[initial] },
        rot: 0,
      };
      instances.push(o);
      if (!running) {
        running = true;
        requestAnimationFrame(frame);
        if (REDUCED) requestAnimationFrame(frame);
      }
      return {
        set(state) {
          if (!STATES[state] || state === o.state) return;
          o.state = state;
          o.target = { ...STATES[state] };
          if (REDUCED) {
            o.cur = { ...o.target };
            requestAnimationFrame(frame);
          }
        },
        get state() { return o.state; },
      };
    },
  };
})();
