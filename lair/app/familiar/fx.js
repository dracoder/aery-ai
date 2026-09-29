import * as T from 'three';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const bell = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));

const BLUE = new T.Color(0x3f86ff), RED = new T.Color(0xff2d48), VIOLET = new T.Color(0xa64dff), WHITE = new T.Color(0xf6eeff), ICE = new T.Color(0x9fd8ff);
const hex = (a, b, burst, spark, glow) => ({ a: new T.Color(a), b: new T.Color(b), burst: new T.Color(burst), spark: new T.Color(spark), glow });
export const PALETTES = {
  aeryx: hex(0x3fd2ff, 0xc9f3ff, 0x2fa8ff, 0x9fe8ff, 0x3fb8ff),
  aeri: hex(0xffa040, 0xff3a2a, 0xff5a2a, 0xffc38a, 0xff6a3a),
  violet: hex(0x3f86ff, 0xff2d48, 0xa64dff, 0x9fd8ff, 0xb07aff),
};

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.16, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.42, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new T.CanvasTexture(c);
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 100, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.6, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new T.CanvasTexture(c);
}

function swirlTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  for (let arm = 0; arm < 5; arm++) {
    g.rotate((Math.PI * 2) / 5);
    for (let i = 0; i < 70; i++) {
      const t = i / 70, r = 8 + t * 116, a = t * 3.4;
      g.fillStyle = `rgba(255,255,255,${(1 - t) * 0.5})`;
      g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 5 * (1 - t) + 1, 0, Math.PI * 2); g.fill();
    }
  }
  return new T.CanvasTexture(c);
}

const additive = (params) => ({ transparent: true, depthWrite: false, depthTest: false, blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.SrcAlphaFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor, toneMapped: false, ...params });

function kit() {
  const disposables = [];
  const own = (o) => { disposables.push(o); return o; };
  const tex = { glow: own(glowTexture()), ring: own(ringTexture()), swirl: own(swirlTexture()) };
  return { own, tex, dispose: () => disposables.forEach((d) => d.dispose?.()) };
}

function sprite(k, group, map, color, scale = 1) {
  const s = new T.Sprite(k.own(new T.SpriteMaterial(additive({ map, color: color.clone(), opacity: 0 }))));
  s.scale.setScalar(scale);
  group.add(s);
  return s;
}

