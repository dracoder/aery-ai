'use client';

import { useEffect, useRef, useState } from 'react';

export const PERSONA_NAMES = { aeryx: 'Aeryx', aeri: 'Aeri' };
export const PERSONA_PRONOUNS = { aeryx: { he: 'he', him: 'him', his: 'his', himself: 'himself' }, aeri: { he: 'she', him: 'her', his: 'her', himself: 'herself' } };
export const FORM_NAMES = { core: 'Core', dragon: 'Dragon', human: 'Humanoid' };
export const EMOTES = {
  core: [['pulse', 'Pulse']],
  dragon: [['roar', 'Roar']],
  human: [['wave', 'Wave'], ['bow', 'Bow'], ['heart', 'Heart'], ['dance', 'Dance']],
};
export const isPersona = (value) => Object.hasOwn(PERSONA_NAMES, value);
export const isForm = (value) => Object.hasOwn(FORM_NAMES, value);

const ASSETS = '/assets/characters/';
const sounds = {};

export function soundOn() {
  try { return localStorage.getItem('aeryx.sound') !== 'off'; } catch { return true; }
}

export function cue(name, volume = .5) {
  if (!soundOn()) return;
  try {
    const audio = sounds[name] ??= new Audio(`${ASSETS}${name}.m4a`);
    audio.volume = volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch { }
}

function webglAvailable() {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return !!gl;
}

const register = (engine, skins) => {
  for (const skin of skins ?? []) engine.registerPersona(skin.id, { label: skin.name, theme: skin.theme, base: `/skins/${skin.id}/`, forms: skin.forms, fx: skin.fx, tap: skin.tap });
};

export default function CharacterStage({ persona, form, activity, speaking, emote, hint, onTap, skins, onFx }) {
  const canvasRef = useRef(null);
  const famRef = useRef(null);
  const engineRef = useRef(null);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(null);
  latest.current = { persona, form, activity, speaking, skins, onFx };
  const skin = skins?.find((s) => s.id === persona);

  useEffect(() => {
    if (!webglAvailable()) { setFailed(true); return undefined; }
    let disposed = false;
    import('./familiar/engine.js').then((engine) => {
      if (disposed || !canvasRef.current) return;
      engineRef.current = engine;
      const now = latest.current;
      register(engine, now.skins);
      famRef.current = engine.createFamiliar(canvasRef.current, {
        assetBase: ASSETS,
        persona: engine.PERSONAS[now.persona] ? now.persona : 'aeryx',
        form: now.form,
        onState: (s) => { if (s.error) setFailed(true); else if (!s.loading) setLive(true); },
        onError: () => setFailed(true),
        onFx: (name) => latest.current.onFx?.(name),
      });
      famRef.current.setActivity(now.activity);
      famRef.current.speak(now.speaking);
    }).catch(() => setFailed(true));
    return () => { disposed = true; famRef.current?.dispose(); famRef.current = null; };
  }, []);

  useEffect(() => {
    if (!engineRef.current || !famRef.current) return;
    register(engineRef.current, skins);
    famRef.current.setPersona(latest.current.persona);
    famRef.current.setForm(latest.current.form);
  }, [skins]);
  useEffect(() => { famRef.current?.setPersona(persona); }, [persona]);
  useEffect(() => { if (hint) famRef.current?.prefetch(hint); }, [hint, persona]);
  useEffect(() => { famRef.current?.setForm(form); }, [form]);
  useEffect(() => { famRef.current?.setActivity(activity); }, [activity]);
  useEffect(() => { famRef.current?.speak(speaking); }, [speaking]);
  useEffect(() => { if (emote?.name) famRef.current?.gesture(emote.name); }, [emote]);

  const aim = (event) => {
    const r = event.currentTarget.getBoundingClientRect();
    famRef.current?.pointer(((event.clientX - r.left) / r.width) * 2 - 1, -(((event.clientY - r.top) / r.height) * 2 - 1), true);
  };

  return (
    <div className={'character-stage' + (live && !failed ? ' is-live' : '')} aria-hidden="true"
      onPointerEnter={() => { if (form === 'core') famRef.current?.prefetch(skin ? skin.forms[1] : 'dragon'); }}
      onPointerMove={aim} onPointerLeave={() => famRef.current?.pointer(0, 0, false)}
      onClick={() => { famRef.current?.tap(); onTap?.(); }}>
      {skin ? skin.posters.includes(form) && <img className="stage-poster" src={`/skins/${skin.id}/${form}.webp`} alt="" draggable={false} />
        : <img className="stage-poster" src={`${ASSETS}${persona}-${form}.webp`} alt="" draggable={false} />}
      <canvas ref={canvasRef} className="stage-canvas" />
    </div>
  );
}
