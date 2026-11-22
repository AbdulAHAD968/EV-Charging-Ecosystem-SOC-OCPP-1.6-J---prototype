import { useMemo, useState } from 'react';
import { HANDSHAKE_COMMON, HANDSHAKE_BRANCH } from '../../data/lessons';
import { SeqDiagram, usePlayer, Controls, Caption, LiveLink } from './Seq';

const LANES = [{ id: 'cp', label: 'Charger' }, { id: 'srv', label: 'CSMS server' }];

export default function Handshake() {
  const [branch, setBranch] = useState(101);
  const [open, setOpen] = useState(false);
  const msgs = useMemo(() => {
    const b = HANDSHAKE_BRANCH[branch];
    return [...HANDSHAKE_COMMON.map((m) => ({ ...m, kind: m.from === 'cp' ? 'call' : 'result' })), { from: 'srv', to: 'cp', label: b.label, kind: b.tone, cap: b.cap, raw: b.raw }];
  }, [branch]);
  const p = usePlayer(msgs.length, 2400);
  return (
    <div>
      <h2 className="lrn-h2">Connect: TCP, then HTTP Upgrade to WebSocket</h2>
      <p className="lrn-p">Before a charger can say anything in OCPP it needs an open line to the server and a valid login. Pick what the server answers, then play the steps.</p>
      <div className="lrn-seg" role="radiogroup" aria-label="Server answer">
        {[101, 401, 503].map((c) => (
          <button key={c} role="radio" aria-checked={branch === c} className={`lrn-segbtn ${branch === c ? 'on' : ''}`} onClick={() => { setBranch(c); p.reset(); }}>
            {c} {c === 101 ? 'success' : c === 401 ? 'bad password' : 'server busy'}
          </button>
        ))}
      </div>
      <Controls p={p} total={msgs.length} />
      <SeqDiagram lanes={LANES} msgs={msgs} shown={p.shown} speed={p.speed} label="TCP and WebSocket handshake" />
      <Caption step={msgs[p.shown - 1]} open={open} setOpen={setOpen} />
      <LiveLink />
    </div>
  );
}
