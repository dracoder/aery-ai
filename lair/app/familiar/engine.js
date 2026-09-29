import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SavePass } from 'three/examples/jsm/postprocessing/SavePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CONVERGENCE, PALETTES, createAura, createCast, createConvergence, createRoar } from './fx.js';

const THEME_LIGHTS = {
  aeryx: { accent: 0x6fe3ff, rim: 0x3aa8ff, floor: 0x0a2a4a },
  aeri: { accent: 0xffa14a, rim: 0xff4a3a, floor: 0x3a0c0c },
  violet: { accent: 0xc28cff, rim: 0x8f52ff, floor: 0x1c0c3a },
};
export const PERSONAS = {
  aeryx: { label: 'Aeryx', ...THEME_LIGHTS.aeryx, fx: 'convergence', palette: 'aeryx' },
  aeri: { label: 'Aeri', ...THEME_LIGHTS.aeri, fx: 'convergence', palette: 'aeri' },
};
export const FORMS = ['core', 'dragon', 'human'];
const FX = ['convergence'];

export function registerPersona(id, { label, theme, base, forms, fx, tap } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id) || id === 'aeryx' || id === 'aeri' || typeof base !== 'string') return false;
  const own = (forms ?? []).filter((f) => FORMS.includes(f));
  if (!own.length) return false;
  PERSONAS[id] = { label: String(label ?? id), ...(THEME_LIGHTS[theme] ?? THEME_LIGHTS.aeryx), base, forms: own, fx: FX.includes(fx) ? fx : undefined, tap: typeof tap === 'string' && /^[a-z0-9_-]{1,24}$/.test(tap) ? tap : undefined, palette: PALETTES[theme] ? theme : 'aeryx' };
  return true;
}
const formsOf = (p) => PERSONAS[p]?.forms ?? FORMS;

const FRAMES = {
  core: { height: 0.62, target: [0, 0.02, 0], dist: 2.2, yaw: 0, fitAspect: 0.95, portrait: { dist: 1.95, fitAspect: 0.5 } },
  dragon: { height: 1.0, target: [0.24, 0.02, 0], dist: 3.45, yaw: 0.35, fitAspect: 1.15, portrait: { target: [-0.28, 0.06, 0], dist: 2.9, fitAspect: 0.5 } },
  human: { height: 1.0, target: [0, 0.06, 0], dist: 2.7, yaw: 0.12, fitAspect: 0.7 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

function revealPatch(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = uniforms.reveal;
    shader.uniforms.uEdge = uniforms.edge;
    shader.uniforms.uBounds = uniforms.bounds;
    shader.uniforms.uRadial = uniforms.radial;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRevealPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRevealPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRevealPos;\nuniform float uReveal;\nuniform vec3 uEdge;\nuniform vec2 uBounds;\nuniform vec4 uRadial;\nfloat rh(vec3 p){return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453);}')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfloat rY = uRadial.w > 0.0 ? length(vRevealPos - uRadial.xyz) / uRadial.w : (vRevealPos.y - uBounds.x) / max(0.0001, uBounds.y - uBounds.x);\nfloat rN = rY + (rh(floor(vRevealPos * 90.0)) - 0.5) * 0.08;\nif (rN > uReveal) discard;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uEdge * smoothstep(0.06, 0.0, uReveal - rN) * step(uReveal, 0.999) * 3.0;');
  };
  material.needsUpdate = true;
}

