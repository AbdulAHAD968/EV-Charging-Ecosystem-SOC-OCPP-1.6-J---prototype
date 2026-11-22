// A3: scripted test-data generator for "connection / BootNotification flood (DoS)".
// Pure synthetic JSON log records fed to the bus. No sockets opened, no real flood traffic.
// Sequence: a burst of ws_auth connects (mostly success, some 503 as the "service" saturates),
// a cluster of BootNotification records from the same source, a few ping_timeout
// disconnects, and service_health samples with rising cpu_pct.

import { bus } from '../bus.js';
import { ATTACKER_IP, CHARGERS } from '../topology.js';

export function runA3({ onStep, onProgress }) {
  const timers = [];
  let cancelled = false;
  const steps = [];

  // Phase 1 (0..10s): connection flood, ~5 ws_auth records every 100ms = 50 in 10s (>=40/10s).
  const floodCount = 50;
  for (let i = 0; i < floodCount; i++) {
    const atMs = i * 150;
    steps.push([atMs, () => {
      const saturating = i > 20; // later part of the burst starts tripping 503s as the service saturates
      const statusCode = saturating ? 503 : 101;
      const cpNum = String((i % 8) + 1).padStart(2, '0');
      bus.emitLog('ocpp_gateway', {
        event: 'ws_auth',
        result: statusCode === 101 ? 'success' : 'failure',
        status_code: statusCode,
        cp_id: `CP-${cpNum}`,
        src_ip: ATTACKER_IP,
        user_agent: 'python-websockets/12.0',
        latency_ms: 10 + i * 4,
      });
      onStep && onStep(`ws_auth: connection flood record ${i + 1}/${floodCount} from ${ATTACKER_IP}${statusCode === 503 ? ' (CSMS returned 503)' : ''}`);
    }]);
  }

  // Phase 2 (2..9s): BootNotification flood from the same source, 15 records in ~7s (>=12/10s).
  const bootCount = 15;
  for (let i = 0; i < bootCount; i++) {
    const atMs = 2000 + i * 450;
    steps.push([atMs, () => {
      bus.emitLog('ocpp_gateway', {
        event: 'cp_boot',
        cp_id: 'CP-03',
        src_ip: ATTACKER_IP,
        firmware: '2.4.1',
        serial: `FLOOD-${(Math.random() * 0xffffff | 0).toString(16).toUpperCase()}`,
        vendor: 'ChargeTech',
        model: 'CT-AC22',
      });
      onStep && onStep(`cp_boot: flood BootNotification ${i + 1}/${bootCount} from ${ATTACKER_IP}`);
    }]);
  }

  // Phase 3 (10..16s): fleet heartbeat loss, 3 ping_timeout disconnects within 180s window.
  const disconnectChargers = CHARGERS.slice(0, 3).map((c) => c.id);
  disconnectChargers.forEach((cp, i) => {
    const atMs = 10000 + i * 1800;
    steps.push([atMs, () => {
      bus.emitLog('ocpp_gateway', {
        event: 'cp_disconnected',
        cp_id: cp,
        src_ip: CHARGERS.find((c) => c.id === cp).ip,
        reason: 'ping_timeout',
      });
      onStep && onStep(`cp_disconnected: ${cp} dropped by ping timeout (fleet heartbeat loss)`);
    }]);
  });

  // Phase 4 (12..24s): service_health samples with cpu climbing to saturation.
  const healthSamples = 10;
  for (let i = 0; i < healthSamples; i++) {
    const atMs = 12000 + i * 1200;
    steps.push([atMs, () => {
      const cpu = Math.min(99, 55 + i * 5);
      bus.emitLog('system', {
        event: 'service_health',
        cpu_pct: cpu,
        p95_latency_ms: 200 + i * 80,
        active_ws: 40 + i * 6,
        handshakes_per_s: 30 + i * 4,
        http_503_per_s: i > 4 ? 2 + (i - 4) : 0,
      });
      onStep && onStep(`service_health: cpu=${cpu}% p95_latency climbing, CSMS under load`);
    }]);
  }

  const total = steps.length;
  const sorted = steps.slice().sort((a, b) => a[0] - b[0]);
  sorted.forEach(([delay, fn], i) => {
    timers.push(setTimeout(() => {
      if (cancelled) return;
      fn();
      onProgress && onProgress((i + 1) / total);
    }, delay));
  });

  function cancel() {
    cancelled = true;
    for (const t of timers) clearTimeout(t);
  }

  const totalDurationMs = Math.max(...steps.map(([d]) => d)) + 1000;
  return { cancel, totalDurationMs };
}
