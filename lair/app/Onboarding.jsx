'use client';

import { useEffect, useRef, useState } from 'react';
import DragonMark from './DragonMark';
import { MIND_ONBOARDING_OFF, MIND_WIN_ONLY_NAMES } from './mind';

const STEPS = ['welcome', 'persona', 'model', 'tour'];
function localSuggestion(ramGb) {
  if (ramGb >= 32) return { tag: 'qwen3-coder', size: '19 GB' };
  if (ramGb >= 16) return { tag: 'qwen3:8b', size: '5 GB' };
  return { tag: 'qwen3:4b', size: '2.5 GB' };
}

const KEY_HINT = {
  openrouter: 'Your OpenRouter key (sk-or-…). Kept out of aeryx.config.json: Keychain on macOS, DPAPI on Windows, a private 0600 file on Linux.',
  codex: 'Runs OpenAI’s Codex models through OpenRouter, so it uses your OpenRouter key (sk-or-…).',
  local: 'No key. Prompts never leave this machine. Spoken replies still use Microsoft’s online voice unless you turn them off.',
};
export const WIN_ONLY_NAMES = {
  hello: 'Windows Hello second factor', warden: 'OS account boundary for the brain',
  voice: 'voice and wake word', ...MIND_WIN_ONLY_NAMES,
};
const OFF_BY_DEFAULT = [
  ...MIND_ONBOARDING_OFF,
  ['Remote access', 'the Lair over your tailnet, behind a PIN'],
];

