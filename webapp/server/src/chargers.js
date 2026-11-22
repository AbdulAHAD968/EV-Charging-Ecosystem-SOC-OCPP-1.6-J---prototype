// Eight real websocket charger clients with normal behaviour on compressed timers.
// Charge 40 to 90 s, MeterValues every 5 s, Heartbeat every 15 s. Auto-reconnect with backoff.
import WebSocket from 'ws';
import { bus } from './bus.js';
import * as ocpp from './ocpp.js';
import {
  CHARGERS, VALID_TAGS, BLOCKED_TAGS, EXPIRED_TAGS, COMPROMISED_TAG, REAL_UA, VENDOR,
} from './topology.js';

const PORT = process.env.PORT || 4000;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const SIM_H_PER_S = 0.01;        // 1 real second = 36 simulated seconds of charging
const CAPACITY_KWH = 60;         // display battery for soc

const tagsInUse = new Set();   // idTags with a live session on some charger

class Charger {
  constructor(spec) {
    this.spec = spec;
    this.id = spec.id;
    this.ws = null;
    this.gen = 0;                // bumps on every reconnect so stale callbacks are ignored
    this.status = 'Offline';
    this.online = false;
    this.powerKw = 0; this.energyKwh = 0;
    this.registerKwh = Math.round(rnd(120, 900) * 10) / 10;
    this.txId = null; this.idTag = null; this.soc = Math.round(rnd(20, 70)); this.progress = 0;
    this.pending = new Map();
    this.msgNo = 0;
    this.backoff = 1000;
    this.timers = new Set();
    this.session = null;
    this.stopped = false;
  }

  toJSON() {
    const s = this.spec;
    return {
      id: s.id, kind: s.kind, model: s.model, ip: s.ip, ratedKw: s.ratedKw, status: this.status,
      online: this.online, powerKw: Math.round(this.powerKw * 100) / 100,
      energyKwh: Math.round(this.energyKwh * 100) / 100,
      registerKwh: Math.round(this.registerKwh * 10) / 10, txId: this.txId, idTag: this.idTag,
      firmware: s.firmware, rogue: ocpp.hasRogue(s.id), soc: Math.round(this.soc), progress: Math.round(this.progress * 1000) / 1000,
    };
  }
  emit() { bus.emitUi({ type: 'charger', ...this.toJSON() }); }

