// Detection engine: pure arithmetic over sliding-window counters.
// Subscribes to bus 'log' events and raises alerts via bus.emitUi({type:'alert', ...}).
// No networking code here at all: only counters, timers and bus calls.

import { bus } from '../bus.js';
import { CHARGERS } from '../topology.js';
import { RULES } from './rules.js';
import { getScore as computeCurrentScore } from './score.js';

// Registered IP lookup: cp_id -> ip, and the reverse ip -> cp_id, from the charger table.
const CP_IP = Object.fromEntries(CHARGERS.map((c) => [c.id, c.ip]));
const IP_CP = Object.fromEntries(CHARGERS.map((c) => [c.ip, c.id]));

const FIRMWARE = '2.4.1';

// ---------------------------------------------------------------- state

let alerts = [];
let alertSeq = 0;

// Generic sliding-window event buckets, keyed by "ruleId:entity".
// Each bucket holds an array of millisecond timestamps.
const windows = new Map();

// Cooldown bookkeeping so a persistent condition does not spam alerts.
// Keyed by "ruleId:entity" -> last alert time (ms).
const cooldowns = new Map();

// Rule 100112/100113 bookkeeping: last rejected-burst time per cp_id.
const rejectBurstAt = new Map();

// Rule 100125 bookkeeping: open transactions per id_tag -> {cp_id, endEstimateMs}
const openTagTx = new Map();

function pushWindow(key, nowMs, windowMs) {
  let arr = windows.get(key);
  if (!arr) { arr = []; windows.set(key, arr); }
  arr.push(nowMs);
  const cutoff = nowMs - windowMs;
  while (arr.length && arr[0] < cutoff) arr.shift();
  return arr.length;
}

function onCooldown(key, nowMs, cooldownMs) {
  const last = cooldowns.get(key);
  if (last != null && nowMs - last < cooldownMs) return true;
  return false;
}

function arm(key, nowMs) {
  cooldowns.set(key, nowMs);
}

function ruleMeta(id) {
  return RULES.find((r) => r.id === id);
}

function raise(id, { ts, entity, detail, count = 1, severity = 10, scenario }) {
  const rule = ruleMeta(id);
  const alert = {
    type: 'alert',
    id: `al-${++alertSeq}`,
    ts: ts || new Date().toISOString(),
    ruleId: id,
    rule: rule ? rule.name : String(id),
    scenario: scenario || (rule ? rule.scenario.split('/')[0] : 'A1'),
    severity,
    entity,
    detail,
    count,
  };
  alerts.push(alert);
  bus.emitUi(alert);
  // score is recomputed on each alert per CONTRACT.md
  bus.emitUi({ type: 'score', ...getScore() });
  return alert;
}

// ---------------------------------------------------------------- handler

