'use client';

import createGlobe from 'cobe';
import { useEffect, useRef } from 'react';
import { CENTROIDS, project } from '../lib/centroids';

const CYAN = [.42, .86, 1];
const WHITE = [1, 1, 1];
const TONES = {
  aeryx: { base: [.24, .52, .92], glow: [.2, .55, 1], arc: [.55, .9, 1], marker: CYAN },
  aeri: { base: [.92, .26, .22], glow: [1, .25, .18], arc: [1, .62, .5], marker: [1, .52, .4] },
  violet: { base: [.56, .3, .95], glow: [.6, .28, 1], arc: [.84, .64, 1], marker: [.95, .45, 1] },
};
const tone = () => TONES[typeof document !== 'undefined' && document.documentElement.dataset.persona] ?? TONES.aeryx;
const THETA = .28;

export default function NewsGlobe({ countryCounts, countries, sel, onSelect, turn = 0 }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const labels = useRef(null);
  const state = useRef({ phi: 1.2, spin: .0028, drag: null, velocity: 0, turn: 0 });
  const data = useRef({ markers: [], arcs: [], points: [] });
  const drawRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  state.current.turn = turn;

  const points = Object.entries(countryCounts)
    .filter(([iso, n]) => n > 0 && CENTROIDS[iso])
    .map(([iso, n]) => ({ iso, n, at: CENTROIDS[iso], name: countries?.[iso]?.name ?? iso.toUpperCase() }))
    .sort((a, b) => b.n - a.n);
  const hub = points.find((p) => sel?.type === 'country' && p.iso === sel.key) ?? points[0];
  data.current = {
    points,
    markers: points.map((p) => ({ location: p.at, size: .025 + Math.min(p.n, 6) * .011, color: sel?.key === p.iso ? WHITE : CYAN, id: p.iso })),
    arcs: hub ? points.filter((p) => p !== hub).slice(0, 10).map((p) => ({ from: hub.at, to: p.at })) : [],
  };

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.current.reduced = reduced;
    let size = box.clientWidth;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const globe = createGlobe(el, {
      devicePixelRatio: dpr, width: size * dpr, height: size * dpr, phi: state.current.phi, theta: THETA,
      dark: 1, diffuse: 2.2, mapSamples: 24000, mapBrightness: 12, mapBaseBrightness: .06,
      baseColor: [.24, .52, .92], markerColor: CYAN, glowColor: [.2, .55, 1],
      markers: data.current.markers, arcs: data.current.arcs, arcColor: [.55, .9, 1], arcWidth: .6, arcHeight: .28, markerElevation: .02, opacity: .92,
    });
    let raf = 0;
    const draw = () => {
      const s = state.current;
      const phi = s.phi + s.turn * Math.PI * .5;
      if (box.clientWidth !== size) size = box.clientWidth;
      const t = tone();
      const markers = data.current.markers.map((m) => (m.color === CYAN ? { ...m, color: t.marker } : m));
      globe.update({ phi, width: size * dpr, height: size * dpr, markers, arcs: data.current.arcs, baseColor: t.base, glowColor: t.glow, markerColor: t.marker, arcColor: t.arc });
      const host = labels.current;
      if (host) {
        for (const node of host.children) {
          const p = data.current.points.find((q) => q.iso === node.dataset.iso);
          if (!p) { node.style.opacity = 0; continue; }
          const at = project(p.at, phi, THETA, .84);
          node.style.transform = `translate(${at.x * size}px, ${at.y * size}px)`;
          node.style.opacity = at.visible ? 1 : 0;
          node.classList.toggle('flip', at.x > .55);
        }
      }
    };
    drawRef.current = draw;
    const frame = () => {
      const s = state.current;
      if (!s.drag) {
        s.phi += s.spin + s.velocity;
        s.velocity *= .94;
      }
      draw();
      raf = requestAnimationFrame(frame);
    };
    let resize = null;
    if (reduced) {
      draw();
      resize = new ResizeObserver(draw);
      resize.observe(box);
    } else {
      raf = requestAnimationFrame(frame);
    }
    requestAnimationFrame(() => { el.style.opacity = 1; });
    const personaWatch = new MutationObserver(() => { if (reduced) draw(); });
    personaWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-persona'] });
    return () => { cancelAnimationFrame(raf); resize?.disconnect(); personaWatch.disconnect(); drawRef.current = null; globe.destroy(); };
  }, []);

  useEffect(() => { if (state.current.reduced) drawRef.current?.(); });

  const down = (e) => {
    state.current.drag = { x: e.clientX, phi: state.current.phi, moved: false, last: e.clientX, t: performance.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    const d = state.current.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    state.current.phi = d.phi + dx / (wrap.current?.clientWidth || 300) * Math.PI;
    const now = performance.now();
    state.current.velocity = (e.clientX - d.last) / (wrap.current?.clientWidth || 300) * Math.PI * Math.min(1, 16 / Math.max(1, now - d.t));
    d.last = e.clientX; d.t = now;
    if (state.current.reduced) drawRef.current?.();
  };
  const up = (e) => {
    const d = state.current.drag;
    state.current.drag = null;
    if (!d || d.moved) return;
    const rect = wrap.current.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height;
    const phi = state.current.phi + state.current.turn * Math.PI * .5;
    let best = null;
    for (const p of data.current.points) {
      const at = project(p.at, phi, THETA);
      const dist = Math.hypot(at.x - fx, at.y - fy);
      if (at.visible && dist < .06 && (!best || dist < best.dist)) best = { iso: p.iso, dist };
    }
    onSelectRef.current(best ? { type: 'country', key: best.iso } : null);
  };

  return (
    <div className="news-globe" ref={wrap} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { state.current.drag = null; }}>
      <canvas ref={canvas} className="news-globe-canvas" />
      <div className="news-globe-labels" ref={labels} aria-hidden="true">
        {points.slice(0, 12).map((p) => (
          <span key={p.iso} data-iso={p.iso} className={'globe-pin' + (sel?.key === p.iso ? ' sel' : '') + (p.n >= 2 ? ' big' : '')}>
            <b>{p.n}</b>{(p.n >= 2 || sel?.key === p.iso) && <em>{p.name}</em>}
          </span>
        ))}
      </div>
    </div>
  );
}