export default function Onboarding({ post, get, persona, onPersona, first, onClose }) {
  const [step, setStep] = useState(first ? 'welcome' : 'model');
  const [state, setState] = useState(null);
  const [kind, setKind] = useState('local');
  const [model, setModel] = useState('');
  const [secret, setSecret] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef(null);

  useEffect(() => { headingRef.current?.focus(); }, [step]);
  useEffect(() => {
    if (first) return;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [first, onClose]);

  useEffect(() => {
    get('/setup/state').then((s) => {
      setState(s);
      if (s.provider) { setKind(s.provider.kind); setModel(s.provider.model); }
      else if (!s.ollama?.reachable && s.claudeLogin) setKind('claude');
    }).catch(() => setState({ error: true }));
  }, [get]);

  const info = state?.providers?.find((p) => p.kind === kind);
  const localModels = state?.ollama?.models ?? [];
  const suggested = localSuggestion(state?.ramGb ?? 0);
  const chosenModel = model || (kind === 'local' && (localModels[0] || suggested.tag)) || info?.defaultModel || '';

  const send = async (path) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await post(path, { kind, model: chosenModel, ...(secret ? { secret } : {}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setResult({ ok: false, detail: d.error ?? `refused (${r.status})` });
      else if (path === '/setup/test') setResult(d);
      else { setSecret(''); setResult({ ok: true, detail: 'connected — waking Aeryx' }); setStep(first ? 'tour' : 'done'); }
    } catch {
      setResult({ ok: false, detail: 'the daemon did not answer' });
    }
    setBusy(false);
  };

  const at = STEPS.indexOf(step);
  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="card onboard-card">
        <div className="onboard-head">
          <span className="onboard-mark"><DragonMark /></span>
          {first && <ol className="onboard-steps" aria-label="Setup progress">
            {STEPS.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'on' : ''}>{s}</li>)}
          </ol>}
          {!first && <button className="act" type="button" onClick={onClose}>close</button>}
        </div>

        {step === 'welcome' && <>
          <h2 id="onboard-title" tabIndex={-1} ref={headingRef}>Meet Aeryx</h2>
          <p>A personal AI that runs on your machine, behind a chain it can never break. Every action it takes is classified, logged in a hash-linked audit trail, and anything that matters waits for your yes.</p>
          <p className="muted small">Early software, run from source. Nothing that acts for you is switched on until you switch it on.</p>
          <div className="onboard-actions"><button className="act yes" type="button" onClick={() => setStep('persona')}>begin</button></div>
        </>}

        {step === 'persona' && <>
          <h2 id="onboard-title" tabIndex={-1} ref={headingRef}>Choose a persona</h2>
          <p className="muted">Purely how your assistant looks: a core, a dragon and a humanoid form, one mind. Change it any time from the rail.</p>
          <div className="onboard-choices" role="group" aria-label="Persona">
            {[['aeryx', 'Aeryx', 'midnight titanium, cyan core'], ['aeri', 'Aeri', 'crimson armour, amber core']].map(([id, label, note]) => (
              <button key={id} type="button" className={`onboard-choice onboard-persona style-${id}`} aria-pressed={persona === id} onClick={() => onPersona(id)}>
                <img src={`/assets/characters/${id}-dragon.webp`} alt="" />
                <strong>{label}</strong><span>{note}</span>
              </button>
            ))}
          </div>
          <div className="onboard-actions">
            <button className="act" type="button" onClick={() => setStep('welcome')}>back</button>
            <button className="act yes" type="button" onClick={() => setStep('model')}>next</button>
          </div>
        </>}

        {step === 'model' && <>
          <h2 id="onboard-title" tabIndex={-1} ref={headingRef}>Connect a model</h2>
          {state?.error && <p className="onboard-err">Could not reach the daemon.</p>}
          {state?.why && first && <p className="muted small">Aeryx is waiting: {state.why}.</p>}
          <div className="onboard-choices" role="group" aria-label="Model provider">
            {(state?.providers ?? []).map((p) => (
              <button key={p.kind} type="button" aria-pressed={kind === p.kind} className="onboard-choice"
                disabled={state?.localOnly && p.kind !== 'local'} title={state?.localOnly && p.kind !== 'local' ? 'Off while local-only mode is on' : undefined}
                onClick={() => { setKind(p.kind); setModel(''); setResult(null); }}>
                <strong>{p.label}{p.experimental && <em> experimental</em>}</strong>
                <span>{p.kind === 'local' ? (state.ollama?.reachable ? `Ollama running · ${state.ollama.models.length} model${state.ollama.models.length === 1 ? '' : 's'}` : 'Ollama not running')
                  : p.kind === 'claude' ? (p.keyStored ? 'key stored' : state.claudeLogin ? 'Claude login found' : 'needs a login or key')
                  : p.keyStored ? 'key stored' : 'needs a key'}</span>
              </button>
            ))}
          </div>
          <p className="muted small">
            {kind === 'claude'
              ? <>Optional — an Anthropic API key (sk-ant-api…) or a <code>claude setup-token</code> token. {state?.claudeLogin ? 'Leave empty to use this machine’s Claude login.' : 'No Claude login found here: paste a key, or run claude once and log in.'}</>
              : KEY_HINT[kind]}
          </p>
          <div className="onboard-fields">
            <label>
              <span>Model</span>
              {kind === 'local' && localModels.length
                ? <select value={chosenModel} onChange={(e) => setModel(e.target.value)}>{localModels.map((m) => <option key={m}>{m}</option>)}</select>
                : <input value={chosenModel} onChange={(e) => setModel(e.target.value)} spellCheck={false} autoComplete="off" />}
            </label>
            {kind !== 'local' && <label>
              <span>Key</span>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={info?.keyStored ? 'stored — leave empty to keep it' : ''} autoComplete="off" spellCheck={false} />
            </label>}
          </div>
          {kind === 'local' && !state?.ollama?.reachable && <p className="muted small">Install Ollama from <a href="https://ollama.com" target="_blank" rel="noopener noreferrer">ollama.com</a>, run <code>ollama pull {suggested.tag}</code> (about {suggested.size}{state?.ramGb ? `, a good fit for this computer's ${state.ramGb} GB of memory` : ''}), then reopen this step.</p>}
          {kind === 'local' && state?.ollama?.reachable && !localModels.length && <p className="muted small">Ollama is running but has no models yet. Run <code>ollama pull {suggested.tag}</code> (about {suggested.size}), then reopen this step.</p>}
          {kind === 'local' && <p className="muted small">Small local models handle simple asks; for the full tool surface use Claude or OpenRouter, or a larger model like qwen3-coder.</p>}
          {result && <p className={result.ok ? 'onboard-ok' : 'onboard-err'} role="status">{result.detail}</p>}
          <div className="onboard-actions">
            {first && <button className="act" type="button" onClick={() => setStep('persona')}>back</button>}
            <button className="act" type="button" disabled={busy || !chosenModel} onClick={() => send('/setup/test')}>{busy ? '…' : 'test'}</button>
            <button className="act yes" type="button" disabled={busy || !chosenModel} onClick={() => send('/setup/provider')}>connect</button>
          </div>
        </>}

        {step === 'tour' && <>
          <h2 id="onboard-title" tabIndex={-1} ref={headingRef}>How the Chain works</h2>
          <p>Reading is free. Ordinary work in your workspace runs. Anything outward, destructive or outside your folders asks you first. Changing Aeryx himself needs a second check, and nothing is ever granted silently: every approval lands in the audit trail.</p>
          <p className="muted small">Off until you turn it on:</p>
          <ul className="onboard-off">
            {OFF_BY_DEFAULT.map(([name, what]) => <li key={name}><strong>{name}</strong> — {what}</li>)}
          </ul>
          <p className="muted small">On by default: spoken replies (the reply text goes to Microsoft&apos;s online voice; set <code>&quot;ttsEnabled&quot;: false</code> in aeryx.config.json, or use local-only mode), the news panel (public RSS feeds), and, when Ollama is reachable, up to 3 headline articles a day read for research (<code>initiative.researchPerDay: 0</code> stops it).</p>
          {state?.windowsOnly?.length > 0 && <p className="muted small">On this computer these are Windows-only and stay unavailable: {state.windowsOnly.map((id) => WIN_ONLY_NAMES[id] ?? id).join(', ')}.</p>}
          <div className="onboard-actions"><button className="act yes" type="button" onClick={onClose}>enter the Lair</button></div>
        </>}

        {step === 'done' && <>
          <h2 id="onboard-title" tabIndex={-1} ref={headingRef}>Model changed</h2>
          <p>{result?.detail}</p>
          <div className="onboard-actions"><button className="act yes" type="button" onClick={onClose}>close</button></div>
        </>}
      </div>
    </div>
  );
}
