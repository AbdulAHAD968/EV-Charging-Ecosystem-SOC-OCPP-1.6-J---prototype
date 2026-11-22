import React, { useMemo, useRef, useState } from 'react';
import { useLive } from '../store';
import { Badge, Panel, SeverityPill, ScenarioBadge, fmtTime } from '../components/ui.jsx';

const IDS = Array.from({ length: 8 }, (_, i) => `CP-0${i + 1}`);
const STATUS_COLOR = {
  Available: '#5db872', Preparing: '#e8a55a', Charging: '#5db8a6',
  Finishing: '#e8a55a', Offline: '#8e8b82', Faulted: '#c64545',
};
const STATUS_TONE = { Available: 'green', Preparing: 'amber', Charging: 'teal', Finishing: 'amber', Offline: 'grey', Faulted: 'red' };

function fallback(id, i) {
  const dc = i >= 6;
  return { id, kind: dc ? 'DC' : 'AC', ratedKw: i < 2 ? 7.4 : dc ? 50 : 22, status: 'Offline', online: false, powerKw: 0, energyKwh: 0, registerKwh: 0, soc: 0, progress: 0, rogue: false, ip: `10.10.10.${11 + i}`, firmware: '2.4.1', model: dc ? 'CT-DC50' : i < 2 ? 'CT-AC7' : 'CT-AC22' };
}

function BaySvg({ c }) {
  const color = STATUS_COLOR[c.online === false ? 'Offline' : c.status] || '#8e8b82';
  const charging = c.status === 'Charging' && c.online !== false;
  const carOn = ['Preparing', 'Charging', 'Finishing'].includes(c.status) && c.online !== false;
  const offline = c.online === false || c.status === 'Offline';
  return (
    <svg viewBox="0 0 240 150" role="img" aria-label={`${c.id} ${c.status}`}>
      <rect x="0" y="128" width="240" height="22" fill="#c4bcab" />
      <line x1="0" y1="128" x2="240" y2="128" stroke="#a89f8d" strokeWidth="1" />
      {/* pedestal */}
      <rect x="14" y="24" width="48" height="104" rx="7" fill="#181715" />
      <rect x="20" y="31" width="36" height="26" rx="3" fill="#252320" stroke="#3d3d3a" />
      <rect x="24" y="36" width={offline ? 10 : charging ? 26 : 18} height="4" rx="2" fill={offline ? '#6c6a64' : '#5db8a6'} />
      <rect x="24" y="44" width="20" height="4" rx="2" fill="#6c6a64" />
      <circle cx="38" cy="72" r="7" fill={color} className={charging ? 'pulse' : ''} />
      <rect x="28" y="88" width="20" height="14" rx="3" fill="#252320" />
      <rect x="10" y="124" width="56" height="6" rx="2" fill="#3d3d3a" />
      {offline && (
        <g stroke="#faf9f5" strokeWidth="2.5" strokeLinecap="round" fill="none">
          <path d="M33 91v-4M43 91v-4M31 91h14v4a7 7 0 0 1-14 0z" />
          <path d="M26 104l24-18" stroke="#c64545" />
        </g>
      )}
      {/* cable */}
      {!offline && (
        <path d="M62 95 C 90 95, 84 118, 112 108 S 140 96, 150 96" fill="none" stroke={charging ? '#5db8a6' : '#3d3d3a'} strokeWidth="4" strokeLinecap="round" className={charging ? 'flow' : ''} opacity={carOn ? 1 : 0.5} />
      )}
      {/* car */}
      <g className="car" style={{ opacity: carOn ? 1 : 0, transform: carOn ? 'translateX(0)' : 'translateX(40px)' }}>
        <path d="M96 122 L96 100 Q96 92 106 90 L128 88 L142 70 Q146 66 152 66 L196 66 Q206 66 212 76 L222 90 Q232 94 232 104 L232 122 Z" fill={c.rogue ? '#a9583e' : '#e8e0d2'} stroke="#6c6a64" strokeWidth="1.5" />
        <path d="M146 74 L152 70 L172 70 L172 88 L134 88 Z" fill="#a8c7d0" opacity=".85" />
        <path d="M176 70 L196 70 Q202 70 206 78 L212 88 L176 88 Z" fill="#a8c7d0" opacity=".85" />
        <circle cx="120" cy="124" r="11" fill="#181715" /><circle cx="120" cy="124" r="4.5" fill="#a09d96" />
        <circle cx="208" cy="124" r="11" fill="#181715" /><circle cx="208" cy="124" r="4.5" fill="#a09d96" />
        <circle cx="152" cy="96" r="4" fill={charging ? '#5db8a6' : '#e8a55a'} className={charging ? 'pulse' : ''} />
      </g>
    </svg>
  );
}

