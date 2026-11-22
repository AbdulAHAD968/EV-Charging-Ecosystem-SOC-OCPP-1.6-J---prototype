import React, { useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, Legend } from 'recharts';
import { useLive } from '../store';
import { StatCard, Badge, SeverityPill, ScenarioBadge, Segmented, fmtTime } from '../components/ui.jsx';

const IDS = Array.from({ length: 8 }, (_, i) => `CP-0${i + 1}`);
const WIN_COLOR = { A1: '#e8a55a', A2: '#5db8a6', A3: '#c64545' };
const tick = (ts) => fmtTime(ts);

function useWindows(attacks, last) {
  const ended = useRef({});
  const prev = useRef({});
  const now = Date.now();
  const out = [];
  ['A1', 'A2', 'A3'].forEach((id) => {
    const a = attacks[id] || {};
    if (prev.current[id] === 'running' && a.state !== 'running' && !ended.current[id]) ended.current[id] = now;
    if (a.state === 'running') delete ended.current[id];
    prev.current[id] = a.state;
    if (!a.startedAt || a.state === 'idle') return;
    const start = a.startedAt;
    const end = a.state === 'running' ? (last || now) : (ended.current[id] || start + 30000);
    out.push({ id, x1: start, x2: end });
  });
  return out;
}

function Chart({ title, data, series, windows, unit, domainMax }) {
  const lo = data.length ? data[0].ts : 0;
  const hi = data.length ? data[data.length - 1].ts : 1;
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="#e6dfd8" strokeDasharray="3 3" />
            <XAxis dataKey="ts" type="number" domain={[lo, hi]} tickFormatter={tick} tick={{ fontSize: 12, fill: '#6c6a64' }} minTickGap={50} allowDataOverflow />
            <YAxis tick={{ fontSize: 12, fill: '#6c6a64' }} width={44} domain={[0, domainMax || 'auto']} allowDecimals={false} unit={unit} />
            <Tooltip labelFormatter={tick} contentStyle={{ fontSize: 13, borderRadius: 8, border: '1px solid #e6dfd8' }} isAnimationActive={false} />
            {windows.map((w) => {
              if (w.x2 < lo || w.x1 > hi) return null;
              return <ReferenceArea key={w.id} x1={Math.max(w.x1, lo)} x2={Math.min(w.x2, hi)} fill={WIN_COLOR[w.id]} fillOpacity={0.18} ifOverflow="hidden" label={{ value: w.id, fontSize: 12, fill: '#3d3d3a', position: 'insideTopLeft' }} />;
            })}
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 13 }} />}
            {series.map((s) => (
              <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} type="monotone" />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { alerts, attacks, health, healthHistory, chargers, score } = useLive();
  const [scen, setScen] = useState('All');
  const data = healthHistory;
  const last = data.length ? data[data.length - 1].ts : 0;
  const windows = useWindows(attacks, last);
  const high = alerts.filter((a) => a.severity >= 12).length;
  const shown = useMemo(() => (scen === 'All' ? alerts : alerts.filter((a) => a.scenario === scen)).slice(0, 100), [alerts, scen]);
  const h = health || {};
  const online = h.online ?? Object.values(chargers).filter((c) => c.online).length;
  const f1 = (v) => (v == null ? '-' : Number(v).toFixed(0));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>SOC dashboard</h1>
          <p>Live telemetry and detections from the OCPP gateway.</p>
        </div>
        <div className="atk-row" aria-label="Attack status">
          {['A1', 'A2', 'A3'].map((id) => {
            const st = (attacks[id] || {}).state || 'idle';
            return <Badge key={id} tone={st === 'running' ? 'coral' : st === 'done' ? 'green' : 'grey'}>{id} {st}</Badge>;
          })}
        </div>
      </div>

      <div className="grid kpis">
        <StatCard label="Alerts total" value={alerts.length} dark alert={alerts.length > 0} sub={score ? `${score.false_positives ?? 0} false positives` : ''} />
        <StatCard label="High severity" value={high} alert={high > 0} sub="level 12 and above" />
        <StatCard label="Chargers online" value={online} unit="/ 8" />
        <StatCard label="CPU" value={f1(h.cpu)} unit="%" alert={h.cpu >= 90} />
        <StatCard label="p95 latency" value={f1(h.p95)} unit="ms" />
        <StatCard label="Active WebSockets" value={h.activeWs ?? '-'} />
        <StatCard label="Handshakes/s" value={h.hsPerS ?? '-'} />
      </div>

      <section className="block">
        <div className="grid charts">
          <Chart title="CPU and p95 latency" data={data} windows={windows} series={[{ key: 'cpu', name: 'CPU %', color: '#a9583e' }, { key: 'p95', name: 'p95 ms', color: '#3d3d3a' }]} />
          <Chart title="Handshakes/s and HTTP 503/s" data={data} windows={windows} series={[{ key: 'hsPerS', name: 'Handshakes/s', color: '#5db8a6' }, { key: 'http503PerS', name: '503/s', color: '#c64545' }]} />
          <Chart title="Active WebSockets" data={data} windows={windows} series={[{ key: 'activeWs', name: 'Active WS', color: '#3d3d3a' }]} />
          <Chart title="Rejected cards per minute" data={data} windows={windows} series={[{ key: 'rejectedCards1m', name: 'Rejected cards/min', color: '#e8a55a' }]} />
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>Shaded bands mark attack windows: A1 amber, A2 teal, A3 red.</p>
      </section>

      <section className="block">
        <div className="page-head">
          <h2>Fleet availability</h2>
        </div>
        <div className="strip">
          {IDS.map((id) => {
            const c = chargers[id];
            const off = !c || c.online === false || c.status === 'Offline';
            const cls = off ? 'o' : c.status === 'Charging' ? 'c' : c.status === 'Preparing' || c.status === 'Finishing' ? 'p' : 'a';
            return <div key={id} className={cls} title={c ? c.status : 'Offline'}>{id.replace('CP-', '')}</div>;
          })}
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>Green available, coral charging, brown preparing or finishing, grey offline.</p>
      </section>

      <section className="block">
        <div className="page-head">
          <h2>Alert feed</h2>
          <Segmented label="Scenario filter" options={['All', 'A1', 'A2', 'A3']} value={scen} onChange={setScen} />
        </div>
        <div className="tbl-wrap" style={{ maxHeight: 460 }}>
          <table className="tbl">
            <thead><tr><th>Time</th><th>Sev</th><th>Rule</th><th>Scenario</th><th>Entity</th><th>Detail</th></tr></thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan="6" className="empty">No alerts{scen !== 'All' ? ` for ${scen}` : ''} yet. Start an attack from the Attacks page.</td></tr>
              ) : shown.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{fmtTime(a.ts)}</td>
                  <td><SeverityPill level={a.severity} /></td>
                  <td><span className="mono">{a.ruleId}</span> {a.rule}</td>
                  <td><ScenarioBadge id={a.scenario} /></td>
                  <td className="mono">{a.entity}</td>
                  <td>{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
