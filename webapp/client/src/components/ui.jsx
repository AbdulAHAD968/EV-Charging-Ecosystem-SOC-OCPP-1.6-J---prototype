import React from 'react';

export function StatCard({ label, value, unit, sub, dark, alert }) {
  return (
    <div className={`stat${dark ? ' dark' : ''}${alert ? ' alert' : ''}`}>
      <div className="lbl">{label}</div>
      <div className="val">{value}{unit ? <small>{unit}</small> : null}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function Panel({ title, right, children, className = '' }) {
  return (
    <div className={`panel ${className}`}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          {title ? <h3>{title}</h3> : <span />}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Badge({ tone = '', children, title }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

export function SeverityPill({ level }) {
  const n = Number(level) || 0;
  const cls = n >= 12 ? 'hi' : n >= 7 ? 'mid' : 'lo';
  return <span className={`sev ${cls}`} title={`Severity ${n}`}>{n}</span>;
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <button key={v} type="button" className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>
        );
      })}
    </div>
  );
}

export const scenarioTone = { A1: 'amber', A2: 'teal', A3: 'red' };
export function ScenarioBadge({ id }) {
  return <Badge tone={scenarioTone[id] || ''}>{id}</Badge>;
}

export const fmtTime = (ts) => {
  if (ts == null) return '';
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour12: false });
};
