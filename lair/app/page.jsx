'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import DragonMark from './DragonMark';
import SkinUpload from './SkinUpload';
import ConfirmDialog from './ConfirmDialog';
import Reactor from './Reactor';
import NewsGlobe from './NewsGlobe';
import Onboarding, { WIN_ONLY_NAMES } from './Onboarding';
import CharacterStage, { EMOTES, FORM_NAMES, PERSONA_NAMES, cue, isForm, isPersona, soundOn as soundEnabled } from './CharacterStage';
import { isDemo, DemoEventSource, demoMessages } from './demo';
import { call, decide, fmtTs, get, leftWords, LOCAL_ONLY, NEEDS_HELLO, onLocked, post, prefersReducedMotion, useWho, whoOf, WhoContext, winOnly } from './lib';
import { MIND_OPS_KINDS, MIND_SSE, MIND_TABS, MindOverviewCards, MindTopbarChips, useMindApprovals } from './mind';
async function toggleLocalOnly(status, refresh, w) {
  const on = !status.localOnly;
  const msg = on
    ? `Turn on local-only mode?\n\nNothing will leave this machine: no cloud models (connect a local Ollama model), no web tools or downloads, no online speech, no news. ${w.name} restarts ${w.his} brain to apply it.`
    : 'Turn off local-only mode?\n\nCloud models, web tools, online speech and news become available again, each still under the Chain.';
  if (!window.confirm(msg)) return;
  const r = await post('/privacy/local-only', { on });
  if (!r.ok) window.alert((await r.json().catch(() => ({}))).error ?? 'Could not change local-only mode.');
  refresh();
}