function handleLog({ file, record }) {
  const r = record;
  const nowMs = r.timestamp ? Date.parse(r.timestamp) : Date.now();

  switch (r.event) {
    case 'ws_auth': {
      // 100110: >=10 ws_auth failures / 120 s per src_ip
      if (r.result === 'failure') {
        const key = `100110:${r.src_ip}`;
        const c = pushWindow(key, nowMs, 120_000);
        if (c >= 10 && !onCooldown(key, nowMs, 120_000)) {
          arm(key, nowMs);
          raise(100110, {
            ts: r.timestamp, entity: r.src_ip, count: c, severity: 10, scenario: 'A1',
            detail: `${c} failed WebSocket handshakes in 120 s from ${r.src_ip}`,
          });
        }
      }
      // 100111: ws_auth success from src_ip not registered for cp_id
      if (r.result === 'success') {
        const registered = CP_IP[r.cp_id];
        if (registered && r.src_ip && r.src_ip !== registered) {
          const key = `100111:${r.cp_id}:${r.src_ip}`;
          if (!onCooldown(key, nowMs, 300_000)) {
            arm(key, nowMs);
            // 100111 is a shared indicator across A1, A2 and A3 (CONTRACT.md); the fixed
            // 'scenario' tag here is only a fallback label. score.js re-attributes each
            // alert to whichever attack window it actually falls inside, so this is not
            // used for scoring, only as a default display tag.
            raise(100111, {
              ts: r.timestamp, entity: r.src_ip, severity: 13, scenario: 'A1',
              detail: `${r.cp_id} authenticated from ${r.src_ip} (registered: ${registered}), UA=${r.user_agent || 'n/a'}`,
            });
          }
        }
      }
      // 100130: connection flood, >=40 ws_auth / 10 s per src_ip (scaled)
      {
        const key = `100130:${r.src_ip}`;
        const c = pushWindow(key, nowMs, 10_000);
        if (c >= 40 && !onCooldown(key, nowMs, 60_000)) {
          arm(key, nowMs);
          raise(100130, {
            ts: r.timestamp, entity: r.src_ip, count: c, severity: 12, scenario: 'A3',
            detail: `${c} WebSocket handshakes in 10 s from ${r.src_ip}`,
          });
        }
      }
      // 100131: >=15 HTTP 503 / 10 s (scaled), fleet-wide
      if (r.status_code === 503) {
        const key = '100131:csms-01';
        const c = pushWindow(key, nowMs, 10_000);
        if (c >= 15 && !onCooldown(key, nowMs, 60_000)) {
          arm(key, nowMs);
          raise(100131, {
            ts: r.timestamp, entity: 'csms-01', count: c, severity: 12, scenario: 'A3',
            detail: `${c} HTTP 503 responses in 10 s`,
          });
        }
      }
      break;
    }

    case 'id_authorize': {
      // 100112: >=10 rejected id_authorize / 120 s per cp_id
      if (r.status !== 'Accepted') {
        const key = `100112:${r.cp_id}`;
        const c = pushWindow(key, nowMs, 120_000);
        if (c >= 10 && !onCooldown(key, nowMs, 120_000)) {
          arm(key, nowMs);
          rejectBurstAt.set(r.cp_id, nowMs);
          raise(100112, {
            ts: r.timestamp, entity: r.cp_id, count: c, severity: 10, scenario: 'A1',
            detail: `${c} rejected idTags in 120 s at ${r.cp_id}`,
          });
        }
      } else {
        // 100113: Accepted within 300 s after a 100112 burst on that cp_id
        const burstAt = rejectBurstAt.get(r.cp_id);
        if (burstAt != null && nowMs - burstAt <= 300_000 && nowMs >= burstAt) {
          const key = `100113:${r.cp_id}`;
          if (!onCooldown(key, nowMs, 300_000)) {
            arm(key, nowMs);
            raise(100113, {
              ts: r.timestamp, entity: r.cp_id, severity: 13, scenario: 'A1',
              detail: `${r.id_tag || 'idTag'} accepted at ${r.cp_id} after rejected-tag burst: probable cloned card`,
            });
          }
        }
      }
      break;
    }

    case 'cp_boot': {
      // 100120: cp_boot firmware != 2.4.1
      if (r.firmware && r.firmware !== FIRMWARE) {
        const key = `100120:${r.cp_id}`;
        if (!onCooldown(key, nowMs, 60_000)) {
          arm(key, nowMs);
          raise(100120, {
            ts: r.timestamp, entity: r.src_ip || r.cp_id, severity: 12, scenario: 'A2',
            detail: `${r.cp_id} booted with firmware ${r.firmware}, serial ${r.serial || 'n/a'}`,
          });
        }
      }
      // 100135: BootNotification flood, >=12 cp_boot / 10 s per src_ip (scaled)
      {
        const key = `100135:${r.src_ip}`;
        const c = pushWindow(key, nowMs, 10_000);
        if (c >= 12 && !onCooldown(key, nowMs, 60_000)) {
          arm(key, nowMs);
          raise(100135, {
            ts: r.timestamp, entity: r.src_ip, count: c, severity: 12, scenario: 'A3',
            detail: `${c} BootNotifications in 10 s from ${r.src_ip}`,
          });
        }
      }
      break;
    }

    case 'meter_value': {
      // 100121: power_w > 1.2 * rated_kw * 1000
      if (typeof r.power_w === 'number' && typeof r.rated_kw === 'number' && r.power_w > 1.2 * r.rated_kw * 1000) {
        const key = `100121:${r.transaction_id}`;
        if (!onCooldown(key, nowMs, 60_000)) {
          arm(key, nowMs);
          raise(100121, {
            ts: r.timestamp, entity: r.src_ip || r.cp_id, severity: 12, scenario: 'A2',
            detail: `tx ${r.transaction_id} on ${r.cp_id} rated ${r.rated_kw} kW reported ${Math.round(r.power_w / 1000)} kW`,
          });
        }
      }
      // 100122: energy_delta_wh < 0
      if (typeof r.energy_delta_wh === 'number' && r.energy_delta_wh < 0) {
        raise(100122, {
          ts: r.timestamp, entity: r.src_ip || r.cp_id, severity: 12, scenario: 'A2',
          detail: `tx ${r.transaction_id} on ${r.cp_id}: energy delta ${r.energy_delta_wh} Wh`,
        });
      }
      break;
    }

    case 'data_transfer': {
      // 100123: data_transfer UnknownVendorId
      if (r.status === 'UnknownVendorId') {
        raise(100123, {
          ts: r.timestamp, entity: r.src_ip || r.cp_id, severity: 9, scenario: 'A2',
          detail: `${r.cp_id} sent vendor=${r.vendor_id} msg=${r.message_id}`,
        });
      }
      break;
    }

    case 'transaction_start': {
      // 100124: meter_start == 0
      if (r.meter_start === 0) {
        raise(100124, {
          ts: r.timestamp, entity: r.src_ip || r.cp_id, severity: 12, scenario: 'A2',
          detail: `tx ${r.transaction_id} on ${r.cp_id} started with meterStart=0`,
        });
      }
      // 100125: same id_tag active at two chargers at once
      if (r.id_tag) {
        for (const [tag, info] of openTagTx) {
          if (tag === r.id_tag && info.cp_id !== r.cp_id && info.endEstimateMs > nowMs) {
            raise(100125, {
              ts: r.timestamp, entity: r.id_tag, severity: 13, scenario: 'A2',
              detail: `idTag ${r.id_tag} active on ${info.cp_id} and ${r.cp_id} simultaneously`,
            });
          }
        }
        // default estimated end: 1 hour out, refined by transaction_stop below
        openTagTx.set(r.id_tag, { cp_id: r.cp_id, transaction_id: r.transaction_id, endEstimateMs: nowMs + 3_600_000 });
      }
      break;
    }

    case 'transaction_stop': {
      // tighten the open-tag window once we know the real end time
      for (const [tag, info] of openTagTx) {
        if (info.transaction_id === r.transaction_id) {
          info.endEstimateMs = nowMs;
        }
      }
      break;
    }

    case 'cp_disconnected': {
      // 100132: >=3 cp_disconnected ping_timeout / 180 s, fleet-wide
      if (r.reason === 'ping_timeout') {
        const key = '100132:fleet';
        const c = pushWindow(key, nowMs, 180_000);
        if (c >= 3 && !onCooldown(key, nowMs, 180_000)) {
          arm(key, nowMs);
          raise(100132, {
            ts: r.timestamp, entity: 'fleet', count: c, severity: 12, scenario: 'A3',
            detail: `${c} chargers dropped by ping timeout in 180 s`,
          });
        }
      }
      break;
    }

    case 'service_health': {
      // 100133: cpu_pct >= 90
      if (typeof r.cpu_pct === 'number' && r.cpu_pct >= 90) {
        const key = '100133:csms-01';
        if (!onCooldown(key, nowMs, 120_000)) {
          arm(key, nowMs);
          raise(100133, {
            ts: r.timestamp, entity: 'csms-01', severity: 10, scenario: 'A3',
            detail: `cpu=${r.cpu_pct}% p95=${r.p95_latency_ms} ms active_ws=${r.active_ws}`,
          });
        }
      }
      break;
    }

    default:
      break;
  }
}

let subscribed = false;

/** Wire the engine to the bus. Safe to call once; repeated calls are no-ops. */
export function startDetection() {
  if (subscribed) return;
  bus.on('log', handleLog);
  subscribed = true;
}

/** Return the alerts raised so far (array, oldest first). */
export function getAlerts() {
  return alerts;
}

/** Return the current score snapshot (see score.js for shape). */
export function getScore() {
  return computeCurrentScore(alerts);
}

/** Clear all engine state: alerts, windows, cooldowns. Used by /api/reset. */
export function resetDetection() {
  alerts = [];
  alertSeq = 0;
  windows.clear();
  cooldowns.clear();
  rejectBurstAt.clear();
  openTagTx.clear();
}

// Exported for the standalone test script only (not part of the public contract).
export const _internal = { IP_CP, CP_IP };