function crackle(k, group, color, count, width = 0.009) {
  const SEG = 8;
  const geo = k.own(new T.BufferGeometry());
  const pos = new Float32Array(count * SEG * 4 * 3), col = new Float32Array(count * SEG * 4 * 3), idx = [];
  for (let i = 0; i < count * SEG; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new T.Mesh(geo, k.own(new T.MeshBasicMaterial(additive({ vertexColors: true, side: T.DoubleSide }))));
  mesh.frustumCulled = false;
  group.add(mesh);
  const a = new T.Vector3(), b = new T.Vector3(), p = new T.Vector3(), q = new T.Vector3();
  let last = -1;
  return (origins, reach, strength, t) => {
    mesh.visible = strength > 0 && origins.length > 0;
    if (Math.floor(t * 24) === last && strength > 0) return;
    last = Math.floor(t * 24);
    col.fill(0);
    if (strength > 0 && origins.length) {
      for (let i = 0; i < count; i++) {
        if (Math.random() > 0.7) continue;
        const o = origins[i % origins.length];
        a.copy(o).add(new T.Vector3((Math.random() - 0.5) * reach * 0.4, (Math.random() - 0.5) * reach * 0.4, 0));
        b.set(o.x + (Math.random() - 0.5) * reach * 2.2, o.y + (Math.random() - 0.5) * reach * 2.2, o.z + (Math.random() - 0.2) * reach);
        p.copy(a);
        for (let s = 0; s < SEG; s++) {
          q.lerpVectors(a, b, (s + 1) / SEG);
          if (s < SEG - 1) { q.x += (Math.random() - 0.5) * reach * 0.4; q.y += (Math.random() - 0.5) * reach * 0.4; }
          const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1, w = width * (1 - (s / SEG) * 0.7);
          const nx = (-dy / len) * w, ny = (dx / len) * w, base = (i * SEG + s) * 12;
          pos.set([p.x - nx, p.y - ny, p.z, p.x + nx, p.y + ny, p.z, q.x + nx, q.y + ny, q.z, q.x - nx, q.y - ny, q.z], base);
          const kk = strength * (1 - (s / SEG) * 0.5);
          for (let v = 0; v < 4; v++) col.set([color.r * kk, color.g * kk, color.b * kk], base + v * 3);
          p.copy(q);
        }
      }
    }
    geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true;
  };
}

function particles(k, group, n, size) {
  const geo = k.own(new T.BufferGeometry());
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  const pts = new T.Points(geo, k.own(new T.PointsMaterial(additive({ map: k.tex.glow, size, vertexColors: true }))));
  pts.frustumCulled = false;
  group.add(pts);
  return { pos, col, flush: () => { geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true; } };
}

function streaks(k, group, n, P = PALETTES.violet) {
  const geo = k.own(new T.BufferGeometry());
  const pos = new Float32Array(n * 12), col = new Float32Array(n * 12), idx = [];
  for (let i = 0; i < n; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new T.Mesh(geo, k.own(new T.MeshBasicMaterial(additive({ vertexColors: true, side: T.DoubleSide }))));
  mesh.frustumCulled = false;
  group.add(mesh);
  const st = Array.from({ length: n }, () => ({ a: Math.random() * Math.PI * 2, r0: 0.1 + Math.random() * 0.45, v: 1.2 + Math.random() * 3.2, len: 0.1 + Math.random() * 0.4, w: 0.004 + Math.random() * 0.012, z: -0.2 - Math.random() * 0.5, tint: Math.random(), delay: Math.random() * 0.3 }));
  const C = new T.Color();
  return (center, t, life = 1.5, gain = 1) => {
    for (let i = 0; i < n; i++) {
      const s = st[i], local = t - s.delay, b = i * 12;
      if (local <= 0 || local > life) { col.fill(0, b, b + 12); continue; }
      const r = s.r0 + s.v * local * (1 + local), len = s.len * (1 + local * 2.5);
      const ca = Math.cos(s.a), sa = Math.sin(s.a), nx = -sa * s.w, ny = ca * s.w;
      const x0 = center.x + ca * r, y0 = center.y + sa * r * 0.9, x1 = center.x + ca * (r + len), y1 = center.y + sa * (r + len) * 0.9;
      pos.set([x0 - nx, y0 - ny, s.z, x0 + nx, y0 + ny, s.z, x1 + nx, y1 + ny, s.z, x1 - nx, y1 - ny, s.z], b);
      C.copy(s.tint < 0.5 ? P.burst : s.tint < 0.82 ? WHITE : P.a).multiplyScalar(bell(local, 0, life) * 1.3 * gain);
      col.set([C.r * 0.1, C.g * 0.1, C.b * 0.1, C.r * 0.1, C.g * 0.1, C.b * 0.1, C.r, C.g, C.b, C.r, C.g, C.b], b);
    }
    geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true;
  };
}

function charge(k, group, color, size) {
  const g = new T.Group();
  const core = new T.Mesh(k.own(new T.SphereGeometry(size, 28, 18)), k.own(new T.MeshBasicMaterial({ color: color.clone().lerp(WHITE, 0.3), toneMapped: false, transparent: true })));
  const halo = sprite(k, g, k.tex.glow, color.clone().multiplyScalar(0.8), size * 8);
  const swirl = sprite(k, g, k.tex.swirl, color, size * 6);
  g.add(core);
  g.visible = false;
  group.add(g);
  return { g, core, halo, swirl };
}

export const CONVERGENCE = { charge: 1.25, reveal: 1.0, total: 2.6 };

export function createConvergence(scene, { center = new T.Vector3(0, 0.02, 0), height = 1, palette = PALETTES.violet } = {}) {
  const P = palette;
  const k = kit();
  const group = new T.Group();
  group.renderOrder = 10;
  scene.add(group);

  const blue = charge(k, group, P.a, 0.04), red = charge(k, group, P.b, 0.04);
  const halo = sprite(k, group, k.tex.glow, P.burst, 1.4);
  halo.position.copy(center).setZ(center.z - 0.25);
  const vortex = [[particles(k, group, 520, 0.02), 520], [particles(k, group, 120, 0.055), 120]].map(([sys, n]) => ({ sys, st: Array.from({ length: n }, () => ({ q: new T.Quaternion().setFromEuler(new T.Euler((Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 1.1, Math.random() * Math.PI)), a0: Math.random() * Math.PI * 2, r: 0.45 + Math.random() * 0.75, v: 0.35 + Math.random() * 0.6, ph: Math.random(), tint: Math.random() })) }));
  const V = new T.Vector3();
  const trail = particles(k, group, 180, 0.05);
  const history = { blue: [], red: [] };

  const flash = sprite(k, group, k.tex.glow, WHITE, 0.01);
  flash.position.copy(center);
  const purple = charge(k, group, P.burst, 0.12);
  purple.g.position.copy(center);
  const rings = [0, 0.12].map((delay, i) => {
    const m = new T.Mesh(k.own(new T.PlaneGeometry(1, 1)), k.own(new T.MeshBasicMaterial(additive({ map: k.tex.glow, color: (i ? P.spark : P.burst).clone(), opacity: 0, side: T.DoubleSide }))));
    m.position.copy(center);
    group.add(m);
    return { m, delay, flat: false };
  });

  const SHARDS = 120;
  const shardMat = k.own(new T.MeshStandardMaterial({ color: 0x3a3440, roughness: 0.5, metalness: 0.25, emissive: P.burst, emissiveIntensity: 1.2, transparent: true }));
  const shards = new T.InstancedMesh(k.own(new T.TetrahedronGeometry(0.03, 0)), shardMat, SHARDS);
  shards.instanceMatrix.setUsage(T.DynamicDrawUsage);
  shards.visible = false;
  group.add(shards);
  const shardState = Array.from({ length: SHARDS }, (_, i) => {
    const dir = new T.Vector3(Math.random() * 2 - 1, Math.random() * 1.6 - 0.5, Math.random() * 2 - 1).normalize();
    return { p: center.clone().addScaledVector(dir, 0.05 + Math.random() * 0.15), v: dir.multiplyScalar(1 + Math.random() * 2.4), r: new T.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new T.Vector3(Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7), s: 0.5 + Math.random() * 1.2 + (i % 9 === 0 ? 1.3 : 0) };
  });
  const warp = streaks(k, group, 190, P);
  const spiral = particles(k, group, 220, 0.022);
  const spiralState = Array.from({ length: 220 }, (_, i) => ({ a: (i / 220) * Math.PI * 16, h: Math.random(), r: 0.3 + Math.random() * 0.25, s: 0.7 + Math.random() * 0.6, tint: Math.random() }));

  const M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(), C = new T.Color();
  let burstFired = false;

  const orbit = (o, side, t, hist) => {
    const kk = ease(t / CONVERGENCE.charge);
    const ang = side * (Math.PI * 0.5 + (1 - kk) * Math.PI * 2.4);
    const rad = 0.9 * (1 - kk) + 0.04;
    o.g.position.set(center.x + Math.cos(ang) * rad * side, center.y + 0.26 * (1 - kk), center.z + 0.25 + Math.sin(ang) * rad * 0.5);
    o.g.visible = t < CONVERGENCE.charge;
    const grow = ease(t / 0.3) * (1 + kk * 0.8) * (1 + Math.sin(t * 26) * 0.08);
    o.g.scale.setScalar(grow);
    o.halo.material.opacity = 0.95; o.swirl.material.opacity = 0.8; o.swirl.material.rotation = t * 7 * side;
    hist.unshift(o.g.position.clone());
    if (hist.length > 90) hist.length = 90;
  };

  return {
    group,
    update(t, dt) {
      const out = { tremble: 0, glow: 0, bloom: 0, exposure: 0, shake: 0, chroma: 0, reveal: null, burst: false, done: t >= CONVERGENCE.total };
      const ch = clamp01(t / CONVERGENCE.charge);
      const after = t - CONVERGENCE.charge;

      if (t < CONVERGENCE.charge) {
        orbit(blue, -1, t, history.blue);
        orbit(red, 1, t, history.red);
        halo.material.opacity = ch * 0.6 * (0.8 + 0.2 * Math.sin(t * 18));
        halo.scale.setScalar(0.8 + ch * 0.9);
        for (const { sys, st } of vortex) {
          for (let i = 0; i < st.length; i++) {
            const s = st[i], u = (s.ph + t * s.v * (1 + ch)) % 1, r = s.r * Math.pow(1 - u, 1.4) + 0.03, a = s.a0 + u * u * 7 + t * 1.2;
            V.set(Math.cos(a) * r, Math.sin(a) * r * 0.55, 0).applyQuaternion(s.q);
            sys.pos.set([center.x + V.x, center.y + V.y, center.z + 0.3 + V.z * 0.5], i * 3);
            C.copy(s.tint < 0.5 ? P.spark : s.tint < 0.8 ? P.a : WHITE).multiplyScalar(Math.pow(Math.sin(u * Math.PI), 1.5) * (0.35 + ch * 0.9));
            sys.col.set([C.r, C.g, C.b], i * 3);
          }
          sys.flush();
        }
        out.tremble = Math.pow(ch, 2.2) * 0.02;
        out.glow = Math.pow(ch, 1.5) * 0.42;
        out.bloom = ch * 0.32;
        out.exposure = ch * 0.04;
      } else {
        blue.g.visible = red.g.visible = false;
        halo.material.opacity = Math.max(0, 0.6 - after * 2);
        for (const { sys } of vortex) { sys.col.fill(0); sys.flush(); }
        for (let i = 0; i < 3; i++) { history.blue.pop(); history.red.pop(); }
      }
      for (const [hist, color, off] of [[history.blue, P.a, 0], [history.red, P.b, 90]]) {
        for (let i = 0; i < 90; i++) {
          const p = hist[i];
          const f = p ? Math.pow(1 - i / 90, 1.6) * 0.9 : 0;
          if (p) trail.pos.set([p.x, p.y, p.z], (off + i) * 3);
          trail.col.set([color.r * f, color.g * f, color.b * f], (off + i) * 3);
        }
      }
      trail.flush();

      if (after >= 0 && !burstFired) { burstFired = true; out.burst = true; shards.visible = true; }
      if (after >= 0) {
        flash.scale.setScalar(0.2 + ease(after / 0.14) * 1.3 * height);
        flash.material.opacity = 0.75 * clamp01(1 - (after - 0.05) / 0.22);
        flash.material.color.copy(WHITE).lerp(P.burst, clamp01(after / 0.3));
        purple.g.visible = after < 0.7;
        purple.g.scale.setScalar(0.4 + ease(after / 0.35) * 2.6);
        purple.core.material.opacity = clamp01(1 - after / 0.55);
        purple.halo.material.opacity = clamp01(1 - after / 0.6);
        purple.swirl.material.opacity = clamp01(1 - after / 0.6); purple.swirl.material.rotation = after * 9;
        for (const { m, delay, flat } of rings) {
          const kk = clamp01((after - delay) / 0.8);
          const r = 0.1 + ease(kk) * (flat ? 3.4 : 2.6) * height;
          m.scale.set(r, r, 1);
          m.material.opacity = kk > 0 && kk < 1 ? Math.pow(1 - kk, 2) * 0.55 : 0;
        }
        const life = clamp01(after / 1.4);
        for (let i = 0; i < SHARDS; i++) {
          const s = shardState[i];
          s.v.multiplyScalar(Math.exp(-2 * dt)); s.v.y -= 0.6 * dt;
          s.p.addScaledVector(s.v, dt);
          s.r.x += s.w.x * dt; s.r.y += s.w.y * dt; s.r.z += s.w.z * dt;
          Q.setFromEuler(s.r); S.setScalar(s.s * (1 - life));
          shards.setMatrixAt(i, M.compose(s.p, Q, S));
        }
        shards.instanceMatrix.needsUpdate = true;
        shardMat.emissiveIntensity = 1.2 * (1 - life) + 0.15;
        shards.visible = life < 1;
        warp(new T.Vector3(center.x, center.y + 0.1, 0), after, 1.7);
        const sp = bell(after, 0.1, 1.3);
        for (let i = 0; i < 220; i++) {
          const s = spiralState[i];
          const a = s.a + after * 5 * s.s, h = (s.h + after * 0.32 * s.s) % 1;
          spiral.pos.set([center.x + Math.cos(a) * s.r, -0.48 + h * height * 1.05, center.z + Math.sin(a) * s.r * 0.75], i * 3);
          C.copy(s.tint < 0.5 ? P.burst : s.tint < 0.8 ? WHITE : P.spark).multiplyScalar(sp * 0.35 * Math.sin(h * Math.PI));
          spiral.col.set([C.r, C.g, C.b], i * 3);
        }
        spiral.flush();
        out.reveal = clamp01((after - 0.05) / CONVERGENCE.reveal);
        const burst = Math.exp(-after * 4.5);
        out.bloom = 0.25 + burst * 1.0;
        out.exposure = burst * 0.16;
        out.shake = burst * 0.05;
        out.chroma = Math.exp(-after * 6) * 0.018;
      }
      return out;
    },
    dispose() { scene.remove(group); shards.dispose(); k.dispose(); },
  };
}

function orbMaterial() {
  return new T.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uSolid: { value: 0 }, uDeep: { value: new T.Color(0x1a0538) }, uMid: { value: new T.Color(0x7424e0) }, uRim: { value: new T.Color(0xeedcff) } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vO; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vO = position; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uTime; uniform float uOpacity; uniform float uSolid; uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uRim; varying vec3 vN; varying vec3 vV; varying vec3 vO; void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float sw = 0.5 + 0.5 * sin(atan(vO.y, vO.x) * 5.0 + vO.z * 9.0 - uTime * 16.0); vec3 c = mix(uDeep, uMid, clamp(smoothstep(0.1, 0.75, f) + sw * 0.3 * (1.0 - f), 0.0, 1.0)); c = mix(c, uRim, pow(f, 3.0)); gl_FragColor = vec4(c * 1.6, uOpacity * mix(0.84 + 0.16 * f, 1.0, uSolid)); }',
    transparent: true, depthWrite: false, depthTest: false, side: T.DoubleSide, toneMapped: false,
  });
}

