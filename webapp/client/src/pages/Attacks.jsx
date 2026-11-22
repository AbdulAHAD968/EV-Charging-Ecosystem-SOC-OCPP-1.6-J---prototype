import { useEffect, useRef } from 'react';
import { useLive, startAttack, stopAttack, reset } from '../store';
import { ATTACKS, EXPECTED, RULE_HELP } from '../data/attacks';
import './Attacks.css';

const fmtT = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false });

function StateBadge({ state }) {
  const s = state || 'idle';
  return <span className={`atk-badge atk-badge-${s}`}>{s}</span>;
}

function AttackCard({ def, attack, steps, alerts }) {
  const { id } = def;
  const running = attack && attack.state === 'running';
  const progress = Math.round(((attack && attack.progress) || 0) * 100);
  const termRef = useRef(null);
  useEffect(() => {
    const el = termRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps.length]);
  const mine = alerts.filter((a) => a.scenario === id);
  const fired = new Set(mine.map((a) => String(a.ruleId)));
  const expected = EXPECTED[id];
  return (
    <section className="atk-card" aria-label={def.title}>
      <header className="atk-head">
        <h2 className="atk-title">{def.title}</h2>
        <StateBadge state={attack && attack.state} />
      </header>
      <p className="atk-blurb">{def.blurb}</p>
      <div className="atk-controls">
        {running ? (
          <button className="atk-btn atk-btn-stop" onClick={() => stopAttack(id)}>Stop attack</button>
        ) : (
          <button className="atk-btn atk-btn-start" onClick={() => startAttack(id)}>Start attack</button>
        )}
        <div className="atk-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={`${id} progress`}>
          <div className="atk-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="atk-pct">{progress}%</span>
      </div>
      {attack && attack.step ? <div className="atk-step">Now: {attack.step}</div> : null}
      <div className="atk-cols">
        <div className="atk-col">
          <h3 className="atk-sub">Attacker view</h3>
          <div className="atk-term" ref={termRef} tabIndex={0} role="log" aria-label={`${id} attacker narration`}>
            {steps.length === 0 ? <div className="atk-term-empty">$ waiting for attack to start</div> : null}
            {steps.map((s, i) => (
              <div key={i} className="atk-term-line"><span className="atk-term-ts">{fmtT(s.ts)}</span> <span className="atk-term-prompt">$</span> {s.text}</div>
            ))}
          </div>
        </div>
        <div className="atk-col">
          <h3 className="atk-sub">SOC view</h3>
          <div className="atk-chips" aria-label="Expected rules">
            {expected.map((r) => (
              <span key={r} className={`atk-chip ${fired.has(r) ? 'atk-chip-hit' : ''}`} title={RULE_HELP[r]}>
                {r}{fired.has(r) ? ' fired' : ''}
              </span>
            ))}
          </div>
          <div className="atk-alerts" tabIndex={0} aria-label={`${id} alerts`}>
            {mine.length === 0 ? <div className="atk-empty">No alerts yet.</div> : null}
            {mine.slice(0, 40).map((a) => (
              <div key={a.id} className="atk-alert">
                <span className="atk-sev">{a.severity}</span>
                <div>
                  <div className="atk-alert-top"><b>{a.ruleId}</b> {a.rule}</div>
                  <div className="atk-alert-sub">{fmtT(a.ts)} on {a.entity}{a.count > 1 ? ` (x${a.count})` : ''}</div>
                  {a.detail ? <div className="atk-alert-sub">{typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail)}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Attacks() {
  const { attacks, attackSteps, alerts, connected } = useLive();
  return (
    <div className="atk-page">
      <div className="atk-hero">
        <h1 className="atk-h1">Attack Console</h1>
        <button className="atk-btn atk-btn-reset" onClick={() => reset()}>Reset lab</button>
      </div>
      <div className="atk-banner" role="note">
        Localhost lab. These attacks only target the local simulated CSMS on this machine. Nothing leaves your computer.
        {!connected ? ' (Not connected to the server right now.)' : ''}
      </div>
      {ATTACKS.map((d) => (
        <AttackCard
          key={d.id}
          def={d}
          attack={attacks[d.id]}
          steps={attackSteps.filter((s) => s.id === d.id)}
          alerts={alerts}
        />
      ))}
    </div>
  );
}
