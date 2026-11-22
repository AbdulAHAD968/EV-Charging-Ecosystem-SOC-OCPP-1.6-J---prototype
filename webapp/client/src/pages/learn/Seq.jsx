import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

const W = 760;
// Rows are kept compact on purpose: the whole point of the longer lessons (the full
// charging session runs to 14 steps) is seeing the entire exchange end to end without
// scrolling. A taller row reads nicer in isolation but forces a scrollbar on exactly the
// lesson where "see it all at once" matters most, which defeats the lesson.
// Note: the SVG's viewBox units are not 1:1 with rendered pixels; the container (.lrn-page
// is up to ~1040px wide) stretches a 760-wide viewBox by roughly 1.3x, so these values are
// chosen so that even after that upscale, 14 rows comfortably fit a normal browser window.
const ROW = 30;
const TOP = 48;

// A message travels along its path in two phases: the line draws itself from sender to
// receiver (like a cable lighting up), then a small packet glyph races along the finished
// line and the receiving lane flashes on arrival. This reads as something actually moving
// across a network, not just an arrow that appears.
function ArrowMsg({ m, x1, x2, y, color, current, dimmed, reduced, onArrive }) {
  const dir = x2 >= x1 ? 1 : -1;
  const tipX = x2 - dir * 10;
  const dashed = m.kind === 'attack';
  const lineDuration = reduced ? 0 : current ? 0.5 : 0;
  const [arrived, setArrived] = useState(!current || reduced);

  useEffect(() => {
    if (!current || reduced) { setArrived(true); return undefined; }
    setArrived(false);
    const t = setTimeout(() => { setArrived(true); onArrive && onArrive(); }, lineDuration * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, reduced]);

  return (
    <g opacity={dimmed ? 0.4 : 1}>
      <motion.line
        x1={x1} y1={y} x2={tipX} y2={y} stroke={color} strokeWidth={current ? 3 : 2}
        strokeDasharray={dashed ? '7 5' : undefined} strokeLinecap="round"
        initial={current && !reduced ? { pathLength: 0 } : { pathLength: 1 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: lineDuration, ease: 'easeOut' }}
      />
      {/* arrowhead, drawn once the line has reached the tip so it doesn't appear early */}
      <motion.path
        d={`M${tipX - dir * 9} ${y - 5} L${tipX + dir * 1} ${y} L${tipX - dir * 9} ${y + 5} Z`}
        fill={color}
        initial={current && !reduced ? { opacity: 0 } : { opacity: 1 }}
        animate={{ opacity: arrived ? 1 : current ? 0 : 1 }}
        transition={{ duration: 0.12 }}
      />
      <text x={(x1 + x2) / 2} y={y - 11} textAnchor="middle" fontSize="13" fill="currentColor">{m.label}</text>
      {current && !reduced ? (
        <motion.circle
          r="6.5" cy={y} fill={color}
          initial={{ cx: x1, opacity: 1 }}
          animate={{ cx: tipX }}
          transition={{ duration: lineDuration, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 5px ${color})` }}
        />
      ) : null}
    </g>
  );
}

// A soft expanding ring on the receiving lane at the moment a packet lands, so "arrival"
// reads as an event rather than the line simply having drawn itself.
function ArrivalPulse({ cx, cy, color }) {
  return (
    <motion.circle
      cx={cx} cy={cy} r={10} fill="none" stroke={color} strokeWidth={2}
      initial={{ r: 4, opacity: 0.9 }}
      animate={{ r: 26, opacity: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    />
  );
}

export function SeqDiagram({ lanes, msgs, shown, speed = 1, label }) {
  const reduced = useReducedMotion();
  const n = lanes.length;
  const x = (id) => {
    const i = Math.max(0, lanes.findIndex((l) => l.id === id));
    return n === 1 ? W / 2 : 110 + (i * (W - 220)) / (n - 1);
  };
  const H = TOP + Math.max(msgs.length, 1) * ROW + 16;
  const colour = (m) => (m.kind === 'attack' ? 'var(--coral, #cc785c)' : m.kind === 'error' ? 'var(--error, #c64545)' : m.kind === 'result' ? 'var(--teal, #5db8a6)' : 'var(--ink, #141413)');
  const current = msgs[shown - 1];
  const [pulseKey, setPulseKey] = useState(0);
  const [activeLane, setActiveLane] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!current) { setActiveLane(null); return; }
    setActiveLane(current.from);
    const t = setTimeout(() => setActiveLane(current.to), reduced ? 0 : 480 / speed);
    return () => clearTimeout(t);
  }, [shown, current, reduced, speed]);

  // The whole diagram renders at once now (see the ROW/TOP comment above), so there is no
  // inner vertical scroll container to keep in view here; the page itself scrolls if the
  // viewport is short, which is ordinary browser behaviour and needs no JS.

  return (
    <div className="lrn-seq-wrap" ref={wrapRef}>
      <svg className="lrn-seq" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label || 'Sequence diagram'}>
        {lanes.map((l) => {
          const isActive = activeLane === l.id;
          return (
            <g key={l.id}>
              <motion.rect
                x={x(l.id) - 80} y="8" width="160" height="32" rx="9"
                fill={l.id === 'att' ? 'var(--coral, #cc785c)' : 'var(--dark, #181715)'}
                animate={{ scale: isActive && !reduced ? 1.05 : 1, filter: isActive ? 'brightness(1.15)' : 'brightness(1)' }}
                transition={{ duration: 0.25 }}
                style={{ transformOrigin: `${x(l.id)}px 24px` }}
              />
              <text x={x(l.id)} y="29" textAnchor="middle" fontSize="13" fill="#faf9f5">{l.label}</text>
              <line x1={x(l.id)} y1="40" x2={x(l.id)} y2={H - 6} stroke="var(--hair, #e6dfd8)" strokeWidth="2" strokeDasharray="4 4" />
            </g>
          );
        })}
        <AnimatePresence initial={false}>
          {msgs.slice(0, shown).map((m, i) => {
            const y = TOP + i * ROW;
            const cur = i === shown - 1;
            const c = colour(m);
            const x1 = x(m.from); const x2 = x(m.to);
            if (m.note) {
              return (
                <motion.g
                  key={`${i}-note`}
                  initial={cur && !reduced ? { opacity: 0, scale: 0.9 } : { opacity: 1, scale: 1 }}
                  animate={{ opacity: cur ? 1 : 0.55, scale: 1 }}
                  transition={{ duration: 0.25 }}
                  style={{ transformOrigin: `${x1}px ${y}px` }}
                >
                  <rect x={x1 - 90} y={y - 15} width="180" height="30" rx="9" fill="none" stroke={c} strokeWidth={cur ? 2.5 : 1.5} />
                  <text x={x1} y={y + 5} textAnchor="middle" fontSize="13" fill="currentColor">{m.label}</text>
                </motion.g>
              );
            }
            return (
              <g key={`${i}-arrow`}>
                <ArrowMsg m={m} x1={x1} x2={x2} y={y} color={c} current={cur} dimmed={!cur} reduced={reduced}
                  onArrive={() => setPulseKey((k) => k + 1)} />
                {cur && !reduced ? <ArrivalPulse key={pulseKey} cx={x2} cy={y} color={c} /> : null}
              </g>
            );
          })}
        </AnimatePresence>
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
    <motion.div
      className="lrn-caption" aria-live="polite" key={step.cap}
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
    >
      <div className="lrn-cap-text">{step.cap}</div>
      {step.rule ? <div className="lrn-rule">Rule that would fire: <b>{step.rule}</b></div> : null}
      {step.raw ? (
        <>
          <button className="lrn-btn lrn-btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide raw packet' : 'Show raw packet'}</button>
          {open ? <pre className="lrn-raw">{step.raw}</pre> : null}
        </>
      ) : null}
    </motion.div>
  );
}

export function LiveLink() {
  return <p className="lrn-live">See the real thing: <Link to="/inspector">Live view in the Packet Inspector</Link></p>;
}