const COST_NOTE = {
  estimate: 'Estimated at Anthropic API prices by the Agent SDK. On a Claude subscription this is covered by your plan.',
  free: 'A local model: no per-token cost.',
  provider: 'OpenRouter prices vary by model; see your OpenRouter activity page for the exact cost.',
};
function fmtTokens(u) {
  if (!u) return '—';
  const n = (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
}
function fmtCost(usage) {
  if (!usage) return '—';
  const money = (c) => (c < 0.01 && c > 0 ? '<$0.01' : `≈$${c.toFixed(2)}`);
  const by = usage.todayByBasis ?? {};
  const est = by.estimate ?? 0;
  if (est > 0) return by.provider !== undefined ? `${money(est)} + varies` : money(est);
  if (by.provider !== undefined) return 'varies';
  if (by.free !== undefined) return 'free';
  if (usage.basis === 'free') return 'free';
  if (usage.basis === 'provider') return 'varies';
  return money(usage.today?.costUsd ?? 0);
}
const FEEDBACK_URL = 'https://github.com/dracoder/aery-ai/discussions/new?category=ideas';

function inDesktopApp() {
  if (typeof window === 'undefined') return false;
  const flagged = () => new URLSearchParams(location.search).get('app') === 'desktop';
  try {
    if (flagged()) sessionStorage.setItem('aeryx.app', 'desktop');
    return sessionStorage.getItem('aeryx.app') === 'desktop';
  } catch {
    return flagged();
  }
}

function bugReportUrl(status) {
  const env = [status?.version ? `v${status.version}` : null, status?.platform, status?.provider ? `${status.provider.kind} ${status.provider.model}` : null].filter(Boolean).join(' · ');
  const inApp = inDesktopApp() ? 'Desktop app (beta)' : 'Web version (browser)';
  return `https://github.com/dracoder/aery-ai/issues/new?template=bug.yml&where=${encodeURIComponent(inApp)}&env=${encodeURIComponent(env)}`;
}

const TABS = ['overview', 'conversation', 'workflows', 'agents', 'news', 'hoard', 'approvals', 'operations'];
const NAV_GROUPS = [
  ['Command', ['overview', 'conversation', 'approvals']],
  ['Autonomy', ['workflows', 'agents']],
  ['Intelligence', ['hoard', 'news']],
  ['System', ['operations']],
];
for (const extra of MIND_TABS) {
  TABS.splice(extra.tabAt, 0, extra.id);
  NAV_GROUPS.find(([label]) => label === extra.group)?.[1].splice(extra.groupAt, 0, extra.id);
}
const RAIL_LABELS = Object.fromEntries(MIND_TABS.filter((t) => t.railLabel).map((t) => [t.id, t.railLabel]));
const SSE_TICK = ['workflows', 'agents', 'confirm', 'say', 'state', 'ready', 'workflow-run', 'hoard', 'news', 'hoard-notice', ...MIND_SSE];

const tabCopy = (w) => ({
  overview: ['Command deck', 'The living system at a glance.'],
  conversation: ['Conversation', `Speak with ${w.name}. Every decision still comes through the Chain.`],
  workflows: ['Workflows', 'Autonomous routines under your control.'],
  agents: ['Agents', 'Specialists in the permanent roster.'],
  news: ['World signal', 'Incoming stories and research.'],
  hoard: ['The hoard', 'Memory and knowledge.'],
  approvals: ['The Chain', 'Decisions waiting for you.'],
  operations: ['Operations', 'A trace of every action.'],
  ...Object.fromEntries(MIND_TABS.map((t) => [t.id, t.copy(w)])),
});

function RailIcon({ id }) {
  const paths = {
    overview: <><path d="M3 12 12 3l9 9-9 9Z"/><circle cx="12" cy="12" r="3"/></>,
    conversation: <><path d="M3 4h18v13H9l-5 4v-4H3Z"/><path d="m7 11 3-3 3 5 2-2h3"/></>,
    approvals: <><path d="M12 2 21 7v10l-9 5-9-5V7Z"/><path d="m7.5 12 3 3 6-6"/></>,
    workflows: <><rect x="2.5" y="3" width="6" height="6" rx="1"/><rect x="15.5" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/><path d="M5.5 9v3h6.5m6.5-3v3H12m0 0v3"/></>,
    agents: <><circle cx="12" cy="6" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3ZM2 13h3m14 0h3"/></>,
    hoard: <><path d="M3 7h18v14H3ZM3 7l4-4h10l4 4M8 12h8m-6 4h4"/></>,
    news: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-4 4-4 14 0 18m0-18c4 4 4 14 0 18"/></>,
    operations: <><path d="M3 7h18M3 12h18M3 17h18"/><circle cx="8" cy="7" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="17" r="2" fill="currentColor"/></>,
    ...Object.fromEntries(MIND_TABS.map((t) => [t.id, t.icon])),
  };
  return <svg className="rail-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[id]}</svg>;
}

export default function Lair() {
  const [tab, setTab] = useState('overview');
  const [hashReady, setHashReady] = useState(false);
  useEffect(() => {
    const syncTabFromHash = () => {
      const h = location.hash.slice(1);
      if (TABS.includes(h)) setTab(h);
    };
    syncTabFromHash();
    setHashReady(true);
    window.addEventListener('hashchange', syncTabFromHash);
    return () => window.removeEventListener('hashchange', syncTabFromHash);
  }, []);
  useEffect(() => {
    if (!hashReady) return;
    try { history.replaceState(null, '', '#' + tab); } catch {}
    window.scrollTo(0, 0);
  }, [tab, hashReady]);
  const [status, setStatus] = useState(null);
  const [tick, setTick] = useState(0);
  const [clock, setClock] = useState('');
  const [locked, setLocked] = useState(false);
  const [nav, setNav] = useState(false);
  const [persona, setPersona] = useState('aeryx');
  const [form, setForm] = useState('core');
  const [skins, setSkins] = useState([]);
  const [skinsLoaded, setSkinsLoaded] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(null);
  const skin = skins.find((s) => s.id === persona);
  const theme = skin?.theme ?? persona;
  const [styleReady, setStyleReady] = useState(false);
  const [demo, setDemo] = useState(false);
  const [messages, setMessages] = useState([]);
  const [voice, setVoice] = useState(null);
  const [setup, setSetup] = useState(null);

  useEffect(() => {
    let saved = null, savedForm = null;
    try {
      saved = localStorage.getItem('aeryx.persona');
      if (isPersona(saved)) setPersona(saved);
      savedForm = localStorage.getItem('aeryx.form');
      if (isForm(savedForm)) setForm(savedForm);
    } catch { }
    if (isDemo()) { setDemo(true); setMessages(demoMessages()); }
    const sync = (event) => { if (event.key === 'aeryx.persona' && isPersona(event.newValue)) setPersona(event.newValue); };
    addEventListener('storage', sync);
    const waitForSkin = !isDemo() && saved && !isPersona(saved);
    const fallback = waitForSkin ? setTimeout(() => setStyleReady(true), 1500) : null;
    if (!waitForSkin) setStyleReady(true);
    if (!isDemo()) loadSkins().then((list) => {
      if (!waitForSkin) return;
      clearTimeout(fallback);
      const s = list.find((x) => x.id === saved);
      if (s) { setPersona(s.id); if (!s.forms.includes(savedForm)) setForm(s.forms[0]); }
      setStyleReady(true);
    });
    return () => { removeEventListener('storage', sync); clearTimeout(fallback); };
  }, []);
  useEffect(() => {
    if (!skins.length) return;
    try {
      const saved = skins.find((s) => s.id === localStorage.getItem('aeryx.persona'));
      if (saved) { setPersona(saved.id); if (!saved.forms.includes(form)) setForm(saved.forms[0]); }
    } catch { }
  }, [skins]);
  useEffect(() => {
    if (styleReady) document.documentElement.dataset.persona = theme;
  }, [theme, styleReady]);
  useEffect(() => {
    if (styleReady && skinsLoaded && !isPersona(persona) && !skins.some((s) => s.id === persona)) resetToAeryx();
  }, [skins, persona, styleReady, skinsLoaded]);
  function loadSkins() {
    return get('/skins').then((d) => { const list = Array.isArray(d?.skins) ? d.skins : []; setSkins(list); setSkinsLoaded(true); return list; }).catch(() => []);
  }
  function skinInstalled(s, replaced) {
    try { localStorage.setItem('aeryx.persona', s.id); localStorage.setItem('aeryx.theme', s.theme); } catch { }
    if (replaced) { location.reload(); return; }
    loadSkins();
  }
  function resetToAeryx() {
    flushSync(() => setPersona('aeryx'));
    document.documentElement.dataset.persona = 'aeryx';
    window.AeryxOrb?.setVisualStyle('aeryx');
    try { localStorage.setItem('aeryx.persona', 'aeryx'); localStorage.setItem('aeryx.theme', 'aeryx'); } catch { }
  }
  async function removeSkin(s) {
    setPendingRemove(null);
    if (persona === s.id) resetToAeryx();
    await post(`/skins/${s.id}/remove`, {}).catch(() => null);
    loadSkins();
  }
  function selectPersona(next) {
    const nextSkin = skins.find((s) => s.id === next);
    if (!nextSkin && !isPersona(next)) return;
    const nextTheme = nextSkin?.theme ?? next;
    const apply = () => {
      flushSync(() => {
        setPersona(next);
        if (nextSkin && !nextSkin.forms.includes(form)) setForm(nextSkin.forms[0]);
      });
      document.documentElement.dataset.persona = nextTheme;
      window.AeryxOrb?.setVisualStyle(nextTheme);
    };
    if (next !== persona && document.startViewTransition && !prefersReducedMotion()) { const vt = document.startViewTransition(apply); for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p?.catch(() => {}); }
    else apply();
    try { localStorage.setItem('aeryx.persona', next); localStorage.setItem('aeryx.theme', nextTheme); } catch { }
  }
  const personaChoices = [...Object.entries(PERSONA_NAMES), ...skins.map((s) => [s.id, s.name])];
  const who = whoOf(skin?.name ?? PERSONA_NAMES[persona] ?? PERSONA_NAMES.aeryx, persona);
  const skinCore = skin?.posters.includes('core') ? `/skins/${skin.id}/core.webp` : null;
  const sectionDragon = PERSONA_NAMES[persona] ? `/assets/characters/${persona}-dragon.webp` : skin?.posters.includes('dragon') ? `/skins/${skin.id}/dragon.webp` : null;
  function selectForm(next) {
    setForm(next);
    try { localStorage.setItem('aeryx.form', next); } catch { }
  }

  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    onLocked(() => setLocked(true));
    return () => onLocked(() => {});
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const burgerRef = useRef(null);
  useEffect(() => {
    if (!nav) return;
    const onKey = (e) => { if (e.key === 'Escape') setNav(false); };
    window.addEventListener('keydown', onKey);
    document.documentElement.classList.add('scroll-locked');
    document.querySelector('#lair-nav button')?.focus();
    const burger = burgerRef.current;
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('scroll-locked');
      burger?.focus({ preventScroll: true });
    };
  }, [nav]);

  useEffect(() => {
    if (status?.setupNeeded && !demo && !setup) setSetup('first');
  }, [status?.setupNeeded, demo, setup]);

  useEffect(() => {
    document.documentElement.classList.toggle('scroll-locked', !!setup);
    return () => document.documentElement.classList.remove('scroll-locked');
  }, [setup]);

  const refresh = useCallback(() => {
    get('/status').then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    const c = setInterval(() => {
      const d = new Date();
      setClock(d.toTimeString().slice(0, 5) + ' · ' + d.toDateString().slice(0, 10));
    }, 1000);
    const es = isDemo() ? new DemoEventSource() : new EventSource('/events');
    es.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'say' && typeof m.text === 'string') {
        setMessages((old) => [...old.slice(-79), { role: 'assistant', text: m.text, at: Date.now() }]);
        setVoice({ ms: Math.min(9000, Math.max(1500, m.text.length * 55)) });
      }
      if (m.type === 'setup-needed' || m.type === 'setup-done') refresh();
      if (m.type === 'skins') loadSkins();
      if (SSE_TICK.includes(m.type)) {
        setTick((n) => n + 1);
        if (m.type === 'confirm' || m.type === 'confirm-expired' || m.type === 'ready' || m.type === 'state') refresh();
      }
    };
    return () => { clearInterval(t); clearInterval(c); es.close(); };
  }, [refresh]);

  if (locked) return <Gate />;

  const proposals = status?.pendingProposals ?? {};
  const pending = (status?.pendingConfirms?.length ?? 0)
    + Object.values(proposals).reduce((a, b) => a + (Number(b) || 0), 0);
  return (
    <WhoContext.Provider value={who}>
      <title>{`${who.NAME} — The Lair`}</title>
      <link rel="icon" href={skinCore ?? (persona === 'aeri' ? '/assets/aeri-mark.svg' : '/assets/aeryx-mark.svg')} />
    <div className={'shell' + (styleReady ? ' style-ready' : '')}>
      {pendingRemove && <ConfirmDialog title={`Remove ${pendingRemove.name}?`} body={`The ${pendingRemove.name} skin will be deleted from this computer and ${PERSONA_NAMES.aeryx} takes its place. You can add it again any time from its zip.`} image={pendingRemove.posters.includes('core') ? `/skins/${pendingRemove.id}/core.webp` : null} confirm={`remove ${pendingRemove.name}`} cancel="keep it" onConfirm={() => removeSkin(pendingRemove)} onCancel={() => setPendingRemove(null)} />}
      {setup && <Onboarding post={post} get={get} persona={persona} onPersona={selectPersona} skins={skins} onSkinInstalled={skinInstalled}
        first={setup === 'first'} onClose={() => { setSetup(false); refresh(); }} />}
      <div className={'backdrop' + (nav ? ' show' : '')} onClick={() => setNav(false)} inert={setup ? true : undefined} />
      <nav className={'rail' + (nav ? ' open' : '')} id="lair-nav" inert={setup || (!nav && narrow) ? true : undefined}>
        <div className="mark"><span className="mark-glyph"><svg className="mark-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" /><circle cx="50" cy="50" r="42" /></svg>{skinCore ? <img className="mark-skin" src={skinCore} alt="" draggable={false} /> : <DragonMark />}</span><span>{who.NAME}<small>THE LAIR <em className="beta-chip" title="Beta: still in active development, so expect rough edges. Use report a bug or send feedback at the bottom of this panel.">BETA</em></small></span></div>
        <div className="rail-dragon-style" role="group" aria-label="Persona">
          {skinCore ? <img className="rail-skin-core" src={skinCore} alt="" draggable={false} /> : <Reactor style={theme} size={50} />}
          <span>PERSONA</span>
          <div>
            {personaChoices.map(([id, label]) => <button key={id} type="button" aria-pressed={persona === id} onClick={() => selectPersona(id)}>{label}</button>)}
          </div>
          {!demo && <div className="rail-skins"><SkinUpload onInstalled={skinInstalled} label="+ add skin" />{skin && <button type="button" className="skin-remove" onClick={() => setPendingRemove(skin)}>remove {skin.name}</button>}</div>}
        </div>
        <div className="rail-scroll">
          {NAV_GROUPS.map(([label, items]) => <div className="rail-group" key={label}>
            <span className="rail-group-label">{label}</span>
            {items.map((t) => <button key={t} className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} aria-label={t === 'approvals' && pending > 0 ? `approvals, ${pending} pending` : undefined} onClick={() => { setTab(t); setNav(false); }}>
              <RailIcon id={t} />{RAIL_LABELS[t] ?? t}
              {t === 'approvals' && pending > 0 && <span className="badge">{pending}</span>}
            </button>)}
          </div>)}
        </div>
        <div className="foot"><span className="foot-status"><i />{status ? (demo ? 'DEMO LINK' : 'CORE ONLINE') : 'CORE OFFLINE'}</span><span className="foot-clock">{clock}</span>{status && !demo && <button type="button" className="foot-model" onClick={() => setSetup('change')}>model: {status.provider ? `${status.provider.kind} · ${status.provider.model}` : status.setupNeeded ? 'not connected' : 'Claude login'}</button>}{status?.windowsOnly?.length > 0 && <span className="foot-platform">Windows-only here: {status.windowsOnly.map((id) => WIN_ONLY_NAMES[id] ?? id).join(', ')}</span>}{status && !demo && <button type="button" className={'foot-model' + (status.localOnly ? ' foot-local-on' : '')} onClick={() => toggleLocalOnly(status, refresh, who)} title="Local-only mode: no cloud models, web tools, downloads, online speech or news, and known network commands are refused. Not a firewall.">local only: {status.localOnly ? 'on' : 'off'}</button>}{!demo && <span className="foot-links"><a className="foot-model" href={bugReportUrl(status)} target="_blank" rel="noopener noreferrer">report a bug</a><a className="foot-model" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">send feedback</a></span>}the Chain holds.<br />nothing invisible.</div>
      </nav>
      <main className="main" inert={setup ? true : undefined} onPointerMove={(e) => {
        const card = e.target.closest?.('.card, .news-card, .approval');
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      }}>
        <div className={`topbar tab-${tab}`} data-section={String(TABS.indexOf(tab) + 1).padStart(2, '0')} style={{ '--section-dragon': sectionDragon ? `url('${sectionDragon}')` : 'none' }}>
          <button
            ref={burgerRef}
            className="burger"
            aria-label={`${nav ? 'close menu' : 'open menu'}${pending > 0 ? `, ${pending} pending approvals` : ''}`}
            aria-expanded={nav}
            aria-controls="lair-nav"
            onClick={() => setNav((v) => !v)}
          >
            ☰{pending > 0 && <span className="badge">{pending}</span>}
          </button>
          <div className="topbar-title"><span>{who.NAME} / THE LAIR</span><h1>{tabCopy(who)[tab][0]}</h1><p>{tabCopy(who)[tab][1]}</p></div>
          {demo && <span className="chip demo" title="Sample data — the daemon is not connected">{who.name} UI · Demo</span>}
          <span className={'chip ' + (status ? (status.chainIntact === false ? 'red' : 'jade') : 'red')} role="status">
            {status ? (status.chainIntact === false ? 'chain BROKEN' : 'chain intact') : 'daemon offline'}
          </span>
          <span className="chip" role="status">{status ? `brain ${status.brain}` : '—'}</span>
          {status?.halted && <span className="chip red" role="status">HALTED</span>}
          <MindTopbarChips status={status} />
          {pending > 0 && <span className="chip gold" role="status">{pending} awaiting your word</span>}
          <span className="clock">{clock}</span>
        </div>
        {status?.halted && (
          <div className="card halted-banner">
            <h2>{who.name} is halted</h2>
            <div className="small" style={{ marginBottom: 10 }}>
              {status.haltReason || 'stopped by you'}
            </div>
            <div className="muted small" style={{ marginBottom: 10 }}>
              The brain is stopped, the scheduler is idle and the core is quiet. Nothing runs, and
              the halt survives a restart. Clearing it is local-only.
            </div>
            <button
              className="act yes"
              disabled={status.remote}
              title={status.remote ? 'clearing the halt needs the machine' : undefined}
              onClick={() => {
                if (!window.confirm(`Resume ${who.name}? The brain restarts and workflows arm again.`)) return;
                decide('/resume').then((e) => { if (e) window.alert(e); refresh(); });
              }}
            >
              {status.remote ? 'resume — at the machine only' : `resume ${who.name}`}
            </button>
          </div>
        )}
        {tab === 'overview' && styleReady && <Overview status={status} tick={tick} persona={persona} skin={skin} skins={skins} theme={theme} personaChoices={personaChoices} form={form} onForm={selectForm} onPersona={selectPersona} voice={voice} openTab={setTab} onOpenConversation={() => setTab('conversation')} />}
        {tab === 'conversation' && <Conversation status={status} messages={messages} name={who.name} persona={persona} onSent={(message) => setMessages((old) => [...old.slice(-79), message])} />}
        {tab === 'workflows' && <Workflows tick={tick} status={status} />}
        {tab === 'agents' && <Agents tick={tick} />}
        {tab === 'news' && <News tick={tick} />}
        {tab === 'hoard' && <Hoard tick={tick} />}
        {tab === 'approvals' && <Approvals status={status} refresh={refresh} tick={tick} />}
        {tab === 'operations' && <Ops tick={tick} />}
        {MIND_TABS.map((extra) => tab === extra.id && <Fragment key={extra.id}>{extra.render({ status, tick, refresh, openTab: setTab })}</Fragment>)}
      </main>
    </div>
    </WhoContext.Provider>
  );
}

