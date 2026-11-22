// A2: scripted test-data generator for "rogue charger / fraudulent transaction".
// Pure synthetic JSON log records fed to the bus. No sockets, no OCPP connection made.
// Sequence: rogue cp_boot with bad firmware, a non-registered-IP session, DataTransfer
// probing, implausible power + a register rollback, meterStart=0, then a wrap-up.

import { bus } from '../bus.js';
import { ATTACKER_IP, COMPROMISED_TAG } from '../topology.js';

const TARGET_CP = 'CP-03';
const RATED_KW = 22; // CP-03 rated kW, from topology.js SPEC

export function runA2({ onStep, onProgress }) {
  const timers = [];
  let cancelled = false;
  const txId = Math.floor(Math.random() * 90000) + 10000;

  const steps = [];

  // t=0: rogue boot with spoofed/out-of-date firmware (test fixture constant).
  steps.push([0, () => {
    bus.emitLog('ocpp_gateway', {
      event: 'cp_boot',
      cp_id: TARGET_CP,
      src_ip: ATTACKER_IP,
      firmware: '9.9.9-dev',
      serial: 'SPOOF-0003',
      vendor: 'ChargeTech',
      model: 'CT-AC22',
    });
    onStep && onStep(`cp_boot: ${TARGET_CP} booted with unexpected firmware 9.9.9-dev from ${ATTACKER_IP}`);
  }]);

  // t=1s: ws_auth success from the attacker IP (not the registered IP for CP-03) -> 100111.
  steps.push([1000, () => {
    bus.emitLog('ocpp_gateway', {
      event: 'ws_auth',
      result: 'success',
      status_code: 101,
      cp_id: TARGET_CP,
      src_ip: ATTACKER_IP,
      user_agent: 'python-websockets/12.0',
      latency_ms: 12,
    });
    onStep && onStep(`ws_auth success: session opened for ${TARGET_CP} from unregistered address ${ATTACKER_IP}`);
  }]);

  // t=2s: Authorize with the stolen/compromised tag, then StartTransaction with meterStart=0.
  steps.push([2000, () => {
    bus.emitLog('transactions', {
      event: 'id_authorize',
      cp_id: TARGET_CP,
      src_ip: ATTACKER_IP,
      id_tag: COMPROMISED_TAG,
      status: 'Accepted',
    });
    onStep && onStep(`id_authorize Accepted: compromised tag ${COMPROMISED_TAG} used at ${TARGET_CP}`);
  }]);

  steps.push([3000, () => {
    bus.emitLog('transactions', {
      event: 'transaction_start',
      cp_id: TARGET_CP,
      src_ip: ATTACKER_IP,
      id_tag: COMPROMISED_TAG,
      transaction_id: txId,
      meter_start: 0,
    });
    onStep && onStep(`transaction_start: tx ${txId} on ${TARGET_CP} started with meterStart=0`);
  }]);

  // t=5s, 6s: DataTransfer probing with an unknown vendor id (test fixture, not a real shell command).
  steps.push([5000, () => {
    bus.emitLog('ocpp_gateway', {
      event: 'data_transfer',
      cp_id: TARGET_CP,
      src_ip: ATTACKER_IP,
      vendor_id: 'x-diag',
      message_id: 'shell',
      status: 'UnknownVendorId',
    });
    onStep && onStep(`data_transfer: ${TARGET_CP} sent probing DataTransfer vendor=x-diag msg=shell`);
  }]);
  steps.push([6500, () => {
    bus.emitLog('ocpp_gateway', {
      event: 'data_transfer',
      cp_id: TARGET_CP,
      src_ip: ATTACKER_IP,
      vendor_id: 'x-diag',
      message_id: 'getconfig',
      status: 'UnknownVendorId',
    });
    onStep && onStep(`data_transfer: ${TARGET_CP} sent probing DataTransfer vendor=x-diag msg=getconfig`);
  }]);

  // t=8s..~26s: 8 meter_value samples with implausible power, one with a negative delta (rollback).
  let energyWh = 0;
  const meterSamples = 8;
  for (let k = 1; k <= meterSamples; k++) {
    const atMs = 8000 + k * 2200;
    steps.push([atMs, () => {
      const powerW = 150000 + Math.round(Math.random() * 35000); // test fixture: far above rated
      let deltaWh = Math.round((powerW * 2.2) / 3600);
      if (k === 5) deltaWh = -6000; // simulated register rollback, test fixture value
      energyWh += deltaWh;
      bus.emitLog('transactions', {
        event: 'meter_value',
        cp_id: TARGET_CP,
        src_ip: ATTACKER_IP,
        transaction_id: txId,
        power_w: powerW,
        energy_wh: energyWh,
        rated_kw: RATED_KW,
        energy_delta_wh: deltaWh,
      });
      onStep && onStep(`meter_value: tx ${txId} on ${TARGET_CP} reported ${Math.round(powerW / 1000)} kW (rated ${RATED_KW} kW)${deltaWh < 0 ? ', energy register went backwards' : ''}`);
    }]);
  }

  // wrap-up: StopTransaction equivalent (not a detection target, just closes the fixture cleanly).
  const stopAt = 8000 + (meterSamples + 1) * 2200;
  steps.push([stopAt, () => {
    bus.emitLog('transactions', {
      event: 'transaction_stop',
      cp_id: TARGET_CP,
      src_ip: ATTACKER_IP,
      transaction_id: txId,
      meter_stop: energyWh,
    });
    onStep && onStep(`transaction_stop: tx ${txId} on ${TARGET_CP} closed`);
  }]);

  const total = steps.length;
  steps.forEach(([delay, fn], i) => {
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

  return { cancel, totalDurationMs: stopAt + 500 };
}
