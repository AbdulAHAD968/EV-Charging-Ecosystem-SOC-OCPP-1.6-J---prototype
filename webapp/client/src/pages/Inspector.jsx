import { useEffect, useMemo, useRef, useState } from 'react';
import { useLive } from '../store';
import { parseFilter, QUICK_FILTERS } from '../data/displayFilter';
import './Inspector.css';

const WINDOW_MS = 5000;
const tsOf = (r) => (typeof r.ts === 'number' ? r.ts : Date.parse(r.timestamp));
const fmtClock = (ms) => new Date(ms).toLocaleTimeString([], { hour12: false });
const macOf = (ip) => {
  const parts = String(ip || '0.0.0.0').split(':')[0].split('.').map((n) => (Number(n) || 0).toString(16).padStart(2, '0'));
  return `02:00:${parts.join(':')}`;
};
const pretty = (o) => { try { return JSON.stringify(o, null, 2); } catch { return String(o); } };

function Tree({ title, children, open }) {
  return (
    <details className="ins-tree" open={open}>
      <summary>{title}</summary>
      <div className="ins-tree-body">{children}</div>
    </details>
  );
}

function Detail({ p }) {
  if (!p) return <div className="ins-detail-empty">Select a packet to see its decoded layers.</div>;
  const d = p.detail || {};
  const srcIp = String(p.src).split(':')[0];
  const dstIp = String(p.dst).split(':')[0];
  const isHttp = p.kind.startsWith('http');
  let b64 = null;
  if (d.authorization) {
    b64 = String(d.authorization).replace(/^Basic\s+/i, '');
  }
  return (
    <div className="ins-detail">
      <Tree title={`Frame ${p.no}: ${p.length} bytes on wire`} open>
        <div>Arrival time: {new Date(p.ts).toISOString()}</div>
        <div>Frame length: {p.length} bytes</div>
        <div>Protocols: eth:ip:tcp{p.proto !== 'TCP' ? ':http' : ''}{p.proto === 'WebSocket' ? ':websocket' : ''}</div>
        {p.attack ? <div className="ins-flag">Marked as attacker traffic in this lab.</div> : null}
      </Tree>
      <Tree title="Ethernet II">
        <div>Source: {macOf(srcIp)}</div>
        <div>Destination: {macOf(dstIp)}</div>
        <div>Type: IPv4 (0x0800)</div>
      </Tree>
      <Tree title={`Internet Protocol Version 4, Src: ${srcIp}, Dst: ${dstIp}`}>
        <div>Source Address: {srcIp}</div>
        <div>Destination Address: {dstIp}</div>
        <div>Protocol: TCP (6)</div>
      </Tree>
      <Tree title={`Transmission Control Protocol, ${p.src} to ${p.dst}`} open={p.proto === 'TCP'}>
        <div>Source: {p.src}</div>
        <div>Destination: {p.dst}</div>
        {p.kind === 'syn' ? <div>Flags: SYN (tcp.flags.syn == 1, tcp.flags.ack == 0)</div> : null}
        {p.kind === 'synack' ? <div>Flags: SYN, ACK</div> : null}
        {p.kind === 'close' ? <div>Flags: FIN, ACK</div> : null}
        {!['syn', 'synack', 'close'].includes(p.kind) ? <div>Flags: PSH, ACK</div> : null}
      </Tree>
      {isHttp ? (
        <Tree title="Hypertext Transfer Protocol" open>
          <div>{p.info}</div>
          {d.userAgent || d.user_agent ? <div>User-Agent: {d.userAgent || d.user_agent}</div> : null}
          {d.authorization ? (
            <>
              <div>Authorization: {d.authorization}</div>
              <div className="ins-decoded">Base64 decoded: <b>{d.decoded || (() => { try { return atob(b64); } catch { return '(not decodable)'; } })()}</b></div>
              <div className="ins-note">HTTP Basic is just Base64, not encryption. Anyone on the path can read the password.</div>
            </>
          ) : null}
        </Tree>
      ) : null}
      {p.proto === 'WebSocket' ? (
        <Tree title="WebSocket and OCPP-J payload" open>
          <div>{p.info}</div>
          {d.json !== undefined ? <pre className="ins-json">{pretty(d.json)}</pre> : null}
          {Array.isArray(d.json) ? (
            <div className="ins-note">
              Message type {d.json[0]} = {{ 2: 'CALL (request)', 3: 'CALLRESULT (reply)', 4: 'CALLERROR' }[d.json[0]] || 'unknown'}, unique id {d.json[1]}
              {d.json[0] === 2 ? `, action ${d.json[2]}` : ''}.
            </div>
          ) : null}
        </Tree>
      ) : null}
      {Object.keys(d).length > 0 ? (
        <Tree title="Raw decoded detail object"><pre className="ins-json">{pretty(d)}</pre></Tree>
      ) : null}
    </div>
  );
}