function Gate() {
  const w = useWho();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await call('/auth', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }),
      });
      if (res.ok) { location.reload(); return; }
      const d = await res.json().catch(() => ({}));
      setErr(
        d.error === 'locked' ? `gate locked — try again in ${Math.max(1, Math.ceil((d.retryAfterMs ?? 0) / 60000))} min`
        : d.error === 'no-pin-configured' ? 'no PIN configured on the daemon'
        : 'wrong PIN'
      );
    } catch {
      setErr('daemon unreachable');
    }
    setBusy(false);
  };
  return (
    <div className="gatewrap">
      <div className="card" style={{ maxWidth: 380, width: '100%' }}>
        <div className="mark" style={{ marginBottom: 12 }}>{w.NAME}<small>THE LAIR</small></div>
        <div className="muted small" style={{ marginBottom: 12 }}>
          Remote session over the tailnet. Enter the PIN — five wrong tries locks the gate for
          fifteen minutes, and this session lasts twelve hours.
        </div>
        <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
          <input
            type="password" inputMode="text" autoFocus placeholder="PIN" value={pin}
            aria-label="PIN" autoComplete="current-password"
            aria-describedby={err ? 'gate-err' : undefined} aria-invalid={err ? true : undefined}
            onChange={(e) => setPin(e.target.value)} style={{ flex: 1 }}
          />
          <button className="act yes" type="submit" disabled={busy || !pin}>{busy ? '…' : 'unlock'}</button>
        </form>
        {err && <div id="gate-err" role="alert" className="small" style={{ color: 'var(--red)', marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  );
}

function Conversation({ status, messages, onSent, name = 'Aeryx', persona }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); }, [messages]);
  const send = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || !status || status.halted) return;
    setSending(true);
    setError('');
    try {
      const response = await post('/ask', { text, via: 'typed', as: persona });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request refused (${response.status})`);
      }
      onSent({ role: 'user', text, at: Date.now() });
      setDraft('');
    } catch (problem) { setError(problem.message || 'The request was not sent'); }
    finally { setSending(false); }
  };
  return <section className="conversation-deck card">
    <div className="conversation-heading"><span>AE / DIRECT CHANNEL</span><h2>{name === 'Aeryx' ? 'Talk to the dragon.' : `Talk to ${name}.`}</h2><p>Messages in this window. Actions requiring permission still wait for your decision.</p></div>
    <div className="conversation-log" ref={logRef} role="log" aria-live="polite" aria-label={`Conversation with ${name}`}>
      {messages.length === 0 && <div className="conversation-empty"><span className="conversation-empty-glyph"><DragonMark /></span><strong>The channel is open.</strong><p>Ask {name} a question or give it a task.</p></div>}
      {messages.map((message, index) => <article key={`${message.at}-${index}`} className={`conversation-message ${message.role}`}><span>{message.role === 'user' ? 'YOU' : name.toUpperCase()}</span><p>{message.text}</p></article>)}
    </div>
    <form className="conversation-composer" onSubmit={send}>
      <label htmlFor="lair-ask">YOUR COMMAND</label>
      <div><textarea id="lair-ask" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={!status ? `${name} is unavailable` : status.halted ? `${name} is halted` : `Ask ${name}…`} disabled={!status || status.halted || sending} /><button type="submit" disabled={!draft.trim() || !status || status.halted || sending}>{sending ? 'SENDING…' : 'SEND ↗'}</button></div>
      {error && <p className="conversation-error" role="alert">{error}</p>}
    </form>
  </section>;
}

const MOTE_TONES = { aeryx: ['190,245,255', '60,170,255'], aeri: ['255,214,190', '255,70,50'], violet: ['236,214,255', '150,70,255'] };

function HeroParticles({ theme }) {
  const ref = useRef(null);
  const toneRef = useRef(theme);
  toneRef.current = theme;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0, raf = 0;
    const motes = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), r: .6 + Math.random() * 1.8, v: .00025 + Math.random() * .0009, a: Math.random() * Math.PI * 2 }));
    const size = () => { w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    const ro = new ResizeObserver(size); ro.observe(canvas);
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.y -= m.v; m.a += .02; if (m.y < -.02) { m.y = 1.02; m.x = Math.random(); }
        const x = (m.x + Math.sin(m.a) * .004) * w, y = m.y * h, glow = .35 + .35 * Math.sin(m.a * 1.7);
        const g = ctx.createRadialGradient(x, y, 0, x, y, m.r * 5);
        const [hi, lo] = MOTE_TONES[toneRef.current] ?? MOTE_TONES.aeryx;
        g.addColorStop(0, `rgba(${hi},${glow})`); g.addColorStop(1, `rgba(${lo},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, m.r * 5, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="hero-particles" aria-hidden="true" />;
}

let ghostClickUntil = 0;
const swallowGhostClick = (e) => { if (performance.now() < ghostClickUntil) { e.preventDefault(); e.stopPropagation(); } };

function HoldButton({ onConfirm, disabled, className = 'act yes', children, title }) {
  const [progress, setProgress] = useState(0);
  const timer = useRef(null);
  const armed = useRef(false);
  const stop = () => { cancelAnimationFrame(timer.current); timer.current = null; armed.current = false; setProgress(0); };
  const start = (e) => {
    if (disabled || e.button > 0) return;
    armed.current = false;
    const began = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - began) / 650);
      setProgress(p);
      if (p >= 1) { timer.current = null; armed.current = true; return; }
      timer.current = requestAnimationFrame(tick);
    };
    timer.current = requestAnimationFrame(tick);
  };
  const release = () => {
    const fire = armed.current;
    stop();
    if (!fire) return;
    ghostClickUntil = performance.now() + 600;
    onConfirm();
  };
  useEffect(() => () => cancelAnimationFrame(timer.current), []);
  return (
    <button type="button" className={className + ' hold-btn'} disabled={disabled} title={title ?? 'Press and hold, then release to confirm'} style={{ '--hold': progress }}
      onPointerDown={start} onPointerUp={release} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onConfirm(); } }}>
      <span className="hold-fill" aria-hidden="true" />{children}<small aria-hidden="true">{progress >= 1 ? 'RELEASE' : 'HOLD'}</small>
    </button>
  );
}