export const CAST = { stance: 1.0, merge: 0.74, hold: 0.8, holdRate: 0.14, after: 1.5, fire: 0.98, clip: 2.73 };
CAST.total = CAST.stance + CAST.merge + CAST.hold + (CAST.clip - CAST.merge - CAST.hold * CAST.holdRate) / CAST.after;
const castClock = (t) => {
  const a = t - CAST.stance;
  if (a <= 0) return 0;
  if (a <= CAST.merge) return a;
  const h = a - CAST.merge;
  if (h <= CAST.hold) return CAST.merge + h * CAST.holdRate;
  return CAST.merge + CAST.hold * CAST.holdRate + (h - CAST.hold) * CAST.after;
};

export function createCast(scene, camera, { hands }) {
  const k = kit();
  const group = new T.Group();
  group.renderOrder = 11;
  scene.add(group);
  const blue = charge(k, group, BLUE, 0.045), red = charge(k, group, RED, 0.045), purple = charge(k, group, VIOLET, 0.055);
  blue.core.material.color.copy(BLUE).lerp(WHITE, 0.08); red.core.material.color.copy(RED).lerp(WHITE, 0.08);
  const shell = new T.Mesh(k.own(new T.IcosahedronGeometry(0.1, 2)), k.own(new T.MeshBasicMaterial(additive({ color: VIOLET.clone().lerp(WHITE, 0.2), opacity: 0.28, wireframe: true }))));
  purple.g.add(shell);
  const ripples = [0, 1, 2, 3].map((i) => {
    const m = new T.Mesh(k.own(new T.PlaneGeometry(1, 1)), k.own(new T.MeshBasicMaterial(additive({ map: k.tex.ring, color: (i % 2 ? WHITE : VIOLET).clone(), opacity: 0 }))));
    group.add(m);
    return m;
  });
  const bolts = crackle(k, group, ICE, 12, 0.007);
  const violetBolts = crackle(k, group, VIOLET.clone().lerp(WHITE, 0.35), 10, 0.008);
  const inflow = particles(k, group, 160, 0.028);
  const inflowState = Array.from({ length: 160 }, () => ({ a: Math.random() * Math.PI * 2, e: Math.random() * Math.PI - Math.PI / 2, r: 0.2 + Math.random() * 0.45, v: 0.8 + Math.random() * 1.6, tint: Math.random() }));
  const aura = particles(k, group, 150, 0.035);
  const auraState = Array.from({ length: 150 }, () => ({ a: Math.random() * Math.PI * 2, h: Math.random(), r: 0.2 + Math.random() * 0.2, v: 0.35 + Math.random() * 0.6, tint: Math.random() }));
  const shock = [0, 0.07, 0.16].map((delay, i) => {
    const m = new T.Mesh(k.own(new T.PlaneGeometry(1, 1)), k.own(new T.MeshBasicMaterial(additive({ map: k.tex.ring, color: (i === 1 ? WHITE : VIOLET).clone(), opacity: 0 }))));
    group.add(m);
    return { m, delay };
  });
  const warp = streaks(k, group, 170);
  const orb = new T.Mesh(k.own(new T.SphereGeometry(1, 48, 32)), k.own(orbMaterial()));
  orb.visible = false;
  orb.frustumCulled = false;
  group.add(orb);
  const L = new T.Vector3(), R = new T.Vector3(), mid = new T.Vector3(), lead = new T.Vector3(), toCam = new T.Vector3(), C = new T.Color();
  const body = new T.Vector3();
  let firedAt = -1, passedAt = -1;
  const fireFrom = new T.Vector3();

  return {
    group,
    update(t, dt) {
      const out = { bloom: 0, exposure: 0, shake: 0, chroma: 0, flash: false, clipTime: Math.min(castClock(t), CAST.clip), done: t >= CAST.total };
      hands(L, R);
      mid.addVectors(L, R).multiplyScalar(0.5);
      lead.copy(R.z > L.z ? R : L);
      body.set(mid.x * 0.3, 0, mid.z * 0.3);
      const clipT = t > CAST.stance ? out.clipTime : 0;
      const holdT = Math.max(0, t - CAST.stance - CAST.merge);
      const build = clamp01(t / CAST.stance);
      const merged = t - CAST.stance >= CAST.merge, fired = merged && clipT >= CAST.fire && holdT > CAST.hold;

      blue.g.visible = red.g.visible = !merged;
      if (!merged) {
        const orbit = t < CAST.stance ? 0.24 * (1 - ease(t / CAST.stance)) + 0.03 : 0.03, spin = t * 7;
        blue.g.position.set(L.x + Math.cos(spin) * orbit, L.y + Math.sin(spin) * orbit * 0.8, L.z + 0.04);
        red.g.position.set(R.x - Math.cos(spin) * orbit, R.y - Math.sin(spin) * orbit * 0.8, R.z + 0.04);
        if (t > CAST.stance) { const pull = ease(clipT / CAST.merge); blue.g.position.lerp(mid, pull * 0.8); red.g.position.lerp(mid, pull * 0.8); }
        const s = ease(t / 0.45) * (0.8 + build * 0.9) * (1 + Math.sin(t * 28) * 0.1);
        for (const [o, side] of [[blue, 1], [red, -1]]) { o.g.scale.setScalar(s); o.halo.material.opacity = 0.9; o.swirl.material.opacity = 1; o.swirl.material.rotation = t * 8 * side; }
        bolts([blue.g.position, red.g.position], 0.12, 0.35 + build * 0.6, t);
        out.bloom = 0.12 + build * 0.3;
      } else bolts([], 0, 0, t);

      if (merged && !fired) {
        const kk = ease(holdT / 0.35), grow = clamp01(holdT / CAST.hold);
        purple.g.visible = true;
        purple.g.position.lerpVectors(mid, lead, clamp01(holdT / 0.3)).add(toCam.subVectors(camera.position, lead).normalize().multiplyScalar(0.06));
        purple.g.scale.setScalar(0.35 + kk * 0.55 + grow * 0.35 + Math.sin(t * 34) * 0.04);
        purple.halo.material.opacity = 0.75; purple.swirl.material.opacity = 1; purple.swirl.material.rotation = t * 12;
        shell.rotation.y += dt * 11; shell.rotation.x += dt * 6;
        violetBolts([purple.g.position], 0.15, 1.6, t);
        ripples.forEach((m, i) => {
          const ph = (t * 2.2 + i / 4) % 1;
          m.position.copy(purple.g.position); m.quaternion.copy(camera.quaternion);
          m.scale.setScalar(0.06 + ph * 0.55); m.material.opacity = (1 - ph) * 0.85;
        });
        out.bloom = 0.3 + grow * 0.3; out.exposure = 0.03; out.shake = grow * 0.006;
      } else if (!fired) { violetBolts([], 0, 0, t); ripples.forEach((m) => { m.material.opacity = 0; }); }

      const inK = merged && !fired ? 1 : !merged && t > CAST.stance ? 0.5 : 0;
      for (let i = 0; i < 160; i++) {
        const s = inflowState[i];
        const ph = (s.v * t + i / 160) % 1, r = s.r * (1 - ph);
        const target = merged ? purple.g.position : mid;
        inflow.pos.set([target.x + Math.cos(s.a + ph * 4) * Math.cos(s.e) * r, target.y + Math.sin(s.e) * r, target.z + Math.sin(s.a + ph * 4) * Math.cos(s.e) * r], i * 3);
        C.copy(s.tint < 0.5 ? VIOLET : s.tint < 0.75 ? BLUE : RED).multiplyScalar(inK * ph);
        inflow.col.set([C.r, C.g, C.b], i * 3);
      }
      inflow.flush();

      if (fired) {
        if (firedAt < 0) { firedAt = t; fireFrom.copy(purple.g.visible ? purple.g.position : lead); }
        const f = t - firedAt, SWELL = 0.14, PASS = 0.5;
        const swell = ease(f / SWELL), travel = Math.pow(clamp01((f - SWELL) / (PASS - SWELL)), 2);
        purple.g.visible = f < SWELL;
        purple.g.scale.setScalar(1.2 + swell * 0.8);
        purple.core.material.opacity = purple.halo.material.opacity = 1 - swell;
        shell.material.opacity = 0;
        ripples.forEach((m) => { m.material.opacity = 0; });
        orb.visible = f < PASS;
        if (orb.visible) {
          orb.position.lerpVectors(fireFrom, camera.position, travel * 0.985);
          orb.scale.setScalar(0.07 + swell * 0.13 + travel * 0.32);
          orb.rotation.z = t * 3;
          orb.material.uniforms.uTime.value = t;
          orb.material.uniforms.uOpacity.value = swell;
          orb.material.uniforms.uSolid.value = clamp01((travel - 0.4) / 0.4);
          violetBolts([orb.position], 0.16 + swell * 0.1, 1.8 * clamp01(1 - travel / 0.3), t);
        } else violetBolts([], 0, 0, t);
        if (f >= PASS && passedAt < 0) { passedAt = t; out.flash = true; }
        const p = passedAt < 0 ? -1 : t - passedAt;
        toCam.subVectors(camera.position, fireFrom);
        for (const { m, delay } of shock) {
          const kk = p < 0 ? 0 : clamp01((p - delay) / 0.7);
          m.position.copy(camera.position).addScaledVector(toCam, -0.45); m.quaternion.copy(camera.quaternion);
          m.scale.setScalar(0.05 + ease(kk) * 1.6);
          m.material.opacity = kk > 0 && kk < 1 ? (1 - kk) * 0.9 : 0;
        }
        warp(new T.Vector3(fireFrom.x, fireFrom.y, 0), p, 1.2, 0.9);
        const decay = p < 0 ? 0 : Math.exp(-p * 4.5);
        out.bloom = p < 0 ? 0.35 + travel * 0.5 : 0.25 + decay * 0.9;
        out.exposure = p < 0 ? travel * 0.08 : decay * 0.15;
        out.shake = p < 0 ? travel * 0.02 : Math.exp(-p * 5) * 0.06;
        out.chroma = p < 0 ? travel * 0.01 : Math.exp(-p * 6) * 0.024;
      }

      const auraK = bell(t, 0, CAST.total) * 1.2;
      for (let i = 0; i < 150; i++) {
        const s = auraState[i];
        const h = (s.h + t * s.v) % 1, a = s.a + t * 2.4;
        aura.pos.set([body.x + Math.cos(a) * s.r, -0.48 + h * 0.95, body.z + Math.sin(a) * s.r * 0.8], i * 3);
        C.copy(s.tint < 0.6 ? ICE : VIOLET).multiplyScalar(auraK * Math.sin(h * Math.PI) * 0.8);
        aura.col.set([C.r, C.g, C.b], i * 3);
      }
      aura.flush();
      return out;
    },
    dispose() { scene.remove(group); k.dispose(); },
  };
}