function Bay({ c, onOpen }) {
  const offline = c.online === false || c.status === 'Offline';
  const carOn = !offline && ['Preparing', 'Charging', 'Finishing'].includes(c.status);
  const soc = Math.max(0, Math.min(100, Math.round(c.soc || 0)));
  return (
    <button type="button" className={`bay${c.rogue ? ' rogue' : ''}${offline ? ' offline' : ''}`} onClick={() => onOpen(c.id)} aria-label={`Open details for ${c.id}`}>
      {c.rogue && <span className="rogue-tag">ROGUE SESSION</span>}
      <div className="bay-top">
        <span className="bay-id">{c.id}</span>
        <span style={{ display: 'flex', gap: 4 }}>
          <Badge tone={c.kind === 'DC' ? 'coral' : 'dark'}>{c.kind}</Badge>
          <Badge tone={STATUS_TONE[offline ? 'Offline' : c.status]}>{offline ? 'Offline' : c.status}</Badge>
        </span>
      </div>
      <BaySvg c={c} />
      <div style={{ height: 8, borderRadius: 4, background: '#d9d1c1', overflow: 'hidden', opacity: carOn ? 1 : 0.35, transition: 'opacity .5s' }} aria-hidden="true">
        <div className="soc-fill" style={{ width: `${carOn ? soc : 0}%`, height: '100%', background: soc > 80 ? '#5db872' : '#5db8a6' }} />
      </div>
      <div className="bay-meta">
        <span className="muted">{carOn ? `Battery ${soc}%` : offline ? 'No link' : 'Free'}</span>
        <span className="muted">Rated {c.ratedKw} kW</span>
      </div>
      <div className="bay-meta">
        <b>{(c.powerKw || 0).toFixed(1)} <span style={{ fontSize: 13, fontFamily: 'var(--sans)' }} className="muted">kW</span></b>
        <span className="muted">Session {(c.energyKwh || 0).toFixed(2)} kWh</span>
      </div>
    </button>
  );
}

function Drawer({ c, packets, logs, onClose }) {
  const pk = packets.filter((p) => p.cp === c.id).slice(-12).reverse();
  const lg = logs.filter((l) => l.cp_id === c.id).slice(-12).reverse();
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`${c.id} details`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{c.id}</h2>
          <button type="button" className="btn sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
          <Badge tone={c.kind === 'DC' ? 'coral' : 'dark'}>{c.kind}</Badge>
          {c.rogue && <Badge tone="coral">ROGUE SESSION</Badge>}
        </div>
        <dl className="facts">
          <dt>Model</dt><dd>{c.model}</dd>
          <dt>Firmware</dt><dd>{c.firmware}</dd>
          <dt>IP</dt><dd>{c.ip}</dd>
          <dt>Rated</dt><dd>{c.ratedKw} kW</dd>
          <dt>Live power</dt><dd>{(c.powerKw || 0).toFixed(2)} kW</dd>
          <dt>Session</dt><dd>{(c.energyKwh || 0).toFixed(2)} kWh</dd>
          <dt>Register</dt><dd>{(c.registerKwh || 0).toFixed(1)} kWh</dd>
          <dt>Transaction</dt><dd>{c.txId ?? 'none'}</dd>
          <dt>ID tag</dt><dd>{c.idTag ?? 'none'}</dd>
          <dt>Battery</dt><dd>{Math.round(c.soc || 0)}%</dd>
        </dl>
        <h3 style={{ margin: '16px 0 8px' }}>Recent packets</h3>
        <div className="logbox">
          {pk.length === 0 ? <div>No packets yet.</div> : pk.map((p) => (
            <div key={p.no}>{`#${p.no} ${p.proto} ${p.src} > ${p.dst} ${p.info}${p.attack ? ' [ATTACK]' : ''}`}</div>
          ))}
        </div>
        <h3 style={{ margin: '16px 0 8px' }}>Recent logs</h3>
        <div className="logbox">
          {lg.length === 0 ? <div>No logs yet.</div> : lg.map((l, i) => (
            <div key={i}>{`${fmtTime(l.timestamp)} ${l.event} ${l.status || l.result || ''}`}</div>
          ))}
        </div>
      </aside>
    </>
  );
}

