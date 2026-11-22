// Attack orchestrator: start/stop/track the three scripted test-data generators.
// No networking code here either: this just manages timers and bus narration.

import { bus } from '../bus.js';
import { runA1 } from './a1.js';
import { runA2 } from './a2.js';
import { runA3 } from './a3.js';

const RUNNERS = { A1: runA1, A2: runA2, A3: runA3 };

// Per-attack live state: {state, step, progress, startedAt, cancel, endedAt}
const states = {
  A1: idleState(),
  A2: idleState(),
  A3: idleState(),
};

function idleState() {
  return { state: 'idle', step: '', progress: 0, startedAt: null, endedAt: null, cancel: null };
}

function broadcast(id) {
  const s = states[id];
  bus.emitUi({
    type: 'attack',
    id,
    state: s.state,
    step: s.step,
    progress: s.progress,
    startedAt: s.startedAt,
  });
}

/** Start one of the three scripted test-data sequences ('A1'|'A2'|'A3'). Idempotent while running. */
export function startAttack(id) {
  if (!RUNNERS[id]) throw new Error(`unknown attack id: ${id}`);
  const s = states[id];
  if (s.state === 'running') return s; // already running, do not double-start

  s.state = 'running';
  s.step = 'starting';
  s.progress = 0;
  s.startedAt = new Date().toISOString();
  s.endedAt = null;
  broadcast(id);

  const { cancel, totalDurationMs } = RUNNERS[id]({
    onStep: (text) => {
      s.step = text;
      bus.emitUi({ type: 'attack_step', id, ts: new Date().toISOString(), text });
      broadcast(id);
    },
    onProgress: (progress) => {
      s.progress = progress;
      broadcast(id);
    },
  });
  s.cancel = cancel;

  // auto-complete the attack once its scripted sequence has finished.
  const doneTimer = setTimeout(() => {
    if (s.state !== 'running') return;
    s.state = 'done';
    s.step = 'complete';
    s.progress = 1;
    s.endedAt = new Date().toISOString();
    broadcast(id);
  }, totalDurationMs + 200);
  const prevCancel = s.cancel;
  s.cancel = () => {
    clearTimeout(doneTimer);
    prevCancel();
  };

  return s;
}

/** Stop a running attack early; marks it idle. */
export function stopAttack(id) {
  if (!RUNNERS[id]) throw new Error(`unknown attack id: ${id}`);
  const s = states[id];
  if (s.cancel) s.cancel();
  s.state = 'idle';
  s.step = '';
  s.progress = 0;
  s.endedAt = new Date().toISOString();
  s.cancel = null;
  broadcast(id);
  return s;
}

/** Return a plain snapshot of all three attack states, keyed by id (no internal cancel refs). */
export function getAttackStates() {
  const out = {};
  for (const id of Object.keys(states)) {
    const { cancel, ...rest } = states[id];
    out[id] = rest;
  }
  return out;
}

/** Return the {start, end} ISO timestamp window for an attack, or null if it has not started. */
export function getAttackWindow(id) {
  const s = states[id];
  if (!s || !s.startedAt) return null;
  return { start: s.startedAt, end: s.endedAt };
}

/** Return windows for all three attacks, suitable for score.js's computeScore(). */
export function getAllWindows() {
  return { A1: getAttackWindow('A1'), A2: getAttackWindow('A2'), A3: getAttackWindow('A3') };
}

/** Stop everything and reset all attack state to idle. Used by /api/reset. */
export function resetAttacks() {
  for (const id of Object.keys(states)) {
    if (states[id].cancel) states[id].cancel();
    states[id] = idleState();
    broadcast(id);
  }
}
