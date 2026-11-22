import { useSyncExternalStore } from 'react';

const state = {
  connected: false, chargers: {}, alerts: [], attacks: { A1: { state: 'idle' }, A2: { state: 'idle' }, A3: { state: 'idle' } },
  health: null, healthHistory: [], score: null, rules: [], packets: [], logs: [], attackSteps: [],
};
let snap = { ...state };
const subs = new Set();
const emit = () => { snap = { ...state, startAttack, stopAttack, reset }; subs.forEach(f => f()); };
const cap = (arr, n) => (arr.length > n ? arr.slice(arr.length - n) : arr);

function handle(m) {
  switch (m.type) {
    case 'snapshot':
      state.chargers = Object.fromEntries((m.chargers || []).map(c => [c.id, c]));
      state.alerts = m.alerts || []; state.attacks = m.attacks || state.attacks; state.health = m.health || null;
      state.score = m.score || null; state.rules = m.rules || []; state.packets = m.packets || []; state.logs = m.logs || [];
      break;
    case 'charger': state.chargers = { ...state.chargers, [m.id]: m }; break;
    case 'packet': state.packets = cap([...state.packets, m], 500); break;
    case 'log': state.logs = cap([...state.logs, m], 500); break;
    case 'alert': state.alerts = [m, ...state.alerts].slice(0, 300); break;
    case 'health': state.health = m; state.healthHistory = cap([...state.healthHistory, m], 120); break;
    case 'attack': state.attacks = { ...state.attacks, [m.id]: m }; break;
    case 'attack_step': state.attackSteps = cap([...state.attackSteps, m], 300); break;
    case 'score': state.score = m; break;
    default: return;
  }
  emit();
}

let ws, timer;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ui`);
  ws.onopen = () => { state.connected = true; ws.send(JSON.stringify({ type: 'hello' })); emit(); };
  ws.onclose = () => { state.connected = false; emit(); clearTimeout(timer); timer = setTimeout(connect, 1500); };
  ws.onmessage = ev => { try { handle(JSON.parse(ev.data)); } catch { /* ignore malformed frame */ } };
}
const post = (u) => fetch(u, { method: 'POST' }).catch(() => {});
export const startAttack = (id) => post(`/api/attack/${id}/start`);
export const stopAttack = (id) => post(`/api/attack/${id}/stop`);
export const reset = () => { state.alerts = []; state.attackSteps = []; emit(); return post('/api/reset'); };

connect(); emit();
export function useLive() {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => snap);
}
