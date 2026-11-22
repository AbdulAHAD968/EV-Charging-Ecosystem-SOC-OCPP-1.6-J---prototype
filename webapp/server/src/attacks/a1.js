// A1: scripted test-data generator for "credential / RFID guessing".
// Pure synthetic JSON log records fed to the bus. No sockets, no real auth attempts.
// Phase 1: repeated ws_auth failures from the attacker IP (password guessing).
// Phase 2: repeated id_authorize rejections at one charger (RFID tag guessing),
//          ending in one Accepted record for the "cloned" tag.

import { bus } from '../bus.js';
import { ATTACKER_IP, ATTACKER_UA, CHARGERS, COMPROMISED_TAG } from '../topology.js';

const DICT_PASSWORDS = ['admin', 'password', '123456', 'ocpp1.6', 'letmein', 'qwerty', 'default'];
const TARGET_CP = 'CP-03';
const RFID_CP = 'CP-05';

/**
 * Run the A1 test-data sequence.
 * onStep(text) narrates each emitted record for the UI.
 * onProgress(progress) reports 0..1 completion.
 * Returns a cancel() function to stop early.
 */
export function runA1({ onStep, onProgress }) {
  const timers = [];
  let cancelled = false;

  // Phase 1: ~16 failed ws_auth attempts over ~16 s (one every ~1 s), >=10/120s trips 100110.
  const phase1Count = 16;
  for (let i = 0; i < phase1Count; i++) {
    const t = setTimeout(() => {
      if (cancelled) return;
      const cp = CHARGERS[i % CHARGERS.length].id;
      const pw = DICT_PASSWORDS[i % DICT_PASSWORDS.length];
      bus.emitLog('ocpp_gateway', {
        event: 'ws_auth',
        result: 'failure',
        status_code: 401,
        cp_id: cp,
        src_ip: ATTACKER_IP,
        user_agent: ATTACKER_UA,
        latency_ms: 15 + Math.round(Math.random() * 10),
      });
      onStep && onStep(`ws_auth failure: tried password "${pw}" against ${cp} from ${ATTACKER_IP}`);
      onProgress && onProgress((i + 1) / (phase1Count + 62));
    }, i * 1000);
    timers.push(t);
  }

  // Phase 2 starts at ~20 s: 55 rejected id_authorize at RFID_CP, then one Accepted hit.
  const phase2Start = 20_000;
  const phase2Count = 55;
  for (let i = 0; i < phase2Count; i++) {
    const t = setTimeout(() => {
      if (cancelled) return;
      const tag = `ID-${Math.floor(Math.random() * 0xffffffff).toString(16).toUpperCase().padStart(8, '0')}`;
      bus.emitLog('transactions', {
        event: 'id_authorize',
        cp_id: RFID_CP,
        src_ip: ATTACKER_IP,
        id_tag: tag,
        status: 'Invalid',
      });
      onStep && onStep(`id_authorize rejected: random tag ${tag} tried at ${RFID_CP}`);
      onProgress && onProgress((phase1Count + i + 1) / (phase1Count + 62));
    }, phase2Start + i * 350);
    timers.push(t);
  }

  // The "hit": the cloned/compromised tag gets Accepted right after the guessing burst.
  const hitAt = phase2Start + phase2Count * 350 + 1000;
  timers.push(setTimeout(() => {
    if (cancelled) return;
    bus.emitLog('transactions', {
      event: 'id_authorize',
      cp_id: RFID_CP,
      src_ip: ATTACKER_IP,
      id_tag: COMPROMISED_TAG,
      status: 'Accepted',
    });
    onStep && onStep(`id_authorize Accepted: cloned tag ${COMPROMISED_TAG} accepted at ${RFID_CP}`);
    onProgress && onProgress(1);
  }, hitAt));

  function cancel() {
    cancelled = true;
    for (const t of timers) clearTimeout(t);
  }

  const totalDurationMs = hitAt + 500;
  return { cancel, totalDurationMs };
}