function PacketsTab({ packets, win, clearWin, filter, setFilter, selected, setSelected }) {
  const [paused, setPaused] = useState(false);
  const [auto, setAuto] = useState(true);
  const frozen = useRef(packets);
  if (!paused) frozen.current = packets;
  const base = frozen.current;
  const { fn, error } = useMemo(() => parseFilter(filter), [filter]);
  const rows = useMemo(() => {
    let r = base;
    if (win) r = r.filter((p) => p.ts >= win.from && p.ts <= win.to);
    return r.filter(fn);
  }, [base, fn, win]);
  const t0 = base.length ? base[0].ts : 0;
  const listRef = useRef(null);
  useEffect(() => {
    const el = listRef.current;
    if (auto && !paused && el) el.scrollTop = el.scrollHeight;
  }, [rows.length, auto, paused]);
  const sel = base.find((p) => p.no === selected) || null;
  const exportCsv = () => {
    const head = 'No,Time,Source,Destination,Protocol,Length,Info';
    const lines = rows.map((p) => [p.no, ((p.ts - t0) / 1000).toFixed(6), p.src, p.dst, p.proto, p.length, `"${String(p.info).replace(/"/g, '""')}"`].join(','));
    const url = URL.createObjectURL(new Blob([[head, ...lines].join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'packets.csv'; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="ins-bar">
        <input
          className={`ins-filter ${error ? 'ins-filter-bad' : ''}`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder='Apply a display filter, e.g. http.response.code==401'
          aria-label="Display filter"
          spellCheck={false}
        />
        <button className="ins-btn" onClick={() => setPaused((x) => !x)}>{paused ? 'Resume' : 'Pause'}</button>
        <label className="ins-check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-scroll</label>
        <button className="ins-btn" onClick={exportCsv}>Export CSV</button>
      </div>
      {error ? <div className="ins-error" role="alert">Filter error: {error}</div> : null}
      <div className="ins-chips" aria-label="Quick filters">
        {QUICK_FILTERS.map((q) => (
          <button key={q.label} className={`ins-qchip ${filter === q.f ? 'on' : ''}`} onClick={() => setFilter(q.f)} title={q.f}>{q.label}</button>
        ))}
        <button className="ins-qchip" onClick={() => setFilter('')}>Clear</button>
      </div>
      {win ? (
        <div className="ins-win">
          Showing only {fmtClock(win.from)} to {fmtClock(win.to)} (alert time plus or minus 5 s).
          <button className="ins-btn ins-btn-sm" onClick={clearWin}>Show all</button>
        </div>
      ) : null}
      <div className="ins-count">{rows.length} of {base.length} packets displayed{paused ? ' (paused)' : ''}</div>
      <div className="ins-table-wrap" ref={listRef}>
        <table className="ins-table">
          <thead>
            <tr><th>No.</th><th>Time</th><th>Source</th><th>Destination</th><th>Protocol</th><th>Length</th><th>Info</th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.no}
                className={`ins-row k-${p.kind} ${p.attack ? 'atk' : ''} ${selected === p.no ? 'sel' : ''}`}
                onClick={() => setSelected(p.no)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(p.no); } }}
                tabIndex={0}
                aria-selected={selected === p.no}
              >
                <td>{p.no}</td>
                <td>{((p.ts - t0) / 1000).toFixed(3)}</td>
                <td>{p.src}</td>
                <td>{p.dst}</td>
                <td>{p.proto}</td>
                <td>{p.length}</td>
                <td>{p.info}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <div className="ins-empty">No packets match.</div> : null}
      </div>
      <Detail p={sel} />
    </>
  );
}

