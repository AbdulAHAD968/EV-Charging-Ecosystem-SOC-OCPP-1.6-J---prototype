// Packet tap: builds `packet` UI messages mirroring wire events.
// Exports: emitPacket, getPackets, clearPackets, injectSyn, endpoint, randPort.
import { bus } from './bus.js';
import { ATTACKER_IP, CSMS_IP, CSMS_PORT } from './topology.js';

const ring = [];
let no = 0;
let budgetSec = 0, budget = 0;
const MAX_PER_SEC = 120; // protects the browser feed during floods

export const CSMS = { ip: CSMS_IP, port: CSMS_PORT };
export const randPort = () => 32768 + Math.floor(Math.random() * 28000);
export const endpoint = (ip, port) => ({ ip, port });
const fmt = (e) => `${e.ip}:${e.port}`;

/**
 * from/to: {ip, port}. kind: syn|synack|http_req|http_401|http_101|http_503|ws_call|ws_result|close.
 * Packets sent from or to the attacker address are flagged attack:true.
 */
export function emitPacket({ from, to, proto = 'TCP', kind, info, cp = null, length = 60, detail = {} }) {
  const sec = Math.floor(Date.now() / 1000);
  if (sec !== budgetSec) { budgetSec = sec; budget = 0; }
  if (++budget > MAX_PER_SEC) return null;
  const pkt = {
    type: 'packet', no: ++no, ts: Date.now(), src: fmt(from), dst: fmt(to), proto, length,
    info, cp, kind, attack: from.ip === ATTACKER_IP || to.ip === ATTACKER_IP, detail,
  };
  ring.push(pkt);
  if (ring.length > 200) ring.shift();
  bus.emitUi(pkt);
  return pkt;
}

export const getPackets = () => ring.slice();
export function clearPackets() { ring.length = 0; }

/**
 * Used by attacks/a3: emit SYN-only packets from the attacker (half-open flood).
 * Emits a sample (max 8) with the true count in the info text, to keep the feed readable.
 */
export function injectSyn(count = 1) {
  const n = Math.min(count, 8);
  for (let i = 0; i < n; i++) {
    emitPacket({
      from: endpoint(ATTACKER_IP, randPort()), to: CSMS, kind: 'syn', length: 60,
      info: `[SYN] Seq=0 Win=64240 (flood sample ${i + 1}/${n} of ${count})`,
      detail: { flags: 'SYN', count },
    });
  }
}
