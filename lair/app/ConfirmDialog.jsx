'use client';

import { useEffect, useRef } from 'react';
import DragonMark from './DragonMark';

export default function ConfirmDialog({ title, body, image = null, confirm = 'confirm', cancel = 'cancel', onConfirm, onCancel }) {
  const keep = useRef(null);
  useEffect(() => {
    keep.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="onboard" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="card onboard-card confirm-card">
        <div className="onboard-head">
          <span className="onboard-mark">{image ? <img className="confirm-image" src={image} alt="" /> : <DragonMark />}</span>
          <h2 id="confirm-title">{title}</h2>
        </div>
        <p id="confirm-body">{body}</p>
        <div className="onboard-actions">
          <button ref={keep} className="act" type="button" onClick={onCancel}>{cancel}</button>
          <button className="act no" type="button" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