function LogsTab({ logs, win, clearWin }) {
  const [q, setQ] = useState('');
  const [file, setFile] = useState('all');
  const [event, setEvent] = useState('all');
  const events = useMemo(() => ['all', ...Array.from(new Set(logs.map((l) => l.event).filter(Boolean))).sort()], [logs]);
  const rows = useMemo(() => {
    const needle = q.toLowerCase();
    return logs.filter((l) => {
      if (file !== 'all' && l.file !== file) return false;
      if (event !== 'all' && l.event !== event) return false;
      if (win) { const t = tsOf(l); if (t < win.from || t > win.to) return false; }
      return !needle || JSON.stringify(l).toLowerCase().includes(needle);
    });
  }, [logs, q, file, event, win]);
  return (
    <>
      <div className="ins-bar">
        <input className="ins-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search logs (text)" aria-label="Search logs" />
        <select className="ins-select" value={file} onChange={(e) => setFile(e.target.value)} aria-label="Log file">
          {['all', 'ocpp_gateway', 'transactions', 'system'].map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="ins-select" value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Event filter">
          {events.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      {win ? (
        <div className="ins-win">Showing logs from {fmtClock(win.from)} to {fmtClock(win.to)}. <button className="ins-btn ins-btn-sm" onClick={clearWin}>Show all</button></div>
      ) : null}
      <div className="ins-count">{rows.length} of {logs.length} records</div>
      <div className="ins-logs" tabIndex={0} aria-label="JSON log stream">
        {rows.slice(-300).map((l, i) => {
          const { type, ...rest } = l; // eslint-disable-line no-unused-vars
          return (
            <div key={i} className={`ins-logline ${/failure|Invalid|Blocked|Expired|Unknown/.test(JSON.stringify(l)) ? 'bad' : ''}`}>
              <span className="ins-logfile">{l.file}</span> {JSON.stringify(rest)}
            </div>
          );
        })}
        {rows.length === 0 ? <div className="ins-empty">No log records match.</div> : null}
      </div>
    </>
  );
}

function AlertsTab({ alerts, packets, logs, jump }) {
  return (
    <>
      <p className="ins-hint">Click an alert to see the packets that were on the wire within 5 seconds of it. This is how an analyst moves from a detection to evidence.</p>
      <div className="ins-alerts">
        {alerts.length === 0 ? <div className="ins-empty">No alerts yet. Start an attack on the Attacks page.</div> : null}
        {alerts.map((a) => {
          const from = a.ts - WINDOW_MS; const to = a.ts + WINDOW_MS;
          const np = packets.filter((p) => p.ts >= from && p.ts <= to).length;
          const nl = logs.filter((l) => { const t = tsOf(l); return t >= from && t <= to; }).length;
          return (
            <div key={a.id} className="ins-alert">
              <div>
                <div><b>{a.ruleId}</b> {a.rule} <span className="ins-sc">{a.scenario}</span></div>
                <div className="ins-alert-sub">{fmtClock(a.ts)} on {a.entity}, severity {a.severity}. {np} packets, {nl} log records nearby.</div>
              </div>
              <div className="ins-alert-btns">
                <button className="ins-btn ins-btn-sm" onClick={() => jump(a, 'packets')}>Packets</button>
                <button className="ins-btn ins-btn-sm" onClick={() => jump(a, 'logs')}>Logs</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function Inspector() {
  const { packets, logs, alerts } = useLive();
  const [tab, setTab] = useState('packets');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [win, setWin] = useState(null);
  const jump = (a, t) => { setWin({ from: a.ts - WINDOW_MS, to: a.ts + WINDOW_MS }); setTab(t); };
  const tabs = [['packets', 'Packets'], ['logs', 'CSMS logs'], ['alerts', 'Alerts']];
  return (
    <div className="ins-page">
      <h1 className="ins-h1">Packet Inspector</h1>
      <p className="ins-lead">A Wireshark-style view of the lab traffic, the matching CSMS log stream, and the alerts that link the two.</p>
      <div className="ins-tabs" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`ins-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="ins-panel">
        {tab === 'packets' ? (
          <PacketsTab packets={packets} win={win} clearWin={() => setWin(null)} filter={filter} setFilter={setFilter} selected={selected} setSelected={setSelected} />
        ) : null}
        {tab === 'logs' ? <LogsTab logs={logs} win={win} clearWin={() => setWin(null)} /> : null}
        {tab === 'alerts' ? <AlertsTab alerts={alerts} packets={packets} logs={logs} jump={jump} /> : null}
      </div>
    </div>
  );
}
