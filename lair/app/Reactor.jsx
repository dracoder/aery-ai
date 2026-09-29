const SPHERE = 142 / 240;

export default function Reactor({ style = 'aeryx', size = 180, load = null, label = null }) {
  const orb = size * .5;
  const pct = load == null ? null : Math.max(0, Math.min(1, load));
  const arc = 2 * Math.PI * 70;
  return (
    <span className={`reactor reactor-${style}`} style={{ '--reactor-size': `${size}px` }} aria-hidden="true">
      <svg className="reactor-rings" viewBox="0 0 200 200">
        <circle className="rr-ticks" cx="100" cy="100" r="96" />
        <circle className="rr-arcs" cx="100" cy="100" r="88" />
        <circle className="rr-track" cx="100" cy="100" r="70" />
        {pct != null && <circle className="rr-gauge" cx="100" cy="100" r="70" style={{ strokeDasharray: `${arc * pct} ${arc}` }} />}
        <circle className="rr-inner" cx="100" cy="100" r="60" />
        <path className="rr-notches" d="M100 2v8M100 190v8M2 100h8M190 100h8" />
      </svg>
      <span className="reactor-orb" style={{ width: orb, height: orb }}>
        <img src={`/assets/characters/${style === 'aeri' ? 'aeri' : 'aeryx'}-orb.png`} alt="" style={{ width: orb / SPHERE, height: orb / SPHERE }} />
      </span>
      <span className="reactor-flare" />
      {label && <span className="reactor-label">{label}</span>}
    </span>
  );
}
