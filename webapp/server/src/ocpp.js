// OCPP 1.6-J CSMS. Deliberate weaknesses (lab targets): weak static passwords, duplicate
// sessions per charge point id are allowed, and no plausibility checks on meter data.
import { WebSocketServer } from 'ws';
import { bus } from './bus.js';
import * as health from './health.js';
import { emitPacket, CSMS, randPort, endpoint } from './packets.js';
import { BY_ID, VENDOR, tagStatus } from './topology.js';

const wss = new WebSocketServer({ noServer: true, handleProtocols: (set) => (set.has('ocpp1.6') ? 'ocpp1.6' : false) });
const sessions = new Map();      // cpId -> Set<session>
const lastRegister = new Map();  // cpId -> last Energy register (Wh) seen in MeterValues/Stop
let txCounter = 1000;
let rogueListener = () => {};

export const onRogueChange = (fn) => { rogueListener = fn; };
export const activeSessionCount = () => [...sessions.values()].reduce((n, s) => n + s.size, 0);
/** True while a session for this id exists whose src is not the registered address. */
export function hasRogue(cpId) {
  const reg = BY_ID[cpId]?.ip;
  return [...(sessions.get(cpId) || [])].some((s) => s.srcIp !== reg);
}
export function resetOcpp() {
  for (const set of sessions.values()) for (const s of set) s.ws.terminate();
  lastRegister.clear();
}

/** Handle an HTTP upgrade for /ocpp/<id>. */
export function handleOcppUpgrade(req, socket, head, cpId) {
  const t0 = Date.now();
  const reg = BY_ID[cpId];
  const simSrc = req.headers['x-sim-src'];
  const srcIp = (Array.isArray(simSrc) ? simSrc[0] : simSrc) || reg?.ip || '127.0.0.1';
  const ua = req.headers['user-agent'] || 'unknown';
  const auth = req.headers.authorization || '';
  const from = endpoint(srcIp, randPort());
  health.recordHandshake();

  let decoded = null;
  if (auth.startsWith('Basic ')) { try { decoded = Buffer.from(auth.slice(6), 'base64').toString(); } catch { /* ignore */ } }
  const lat = () => health.latencySample() + (Date.now() - t0);

  emitPacket({ from, to: CSMS, kind: 'syn', info: '[SYN] Seq=0 Win=64240', cp: cpId, detail: { flags: 'SYN' } });
  emitPacket({ from: CSMS, to: from, kind: 'synack', info: '[SYN, ACK] Seq=0 Ack=1', cp: cpId, detail: { flags: 'SYN,ACK' } });
  emitPacket({
    from, to: CSMS, proto: 'HTTP', kind: 'http_req', cp: cpId, length: 260,
    info: `GET /ocpp/${cpId} HTTP/1.1 (Upgrade: websocket)`,
    detail: { authorization: auth || null, decoded, userAgent: ua, protocol: req.headers['sec-websocket-protocol'] || null },
  });

  const logAuth = (result, code, ms) => bus.emitLog('ocpp_gateway', {
    event: 'ws_auth', result, status_code: code, cp_id: cpId, src_ip: srcIp, user_agent: ua, latency_ms: ms,
  });
  const refuse = (code, text, kind, extra = '') => {
    const ms = lat();
    socket.write(`HTTP/1.1 ${code} ${text}\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n`);
    socket.destroy();
    logAuth('failure', code, ms);
    emitPacket({ from: CSMS, to: from, proto: 'HTTP', kind, cp: cpId, length: 120, info: `HTTP/1.1 ${code} ${text}`, detail: { status: code } });
    emitPacket({ from: CSMS, to: from, kind: 'close', cp: cpId, info: '[FIN, ACK]', detail: {} });
  };

  if (health.isSaturated()) { health.recordRejected503(); return refuse(503, 'Service Unavailable', 'http_503', 'Retry-After: 5\r\n'); }
  const ok = reg && decoded === `${cpId}:${reg.password}`;
  if (!ok) return refuse(401, 'Unauthorized', 'http_401', 'WWW-Authenticate: Basic realm="ocpp"\r\n');

  wss.handleUpgrade(req, socket, head, (ws) => {
    const ms = lat();
    const sess = { ws, cpId, srcIp, ua, from, satSince: 0, reason: 'close' };
    if (!sessions.has(cpId)) sessions.set(cpId, new Set());
    sessions.get(cpId).add(sess);   // duplicates allowed on purpose
    logAuth('success', 101, ms);
    emitPacket({ from: CSMS, to: from, proto: 'HTTP', kind: 'http_101', cp: cpId, length: 180, info: 'HTTP/1.1 101 Switching Protocols', detail: { protocol: ws.protocol || null } });
    rogueListener(cpId);
    ws.on('message', (data) => onMessage(sess, data.toString()));
    ws.on('error', () => {});
    ws.on('close', () => {
      sessions.get(cpId)?.delete(sess);
      bus.emitLog('ocpp_gateway', { event: 'cp_disconnected', cp_id: cpId, src_ip: srcIp, reason: sess.reason });
      emitPacket({ from: sess.from, to: CSMS, kind: 'close', cp: cpId, info: `[FIN, ACK] (${sess.reason})`, detail: { reason: sess.reason } });
      rogueListener(cpId);
    });
  });
}