export function createAura(scene, P = PALETTES.violet) {
  const k = kit();
  const group = new T.Group();
  scene.add(group);
  const pts = particles(k, group, 70, 0.03);
  const st = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, h: Math.random(), r: 0.28 + Math.random() * 0.22, v: 0.05 + Math.random() * 0.12, s: 0.4 + Math.random() * 0.6, tint: Math.random() }));
  const C = new T.Color();
  return {
    update(t, strength) {
      group.visible = strength > 0.01;
      if (!group.visible) return;
      for (let i = 0; i < 70; i++) {
        const s = st[i], h = (s.h + t * s.v) % 1, a = s.a + t * 0.6 * s.s;
        pts.pos.set([Math.cos(a) * s.r, -0.46 + h * 1.05, Math.sin(a) * s.r * 0.7], i * 3);
        C.copy(s.tint < 0.7 ? P.spark : P.burst).multiplyScalar(strength * 0.5 * Math.sin(h * Math.PI) * (0.6 + 0.4 * Math.sin(t * 3 + i)));
        pts.col.set([C.r, C.g, C.b], i * 3);
      }
      pts.flush();
    },
    dispose() { scene.remove(group); k.dispose(); },
  };
}

export function createRoar(scene, camera, { origin, palette = PALETTES.aeryx }) {
  const P = palette;
  const k = kit();
  const group = new T.Group();
  group.renderOrder = 12;
  scene.add(group);
  const rings = [0, 0.1, 0.22].map((delay, i) => {
    const m = new T.Mesh(k.own(new T.PlaneGeometry(1, 1)), k.own(new T.MeshBasicMaterial(additive({ map: k.tex.ring, color: (i === 1 ? WHITE : P.burst).clone(), opacity: 0 }))));
    group.add(m);
    return { m, delay };
  });
  const glow = sprite(k, group, k.tex.glow, P.burst, 0.3);
  const embers = particles(k, group, 160, 0.03);
  const st = Array.from({ length: 160 }, () => {
    const d = new T.Vector3(Math.random() - 0.5, Math.random() * 0.8 - 0.2, 0.6 + Math.random()).normalize();
    return { d, v: 0.8 + Math.random() * 2.2, tint: Math.random(), delay: Math.random() * 0.25 };
  });
  const warp = streaks(k, group, 120, P);
  const C = new T.Color(), at = new T.Vector3();
  return {
    update(t) {
      origin(at);
      const out = { bloom: 0, exposure: 0, shake: 0, chroma: 0, done: t >= 2.1 };
      const hit = t - 0.25;
      glow.position.copy(at);
      glow.scale.setScalar(0.2 + ease(clamp01(t / 0.3)) * 0.6);
      glow.material.opacity = bell(t, 0, 1.1) * 0.9;
      for (const { m, delay } of rings) {
        const kk = clamp01((hit - delay) / 0.9);
        m.position.copy(at); m.quaternion.copy(camera.quaternion);
        m.scale.setScalar(0.05 + ease(kk) * 2.6);
        m.material.opacity = kk > 0 && kk < 1 ? (1 - kk) * 0.85 : 0;
      }
      for (let i = 0; i < 160; i++) {
        const s = st[i], local = hit - s.delay;
        const d = local > 0 ? s.v * local * (1 - local * 0.25) : 0;
        embers.pos.set([at.x + s.d.x * d, at.y + s.d.y * d, at.z + s.d.z * d], i * 3);
        C.copy(s.tint < 0.5 ? P.a : s.tint < 0.8 ? P.spark : WHITE).multiplyScalar(local > 0 ? bell(local, 0, 1.5) : 0);
        embers.col.set([C.r, C.g, C.b], i * 3);
      }
      embers.flush();
      warp(new T.Vector3(at.x, at.y, 0), hit, 1.2, 0.7);
      if (hit > 0) {
        const decay = Math.exp(-hit * 4);
        out.bloom = 0.2 + decay * 0.9; out.exposure = decay * 0.12; out.shake = decay * 0.045; out.chroma = Math.exp(-hit * 7) * 0.014;
      }
      return out;
    },
    dispose() { scene.remove(group); k.dispose(); },
  };
}
