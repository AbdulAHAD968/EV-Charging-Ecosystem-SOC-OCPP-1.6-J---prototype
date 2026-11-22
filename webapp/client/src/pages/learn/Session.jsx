import { useMemo, useState } from 'react';
import { SESSION_LANES, SESSION_STEPS, BREAK, BREAK_LANES } from '../../data/lessons';
import { SeqDiagram, usePlayer, Controls, Caption, LiveLink } from './Seq';

export function Session() {
  const [open, setOpen] = useState(false);
  const p = usePlayer(SESSION_STEPS.length, 2200);
  return (
    <div>
      <h2 className="lrn-h2">A full charging session</h2>
      <p className="lrn-p">Boot, Status, Heartbeat, Authorize, StartTransaction, MeterValues, StopTransaction. Each request from the charger is answered by the server with the same id.</p>
      <Controls p={p} total={SESSION_STEPS.length} />
      <SeqDiagram lanes={SESSION_LANES} msgs={SESSION_STEPS} shown={p.shown} speed={p.speed} label="Charging session sequence diagram" />
      <Caption step={SESSION_STEPS[p.shown - 1]} open={open} setOpen={setOpen} />
      <LiveLink />
    </div>
  );
}

export function BreakIt() {
  const [mode, setMode] = useState('brute');
  const [open, setOpen] = useState(false);
  const def = BREAK[mode];
  const msgs = useMemo(() => def.steps, [def]);
  const p = usePlayer(msgs.length, 2600);
  return (
    <div>
      <h2 className="lrn-h2">Break it</h2>
      <p className="lrn-p">The same server, but now an attacker joins in. Choose an attack and watch the attacker lane appear. Each hostile step names the SOC rule that would fire and why.</p>
      <div className="lrn-seg" role="radiogroup" aria-label="Attack type">
        {Object.entries(BREAK).map(([k, v]) => (
          <button key={k} role="radio" aria-checked={mode === k} className={`lrn-segbtn ${mode === k ? 'on' : ''}`} onClick={() => { setMode(k); setOpen(false); }}>{v.label}</button>
        ))}
      </div>
      <Controls p={p} total={msgs.length} />
      <SeqDiagram lanes={BREAK_LANES} msgs={msgs} shown={p.shown} speed={p.speed} label={`${def.label} sequence diagram`} />
      <Caption step={msgs[p.shown - 1]} open={open} setOpen={setOpen} />
      <LiveLink />
    </div>
  );
}