  after(ms, fn) {
    const gen = this.gen;
    const t = setTimeout(() => { this.timers.delete(t); if (gen === this.gen && !this.stopped) fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  every(ms, fn) {
    const gen = this.gen;
    const t = setInterval(() => { if (gen === this.gen && !this.stopped) fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  clearTimers() { for (const t of this.timers) { clearTimeout(t); clearInterval(t); } this.timers.clear(); }

  // ---- connection -------------------------------------------------------
  connect() {
    if (this.stopped) return;
    const gen = ++this.gen;
    const auth = Buffer.from(`${this.id}:${this.spec.password}`).toString('base64');
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ocpp/${this.id}`, 'ocpp1.6', {
      headers: { Authorization: `Basic ${auth}`, 'User-Agent': REAL_UA }, handshakeTimeout: 5000,
    });
    this.ws = ws;
    ws.on('open', () => { if (gen === this.gen) this.onOpen(); });
    ws.on('message', (d) => this.onMessage(d.toString()));
    ws.on('unexpected-response', (_req, res) => { res.resume(); this.onDown(gen); });
    ws.on('error', () => this.onDown(gen));
    ws.on('close', () => this.onDown(gen));
  }

  /** Connection lost or refused: go Offline and retry with exponential backoff and jitter. */
  onDown(gen) {
    if (gen !== this.gen) return;
    this.gen++;                  // invalidate timers/callbacks of this connection
    this.clearTimers();
    for (const p of this.pending.values()) clearTimeout(p.t);
    this.pending.clear();
    this.session = null; this.release();
    this.status = 'Offline'; this.online = false; this.powerKw = 0;
    this.txId = null; this.idTag = null; this.progress = 0; this.energyKwh = 0;
    this.emit();
    if (this.stopped) return;
    const wait = this.backoff * rnd(0.8, 1.3);
    this.backoff = Math.min(this.backoff * 2, 8000);
    const gen2 = this.gen;
    const t = setTimeout(() => { this.timers.delete(t); if (gen2 === this.gen) this.connect(); }, wait);
    this.timers.add(t);
  }

  async onOpen() {
    try {
      await this.call('BootNotification', {
        chargePointVendor: VENDOR, chargePointModel: this.spec.model,
        chargePointSerialNumber: this.spec.serial, firmwareVersion: this.spec.firmware,
      });
    } catch { return this.drop(); }
    this.backoff = 1000;
    this.online = true;
    await this.setStatus('Available').catch(() => {});
    this.every(15000, () => this.call('Heartbeat', {}).catch(() => this.drop()));
    this.scheduleSession(rnd(2, 10));
  }

  /** Terminate the socket (treated as a broken link) and let onDown reconnect. */
  release() { if (this.reserved) tagsInUse.delete(this.reserved); this.reserved = null; }
  drop() { try { this.ws?.terminate(); } catch { /* ignore */ } }

  // ---- OCPP plumbing ----------------------------------------------------
  call(action, payload, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== 1) return reject(new Error('not open'));
      const id = `${this.id}-${++this.msgNo}`;
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, t });
      ws.send(JSON.stringify([2, id, action, payload]));
    });
  }
  onMessage(text) {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (!Array.isArray(m)) return;
    const p = this.pending.get(m[1]);
    if (!p) return;
    clearTimeout(p.t); this.pending.delete(m[1]);
    if (m[0] === 3) p.resolve(m[2]); else p.reject(new Error('call error'));
  }
  async setStatus(status) {
    this.status = status;
    this.emit();
    await this.call('StatusNotification', { connectorId: 1, errorCode: 'NoError', status });
  }

  // ---- normal behaviour -------------------------------------------------
  scheduleSession(delaySec) {
    this.after(delaySec * 1000, () => this.startSession().catch(() => this.drop()));
  }

  tagFor() {
    // CP-07 is where the compromised card's owner charges legitimately.
    if (this.id === 'CP-07') return COMPROMISED_TAG;
    // Never reuse a tag that is active elsewhere (that would be a genuine 100125 trigger).
    const free = VALID_TAGS.slice(1).filter((t) => !tagsInUse.has(t));
    return pick(free);
  }

  async startSession() {
    if (!this.online || this.session) return;
    const idTag = this.tagFor();
    tagsInUse.add(idTag);
    this.reserved = idTag;
    const auth = await this.call('Authorize', { idTag });
    if (auth.idTagInfo.status !== 'Accepted') { this.release(); return this.scheduleSession(rnd(5, 15)); }
    await this.setStatus('Preparing');
    await new Promise((r) => this.after(1000, r));
    const meterStart = Math.round(this.registerKwh * 1000);
    const res = await this.call('StartTransaction', { connectorId: 1, idTag, meterStart, timestamp: new Date().toISOString() });
    this.txId = res.transactionId; this.idTag = idTag;
    this.energyKwh = 0; this.progress = 0;
    this.soc = Math.round(rnd(15, 45));
    const duration = rnd(40, 90);
    const base = rnd(0.35, 0.75);   // mean ratio around 0.53 after taper
    this.session = { startedAt: Date.now(), duration, base, soc0: this.soc };
    await this.setStatus('Charging');
    // 1 s physics tick
    this.every(1000, () => this.tick());
    // MeterValues every 5 s
    this.every(5000, () => this.meter().catch(() => this.drop()));
  }

  tick() {
    const s = this.session;
    if (!s) return;
    const elapsed = (Date.now() - s.startedAt) / 1000;
    this.progress = Math.min(1, elapsed / s.duration);
    // Taper over the last 25 % of the session, small noise, never above 0.97 of rated.
    const taper = this.progress > 0.75 ? 1 - (this.progress - 0.75) * 2 : 1;
    const ratio = Math.min(0.97, Math.max(0.05, s.base * taper * rnd(0.95, 1.05)));
    this.powerKw = this.spec.ratedKw * ratio;
    const dk = this.powerKw * SIM_H_PER_S;
    this.energyKwh += dk; this.registerKwh += dk;     // register is continuous across sessions
    this.soc = Math.min(100, s.soc0 + (this.energyKwh / CAPACITY_KWH) * 100);
    this.emit();
    if (this.progress >= 1) this.endSession().catch(() => this.drop());
  }

  meter() {
    return this.call('MeterValues', {
      connectorId: 1, transactionId: this.txId,
      meterValue: [{
        timestamp: new Date().toISOString(),
        sampledValue: [
          { measurand: 'Power.Active.Import', value: String(Math.round(this.powerKw * 1000)), unit: 'W' },
          { measurand: 'Energy.Active.Import.Register', value: String(Math.round(this.registerKwh * 1000)), unit: 'Wh' },
        ],
      }],
    });
  }

  async endSession() {
    const s = this.session; if (!s) return;
    this.session = null; this.powerKw = 0;
    const txId = this.txId;
    this.clearTimers();
    // Heartbeat timer was cleared with the rest; re-arm it.
    this.every(15000, () => this.call('Heartbeat', {}).catch(() => this.drop()));
    await this.call('StopTransaction', { transactionId: txId, meterStop: Math.round(this.registerKwh * 1000), timestamp: new Date().toISOString(), idTag: this.idTag });
    this.txId = null; this.idTag = null; this.release();
    await this.setStatus('Finishing');
    await new Promise((r) => this.after(2000, r));
    this.progress = 0; this.energyKwh = 0;
    await this.setStatus('Available');
    this.scheduleSession(rnd(4, 18));
  }

  /** Benign noise: a declined card at an idle charger (not enough to cross any threshold). */
  async declinedCard() {
    if (!this.online || this.session) return;
    await this.call('Authorize', { idTag: pick([...BLOCKED_TAGS, ...EXPIRED_TAGS, 'ID-0000FFFF']) });
  }

  shutdown() {
    this.stopped = true; this.gen++; this.clearTimers(); this.release();
    try { this.ws?.terminate(); } catch { /* ignore */ }
  }
}

const fleet = CHARGERS.map((c) => new Charger(c));
const byId = Object.fromEntries(fleet.map((c) => [c.id, c]));
let noiseTimers = [];

export const getChargers = () => fleet.map((c) => c.toJSON());
export const onlineCount = () => fleet.filter((c) => c.online).length;

/** Benign false-positive material at low rate (stays far below every detection threshold). */
function startNoise() {
  noiseTimers.forEach(clearTimeout);
  noiseTimers = [];
  const loop = (minS, maxS, fn) => {
    const t = setTimeout(() => { fn(); loop(minS, maxS, fn); }, rnd(minS, maxS) * 1000);
    noiseTimers.push(t);
  };
  loop(60, 120, () => pick(fleet).declinedCard().catch(() => {}));
  loop(150, 300, wrongPasswordHandshake);
}

/** One handshake with a wrong password (a technician typo), then it goes away. */
function wrongPasswordHandshake() {
  const c = pick(fleet);
  const auth = Buffer.from(`${c.id}:wrongpass`).toString('base64');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ocpp/${c.id}`, 'ocpp1.6', { headers: { Authorization: `Basic ${auth}`, 'User-Agent': REAL_UA } });
  ws.on('unexpected-response', (_r, res) => res.resume());
  ws.on('error', () => {});
}

export function startChargers() {
  // Rogue flag changes (second session for an id) refresh the UI immediately.
  ocpp.onRogueChange((id) => byId[id]?.emit());
  fleet.forEach((c, i) => { c.stopped = false; c.backoff = 1000; setTimeout(() => c.connect(), 300 + i * 250); });
  startNoise();
}

/** Drop all charger links and bring them back (used by /api/reset). */
export function resetChargers() {
  fleet.forEach((c) => { c.shutdown(); });
  ocpp.resetOcpp();
  fleet.forEach((c) => {
    c.stopped = false; c.backoff = 1000; c.session = null; c.pending.clear();
    c.status = 'Offline'; c.online = false; c.powerKw = 0; c.energyKwh = 0;
    c.txId = null; c.idTag = null; c.progress = 0;
    c.emit();
  });
  fleet.forEach((c, i) => setTimeout(() => c.connect(), 800 + i * 250));
  startNoise();
}
