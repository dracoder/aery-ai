'use client';

import { useRef, useState } from 'react';
import { call } from './lib';

export default function SkinUpload({ onInstalled, className = 'skin-add', label = '+ add a skin pack' }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await call('/skins/install', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ ok: false, text: r.status === 401 ? 'PIN required' : d.error ?? `refused (${r.status})` });
      else {
        setMsg({ ok: true, text: `${d.skin.name} ${d.replaced ? 'updated' : 'installed'}` });
        onInstalled?.(d.skin, d.replaced);
      }
    } catch {
      setMsg({ ok: false, text: 'the daemon did not answer' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="skin-upload">
      <button type="button" className={className} disabled={busy} onClick={() => input.current?.click()}>{busy ? 'installing…' : label}</button>
      <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={(e) => upload(e.target.files?.[0])} />
      {msg && <span className={msg.ok ? 'skin-upload-ok' : 'skin-upload-err'} role="status">{msg.text}</span>}
    </div>
  );
}