function Overview({ status, tick, persona, skin, skins, theme, personaChoices, form, onForm, onPersona, voice, openTab, onOpenConversation }) {
  const [ops, setOps] = useState(null);
  const [wfs, setWfs] = useState([]);
  const [usage, setUsage] = useState(null);
  const [emote, setEmote] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [shock, setShock] = useState(0);
  const [hint, setHint] = useState(null);
  const [fx, setFx] = useState(null);
  const [full, setFull] = useState(false);
  const [bare, setBare] = useState(false);
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFull(false); else if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !e.altKey) setBare((v) => !v); };
    document.documentElement.classList.add('stage-full-open');
    addEventListener('keydown', onKey);
    return () => { removeEventListener('keydown', onKey); document.documentElement.classList.remove('stage-full-open'); setBare(false); };
  }, [full]);
  const name = skin?.name ?? PERSONA_NAMES[persona];
  const forms = skin?.forms ?? Object.keys(FORM_NAMES);
  const emotes = form === 'human' && skin?.emotes?.length ? skin.emotes : EMOTES[form];
  const formWords = ['One form', 'Two forms', 'Three forms'][forms.length - 1];
  const onFx = (kind) => setFx({ kind, at: performance.now() });

  useEffect(() => { setSoundOn(soundEnabled()); }, []);
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    try { localStorage.setItem('aeryx.sound', next ? 'on' : 'off'); } catch { }
  };

  useEffect(() => {
    if (!voice) return;
    setSpeaking(true);
    const done = setTimeout(() => setSpeaking(false), voice.ms);
    return () => clearTimeout(done);
  }, [voice]);

  const brain = status?.brain;
  const activity = !status || brain === 'offline' || brain === 'needs-setup' ? 'offline'
    : status.pendingConfirms?.length > 0 ? 'awaiting'
    : brain === 'thinking' || brain === 'executing' ? 'working'
    : 'idle';

  const changeForm = (next) => {
    if (next === form) return;
    if (form === 'core') cue('summon', .45);
    setShock((n) => n + 1);
    onForm(next);
  };
  const gesture = (id) => {
    if (id === 'roar') cue('growl', .6);
    if (id === 'pulse') cue('summon', .3);
    setEmote({ name: id });
  };
  const tapStage = () => {
    if (form === 'core' && forms.length > 1) changeForm(forms[1]);
    else if (form === 'dragon') cue('growl', .6);
  };

  useEffect(() => {
    get('/ops?limit=200').then(setOps).catch(() => {});
    get('/workflows').then((d) => setWfs(d.workflows ?? [])).catch(() => {});
    get('/usage').then(setUsage).catch(() => setUsage(null));
  }, [tick]);

  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const today = (ts) => ts && new Date(ts).getTime() >= midnight.getTime();
  const rows = (ops?.rows ?? []).filter((r) => today(r.ts));
  const wyrmlings = rows.filter((r) => r.tool === 'wyrmling').length;
  const runs = ops?.runs ?? [];
  const runsToday = runs.filter((r) => today(r.startedTs));
  const runsOk = runsToday.filter((r) => r.outcome === 'ok').length;
  const runsBad = runsToday.filter((r) => ['failed', 'timeout'].includes(r.outcome)).length;
  const active = wfs.filter((w) => w.status === 'active').length;
  return (
    <>
      <section className={`overview-hero style-${theme} form-${form} activity-${activity}${fx ? ` fx-${fx.kind}` : ''}${full ? ' stage-full' : ''}${full && bare ? ' stage-bare' : ''}`}>
        <div className="hero-media" aria-hidden="true">
          <div className="hero-still" />
          <div className="hero-light" />
          {fx && <div key={fx.at} className={`hero-fx hero-fx-${fx.kind}`} onAnimationEnd={(e) => { if (e.animationName === 'hero-fx-life') setFx(null); }} />}
        </div>
        <CharacterStage persona={persona} form={form} activity={activity} speaking={speaking} emote={emote} hint={hint} onTap={tapStage} skins={skins} onFx={onFx} />
        <HeroParticles theme={theme} />
        <div className="hero-hud" aria-hidden="true">
          <i className="hud-c tl" /><i className="hud-c tr" /><i className="hud-c bl" /><i className="hud-c br" />
          <span className="hud-tag tl">{skin ? (skin.tag ?? 'SKIN') : persona === 'aeri' ? 'AE-02' : 'AE-01'} // {name.toUpperCase()}</span>
          <span className="hud-tag tr">FORM 0{forms.indexOf(form) + 1} · {FORM_NAMES[form].toUpperCase()} // {activity.toUpperCase()}</span>
          <span className="hud-scan" />
        </div>
        <div className="overview-hero-copy">
          <span className="hero-kicker">{`${name.toUpperCase()} / ${skin ? 'LOCAL SKIN' : 'THE LAIR'}`}</span>
          <h2><span className="hero-desktop-copy">{name} is yours<br />to command.</span><span className="hero-mobile-copy">{name} awaits.</span></h2>
          <p><span className="hero-desktop-copy">One mind, {formWords.toLowerCase()}. Every action stays visible and every decision stays yours.</span><span className="hero-mobile-copy">One mind. {formWords}. Tap to summon.</span></p>
          <div className="hero-signals"><span className={status ? 'on' : ''}>{status?.brain || 'Offline'}</span><span className="hero-model-signal">{status?.model || status?.provider?.model || (status && !status.setupNeeded ? 'Claude login' : 'No model connected')}</span>{status?.localOnly && <span className="on">Local only</span>}</div>
          <div className="hero-persona" role="group" aria-label="Persona">
            {personaChoices.map(([id, label]) => <button key={id} type="button" aria-pressed={persona === id} onClick={() => onPersona(id)}>{label}</button>)}
          </div>
          <div className="hero-forms" role="group" aria-label={`${name}'s form`}>
            {forms.map((id) => [id, FORM_NAMES[id]]).map(([id, label], index) => (
              <button key={id} type="button" aria-pressed={form === id} onPointerEnter={() => setHint(id)} onFocus={() => setHint(id)} onClick={() => changeForm(id)}><small>0{index + 1}</small>{label}</button>
            ))}
          </div>
          <div className="hero-emotes" role="group" aria-label="Gestures">
            {emotes.map(([id, label]) => <button key={id} type="button" onClick={() => gesture(id)}>{label}</button>)}
            <button type="button" className="hero-sound" aria-pressed={soundOn} onClick={toggleSound}>{soundOn ? 'sound on' : 'sound off'}</button>
          </div>
        </div>
        {shock > 0 && <span key={shock} className="core-shockwave" aria-hidden="true" />}
        <span className="hero-gaze-hint" aria-hidden="true">◇ {skin?.hints?.[form] ?? (form === 'core' ? 'tap the core to summon' : form === 'dragon' ? 'tap to wake it' : 'tap to say hi')}</span>
        {skin?.credit && <span className="hero-credit">{skin.credit}</span>}
        <button type="button" className="hero-full" aria-pressed={full} aria-label={full ? 'Leave full screen' : 'Full screen stage'} onClick={() => setFull((v) => !v)}>{full ? '✕' : '⤢'}</button>
        {full && <button type="button" className="hero-bare" aria-pressed={bare} aria-label={bare ? 'Show controls' : 'Hide controls (H)'} onClick={() => setBare((v) => !v)}>{bare ? '◉' : '◌'}</button>}
      </section>
      <button type="button" className="overview-conversation-link" onClick={onOpenConversation}><span>↗</span><strong>Speak with {name}</strong><small>Open the command channel</small></button>
      <div className="overview-cards">
          <MindOverviewCards status={status} tick={tick} persona={persona} theme={theme} name={name} openTab={openTab} />
          <div className="card today-card">
            <h2>Today</h2>
            <div className="stat-grid">
              <span className="stat"><div className="n">{active}</div><div className="l">workflows armed</div></span>
              <span className="stat"><div className="n">{runsOk}</div><div className="l">runs ok</div></span>
              <span className="stat"><div className="n" style={runsBad ? { color: 'var(--red)' } : {}}>{runsBad}</div><div className="l">runs failed</div></span>
              <span className="stat"><div className="n">{wyrmlings}</div><div className="l">wyrmlings flown</div></span>
              <span className="stat" title="Tokens the model read and wrote today (cached context not counted)"><div className="n">{fmtTokens(usage?.today)}</div><div className="l">tokens today</div></span>
              <span className="stat" title={COST_NOTE[usage?.basis ?? 'estimate']}><div className="n">{fmtCost(usage)}</div><div className="l">cost today</div></span>
            </div>
          </div>
      </div>
      {runs.length > 0 && (
        <div className="card">
          <h2>Recent runs</h2>
          {runs.slice(0, 6).map((r) => (
            <div key={r.id} className="small" style={{ padding: '3px 0', borderBottom: '1px solid var(--line)' }}>
              <span className={'pill ' + (r.outcome === 'ok' ? 'active' : r.outcome ? 'proposed' : 'paused')}>{r.outcome ?? 'running'}</span>{' '}
              <b>{r.workflow}</b> · {fmtTs(r.startedTs)} <span className="muted">{r.detail ? '— ' + String(r.detail).slice(0, 90) : ''}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Workflows({ tick, status }) {
  const w = useWho();
  const [wfs, setWfs] = useState([]);
  const [form, setForm] = useState({ name: '', schedule: '', prompt: '' });
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState({});
  const remote = status?.remote === true;
  const helloOff = winOnly(status, 'hello');
  const load = useCallback(() => get('/workflows').then((d) => setWfs(d.workflows ?? [])).catch(() => {}), []);
  useEffect(() => { load(); }, [tick, load]);

  const act = async (id, route) => {
    const e = await decide(`/workflows/${id}/${route}`);
    setErrs((m) => ({ ...m, [id]: e }));
    load();
  };
  const HELLO_AT_MACHINE = 'sit at the machine — a standing order needs Windows Hello';
  const create = async (e) => {
    e.preventDefault();
    setErr('');
    const res = await post('/workflows', { ...form, purpose: '', status: 'active', source: 'ui' });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? 'create failed');
    else { setForm({ name: '', schedule: '', prompt: '' }); load(); }
  };

  return (
    <div className="card">
      <h2>Workflows</h2>
      <table className="table-wide">
        <thead><tr><th>workflow</th><th>schedule</th><th>last / next</th><th>status</th><th></th></tr></thead>
        <tbody>
          {wfs.length === 0 && <tr><td colSpan={5} className="muted">none yet — create one below or just ask {w.name} for something recurring</td></tr>}
          {wfs.map((wf) => (
            <tr key={wf.id}>
              <td>
                <b>{wf.name}</b>
                {(wf.scope ?? []).length > 0 && (
                  <span className="pill gold" style={{ marginLeft: 6 }} title={`standing order: ${wf.scope.join(', ')} — runs act unattended in these lanes`}>
                    standing · {wf.scope.length}
                  </span>
                )}
                {wf.purpose && <div className="muted small">{wf.purpose}</div>}
              </td>
              <td data-label="schedule">{wf.scheduleWords ?? wf.schedule}</td>
              <td className="muted small" data-label="last">{wf.lastOutcome ? wf.lastOutcome + ' · ' : ''}{fmtTs(wf.lastRunTs)}<br />next {fmtTs(wf.nextRunTs)}</td>
              <td><span className={'pill ' + wf.status}>{wf.status}</span></td>
              <td className="acts">
                {wf.status === 'proposed' && (
                  <button className="act yes" disabled={(wf.scope ?? []).length > 0 && (remote || helloOff)} title={(wf.scope ?? []).length > 0 && (remote || helloOff) ? (remote ? HELLO_AT_MACHINE : NEEDS_HELLO) : undefined} onClick={() => act(wf.id, 'approve')}>
                    {(wf.scope ?? []).length > 0 ? (remote ? 'grant — at the machine only' : helloOff ? `grant — ${NEEDS_HELLO}` : 'approve & grant standing order') : 'approve'}
                  </button>
                )}{' '}
                {wf.status === 'active' && <><button className="act" onClick={() => act(wf.id, 'run')}>run now</button>{' '}<button className="act" onClick={() => act(wf.id, 'pause')}>pause</button></>}{' '}
                {wf.status === 'paused' && <button className="act yes" disabled={(wf.scope ?? []).length > 0 && (remote || helloOff)} title={(wf.scope ?? []).length > 0 && (remote || helloOff) ? (remote ? HELLO_AT_MACHINE : NEEDS_HELLO) : undefined} onClick={() => act(wf.id, 'resume')}>resume</button>}{' '}
                <button className="act no" onClick={() => window.confirm(`Delete "${wf.name}"?`) && act(wf.id, 'delete')}>delete</button>
                {errs[wf.id] && <div className="small" style={{ color: 'var(--red)' }}>{errs[wf.id]}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={create} className="create-form workflow-form">
        <input type="text" aria-label="workflow name" placeholder="name — e.g. morning briefing" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input type="text" aria-label="workflow schedule" placeholder="daily@08:00" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} />
        <input type="text" aria-label="workflow prompt" placeholder={`what should ${w.name} do on this schedule?`} style={{ gridColumn: '1 / -1' }} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="act" type="submit">create workflow</button>
          <span className="muted small">manual · every 15m/2h · daily@08:00 · weekdays@ · weekends@ · weekly@mon 09:00 · monthly@1 09:00</span>
          {err && <span className="small" style={{ color: 'var(--red)' }}>{err}</span>}
        </div>
      </form>
    </div>
  );
}

function Agents({ tick }) {
  const w = useWho();
  const [agents, setAgents] = useState([]);
  const [form, setForm] = useState({ slug: '', description: '', prompt: '' });
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState({});
  const load = useCallback(() => get('/agents').then((d) => setAgents(d.agents ?? [])).catch(() => {}), []);
  useEffect(() => { load(); }, [tick, load]);
  const act = async (id, route) => {
    const e = await decide(`/agents/${id}/${route}`);
    setErrs((m) => ({ ...m, [id]: e }));
    load();
  };
  const create = async (e) => {
    e.preventDefault();
    setErr('');
    const res = await post('/agents', { ...form, source: 'ui' });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? 'create failed');
    else { setForm({ slug: '', description: '', prompt: '' }); load(); }
  };

  return (
    <div className="card">
      <h2>Permanent agents</h2>
      <table>
        <thead><tr><th>agent</th><th>tools</th><th>status</th><th></th></tr></thead>
        <tbody>
          {agents.length === 0 && <tr><td colSpan={4} className="muted">no permanent agents — wyrmlings (one-off subagents) need no roster</td></tr>}
          {agents.map((a) => {
            let tools = 'inherit';
            try { const t = a.tools ? JSON.parse(a.tools) : null; if (t) tools = `${t.length} tool${t.length === 1 ? '' : 's'}`; } catch {}
            return (
              <tr key={a.id}>
                <td><b>{a.slug}</b><div className="muted small">{a.description}</div></td>
                <td className="muted small" data-label="tools">{tools}</td>
                <td><span className={'pill ' + a.status}>{a.status}</span></td>
                <td className="acts">
                  {a.status === 'proposed' && <><button className="act yes" onClick={() => act(a.id, 'approve')}>approve</button>{' '}<button className="act no" onClick={() => act(a.id, 'retire')}>reject</button></>}
                  {a.status === 'active' && <button className="act no" onClick={() => act(a.id, 'retire')}>retire</button>}
                  {a.status === 'retired' && <button className="act yes" onClick={() => act(a.id, 'revive')}>revive</button>}
                  {errs[a.id] && <div className="small" style={{ color: 'var(--red)' }}>{errs[a.id]}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form onSubmit={create} className="create-form agent-form">
        <input type="text" aria-label="agent slug" placeholder="slug — e.g. inbox-triager" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        <input type="text" aria-label="when to use this agent" placeholder={`when should ${w.name} reach for this agent?`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <input type="text" aria-label="agent system prompt" placeholder="the agent's system prompt" style={{ gridColumn: '1 / -1' }} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="act" type="submit">create agent</button>
          <button className="act" type="button" onClick={() => decide('/brain/restart').then((e) => e && setErr(e))}>restart brain</button>
          <span className="muted small">roster changes apply at the next brain start</span>
          {err && <span className="small" style={{ color: 'var(--red)' }}>{err}</span>}
        </div>
      </form>
    </div>
  );
}

const REGION_META = {
  AS: { name: 'Asia' }, EU: { name: 'Europe' }, NA: { name: 'North America' },
  AF: { name: 'Africa' }, SA: { name: 'South America' }, OC: { name: 'Oceania' },
};
const dispatchCode = (text) => {
  let h = 0;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `DSP-${String(h % 9000 + 1000)}`;
};

function NewsCard({ it, showRegion, countries, index = 0 }) {
  const place = it.country ? (countries?.[it.country]?.name ?? it.country) : (REGION_META[it.region]?.name ?? null);
  return (
    <a className="news-card" href={it.link} target="_blank" rel="noreferrer noopener" style={{ '--i': index }}>
      <div className={'thumb' + (it.image ? '' : ' noimg')}>
        {it.image && <img src={it.image.startsWith('/') ? it.image : '/news/img?u=' + encodeURIComponent(it.image)} alt="" loading="lazy"
          onError={(e) => { e.currentTarget.parentNode.classList.add('noimg'); e.currentTarget.remove(); }} />}
        <span className="thumb-code">{dispatchCode(it.title)}</span>
        {showRegion && place && <span className="rchip">{place}</span>}
      </div>
      <div className="body">
        <div className="meta"><span className="src">{it.source}</span><span className="ago">{it.ts ? fmtTs(it.ts) : ''}</span></div>
        <div className="title">{it.title}</div>
      </div>
    </a>
  );
}

function News({ tick }) {
  const w = useWho();
  const [view, setView] = useState('world');
  const [sel, setSel] = useState(null);
  const [globeTurn, setGlobeTurn] = useState(0);
  const [news, setNews] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => get('/news').then(setNews).catch(() => setNews(null)), []);
  useEffect(() => { load(); }, [load, tick]);
  const refresh = async () => {
    setBusy(true);
    await post('/news/refresh').catch(() => {});
    await load();
    setBusy(false);
  };

  const cats = news?.categories ?? {};
  const countries = news?.countries ?? {};
  const all = Object.values(cats).flat();
  const regioned = all.filter((it) => it.region);
  const counts = {}, countryCounts = {};
  for (const k of Object.keys(REGION_META)) counts[k] = 0;
  for (const it of regioned) {
    counts[it.region] = (counts[it.region] ?? 0) + 1;
    if (it.country) countryCounts[it.country] = (countryCounts[it.country] ?? 0) + 1;
  }
  const byTs = (a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? ''));
  const interleave = (list) => {
    const bySrc = new Map();
    for (const it of list) {
      if (!bySrc.has(it.source)) bySrc.set(it.source, []);
      bySrc.get(it.source).push(it);
    }
    const lanes = [...bySrc.values()];
    const out = [];
    for (let i = 0; out.length < list.length; i++) for (const lane of lanes) if (lane[i]) out.push(lane[i]);
    return out;
  };

  const items = view === 'world'
    ? (sel
        ? regioned.filter((it) => (sel.type === 'country' ? it.country === sel.key : it.region === sel.key)).sort(byTs)
        : interleave((cats.global ?? []).slice().sort(byTs)))
    : (cats[view] ?? []);
  const latest = all.slice().sort(byTs).slice(0, 10);
  const errors = news?.errors ?? [];
  const nationalUnset = view === 'national' && news && !(news.feeds ?? []).some((f) => f.category === 'national');
  const selLabel = !sel ? 'all regions'
    : sel.type === 'region' ? REGION_META[sel.key].name
    : [REGION_META[countries[sel.key]?.region]?.name, countries[sel.key]?.name ?? sel.key]
        .filter(Boolean).join(' › ');

  return (
    <div className="card newswall">
      <h2>News</h2>
      <div className="subtabs">
        {['world', 'national', 'tech', 'ai'].map((v) => (
          <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
            {v === 'ai' ? 'tech › ai' : v}
          </button>
        ))}
        <button onClick={refresh} disabled={busy}>{busy ? 'fetching…' : 'refresh'}</button>
        <span className="muted small" style={{ alignSelf: 'center' }}>
          {news?.fetchedAt ? 'fetched ' + fmtTs(news.fetchedAt) : 'not fetched yet'}
        </span>
      </div>

      {view === 'world' && (
        <>
          <div className="maphero">
            <div className="globe-console">
              <div className="globe-stage">
                <svg className="globe-plates" viewBox="0 0 600 420" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="globe-plate-metal" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" style={{ stopColor: "rgb(var(--c-173a6a))" }} /><stop offset=".38" style={{ stopColor: "rgb(var(--c-10284c))" }} /><stop offset="1" style={{ stopColor: "rgb(var(--c-06152e))" }} />
                    </linearGradient>
                  </defs>
                  <g className="globe-plate-half">
                    <path className="globe-plate-face" d="M0 31H180L211 53V98L187 120H0Z" />
                    <path className="globe-plate-face" d="M0 140H191L221 164V220L192 244H0Z" />
                    <path className="globe-plate-face" d="M0 266H185L216 290V350L189 376H0Z" />
                    <path className="globe-plate-edge" d="M0 42H174L196 58M0 151H185L205 169M0 278H180L199 297" />
                    <path className="globe-plate-trace" d="M9 75H77L91 91H134M0 188H66L81 203H149M0 319H72L86 334H143" />
                    <path className="globe-plate-trace" d="M22 111H111M28 234H104M18 366H117" />
                    <path className="globe-plate-tile" d="M20 48H65L79 62V99L65 113H20L6 99V62Z M20 166H65L79 180V217L65 231H20L6 217V180Z M20 289H65L79 303V340L65 354H20L6 340V303Z" />
                    <path className="globe-plate-tile-inset" d="M25 60H60L68 68V93L60 101H25L17 93V68Z M25 178H60L68 186V211L60 219H25L17 211V186Z M25 301H60L68 309V334L60 342H25L17 334V309Z" />
                    <circle className="globe-plate-node" cx="43" cy="90" r="3" /><circle className="globe-plate-node" cx="37" cy="202" r="3" /><circle className="globe-plate-node" cx="40" cy="333" r="3" />
                  </g>
                  <g transform="translate(600 0) scale(-1 1)">
                    <path className="globe-plate-face" d="M0 31H180L211 53V98L187 120H0Z" />
                    <path className="globe-plate-face" d="M0 140H191L221 164V220L192 244H0Z" />
                    <path className="globe-plate-face" d="M0 266H185L216 290V350L189 376H0Z" />
                    <path className="globe-plate-edge" d="M0 42H174L196 58M0 151H185L205 169M0 278H180L199 297" />
                    <path className="globe-plate-trace" d="M9 75H77L91 91H134M0 188H66L81 203H149M0 319H72L86 334H143" />
                    <path className="globe-plate-trace" d="M22 111H111M28 234H104M18 366H117" />
                    <path className="globe-plate-tile" d="M20 48H65L79 62V99L65 113H20L6 99V62Z M20 166H65L79 180V217L65 231H20L6 217V180Z M20 289H65L79 303V340L65 354H20L6 340V303Z" />
                    <path className="globe-plate-tile-inset" d="M25 60H60L68 68V93L60 101H25L17 93V68Z M25 178H60L68 186V211L60 219H25L17 211V186Z M25 301H60L68 309V334L60 342H25L17 334V309Z" />
                    <circle className="globe-plate-node" cx="43" cy="90" r="3" /><circle className="globe-plate-node" cx="37" cy="202" r="3" /><circle className="globe-plate-node" cx="40" cy="333" r="3" />
                  </g>
                </svg>
                <div className="globe-shell" role="group" aria-label="Earth globe. Drag to rotate; tap a glowing pin to filter news by country.">
                  <div className="globe-rings" aria-hidden="true"><i /><i /><i /></div>
                  <NewsGlobe countryCounts={countryCounts} countries={countries} sel={sel} turn={globeTurn}
                    onSelect={(next) => setSel((cur) => cur && next && cur.type === next.type && cur.key === next.key ? null : next)} />
                </div>
                <div className="globe-turn-controls">
                  <button type="button" onClick={() => setGlobeTurn((turn) => Math.min(1, turn + .5))} disabled={globeTurn >= 1} aria-label="Rotate globe west">← WEST</button>
                  <span>{w.NAME} / EARTH · DRAG TO ROTATE</span>
                  <button type="button" onClick={() => setGlobeTurn((turn) => Math.max(-1, turn - .5))} disabled={globeTurn <= -1} aria-label="Rotate globe east">EAST →</button>
                </div>
              </div>
              <div className="globe-readout">
                <span className="globe-eyebrow">AE / WORLD SIGNAL</span>
                <h3>Earth, in the loop.</h3>
                <p>Signals mapped to where the story happened. Select a country on the globe or a region below.</p>
                <div className="globe-count"><strong>{news ? regioned.length : '—'}</strong><span>mapped stories<br />across {Object.values(counts).filter((n) => n > 0).length} regions</span></div>
                <div className="globe-status"><span className={news?.fetchedAt ? 'on' : ''} />{news?.fetchedAt ? `LAST SYNC ${fmtTs(news.fetchedAt)}` : 'AWAITING FIRST SYNC'}</div>
              </div>
            </div>
          </div>
          <div className="regionchips" role="group" aria-label="filter by region">
            {Object.entries(REGION_META).map(([k, m]) => {
              const on = sel?.type === 'region' && sel.key === k;
              return (
                <button key={k} className={'region-chip' + (on ? ' on' : '')} aria-pressed={on}
                  onClick={() => setSel(on ? null : { type: 'region', key: k })}>
                  {m.name} <span className="n">{counts[k]}</span>
                </button>
              );
            })}
          </div>
          {latest.length > 0 && (
            <div className="tickerstrip" aria-hidden="true">
              <span className="label">latest</span>
              <div className="lanewrap"><div className="lane">
                {[...latest, ...latest].map((it, i) => (
                  <span key={i}><b>{it.source}</b>{it.title}</span>
                ))}
              </div></div>
            </div>
          )}
          <div className="selbar">
            <span className="selname">{selLabel}</span>
            <span className="muted small">{items.length} stories</span>
            {sel && <button className="clearsel" onClick={() => setSel(null)}>✕ clear filter</button>}
          </div>
        </>
      )}

      {items.length === 0 && (
        <div className="muted">
          {nationalUnset
            ? <>national ships empty — add your country&apos;s feed to news.feeds in aeryx.config.json with &quot;category&quot;: &quot;national&quot;, then restart the daemon.</>
            : <>nothing here yet — {news?.fetchedAt ? (view === 'world' && sel ? `${selLabel} came back empty this refresh` : 'this category came back empty') : 'hit refresh'}.</>}
          {errors.length > 0 && (
            <div className="small" style={{ marginTop: 6 }}>
              {errors.map((e, i) => <div key={i} style={{ color: 'var(--red)' }}>{e.feed}: {e.error}</div>)}
            </div>
          )}
        </div>
      )}
      <div className="newsgrid">
        {items.map((it, i) => <NewsCard key={it.title + i} it={it} index={i} showRegion={view === 'world'} countries={countries} />)}
      </div>
      {errors.length > 0 && items.length > 0 && (
        <div className="muted small" style={{ marginTop: 10 }}>
          {errors.length} feed{errors.length === 1 ? '' : 's'} failed this refresh — see the empty categories.
        </div>
      )}
    </div>
  );
}

function Hoard({ tick }) {
  const w = useWho();
  const [hoard, setHoard] = useState(null);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState(null);
  const [hoardFailed, setHoardFailed] = useState(false);
  useEffect(() => { get('/hoard').then((h) => { setHoard(h); setHoardFailed(false); }).catch(() => setHoardFailed(true)); }, [tick]);

  const save = async () => {
    const e = await decide('/hoard/user.md', { content: draft });
    if (!e) { setMsg({ ok: true, text: 'saved — the brain re-reads memory at its next start' }); setDraft(null); get('/hoard').then(setHoard).catch(() => {}); }
    else setMsg({ ok: false, text: e === 'the daemon did not answer' ? 'daemon offline — not saved' : e });
  };

  if (!hoard) return <div className="card"><h2>The Hoard</h2><div className="muted">{hoardFailed ? 'daemon offline' : 'loading…'}</div></div>;
  return (
    <>
      <div className="card hoard-file yours">
        <h2>The Hoard — what {w.name} knows about you</h2>
        <div className="muted small" style={{ marginBottom: 10 }}>
          Yours, fully editable, nothing hidden. <b>user.md</b> is your page; <b>learned.md</b> is what {w.he}
          noticed (machine-appended); <b>persona.md</b> is who {w.he} is (edited in the repo, eyes open).
        </div>
        {draft === null ? (
          <>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 12.5 }}>{hoard.files['user.md'] || `(empty — tell ${w.name} about yourself, or write it here)`}</pre>
            <button className="act" style={{ marginTop: 8 }} onClick={() => setDraft(hoard.files['user.md'] ?? '')}>edit user.md</button>
          </>
        ) : (
          <>
            <textarea aria-label="user.md — your page" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="act yes" onClick={save}>save</button>
              <button className="act" onClick={() => { setDraft(null); setMsg(null); }}>cancel</button>
            </div>
          </>
        )}
        {msg && <div className="small" role="status" style={{ marginTop: 6, color: msg.ok ? 'var(--jade)' : 'var(--red)' }}>{msg.text}</div>}
      </div>
      <div className="grid2">
        <div className="card hoard-file">
          <h2>learned.md</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 12 }}>{hoard.files['learned.md'] || '(nothing learned yet)'}</pre>
        </div>
        <div className="card hoard-file">
          <h2>persona.md</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 12 }}>{hoard.files['persona.md'] || '(missing)'}</pre>
        </div>
      </div>
    </>
  );
}

function Approvals({ status, refresh, tick }) {
  const w = useWho();
  const [wfs, setWfs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [notices, setNotices] = useState([]);
  const [draft, setDraft] = useState(null);
  const [errs, setErrs] = useState({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const load = useCallback(() => {
    get('/workflows').then((d) => setWfs((d.workflows ?? []).filter((w) => w.status === 'proposed'))).catch(() => {});
    get('/agents').then((d) => setAgents((d.agents ?? []).filter((a) => a.status === 'proposed'))).catch(() => {});
    get('/hoard/notices').then((d) => setNotices((d.notices ?? []).filter((n) => n.status === 'proposed'))).catch(() => {});
    get('/hoard/draft').then((d) => setDraft(d.draft ?? null)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [tick, load]);
  const mind = useMindApprovals({ status, tick });

  const act = (key, p, body, after) => async () => {
    setErrs((e) => ({ ...e, [key]: null }));
    const err = await decide(p, body);
    if (err) setErrs((e) => ({ ...e, [key]: err }));
    (after ?? load)();
  };
  const Err = ({ k }) => errs[k]
    ? <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 8 }}>{errs[k]}</div>
    : null;

  const remote = status?.remote === true;
  const helloOff = winOnly(status, 'hello');

  const confirms = status?.pendingConfirms ?? [];
  const empty = confirms.length === 0 && wfs.length === 0 && agents.length === 0 && notices.length === 0 && mind.count === 0 && !draft;
  return (
    <div className="card" onClickCapture={swallowGhostClick}>
      <h2>The Chain — everything awaiting your word</h2>
      {empty && <div className="muted">nothing pending. the dragon works within its chain.</div>}
      {confirms.map(({ id, question, riskClass, laneId, ts, timeoutMs, preview }) => {
        const left = ts && timeoutMs ? Math.max(0, Math.round((ts + timeoutMs - now) / 1000)) : null;
        const dead = left === 0;
        const cls3 = riskClass === 3;
        return (
          <div key={id} className={'approval' + (dead ? ' expired' : '')}>
            <div className="q">{question}</div>
            {preview && (
              <img
                src={preview}
                alt="what sits under the point right now"
                style={{ display: 'block', maxWidth: '100%', border: '1px solid var(--line)', borderRadius: 6, marginBottom: 8 }}
              />
            )}
            <div className="small" style={{ marginBottom: 8 }}>
              {riskClass !== undefined && (
                <span className={'pill ' + (cls3 ? 'proposed' : 'paused')}>class {riskClass}</span>
              )}{' '}
              {laneId && <span className="muted">{laneId}</span>}
              {left !== null && (
                <span style={{ marginLeft: 8, color: dead ? 'var(--red)' : left < 20 ? 'var(--warn)' : 'var(--ash-text)' }}>
                  {dead ? 'expired — denied by timeout, nothing ran' : leftWords(left)}
                </span>
              )}
            </div>
            {cls3 && remote && (
              <div className="small" style={{ marginBottom: 8, color: 'var(--warn)' }}>
                Class 3 asks for Windows Hello at the PC — a yes from here cannot finish it.
              </div>
            )}
            <div className="acts">
              <button className="act no" disabled={dead} onClick={act(id, '/confirm', { id, approve: false }, refresh)}>deny</button>
              <HoldButton disabled={dead} onConfirm={act(id, '/confirm', { id, approve: true }, refresh)}>approve</HoldButton>
            </div>
            <Err k={id} />
          </div>
        );
      })}
      {wfs.map((wf) => {
        const scope = wf.scope ?? [];
        const scoped = scope.length > 0;
        return (
          <div key={'wf' + wf.id} className="approval">
            <div className="q">Workflow proposal: “{wf.name}” — {wf.scheduleWords ?? wf.schedule}</div>
            <div className="muted small" style={{ marginBottom: 8 }}>{wf.prompt}</div>
            {scoped && (
              <div className="small" style={{ marginBottom: 8 }}>
                <b style={{ color: 'var(--warn)' }}>STANDING ORDER</b> — once you approve, its runs act
                on their own, unattended, in these lanes (no confirm, no Hello per act):
                <div style={{ margin: '4px 0' }}>
                  {scope.map((s) => <span key={s} className="pill proposed" style={{ marginRight: 4, fontFamily: 'var(--mono)' }}>{s}</span>)}
                </div>
                Anything outside this list still stops and asks. Approving is local-only and Windows
                Hello asks once, here — that yes IS the standing. Revoke any time by pausing or deleting.
              </div>
            )}
            <div className="acts">
              <button className="act no" onClick={act('wf' + wf.id, `/workflows/${wf.id}/delete`)}>reject</button>
              <button className="act yes" disabled={scoped && (remote || helloOff)} title={scoped && remote ? LOCAL_ONLY : scoped && helloOff ? NEEDS_HELLO : undefined}
                onClick={act('wf' + wf.id, `/workflows/${wf.id}/approve`)}>
                {scoped ? (remote ? 'grant — at the machine only' : helloOff ? `grant — ${NEEDS_HELLO}` : 'approve & grant standing order') : 'approve'}
              </button>
            </div>
            <Err k={'wf' + wf.id} />
          </div>
        );
      })}
      {agents.map((a) => (
        <div key={'ag' + a.id} className="approval">
          <div className="q">Agent proposal: “{a.slug}” — {a.description}</div>
          <div className="muted small" style={{ marginBottom: 8 }}>{a.prompt}</div>
          <div className="acts">
            <button className="act no" onClick={act('ag' + a.id, `/agents/${a.id}/retire`)}>reject</button>
            <button className="act yes" onClick={act('ag' + a.id, `/agents/${a.id}/approve`)}>approve</button>
          </div>
          <Err k={'ag' + a.id} />
        </div>
      ))}
      {draft && (
        <div className="approval">
          <div className="q">Your About Me, drafted by {w.name} — applying replaces user.md</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 12, maxHeight: 320, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6, padding: 10, margin: '8px 0' }}>{draft.content}</pre>
          <div className="acts">
            <button className="act no" onClick={act('draft' + draft.id, `/hoard/draft/${draft.id}/reject`)}>reject</button>
            <button className="act yes" onClick={act('draft' + draft.id, `/hoard/draft/${draft.id}/apply`)}>apply — save as my About Me</button>
          </div>
          <Err k={'draft' + draft.id} />
        </div>
      )}
      {notices.map((n) => (
        <div key={'no' + n.id} className="approval">
          <div className="q">Noticed about you: “{n.fact}”</div>
          <div className="muted small" style={{ marginBottom: 8 }}>
            keep hardens it into learned.md; dismiss is forever — it will never be proposed again.
          </div>
          <div className="acts">
            <button
              className="act no"
              onClick={(e) => {
                if (!window.confirm(`Dismiss “${n.fact}” forever? It will never be proposed again.`)) return;
                act('no' + n.id, `/hoard/notices/${n.id}/dismiss`)(e);
              }}
            >dismiss</button>
            <button className="act yes" onClick={act('no' + n.id, `/hoard/notices/${n.id}/keep`)}>keep</button>
          </div>
          <Err k={'no' + n.id} />
        </div>
      ))}
      {mind.cards}
    </div>
  );
}

function Ops({ tick }) {
  const [ops, setOps] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { get('/ops?limit=60').then(setOps).catch(() => setOps(null)); }, [tick]);
  const KINDS = ['workflow', 'agent', 'wyrmling', 'hoard', ...MIND_OPS_KINDS];
  const rows = (ops?.rows ?? []).slice().reverse();
  return (
    <div className="card">
      <h2>Operations log — the immutable trail</h2>
      <div className="muted small" style={{ marginBottom: 8 }}>
        chain {ops ? (ops.chainIntact ? 'intact' : 'BROKEN — the log was modified') : '—'} · every tool call,
        wyrmling flight, workflow run and agent lifecycle. click a row for detail.
      </div>
      <table className="opslog">
        <thead><tr><th>#</th><th>kind</th><th>lane</th><th>class</th><th>verdict</th><th>detail</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const kind = KINDS.includes(r.tool) ? r.tool : 'tool';
            return <Fragment key={r.id}>
              <tr className={'ops rowv-' + String(r.verdict ?? '').split(':')[0]} tabIndex={0} onClick={() => setOpen(open === r.id ? null : r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(open === r.id ? null : r.id); }}>
                <td data-label="op">{r.id}</td>
                <td><span className={'k k-' + kind}>{kind === 'tool' ? r.tool : kind}</span></td>
                <td data-label="lane">{r.lane}</td>
                <td data-label="class">{r.riskClass}</td>
                <td className={'v-' + String(r.verdict).split(':')[0]} data-label="verdict">{r.verdict}</td>
                <td>{String(r.detail ?? '').slice(0, 60)}</td>
              </tr>
              {open === r.id && (
                <tr className="opsdetail">
                  <td colSpan={6}>{r.ts} · {r.tool} · lane {r.lane} · class {r.riskClass} · {r.verdict}<br />{String(r.detail ?? '(no detail)')}</td>
                </tr>
              )}
            </Fragment>;
          })}
        </tbody>
      </table>
    </div>
  );
}
