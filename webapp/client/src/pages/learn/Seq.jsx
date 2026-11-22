import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const W = 760;
const ROW = 44;
const TOP = 64;

export function SeqDiagram({ lanes, msgs, shown, speed = 1, label }) {
  const n = lanes.length;
  const x = (id) => {
    const i = Math.max(0, lanes.findIndex((l) => l.id === id));
    return n === 1 ? W / 2 : 110 + (i * (W - 220)) / (n - 1);
  };
  const H = TOP + Math.max(msgs.length, 1) * ROW + 16;
  const colour = (m) => (m.kind === 'attack' ? 'var(--coral, #cc785c)' : m.kind === 'error' ? 'var(--error, #c64545)' : m.kind === 'result' ? 'var(--teal, #5db8a6)' : 'var(--ink, #141413)');
  return (
    <div className="lrn-seq-wrap">
      <svg className="lrn-seq" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label || 'Sequence diagram'}>
        <defs>
          {['a0', 'a1', 'a2', 'a3'].map((id, i) => (
            <marker key={id} id={`lrn-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill={['var(--ink, #141413)', 'var(--teal, #5db8a6)', 'var(--coral, #cc785c)', 'var(--error, #c64545)'][i]} />
            </marker>
          ))}
        </defs>
        {lanes.map((l) => (
          <g key={l.id}>
            <rect x={x(l.id) - 80} y="8" width="160" height="30" rx="8" fill={l.id === 'att' ? 'var(--coral, #cc785c)' : 'var(--dark, #181715)'} />
            <text x={x(l.id)} y="28" textAnchor="middle" fontSize="13" fill="#faf9f5">{l.label}</text>
            <line x1={x(l.id)} y1="38" x2={x(l.id)} y2={H - 6} stroke="var(--hair, #e6dfd8)" strokeWidth="2" strokeDasharray="4 4" />
          </g>
        ))}
        {msgs.slice(0, shown).map((m, i) => {
          const y = TOP + i * ROW;
          const cur = i === shown - 1;
          const c = colour(m);
          const mk = m.kind === 'attack' ? 'a2' : m.kind === 'error' ? 'a3' : m.kind === 'result' ? 'a1' : 'a0';
          const x1 = x(m.from); const x2 = x(m.to);
          const dir = x2 >= x1 ? 1 : -1;
          if (m.note) {
            return (
              <g key={`${i}-${cur}`} opacity={cur ? 1 : 0.65}>
                <rect x={x1 - 90} y={y - 14} width="180" height="28" rx="8" fill="none" stroke={c} strokeWidth={cur ? 2.5 : 1.5} />
                <text x={x1} y={y + 5} textAnchor="middle" fontSize="13" fill="currentColor">{m.label}</text>
              </g>
            );
          }
          return (
            <g key={`${i}-${cur}`} opacity={cur ? 1 : 0.65}>
              <line x1={x1} y1={y} x2={x2 - dir * 4} y2={y} stroke={c} strokeWidth={cur ? 3 : 2} strokeDasharray={m.kind === 'attack' ? '6 4' : undefined} markerEnd={`url(#lrn-${mk})`} />
              <text x={(x1 + x2) / 2} y={y - 7} textAnchor="middle" fontSize="13" fill="currentColor">{m.label}</text>
              {cur ? (
                <circle r="6" cy={y} fill={c}>
                  <animate attributeName="cx" from={x1} to={x2} dur={`${0.9 / speed}s`} fill="freeze" />
                </circle>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Play/Pause/Step/Reset/speed controller. Returns the shown count and a control bar.
export function usePlayer(total, base = 2200) {
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => {
      setShown((s) => {
        if (s >= total) { setPlaying(false); return s; }
        return s + 1;
      });
    }, base / speed);
    return () => clearInterval(t);
  }, [playing, speed, total, base]);
  useEffect(() => { setShown(0); setPlaying(false); }, [total]);
  return {
    shown, speed, playing, setSpeed,
    play: () => { if (shown >= total) setShown(0); setPlaying(true); },
    pause: () => setPlaying(false),
    step: () => { setPlaying(false); setShown((s) => Math.min(total, s + 1)); },
    reset: () => { setPlaying(false); setShown(0); },
  };
}

export function Controls({ p, total }) {
  return (
    <div className="lrn-controls" role="group" aria-label="Playback controls">
      {p.playing ? <button className="lrn-btn" onClick={p.pause}>Pause</button> : <button className="lrn-btn lrn-btn-main" onClick={p.play}>Play</button>}
      <button className="lrn-btn" onClick={p.step} disabled={p.shown >= total}>Step</button>
      <button className="lrn-btn" onClick={p.reset}>Reset</button>
      <label className="lrn-speed">Speed
        <select value={p.speed} onChange={(e) => p.setSpeed(Number(e.target.value))} aria-label="Speed">
          <option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option><option value={4}>4x</option>
        </select>
      </label>
      <span className="lrn-prog">{p.shown} / {total}</span>
    </div>
  );
}

export function Caption({ step, open, setOpen }) {
  if (!step) return <div className="lrn-caption lrn-caption-empty">Press Play or Step to begin.</div>;
  return (
    <div className="lrn-caption" aria-live="polite">
      <div className="lrn-cap-text">{step.cap}</div>
      {step.rule ? <div className="lrn-rule">Rule that would fire: <b>{step.rule}</b></div> : null}
      {step.raw ? (
        <>
          <button className="lrn-btn lrn-btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide raw packet' : 'Show raw packet'}</button>
          {open ? <pre className="lrn-raw">{step.raw}</pre> : null}
        </>
      ) : null}
    </div>
  );
}

export function LiveLink() {
  return <p className="lrn-live">See the real thing: <Link to="/inspector">Live view in the Packet Inspector</Link></p>;
}