export function createFamiliar(canvas, { assetBase = '/characters/', persona = 'aeryx', form = 'core', onState = () => {}, onError = () => {}, onFx = () => {}, reducedMotion } = {}) {
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    onError(e);
    return { dispose() {}, setPersona() {}, setForm() {}, setActivity() {}, speak() {}, gesture() {}, tap() {}, pointer() {}, preload() {}, prefetch() {}, state: {} };
  }
  const sharp = (() => { try { return localStorage.getItem('aeryx.gfx') === 'high'; } catch { return false; } })();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, sharp ? 3 : 1.5));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(30, 1, 0.01, 60);
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const key = new T.DirectionalLight(0xf2f6ff, 2.4); key.position.set(-2.5, 4, 4); scene.add(key);
  const rim = new T.DirectionalLight(PERSONAS[persona].rim, 3.2); rim.position.set(2.5, 2.2, -3.5); scene.add(rim);
  const fill = new T.HemisphereLight(0xbfd4ff, 0x0b0d14, 0.6); scene.add(fill);
  const glow = new T.PointLight(PERSONAS[persona].accent, 2.2, 3.5, 2); glow.position.set(0, 0.1, 0.6); scene.add(glow);

  const floor = new T.Mesh(new T.CircleGeometry(1.6, 64), new T.MeshBasicMaterial({ color: PERSONAS[persona].floor, transparent: true, opacity: 0.55, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.5; scene.add(floor);
  const ringTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128); grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, 256, 256); return new T.CanvasTexture(c); })();
  floor.material.map = ringTex; floor.material.needsUpdate = true;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const sceneAlpha = new SavePass();
  composer.addPass(sceneAlpha);
  const bloom = new UnrealBloomPass(new T.Vector2(1, 1), 0.22, 0.4, 0.93);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const chroma = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, amount: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv; void main() { vec2 d = (vUv - 0.5) * amount; vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(texture2D(tDiffuse, vUv + d).r, c.g, texture2D(tDiffuse, vUv - d).b, c.a); }',
  });
  chroma.enabled = false;
  composer.addPass(chroma);
  const restoreAlpha = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tAlpha: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; uniform sampler2D tAlpha; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); float a = texture2D(tAlpha, vUv).a; gl_FragColor = vec4(c.rgb, clamp(max(a, max(c.r, max(c.g, c.b))), 0.0, 1.0)); }',
  });
  restoreAlpha.uniforms.tAlpha.value = sceneAlpha.renderTarget.texture;
  composer.addPass(restoreAlpha);

  const loader = new GLTFLoader();
  const cache = new Map();
  const motion = reducedMotion ?? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const state = { persona, form, activity: 'idle', speaking: false, disposed: false, visible: true, inView: true, tapAt: -10 };
  const loaded = new Set();
  const pointerNdc = new T.Vector2(0, 0);
  let pointerActive = false;
  let current = null;
  let incoming = null;
  let clock = new T.Clock();
  let time = 0;

  async function load(p, f) {
    const k = `${p}-${f}`;
    if (cache.has(k)) return cache.get(k);
    const url = PERSONAS[p]?.base ? `${PERSONAS[p].base}${f}.glb` : `${assetBase}${p}-${f}.glb`;
    const promise = new Promise((resolve, reject) => {
      loader.load(url, (gltf) => { const entry = prepare(gltf, f, p); loaded.add(entry); resolve(entry); }, undefined, reject);
    });
    promise.catch(() => cache.delete(k));
    cache.set(k, promise);
    return promise;
  }

  function prepare(gltf, f, p) {
    const root = new T.Group();
    const model = gltf.scene;
    root.add(model);
    const box = new T.Box3().setFromObject(model);
    const size = box.getSize(new T.Vector3());
    const center = box.getCenter(new T.Vector3());
    const scale = FRAMES[f].height / size.y;
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -box.min.y * scale - 0.5, -center.z * scale);
    if (f === 'core') model.position.y = -center.y * scale;
    const uniforms = { reveal: { value: 0 }, edge: { value: new T.Color(PERSONAS[p].accent) }, bounds: { value: new T.Vector2(-0.55, 0.6) }, radial: { value: new T.Vector4(0, 0, 0, 0) } };
    const materials = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const m = o.material.clone();
      if (m.emissive) m.userData.emissive0 = { color: m.emissive.clone(), intensity: m.emissiveIntensity, map: m.emissiveMap };
      revealPatch(m, uniforms);
      o.material = m; materials.push(m);
    });
    const bones = {};
    model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    const rest = {};
    for (const [n, b] of Object.entries(bones)) rest[n] = b.quaternion.clone();
    let mixer = null, actions = {};
    if (gltf.animations.length) {
      mixer = new T.AnimationMixer(model);
      for (const clip of gltf.animations) {
        actions[clip.name] = mixer.clipAction(clip);
      }
      const hips = Object.keys(bones).find((n) => /hips/i.test(n));
      if (hips) {
        for (const clip of gltf.animations) {
          const track = clip.tracks.find((t) => t.name === `${hips}.position`);
          if (!track) continue;
          const v = track.values; const x0 = v[0], z0 = v[2];
          for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
        }
      }
    }
    const hand = (side) => bones[Object.keys(bones).find((n) => new RegExp(`^${side}hand$`, 'i').test(n)) ?? ''];
    return { root, model, form: f, persona: p, uniforms, materials, bones, rest, mixer, actions, playing: null, oneShot: false, posed: false, scale, hands: [hand('left'), hand('right')] };
  }

  function play(entry, name, { fade = 0.35, once = false } = {}) {
    if (!entry?.mixer) return;
    if (entry.oneShot && !once) return;
    const next = entry.actions[name] || entry.actions.idle;
    if (!next || (entry.playing === next && !once)) return;
    next.reset();
    next.setLoop(once ? T.LoopOnce : T.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.play();
    if (entry.playing) entry.playing.crossFadeTo(next, fade, false);
    entry.playing = next;
    if (once) {
      entry.oneShot = true;
      const back = (e) => {
        if (e.action !== next) return;
        entry.mixer.removeEventListener('finished', back);
        if (entry.playing !== next) return;
        entry.oneShot = false; play(entry, baseClip());
      };
      entry.mixer.addEventListener('finished', back);
    }
  }

  function baseClip() {
    if (state.speaking) return 'talk';
    if (state.activity === 'listening') return 'listen';
    return 'idle';
  }

  const Q = new T.Quaternion(), P = new T.Quaternion(), A = new T.Vector3();
  function turn(bone, axis, rad) {
    if (!bone || !rad) return;
    bone.parent.getWorldQuaternion(P).invert();
    A.set(axis[0], axis[1], axis[2]).applyQuaternion(P);
    Q.setFromAxisAngle(A, rad);
    bone.quaternion.premultiply(Q);
  }

  const look = { yaw: 0, pitch: 0 };
  function animateDragon(e, dt) {
    const b = e.bones;
    for (const [n, q] of Object.entries(e.rest)) b[n].quaternion.copy(q);
    const awake = state.activity === 'offline' ? 0.15 : state.activity === 'awaiting' ? 0.5 : 1;
    const t = time;
    const breath = Math.sin(t * 1.5) * awake;
    const since = t - state.tapAt;
    const roar = since < 2.4 ? Math.sin(Math.min(1, since / 2.4) * Math.PI) : 0;
    let yaw = 0, pitch = 0;
    if (pointerActive && state.activity !== 'offline') { yaw = clamp(pointerNdc.x * 0.7, -0.6, 0.6); pitch = clamp(-pointerNdc.y * 0.35, -0.3, 0.35); }
    if (state.activity === 'awaiting') { yaw *= 0.5; pitch = Math.max(pitch, 0.12); }
    look.yaw = damp(look.yaw, yaw, 4, dt); look.pitch = damp(look.pitch, pitch - roar * 0.45, 4, dt);
    const neck = ['neck1', 'neck2', 'neck3'].map((n) => b[n]).filter(Boolean);
    neck.forEach((bone) => { turn(bone, [0, 1, 0], look.yaw * 0.28); turn(bone, [1, 0, 0], look.pitch * 0.22 + breath * 0.012); });
    turn(b.head, [0, 1, 0], look.yaw * 0.35); turn(b.head, [1, 0, 0], look.pitch * 0.4);
    const flap = motion ? 0 : (Math.sin(t * 1.1) * 0.04 + roar * 0.35) * awake + (state.activity === 'working' ? Math.sin(t * 2.4) * 0.05 : 0);
    turn(b.wingL1, [0, 0, 1], -flap - breath * 0.01); turn(b.wingR1, [0, 0, 1], flap + breath * 0.01);
    turn(b.wingL2, [0, 0, 1], -flap * 0.4); turn(b.wingR2, [0, 0, 1], flap * 0.4);
    const sway = motion ? 0 : Math.sin(t * 0.9) * 0.05 * awake;
    ['tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6'].forEach((n, i) => turn(b[n], [0, 1, 0], sway * (0.6 + i * 0.25) * Math.sin(t * 0.9 - i * 0.5)));
    if (b.chest) turn(b.chest, [1, 0, 0], breath * 0.012);
  }

  function animateHuman(e, dt) {
    if (!motion || e.oneShot) e.mixer?.update(dt);
    else if (!e.posed) { e.mixer?.update(1.2); e.posed = true; }
    const head = e.bones[Object.keys(e.bones).find((n) => /head$/i.test(n) || /^head/i.test(n)) || ''];
    let yaw = 0, pitch = 0;
    if (pointerActive) { yaw = clamp(pointerNdc.x * 0.5, -0.45, 0.45); pitch = clamp(-pointerNdc.y * 0.25, -0.2, 0.25); }
    look.yaw = damp(look.yaw, yaw, 4, dt); look.pitch = damp(look.pitch, pitch, 4, dt);
    turn(head, [0, 1, 0], look.yaw * 0.6); turn(head, [1, 0, 0], look.pitch * 0.6);
  }

  function animateCore(e, dt) {
    const t = time;
    const since = t - state.tapAt;
    const pulse = since < 1.2 ? Math.sin(Math.min(1, since / 1.2) * Math.PI) : 0;
    const yaw = pointerActive ? clamp(pointerNdc.x * 0.6, -0.6, 0.6) : Math.sin(t * 0.3) * 0.25;
    const pitch = pointerActive ? clamp(-pointerNdc.y * 0.4, -0.4, 0.4) : Math.sin(t * 0.21) * 0.1;
    look.yaw = damp(look.yaw, yaw, 3, dt); look.pitch = damp(look.pitch, pitch, 3, dt);
    e.model.rotation.set(look.pitch, look.yaw, 0);
    e.root.position.y = motion ? 0 : Math.sin(t * 1.2) * 0.02;
    e.root.scale.setScalar(1 + pulse * 0.06);
    glow.intensity = (state.activity === 'working' ? 3.4 : state.activity === 'offline' ? 0.4 : 2.2) + pulse * 4 + Math.sin(t * 2) * 0.3;
  }

  function frameCamera(f, dt, snap) {
    const aspect = camera.aspect;
    const fr = aspect < 0.7 && FRAMES[f].portrait ? { ...FRAMES[f], ...FRAMES[f].portrait } : FRAMES[f];
    const fit = fr.dist * Math.max(1, fr.fitAspect / aspect);
    const tx = fr.target[0], ty = fr.target[1], tz = fr.target[2];
    const px = tx + Math.sin(fr.yaw) * fit, pz = tz + Math.cos(fr.yaw) * fit, py = ty + 0.12 * fit;
    const k = snap ? 1 : 1 - Math.exp(-4 * dt);
    camera.position.lerp(new T.Vector3(px, py, pz), k);
    camera.lookAt(tx, ty, tz);
  }

  async function show(p, f) {
    const token = Symbol('show');
    show.token = token;
    onState({ loading: true, persona: p, form: f });
    let entry;
    try { entry = await load(p, f); } catch (e) { onError(e); onState({ loading: false, error: true }); return; }
    if (show.token !== token || state.disposed) return;
    endCast();
    let from = current, other = null;
    if (incoming) {
      const a = incoming.from, b = incoming.entry;
      const bShown = incoming.fx ? !!incoming.burst : b.uniforms.reveal.value >= 0.54;
      incoming.fx?.dispose();
      incoming = null;
      from = bShown ? b : a; other = bShown ? a : b;
      settle(a); b.uniforms.radial.value.w = 0;
    }
    if (entry === from) { from = other; other = null; }
    else if (entry === other) other = null;
    for (const e of loaded) if (e !== entry && e !== from && e.root.parent === scene) unstage(e);
    entry.uniforms.edge.value.set(PERSONAS[p].accent);
    entry.uniforms.radial.value.w = 0;
    const onStage = entry.root.parent === scene;
    if (!onStage) { entry.uniforms.reveal.value = motion ? 1.02 : 0; scene.add(entry.root); }
    if (from && from.uniforms.reveal.value <= 0.02) { unstage(from); from = null; }
    const fromShown = !!from && from.root.parent === scene;
    const summon = !motion && !onStage && fromShown && from.uniforms.reveal.value >= 1 && PERSONAS[p].fx === 'convergence' && from.form === 'core' && from.persona === p && f !== 'core';
    if (fromShown) {
      const t0 = onStage ? clamp(entry.uniforms.reveal.value / 1.08, 0, 0.98) : 0;
      incoming = { entry, from, t: t0, t0, fromStart: Math.min(from.uniforms.reveal.value, 1.08), fx: summon ? createConvergence(scene, { center: new T.Vector3(0, 0.02, 0), palette: PALETTES[PERSONAS[p].palette] }) : null, ft: 0 };
      current = from;
    } else { current = entry; incoming = null; }
    if (entry.mixer) play(entry, baseClip(), { once: false });
    onState({ loading: false, persona: p, form: f });
    wake();
  }

  function settle(e) {
    e.root.position.set(0, 0, 0); e.root.scale.setScalar(1);
    for (const m of e.materials) {
      if (!m.emissive) continue;
      const e0 = m.userData.emissive0;
      m.emissive.copy(e0.color); m.emissiveIntensity = e0.intensity;
      if (m.emissiveMap !== (e0.map ?? null)) { m.emissiveMap = e0.map ?? null; m.needsUpdate = true; }
    }
  }
  function unstage(e) {
    scene.remove(e.root); settle(e);
    e.uniforms.reveal.value = 0; e.uniforms.radial.value.w = 0;
  }
  function enforceStage() {
    for (const e of loaded) if (e.root.parent === scene && e !== current && e !== incoming?.entry) unstage(e);
  }

  function setLights(p) {
    rim.color.set(PERSONAS[p].rim); glow.color.set(PERSONAS[p].accent); floor.material.color.set(PERSONAS[p].floor);
  }

  let cast = null, aura = null, fading = null;
  const handAt = (e, i, v) => { const b = e?.hands?.[i]; if (b) b.getWorldPosition(v); else v.set(i ? 0.25 : -0.25, 0.05, 0.1); };
  function startCast(e) {
    endCast();
    cast = { entry: e, t: 0, fx: createCast(scene, camera, { hands: (l, r) => { handAt(e, 0, l); handAt(e, 1, r); } }) };
    play(e, 'cast', { once: true, fade: 0.3 });
    e.actions.cast.setEffectiveTimeScale(0);
    e.actions.cast.time = 0;
  }
  function endCast() { if (cast) { cast.entry.actions.cast?.setEffectiveTimeScale(1); cast.fx.dispose(); cast = null; } }
  let roar = null;
  function startRoar(e) {
    if (motion || roar) return;
    const head = e.bones.head ?? e.bones.neck3;
    roar = { t: 0, fx: createRoar(scene, camera, { origin: (v) => { if (head) head.getWorldPosition(v); else v.set(0.3, 0.2, 0.2); }, palette: PALETTES[PERSONAS[e.persona].palette] }) };
  }
  const fxLevel = { bloom: 0, exposure: 0, shake: 0, chroma: 0 };
  function applyFx(o) {
    fxLevel.bloom = Math.max(fxLevel.bloom, o.bloom || 0); fxLevel.exposure = Math.max(fxLevel.exposure, o.exposure || 0);
    fxLevel.shake = Math.max(fxLevel.shake, o.shake || 0); fxLevel.chroma = Math.max(fxLevel.chroma, o.chroma || 0);
  }

  let raf = 0;
  const onScreen = () => { const r = canvas.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  function wake() { if (!raf && !state.disposed) raf = requestAnimationFrame(tick); }
  function tick() {
    raf = 0;
    if (state.disposed || !state.visible) return;
    if (!state.inView && !(state.inView = onScreen())) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;
    fxLevel.bloom = fxLevel.exposure = fxLevel.shake = fxLevel.chroma = 0;
    if (fading) {
      fading.ft += dt;
      const o = fading.fx.update(fading.ft, dt);
      applyFx(o);
      if (o.done) { fading.fx.dispose(); fading = null; }
    }
    if (incoming?.fx) {
      incoming.ft += dt;
      const o = incoming.fx.update(incoming.ft, dt);
      applyFx(o);
      const from = incoming.from, to = incoming.entry;
      if (o.burst && !incoming.burst) { incoming.burst = true; unstage(from); onFx('burst'); }
      if (o.reveal === null) {
        from.root.position.set((Math.random() - 0.5) * o.tremble, (Math.random() - 0.5) * o.tremble, (Math.random() - 0.5) * o.tremble);
        from.root.scale.setScalar(1 + o.tremble * 3);
        for (const m of from.materials) {
          if (!m.emissive) continue;
          if (m.emissiveMap !== (m.map ?? null)) { m.emissiveMap = m.map ?? null; m.needsUpdate = true; }
          m.emissive.set(PALETTES[PERSONAS[to.persona].palette].glow); m.emissiveIntensity = o.glow;
        }
        to.uniforms.reveal.value = 0;
      } else {
        to.uniforms.radial.value.set(0, 0.05, 0, 0.62);
        to.uniforms.reveal.value = o.reveal * 1.08;
        if (o.reveal >= 1) to.uniforms.radial.value.w = 0;
      }
      if (o.done) settleSummon();
    } else if (incoming) {
      incoming.t += dt / (motion ? 0.01 : 1.3);
      const k = clamp(incoming.t, 0, 1);
      incoming.entry.uniforms.reveal.value = k * 1.08;
      incoming.from.uniforms.reveal.value = incoming.fromStart * (1 - k) / (1 - incoming.t0);
      if (k >= 1) { unstage(incoming.from); current = incoming.entry; incoming = null; }
    } else if (current && current.uniforms.reveal.value < 1.08) {
      current.uniforms.reveal.value = Math.min(1.08, current.uniforms.reveal.value + dt / (motion ? 0.01 : 1.3));
    }
    for (const e of [current, incoming?.entry].filter(Boolean)) {
      if (e.form === 'dragon') animateDragon(e, dt);
      else if (e.form === 'human') animateHuman(e, dt);
      else animateCore(e, dt);
    }
    if (cast) {
      cast.t += dt;
      const o = cast.fx.update(cast.t, dt);
      applyFx(o);
      const clip = cast.entry.actions.cast;
      clip.time = o.clipTime;
      if (o.clipTime >= clip.getClip().duration - 0.02) clip.setEffectiveTimeScale(1);
      if (o.flash) onFx('blast');
      if (o.done) endCast();
    }
    if (roar) {
      roar.t += dt;
      const o = roar.fx.update(roar.t);
      applyFx(o);
      if (o.done) { roar.fx.dispose(); roar = null; }
    }
    const auraOn = !motion && current?.form === 'human' && PERSONAS[current.persona]?.fx === 'convergence' && !incoming;
    if (auraOn && aura?.palette !== PERSONAS[current.persona].palette) { aura?.dispose(); aura = null; }
    if (auraOn && !aura) { aura = createAura(scene, PALETTES[PERSONAS[current.persona].palette]); aura.palette = PERSONAS[current.persona].palette; }
    aura?.update(time, auraOn ? (cast ? 0.2 : 1) : 0);
    if (current && current.form !== 'core') glow.intensity = damp(glow.intensity, state.activity === 'working' ? 0.5 : 0.12, 3, dt);
    enforceStage();
    frameCamera(state.form, dt, false);
    bloom.strength = 0.22 + fxLevel.bloom;
    renderer.toneMappingExposure = 0.95 + fxLevel.exposure;
    chroma.enabled = fxLevel.chroma > 0.0005;
    chroma.uniforms.amount.value = fxLevel.chroma;
    if (fxLevel.shake > 0.0005) { camera.position.x += (Math.random() - 0.5) * fxLevel.shake; camera.position.y += (Math.random() - 0.5) * fxLevel.shake; }
    composer.render();
    raf = requestAnimationFrame(tick);
  }

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 800;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 600;
    const frame = Math.min(w, canvas.parentElement?.clientWidth || w);
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = frame / h;
    if (frame < w) camera.setViewOffset(frame, h, frame - w, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    frameCamera(state.form, 0, true);
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);
  const resume = () => { if (state.visible && state.inView) { clock.getDelta(); wake(); } };
  const onVisibility = () => { state.visible = !document.hidden; resume(); };
  document.addEventListener('visibilitychange', onVisibility);
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => { state.inView = entries[entries.length - 1].isIntersecting; resume(); }) : null;
  io?.observe(canvas);

  resize();
  setLights(persona);
  function settleSummon() {
    const from = incoming.from, to = incoming.entry;
    unstage(from);
    if (incoming.ft < CONVERGENCE.total) fading = { fx: incoming.fx, ft: incoming.ft }; else incoming.fx.dispose();
    to.uniforms.radial.value.w = 0; to.uniforms.reveal.value = 1.08;
    current = to; incoming = null;
  }
  const revealed = () => incoming?.fx && incoming.ft >= CONVERGENCE.charge + CONVERGENCE.reveal + 0.05;

  function gesture(name) {
    if (name === 'cast' && revealed()) settleSummon();
    const e = current;
    if (name === 'cast' && !motion && !incoming && e?.form === 'human' && e.actions.cast && PERSONAS[e.persona]?.fx === 'convergence') startCast(e);
    else if (e?.form === 'human' && e.actions[name]) play(e, name, { once: true });
    else { state.tapAt = time; if (name === 'roar' && e?.form === 'dragon') startRoar(e); }
    wake();
  }

  show(persona, form);

  return {
    setPersona(p) {
      if (!PERSONAS[p] || p === state.persona) return;
      state.persona = p;
      if (!formsOf(p).includes(state.form)) state.form = formsOf(p)[0];
      setLights(p); show(p, state.form);
    },
    setForm(f) { if (!formsOf(state.persona).includes(f) || f === state.form) return; state.form = f; show(state.persona, f); },
    setActivity(a) { state.activity = a || 'idle'; const e = current; if (e?.form === 'human' && !state.gesture) play(e, baseClip()); },
    speak(on) { state.speaking = !!on; const e = current; if (e?.form === 'human') play(e, baseClip()); },
    gesture,
    tap() {
      state.tapAt = time;
      if (revealed() && incoming.entry.form === 'human' && PERSONAS[incoming.entry.persona]?.tap) settleSummon();
      const e = current, sig = e && PERSONAS[e.persona]?.tap;
      if (e?.form === 'human' && !e.oneShot) { if (sig && e.actions[sig]) return gesture(sig); play(e, 'wave', { once: true }); }
      if (e?.form === 'dragon' && !incoming) startRoar(e);
      wake();
    },
    pointer(nx, ny, active = true) { pointerNdc.set(nx, ny); pointerActive = active; },
    preload(p = state.persona) { for (const f of formsOf(p)) load(p, f).catch(() => {}); },
    prefetch(f) { if (formsOf(state.persona).includes(f)) load(state.persona, f).catch(() => {}); },
    get state() { return { ...state }; },
    dispose() {
      state.disposed = true; cancelAnimationFrame(raf); endCast(); roar?.fx.dispose(); aura?.dispose(); fading?.fx.dispose(); incoming?.fx?.dispose(); ro?.disconnect(); io?.disconnect(); document.removeEventListener('visibilitychange', onVisibility);
      const free = (o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { for (const v of Object.values(m)) v?.isTexture && v.dispose(); m.dispose(); }); };
      scene.traverse(free);
      for (const e of loaded) { e.mixer?.stopAllAction(); e.root.traverse(free); }
      composer.dispose?.(); pmrem.dispose(); renderer.dispose();
    },
  };
}
