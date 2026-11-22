// EV-SOC Live backend entry: express REST + ws upgrade routing on :4000.
//
// Helpers other modules (e.g. attacks) may import:
//   bus.js      bus.emitUi(msg), bus.emitLog(file, record), bus.on('log' | 'ui', fn)
//   health.js   recordHandshake(), recordRejected503(), recordRejectedCard(), isSaturated(),
//               latencySample(), getCpu(), SATURATION_HS_PER_S
//   packets.js  emitPacket({from,to,proto,kind,info,cp,length,detail}), injectSyn(count),
//               getPackets(), endpoint(ip,port), randPort(), CSMS
//   topology.js CHARGERS, BY_ID, VALID_TAGS, BLOCKED_TAGS, EXPIRED_TAGS, COMPROMISED_TAG,
//               ATTACKER_IP, ATTACKER_UA, tagStatus(tag)
//   ocpp.js     hasRogue(cpId), activeSessionCount()
//   chargers.js getChargers(), onlineCount()
// Attacks only need the real network (ws://localhost:4000/ocpp/<id>, header X-Sim-Src).
//
// Optional modules (loaded dynamically so the server boots without them):
//   ./attacks/index.js  startAttack(id), stopAttack(id), getAttackStates(), resetAttacks()
//   ./detect/engine.js  startDetection(), getAlerts(), getScore(), resetDetection()
//   ./detect/rules.js   RULES
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { bus } from './bus.js';
import * as health from './health.js';
import * as packets from './packets.js';
import * as ocpp from './ocpp.js';
import * as chargers from './chargers.js';

const PORT = Number(process.env.PORT || 4000);

// In production (Docker), the client is built to ../../client/dist and served from this
// same process and port, so the browser and the OCPP/UI WebSockets share one origin and
// no reverse proxy or CORS setup is needed. In local dev this directory does not exist
// (the client runs on its own Vite dev server, port 5173, proxying to this one) and the
// static middleware below is simply skipped.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');
const hasClientBuild = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));

async function optional(path) {
  try { return await import(path); } catch (e) {
    console.warn(`[optional] ${path} not loaded: ${e.code === 'ERR_MODULE_NOT_FOUND' ? 'missing' : e.message}`);
    return null;
  }
}
const attacks = await optional('./attacks/index.js');
const engine = await optional('./detect/engine.js');
const rulesMod = await optional('./detect/rules.js');
const scoreMod = await optional('./detect/score.js');

// Keep score.js's windows in sync with the attacks module's live start/stop times,
// so getScore() can report time-to-detect, recall and false positives correctly.
if (attacks?.getAllWindows && scoreMod?.setWindows) {
  bus.on('ui', (m) => { if (m.type === 'attack') scoreMod.setWindows(attacks.getAllWindows()); });
}

const IDLE = (id) => ({ type: 'attack', id, state: 'idle', step: '', progress: 0, startedAt: null });
const attackStates = () => ({ A1: IDLE('A1'), A2: IDLE('A2'), A3: IDLE('A3'), ...(attacks?.getAttackStates?.() || {}) });
const emptyScore = () => ({
  type: 'score', A1: { state: 'idle' }, A2: { state: 'idle' }, A3: { state: 'idle' },
  total_alerts: 0, false_positives: 0, benign_events: 0,
});

// Ring buffer of the last 200 log messages for the snapshot.
let logRing = [];
bus.on('ui', (m) => { if (m.type === 'log') { logRing.push(m); if (logRing.length > 200) logRing.shift(); } });

health.setProviders({ activeWs: ocpp.activeSessionCount, online: chargers.onlineCount });

function snapshot() {
  return {
    type: 'snapshot',
    chargers: chargers.getChargers(),
    alerts: engine?.getAlerts?.() || [],
    attacks: attackStates(),
    health: health.getHealth(),
    score: engine?.getScore?.() || emptyScore(),
    rules: rulesMod?.RULES || [],
    packets: packets.getPackets(),
    logs: logRing.slice(),
  };
}

// ---- HTTP ----------------------------------------------------------------
const app = express();
app.use(express.json());
app.get('/api/state', (_req, res) => res.json(snapshot()));
app.get('/api/rules', (_req, res) => res.json(rulesMod?.RULES || []));

function attackRoute(action) {
  return (req, res) => {
    const id = String(req.params.id).toUpperCase();
    if (!['A1', 'A2', 'A3'].includes(id)) return res.status(404).json({ ok: false, error: 'unknown attack id' });
    if (!attacks?.[`${action}Attack`]) return res.status(501).json({ ok: false, error: 'attacks module not available' });
    try { attacks[`${action}Attack`](id); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
    res.json({ ok: true, id, state: attackStates()[id] });
  };
}
app.post('/api/attack/:id/start', attackRoute('start'));
app.post('/api/attack/:id/stop', attackRoute('stop'));

app.post('/api/reset', (_req, res) => {
  try { attacks?.resetAttacks?.(); } catch (e) { console.warn('resetAttacks failed', e.message); }
  try { engine?.resetDetection?.(); } catch (e) { console.warn('resetDetection failed', e.message); }
  health.resetHealth();
  packets.clearPackets();
  logRing = [];
  chargers.resetChargers();
  broadcast(snapshot());
  res.json({ ok: true });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---- Static client (production/Docker only; see hasClientBuild above) ----
if (hasClientBuild) {
  app.use(express.static(CLIENT_DIST));
  // SPA fallback: any non-API, non-OCPP GET that does not match a static file
  // falls through to index.html so React Router can handle client-side routes.
  app.get(/^(?!\/api\/|\/ocpp\/|\/ui$).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('EV-SOC Live backend is running. The client dev server runs separately on :5173 in development.');
  });
}

// ---- WebSockets ----------------------------------------------------------
const server = http.createServer(app);
const uiWss = new WebSocketServer({ noServer: true });
const broadcast = (msg) => {
  const text = JSON.stringify(msg);
  for (const c of uiWss.clients) if (c.readyState === 1) c.send(text);
};
bus.on('ui', broadcast);

uiWss.on('connection', (ws) => {
  ws.send(JSON.stringify(snapshot()));
  ws.on('message', (d) => {
    try { if (JSON.parse(d.toString()).type === 'hello') ws.send(JSON.stringify(snapshot())); } catch { /* ignore */ }
  });
  ws.on('error', () => {});
});

server.on('upgrade', (req, socket, head) => {
  const path = (req.url || '').split('?')[0];
  const m = path.match(/^\/ocpp\/([^/]+)$/);
  socket.on('error', () => {});
  if (m) return ocpp.handleOcppUpgrade(req, socket, head, decodeURIComponent(m[1]));
  if (path === '/ui') return uiWss.handleUpgrade(req, socket, head, (ws) => uiWss.emit('connection', ws, req));
  socket.destroy();
});

server.listen(PORT, () => {
  console.log(`EV-SOC Live backend on http://localhost:${PORT} (ocpp: /ocpp/<id>, ui: /ui)`);
  engine?.startDetection?.();
  health.startHealth();
  chargers.startChargers();
});