function send(sess, arr) {
  if (sess.ws.readyState !== 1) return;
  const text = JSON.stringify(arr);
  sess.ws.send(text);
  emitPacket({ from: CSMS, to: sess.from, proto: 'WebSocket', kind: 'ws_result', cp: sess.cpId, length: 80 + text.length, info: `CallResult ${arr[1]}`, detail: { json: arr } });
}

function onMessage(sess, text) {
  const t0 = Date.now();
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (!Array.isArray(msg)) return;
  const [type, id, action, payload] = msg;
  if (type !== 2) return; // only Calls are handled
  emitPacket({ from: sess.from, to: CSMS, proto: 'WebSocket', kind: 'ws_call', cp: sess.cpId, length: 80 + text.length, info: `Call ${action} ${id}`, detail: { json: msg } });
  // Saturated: the server is too busy to answer. The session is later dropped as ping_timeout.
  if (health.isSaturated()) return;
  const { result, status, error } = handle(sess, action, payload || {});
  const latency_ms = health.latencySample() + (Date.now() - t0);
  bus.emitLog('ocpp_gateway', { event: 'ocpp_message', cp_id: sess.cpId, src_ip: sess.srcIp, action, msg_id: id, status, latency_ms });
  if (error) send(sess, [4, id, error, '', {}]); else send(sess, [3, id, result]);
}

/** Dispatch one Call. Returns {result, status} or {error, status}. */
function handle(sess, action, p) {
  const { cpId, srcIp } = sess;
  const rated = BY_ID[cpId]?.ratedKw ?? 0;
  const now = new Date().toISOString();
  switch (action) {
    case 'BootNotification':
      bus.emitLog('ocpp_gateway', {
        event: 'cp_boot', cp_id: cpId, src_ip: srcIp, firmware: p.firmwareVersion,
        serial: p.chargePointSerialNumber, vendor: p.chargePointVendor, model: p.chargePointModel,
      });
      return { result: { status: 'Accepted', currentTime: now, interval: 15 }, status: 'Accepted' };
    case 'StatusNotification':
      bus.emitLog('ocpp_gateway', { event: 'cp_status', cp_id: cpId, status: p.status });
      return { result: {}, status: 'Accepted' };
    case 'Heartbeat':
      return { result: { currentTime: now }, status: 'Accepted' };
    case 'Authorize': {
      const status = tagStatus(p.idTag);
      bus.emitLog('transactions', { event: 'id_authorize', cp_id: cpId, src_ip: srcIp, id_tag: p.idTag, status });
      if (status !== 'Accepted') health.recordRejectedCard();
      return { result: { idTagInfo: { status } }, status };
    }
    case 'StartTransaction': {
      const transaction_id = ++txCounter;
      const status = tagStatus(p.idTag);
      bus.emitLog('transactions', { event: 'transaction_start', cp_id: cpId, src_ip: srcIp, id_tag: p.idTag, transaction_id, meter_start: p.meterStart });
      return { result: { transactionId: transaction_id, idTagInfo: { status } }, status };
    }
    case 'MeterValues': {
      // No plausibility checks: whatever the charger reports is accepted and logged.
      const sv = (p.meterValue || []).flatMap((m) => m.sampledValue || []);
      const val = (name) => { const x = sv.find((s) => s.measurand === name); return x ? Number(x.value) : null; };
      const power_w = val('Power.Active.Import') ?? 0;
      const energy_wh = val('Energy.Active.Import.Register') ?? 0;
      const prev = lastRegister.get(cpId);
      const energy_delta_wh = prev === undefined ? 0 : energy_wh - prev;
      lastRegister.set(cpId, energy_wh);
      bus.emitLog('transactions', { event: 'meter_value', cp_id: cpId, src_ip: srcIp, transaction_id: p.transactionId, power_w, energy_wh, rated_kw: rated, energy_delta_wh });
      return { result: {}, status: 'Accepted' };
    }
    case 'StopTransaction':
      if (Number.isFinite(Number(p.meterStop))) lastRegister.set(cpId, Number(p.meterStop));
      bus.emitLog('transactions', { event: 'transaction_stop', cp_id: cpId, src_ip: srcIp, transaction_id: p.transactionId, meter_stop: p.meterStop });
      return { result: { idTagInfo: { status: 'Accepted' } }, status: 'Accepted' };
    case 'DataTransfer': {
      const status = p.vendorId === VENDOR ? 'Accepted' : 'UnknownVendorId';
      bus.emitLog('ocpp_gateway', { event: 'data_transfer', cp_id: cpId, src_ip: srcIp, vendor_id: p.vendorId, message_id: p.messageId, status });
      return { result: { status }, status };
    }
    default:
      return { error: 'NotImplemented', status: 'NotImplemented' };
  }
}

// While saturated, sessions that get no answers for 3 s are dropped as ping_timeout.
setInterval(() => {
  const sat = health.isSaturated();
  const now = Date.now();
  for (const set of sessions.values()) {
    for (const s of set) {
      if (!sat) { s.satSince = 0; continue; }
      if (!s.satSince) s.satSince = now;
      else if (now - s.satSince >= 3000 && s.ws.readyState === 1) { s.reason = 'ping_timeout'; s.ws.terminate(); }
    }
  }
}, 500).unref();
