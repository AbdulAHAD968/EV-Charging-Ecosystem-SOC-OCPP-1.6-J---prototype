// Service health model. Everything is derived from REAL connection attempt counts:
// handshakes are counted as they arrive, and when the rate reaches SATURATION_HS_PER_S
// the CSMS is marked saturated (503 on new handshakes, no replies on open sessions).
import { bus } from './bus.js';

export const SATURATION_HS_PER_S = Number(process.env.SATURATION_HS_PER_S || 40);
const HOLD_MS = 5000; // saturation persists this long after the last over-threshold second

const hsTimes = [];   // timestamps of handshake attempts (last 1 s window)
let hs1s = 0;         // attempts in the last full tick
let rej503 = 0, rej503Tick = 0;
let saturatedUntil = 0;
let cpu = 8;
let p95 = 30;
const rejectedCards = []; // timestamps of rejected id_authorize (for the 1 min UI counter)
let providers = { activeWs: () => 0, online: () => 0 };

export function setProviders(p) { providers = { ...providers, ...p }; }

/** Call for every incoming OCPP handshake attempt (any outcome). */
export function recordHandshake() {
  const now = Date.now();
  hsTimes.push(now);
  while (hsTimes.length && hsTimes[0] < now - 1000) hsTimes.shift();
  if (hsTimes.length >= SATURATION_HS_PER_S) saturatedUntil = now + HOLD_MS;
}
/** Call when a handshake was answered with 503. */
export function recordRejected503() { rej503++; }
/** Call when an id_authorize was rejected (Invalid/Blocked/Expired). */
export function recordRejectedCard() { rejectedCards.push(Date.now()); }

export function isSaturated() { return Date.now() < saturatedUntil; }
export function getCpu() { return cpu; }

/** Sample a response latency in ms that grows with CPU load. */
export function latencySample() {
  const load = (cpu / 100) ** 4;
  return Math.round(12 + Math.random() * 20 + load * Math.random() * 900);
}

let tickTimer = null;
function tick() {
  const now = Date.now();
  while (hsTimes.length && hsTimes[0] < now - 1000) hsTimes.shift();
  hs1s = hsTimes.length;
  const r503 = rej503 - rej503Tick; rej503Tick = rej503;
  const activeWs = providers.activeWs();
  if (isSaturated()) {
    cpu = Math.min(99, 93 + Math.random() * 5);
  } else {
    const base = 5 + Math.random() * 7;                       // 5 to 12 % idle baseline
    const load = Math.min(70, hs1s * 1.4) + activeWs * 0.2;   // handshake pressure
    const target = base + load;
    cpu = cpu * 0.5 + target * 0.5;                           // smooth rise and recovery
  }
  cpu = Math.round(cpu * 10) / 10;
  p95 = Math.round(30 + Math.random() * 12 + (cpu / 100) ** 4 * 1200);
  while (rejectedCards.length && rejectedCards[0] < now - 60000) rejectedCards.shift();

  bus.emitLog('system', {
    event: 'service_health', cpu_pct: cpu, p95_latency_ms: p95,
    active_ws: activeWs, handshakes_per_s: hs1s, http_503_per_s: r503,
  });
  bus.emitUi({
    type: 'health', ts: now, cpu, p95, activeWs, hsPerS: hs1s, http503PerS: r503,
    rejectedCards1m: rejectedCards.length, online: providers.online(),
  });
}

export function startHealth() { if (!tickTimer) tickTimer = setInterval(tick, 1000); }
export function resetHealth() { hsTimes.length = 0; saturatedUntil = 0; cpu = 8; rejectedCards.length = 0; }
export function getHealth() {
  return {
    type: 'health', ts: Date.now(), cpu, p95, activeWs: providers.activeWs(), hsPerS: hs1s,
    http503PerS: 0, rejectedCards1m: rejectedCards.length, online: providers.online(),
  };
}
