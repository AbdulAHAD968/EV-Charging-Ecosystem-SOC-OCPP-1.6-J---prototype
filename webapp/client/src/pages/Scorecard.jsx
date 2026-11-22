import { useLive } from '../store';
import { ATTACKS, EXPECTED } from '../data/attacks';
import './Scorecard.css';

const pct = (r) => (r == null ? 0 : Math.round(r <= 1 ? r * 100 : r));
const sec = (v) => (v == null ? 'n/a' : `${Number(v).toFixed(1)} s`);

function Ring({ value }) {
  const r = 34; const c = 2 * Math.PI * r;
  return (
    <svg className="sc-ring" viewBox="0 0 90 90" role="img" aria-label={`Recall ${value} percent`}>
      <circle cx="45" cy="45" r={r} fill="none" stroke="var(--hair, #e6dfd8)" strokeWidth="9" />
      <circle cx="45" cy="45" r={r} fill="none" stroke="var(--coral, #cc785c)" strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 45 45)" />
      <text x="45" y="51" textAnchor="middle" fontSize="19" fontFamily="Georgia, serif" fill="currentColor">{value}%</text>
    </svg>
  );
}

function Card({ def, s }) {
  const expected = (s && s.rules_expected) || EXPECTED[def.id];
  const fired = new Set(((s && s.rules_fired) || []).map(String));
  const recall = pct(s && s.recall);
  return (
    <section className="sc-card" aria-label={def.title}>
      <header className="sc-head">
        <h2 className="sc-h2">{def.title}</h2>
        <span className={`sc-state sc-state-${(s && s.state) || 'idle'}`}>{(s && s.state) || 'idle'}</span>
      </header>
      <div className="sc-body">
        <Ring value={recall} />
        <dl className="sc-dl">
          <div><dt>First alert</dt><dd>{sec(s && s.first_alert_s)}</dd></div>
          <div><dt>Time to detect</dt><dd>{sec(s && s.time_to_detect_s)}</dd></div>
          <div><dt>Alerts</dt><dd>{(s && s.alerts) || 0}</dd></div>
          <div><dt>Rules fired</dt><dd>{expected.filter((r) => fired.has(String(r))).length} of {expected.length}</dd></div>
        </dl>
      </div>
      <div className="sc-chips" aria-label="Expected rules">
        {expected.map((r) => (
          <span key={r} className={`sc-chip ${fired.has(String(r)) ? 'hit' : 'miss'}`}>{r} {fired.has(String(r)) ? 'fired' : 'not yet'}</span>
        ))}
      </div>
    </section>
  );
}

export default function Scorecard() {
  const { score, rules, alerts } = useLive();
  const counts = {};
  alerts.forEach((a) => { counts[a.ruleId] = (counts[a.ruleId] || 0) + 1; });
  const list = rules || [];
  return (
    <div className="sc-page">
      <h1 className="sc-h1">Detection Scorecard</h1>
      <p className="sc-lead">How well the rules caught each attack in this live run.</p>
      <div className="sc-grid">
        {ATTACKS.map((d) => <Card key={d.id} def={d} s={score && score[d.id]} />)}
      </div>
      <div className="sc-totals">
        <div className="sc-tot"><div className="sc-num">{(score && score.total_alerts) ?? alerts.length}</div><div>Total alerts</div></div>
        <div className="sc-tot"><div className="sc-num">{(score && score.false_positives) ?? 0}</div><div>False positives</div></div>
        <div className="sc-tot"><div className="sc-num">{(score && score.benign_events) ?? 0}</div><div>Benign events seen</div></div>
      </div>

      <h2 className="sc-h2 sc-mt">Rule coverage</h2>
      <div className="sc-table-wrap">
        <table className="sc-table">
          <thead><tr><th>Rule</th><th>Name</th><th>Scenario</th><th>Logic</th><th>Fired</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.id}</td><td>{r.name}</td><td>{r.scenario}</td><td>{r.logic}</td>
                <td><span className={`sc-count ${counts[r.id] ? 'on' : ''}`}>{counts[r.id] || 0}</span></td>
              </tr>
            ))}
            {list.length === 0 ? <tr><td colSpan={5} className="sc-empty">Rules load from the server when connected.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="sc-notes">
        <div className="sc-note">
          <h3>How to read this</h3>
          <p>Each attack has a list of rules we expect to fire. Recall is the share of those rules that actually fired. Time to detect is how many seconds passed between the attack starting and the first alert. A false positive is an alert on normal behaviour, and benign events are normal events the rules looked at and correctly ignored.</p>
        </div>
        <div className="sc-note sc-dark">
          <h3>Limitations</h3>
          <ul>
            <li>The traffic is synthetic and the lab is compressed in time, so thresholds for the flood rules are scaled down.</li>
            <li>Thresholds are fixed numbers. A low and slow attacker who stays under them, for example fewer than 10 failures in 120 seconds, would evade rules 100110 and 100112.</li>
            <li>Rules only know what the logs show. Encrypted payloads or a stolen but valid password from the right IP would look normal.</li>
            <li>This is a learning lab on localhost, not a production-grade benchmark.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
