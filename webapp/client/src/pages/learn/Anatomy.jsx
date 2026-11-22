import { useState } from 'react';
import { ANATOMY } from '../../data/lessons';
import { LiveLink } from './Seq';

const NAMES = {
  CALL: ['MessageTypeId', 'UniqueId', 'Action', 'Payload'],
  CALLRESULT: ['MessageTypeId', 'UniqueId', null, 'Payload'],
  CALLERROR: ['MessageTypeId', 'UniqueId', 'ErrorCode', 'ErrorDescription and ErrorDetails'],
};

export default function Anatomy() {
  const [kind, setKind] = useState('CALL');
  const [field, setField] = useState(0);
  const def = ANATOMY[kind];
  // Map array items to the four field slots.
  const parts = kind === 'CALL'
    ? [def.arr[0], def.arr[1], def.arr[2], def.arr[3]]
    : kind === 'CALLRESULT'
      ? [def.arr[0], def.arr[1], null, def.arr[2]]
      : [def.arr[0], def.arr[1], def.arr[2], [def.arr[3], def.arr[4]]];
  const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));
  const pick = (i) => { if (parts[i] !== null) setField(i); };
  const hasPair = kind !== 'CALL';
  return (
    <div>
      <h2 className="lrn-h2">Anatomy of an OCPP message</h2>
      <p className="lrn-p">Every OCPP-J message is a short JSON array. Click a field to see what it means.</p>
      <div className="lrn-seg" role="radiogroup" aria-label="Message type">
        {Object.keys(ANATOMY).map((k) => (
          <button key={k} role="radio" aria-checked={kind === k} className={`lrn-segbtn ${kind === k ? 'on' : ''}`} onClick={() => { setKind(k); setField(0); }}>{k}</button>
        ))}
      </div>
      <div className="lrn-code" role="group" aria-label="Message fields">
        <span>[</span>
        {parts.map((v, i) => (v === null ? null : (
          <span key={i}>
            <button className={`lrn-field f${i} ${field === i ? 'on' : ''}`} onClick={() => pick(i)} onMouseEnter={() => pick(i)} onFocus={() => pick(i)} aria-pressed={field === i}>
              {show(v)}
            </button>
            {i < 3 ? <span>, </span> : null}
          </span>
        )))}
        <span>]</span>
      </div>
      <div className="lrn-explain" aria-live="polite">
        <div className="lrn-explain-title">{NAMES[kind][field] || NAMES[kind][0]}</div>
        <p>{def.explain[field] || def.explain[0]}</p>
      </div>

      <h3 className="lrn-h3">Matching a reply to its request</h3>
      <svg className="lrn-match" viewBox="0 0 640 150" role="img" aria-label="Request and reply share the same UniqueId">
        <rect x="10" y="20" width="250" height="44" rx="8" fill="var(--dark, #181715)" />
        <text x="135" y="40" textAnchor="middle" fontSize="13" fill="#faf9f5">CALL BootNotification</text>
        <text x="135" y="57" textAnchor="middle" fontSize="13" fill="var(--coral, #cc785c)">id 19223201</text>
        <rect x="380" y="86" width="250" height="44" rx="8" fill="var(--dark, #181715)" />
        <text x="505" y="106" textAnchor="middle" fontSize="13" fill="#faf9f5">{hasPair ? kind : 'CALLRESULT'}</text>
        <text x="505" y="123" textAnchor="middle" fontSize="13" fill="var(--coral, #cc785c)">id 19223201</text>
        <path d="M260 42 C 320 42, 320 108, 380 108" fill="none" stroke="var(--coral, #cc785c)" strokeWidth="3" strokeDasharray="6 4" />
        <text x="320" y="80" textAnchor="middle" fontSize="13" fill="currentColor">same id</text>
      </svg>
      <p className="lrn-p">The charger can have many requests in flight. The shared id is how the answer finds its question.</p>
      <LiveLink />
    </div>
  );
}
