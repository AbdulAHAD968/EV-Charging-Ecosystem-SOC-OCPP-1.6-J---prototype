// Standalone test: feeds synthetic log records straight into the bus and checks
// that each detection rule fires on the matching shape of data, and does not
// fire on normal-shaped records. Run with: node server/test/attacks-detect.mjs
//
// This does not start the attack generators or any server; it only exercises
// detect/engine.js against hand-built JSON records, same shapes as attacks/*.js use.

import { bus } from '../src/bus.js';
import { startDetection, getAlerts, resetDetection } from '../src/detect/engine.js';
import { CHARGERS, ATTACKER_IP } from '../src/topology.js';

const CP = CHARGERS[2].id; // CP-03
const CP_IP = CHARGERS[2].ip;

let passCount = 0;
let failCount = 0;

function check(label, cond) {
  if (cond) {
    console.log(`PASS  ${label}`);
    passCount++;
  } else {
    console.log(`FAIL  ${label}`);
    failCount++;
  }
}

function firedSince(ruleId, before) {
  const alerts = getAlerts();
  return alerts.slice(before).some((a) => a.ruleId === ruleId);
}

function log(file, record) {
  bus.emitLog(file, record);
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  startDetection();

  // ---------------------------------------------------------------- 100110
  resetDetection();
  {
    const before = getAlerts().length;
    for (let i = 0; i < 10; i++) {
      log('ocpp_gateway', { event: 'ws_auth', result: 'failure', status_code: 401, cp_id: CP, src_ip: ATTACKER_IP, user_agent: 'python-websockets/12.0', latency_ms: 10 });
    }
    check('100110 fires on 10 ws_auth failures from one src_ip', firedSince(100110, before));
  }
  {
    // normal: a couple of isolated failures should not trip it
    resetDetection();
    const before = getAlerts().length;
    log('ocpp_gateway', { event: 'ws_auth', result: 'failure', status_code: 401, cp_id: CP, src_ip: '10.10.10.13', user_agent: 'CT-Firmware/2.4.1', latency_ms: 10 });
    check('100110 does not fire on a single benign failure', !firedSince(100110, before));
  }

  // ---------------------------------------------------------------- 100111
  resetDetection();
  {
    const before = getAlerts().length;
    log('ocpp_gateway', { event: 'ws_auth', result: 'success', status_code: 101, cp_id: CP, src_ip: ATTACKER_IP, user_agent: 'python-websockets/12.0', latency_ms: 10 });
    check('100111 fires on ws_auth success from a non-registered src_ip', firedSince(100111, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('ocpp_gateway', { event: 'ws_auth', result: 'success', status_code: 101, cp_id: CP, src_ip: CP_IP, user_agent: 'CT-Firmware/2.4.1', latency_ms: 10 });
    check('100111 does not fire on ws_auth success from the registered src_ip', !firedSince(100111, before));
  }

  // ---------------------------------------------------------------- 100112 / 100113
  resetDetection();
  {
    const before = getAlerts().length;
    for (let i = 0; i < 10; i++) {
      log('transactions', { event: 'id_authorize', cp_id: CP, src_ip: ATTACKER_IP, id_tag: `ID-${i}`, status: 'Invalid' });
    }
    check('100112 fires on 10 rejected id_authorize at one cp_id', firedSince(100112, before));
    const before2 = getAlerts().length;
    log('transactions', { event: 'id_authorize', cp_id: CP, src_ip: ATTACKER_IP, id_tag: 'ID-00000001', status: 'Accepted' });
    check('100113 fires on an Accepted id_authorize right after a 100112 burst', firedSince(100113, before2));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('transactions', { event: 'id_authorize', cp_id: CP, src_ip: CP_IP, id_tag: 'ID-00000002', status: 'Accepted' });
    check('100113 does not fire on an Accepted id_authorize with no prior burst', !firedSince(100113, before));
  }

  // ---------------------------------------------------------------- 100120
  resetDetection();
  {
    const before = getAlerts().length;
    log('ocpp_gateway', { event: 'cp_boot', cp_id: CP, src_ip: ATTACKER_IP, firmware: '9.9.9-dev', serial: 'SPOOF-0003', vendor: 'ChargeTech', model: 'CT-AC22' });
    check('100120 fires on cp_boot with unexpected firmware', firedSince(100120, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('ocpp_gateway', { event: 'cp_boot', cp_id: CP, src_ip: CP_IP, firmware: '2.4.1', serial: 'CT1074', vendor: 'ChargeTech', model: 'CT-AC22' });
    check('100120 does not fire on cp_boot with normal firmware', !firedSince(100120, before));
  }

  // ---------------------------------------------------------------- 100121
  resetDetection();
  {
    const before = getAlerts().length;
    log('transactions', { event: 'meter_value', cp_id: CP, src_ip: ATTACKER_IP, transaction_id: 999, power_w: 160000, energy_wh: 1000, rated_kw: 22, energy_delta_wh: 500 });
    check('100121 fires on power_w far above rated', firedSince(100121, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('transactions', { event: 'meter_value', cp_id: CP, src_ip: CP_IP, transaction_id: 1000, power_w: 15000, energy_wh: 1000, rated_kw: 22, energy_delta_wh: 500 });
    check('100121 does not fire on normal power within rating', !firedSince(100121, before));
  }

  // ---------------------------------------------------------------- 100122
  resetDetection();
  {
    const before = getAlerts().length;
    log('transactions', { event: 'meter_value', cp_id: CP, src_ip: ATTACKER_IP, transaction_id: 999, power_w: 150000, energy_wh: 1000, rated_kw: 22, energy_delta_wh: -6000 });
    check('100122 fires on a negative energy delta (register rollback)', firedSince(100122, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('transactions', { event: 'meter_value', cp_id: CP, src_ip: CP_IP, transaction_id: 1000, power_w: 15000, energy_wh: 1000, rated_kw: 22, energy_delta_wh: 120 });
    check('100122 does not fire on a normal positive energy delta', !firedSince(100122, before));
  }

  // ---------------------------------------------------------------- 100123
  resetDetection();
  {
    const before = getAlerts().length;
    log('ocpp_gateway', { event: 'data_transfer', cp_id: CP, src_ip: ATTACKER_IP, vendor_id: 'x-diag', message_id: 'shell', status: 'UnknownVendorId' });
    check('100123 fires on data_transfer with UnknownVendorId', firedSince(100123, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('ocpp_gateway', { event: 'data_transfer', cp_id: CP, src_ip: CP_IP, vendor_id: 'ChargeTech', message_id: 'diag', status: 'Accepted' });
    check('100123 does not fire on data_transfer from a known vendor', !firedSince(100123, before));
  }

  // ---------------------------------------------------------------- 100124
  resetDetection();
  {
    const before = getAlerts().length;
    log('transactions', { event: 'transaction_start', cp_id: CP, src_ip: ATTACKER_IP, id_tag: 'ID-00000001', transaction_id: 5001, meter_start: 0 });
    check('100124 fires on transaction_start with meter_start == 0', firedSince(100124, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('transactions', { event: 'transaction_start', cp_id: CP, src_ip: CP_IP, id_tag: 'ID-00000002', transaction_id: 5002, meter_start: 4210 });
    check('100124 does not fire on a normal non-zero meter_start', !firedSince(100124, before));
  }

  // ---------------------------------------------------------------- 100125
  resetDetection();
  {
    const before = getAlerts().length;
    const tag = 'ID-00000003';
    log('transactions', { event: 'transaction_start', cp_id: 'CP-01', src_ip: CHARGERS[0].ip, id_tag: tag, transaction_id: 6001, meter_start: 1000 });
    log('transactions', { event: 'transaction_start', cp_id: 'CP-02', src_ip: CHARGERS[1].ip, id_tag: tag, transaction_id: 6002, meter_start: 2000 });
    check('100125 fires when the same id_tag starts at a second charger while still open', firedSince(100125, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('transactions', { event: 'transaction_start', cp_id: 'CP-01', src_ip: CHARGERS[0].ip, id_tag: 'ID-00000004', transaction_id: 6003, meter_start: 1000 });
    log('transactions', { event: 'transaction_stop', cp_id: 'CP-01', src_ip: CHARGERS[0].ip, transaction_id: 6003, meter_stop: 1500 });
    log('transactions', { event: 'transaction_start', cp_id: 'CP-02', src_ip: CHARGERS[1].ip, id_tag: 'ID-00000004', transaction_id: 6004, meter_start: 1500 });
    check('100125 does not fire when the first session already closed', !firedSince(100125, before));
  }

  // ---------------------------------------------------------------- 100130
  resetDetection();
  {
    const before = getAlerts().length;
    for (let i = 0; i < 40; i++) {
      log('ocpp_gateway', { event: 'ws_auth', result: 'success', status_code: 101, cp_id: `CP-0${(i % 8) + 1}`, src_ip: ATTACKER_IP, user_agent: 'python-websockets/12.0', latency_ms: 10 });
    }
    check('100130 fires on a connection flood (40 ws_auth in a 10 s window)', firedSince(100130, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    for (let i = 0; i < 5; i++) {
      log('ocpp_gateway', { event: 'ws_auth', result: 'success', status_code: 101, cp_id: CP, src_ip: CP_IP, user_agent: 'CT-Firmware/2.4.1', latency_ms: 10 });
    }
    check('100130 does not fire on a handful of normal connections', !firedSince(100130, before));
  }

  // ---------------------------------------------------------------- 100131
  resetDetection();
  {
    const before = getAlerts().length;
    for (let i = 0; i < 15; i++) {
      log('ocpp_gateway', { event: 'ws_auth', result: 'failure', status_code: 503, cp_id: CP, src_ip: ATTACKER_IP, user_agent: 'python-websockets/12.0', latency_ms: 300 });
    }
    check('100131 fires on 15 HTTP 503 in a 10 s window', firedSince(100131, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('ocpp_gateway', { event: 'ws_auth', result: 'success', status_code: 101, cp_id: CP, src_ip: CP_IP, user_agent: 'CT-Firmware/2.4.1', latency_ms: 10 });
    check('100131 does not fire on a normal successful handshake', !firedSince(100131, before));
  }

  // ---------------------------------------------------------------- 100132
  resetDetection();
  {
    const before = getAlerts().length;
    for (const cp of CHARGERS.slice(0, 3)) {
      log('ocpp_gateway', { event: 'cp_disconnected', cp_id: cp.id, src_ip: cp.ip, reason: 'ping_timeout' });
    }
    check('100132 fires on 3 ping_timeout disconnects fleet-wide', firedSince(100132, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('ocpp_gateway', { event: 'cp_disconnected', cp_id: CP, src_ip: CP_IP, reason: 'close' });
    check('100132 does not fire on a normal planned close', !firedSince(100132, before));
  }

  // ---------------------------------------------------------------- 100133
  resetDetection();
  {
    const before = getAlerts().length;
    log('system', { event: 'service_health', cpu_pct: 95, p95_latency_ms: 900, active_ws: 80, handshakes_per_s: 40, http_503_per_s: 5 });
    check('100133 fires when cpu_pct >= 90', firedSince(100133, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('system', { event: 'service_health', cpu_pct: 35, p95_latency_ms: 80, active_ws: 20, handshakes_per_s: 5, http_503_per_s: 0 });
    check('100133 does not fire on normal cpu_pct', !firedSince(100133, before));
  }

  // ---------------------------------------------------------------- 100135
  resetDetection();
  {
    const before = getAlerts().length;
    for (let i = 0; i < 12; i++) {
      log('ocpp_gateway', { event: 'cp_boot', cp_id: 'CP-03', src_ip: ATTACKER_IP, firmware: '2.4.1', serial: `FLOOD-${i}`, vendor: 'ChargeTech', model: 'CT-AC22' });
    }
    check('100135 fires on a BootNotification flood (12 in a 10 s window)', firedSince(100135, before));
  }
  {
    resetDetection();
    const before = getAlerts().length;
    log('ocpp_gateway', { event: 'cp_boot', cp_id: CP, src_ip: CP_IP, firmware: '2.4.1', serial: 'CT1074', vendor: 'ChargeTech', model: 'CT-AC22' });
    check('100135 does not fire on a single normal boot', !firedSince(100135, before));
  }

  resetDetection();

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount === 0 ? 0 : 1);
}

main();