export default function Site() {
  const { chargers, alerts, packets, logs, connected } = useLive();
  const [open, setOpen] = useState(null);
  const base = useRef({});
  const list = IDS.map((id, i) => chargers[id] || fallback(id, i));
  list.forEach((c) => { if (base.current[c.id] == null && chargers[c.id]) base.current[c.id] = c.registerKwh || 0; });
  const online = list.filter((c) => c.online !== false && c.status !== 'Offline').length;
  const liveKw = list.reduce((s, c) => s + (c.powerKw || 0), 0);
  const today = useMemo(() => list.reduce((s, c) => s + Math.max(0, (c.registerKwh || 0) - (base.current[c.id] || 0)) + 0, 0) + list.reduce((s, c) => s + (c.energyKwh || 0), 0), [chargers]); // eslint-disable-line
  const openC = open ? list.find((c) => c.id === open) : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Charging site</h1>
          <p>Eight bays on one OCPP back office. Click a bay for details.</p>
        </div>
        {!connected && <Badge tone="red">Feed disconnected</Badge>}
      </div>
      <div className="site-grid">
        <div className="station">
          <div className="canopy">
            <span className="brand"><span className="ast">&#x2733;</span> Northgate Charging Hub</span>
            <span className="tag">8 bays, 2 x 7.4 kW AC, 4 x 22 kW AC, 2 x 50 kW DC</span>
          </div>
          <div className="bays" style={{ paddingTop: 22 }}>
            {list.map((c) => <Bay key={c.id} c={c} onOpen={setOpen} />)}
          </div>
          <div className="road" aria-hidden="true" />
        </div>
        <div className="side">
          <Panel title="Site summary">
            <div className="sumgrid">
              <div><div className="lbl">Chargers online</div><div className="v">{online}/8</div></div>
              <div><div className="lbl">Live power</div><div className="v">{liveKw.toFixed(1)} <small className="muted" style={{ fontSize: 13 }}>kW</small></div></div>
              <div><div className="lbl">Today energy</div><div className="v">{today.toFixed(1)} <small className="muted" style={{ fontSize: 13 }}>kWh</small></div></div>
              <div><div className="lbl">Active alerts</div><div className="v" style={{ color: alerts.length ? 'var(--coral)' : undefined }}>{alerts.length}</div></div>
            </div>
          </Panel>
          <Panel title="Live alert feed">
            {alerts.length === 0 ? <p className="muted" style={{ margin: '12px 0 0' }}>No alerts. All quiet.</p> : (
              <ul className="feed" style={{ marginTop: 8 }}>
                {alerts.slice(0, 12).map((a) => (
                  <li key={a.id}>
                    <SeverityPill level={a.severity} />
                    <div style={{ minWidth: 0 }}>
                      <div>{a.ruleId} {a.rule} <ScenarioBadge id={a.scenario} /></div>
                      <div className="muted">{fmtTime(a.ts)} {a.entity}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      {openC && <Drawer c={openC} packets={packets} logs={logs} onClose={() => setOpen(null)} />}
    </div>
  );
}
