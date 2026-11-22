// Mock /ui feed on :4000 for frontend development. Run: npm run mock
import { WebSocketServer } from 'ws';
import http from 'http';

const server = http.createServer((req, res) => { res.writeHead(200); res.end('{}'); });
const wss = new WebSocketServer({ server, path: '/ui' });
const specs = [[7.4, 'AC'], [7.4, 'AC'], [22, 'AC'], [22, 'AC'], [22, 'AC'], [22, 'AC'], [50, 'DC'], [50, 'DC']];
const ch = specs.map(([kw, kind], i) => ({
  id: `CP-0${i + 1}`, kind, model: kind === 'DC' ? 'CT-DC50' : kw > 10 ? 'CT-AC22' : 'CT-AC7', ip: `10.10.10.${11 + i}`,
  ratedKw: kw, status: 'Available', online: true, powerKw: 0, energyKwh: 0, registerKwh: 1000 + i * 100, txId: null, idTag: null,
  firmware: '2.4.1', rogue: false, soc: 0, progress: 0,
}));
const attacks = { A1: { state: 'idle' }, A2: { state: 'idle' }, A3: { state: 'idle' } };
const alerts = []; const hist = [];
let aid = 1;
const send = (m) => wss.clients.forEach((c) => c.readyState === 1 && c.send(JSON.stringify(m)));
wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'snapshot', chargers: ch, alerts, attacks, health: null, score: null, rules: [], packets: [], logs: [] })));

setInterval(() => {
  ch.forEach((c, i) => {
    if (c.status === 'Available' && Math.random() < 0.15) { c.status = 'Preparing'; c.soc = 15 + Math.random() * 40; c.progress = 0; }
    else if (c.status === 'Preparing') { c.status = 'Charging'; }
    else if (c.status === 'Charging') {
      c.progress = Math.min(1, c.progress + 0.05); c.soc = Math.min(100, c.soc + 2);
      c.powerKw = c.ratedKw * (0.4 + Math.random() * 0.3); c.energyKwh += c.powerKw / 3600 * 5;
      if (c.progress >= 1) { c.status = 'Available'; c.powerKw = 0; c.energyKwh = 0; c.soc = 0; }
    }
    c.rogue = attacks.A2.state === 'running' && i === 6;
    if (i === 4 && attacks.A3.state === 'running') { c.online = false; c.status = 'Offline'; c.powerKw = 0; } else if (i === 4 && !c.online) { c.online = true; c.status = 'Available'; }
    send({ type: 'charger', ...c });
  });
}, 1000);

setInterval(() => {
  const a3 = attacks.A3.state === 'running';
  const m = { type: 'health', ts: Date.now(), cpu: a3 ? 92 + Math.random() * 6 : 12 + Math.random() * 8, p95: a3 ? 900 + Math.random() * 200 : 40 + Math.random() * 20,
    activeWs: a3 ? 180 : 8, hsPerS: a3 ? 60 : 1, http503PerS: a3 ? 25 : 0, rejectedCards1m: attacks.A1.state === 'running' ? 30 : 0, online: ch.filter((c) => c.online).length };
  hist.push(m); send(m);
}, 1000);

function run(id) {
  attacks[id] = { state: 'running', step: 'working', progress: 0.5, startedAt: Date.now() };
  send({ type: 'attack', id, ...attacks[id] });
  [3000, 6000].forEach((d, k) => setTimeout(() => {
    const al = { type: 'alert', id: aid++, ts: Date.now(), ruleId: 100110 + k, rule: 'Mock rule ' + k, scenario: id, severity: 8 + k * 5, entity: '10.10.99.66', detail: 'mock detail', count: 10 };
    alerts.unshift(al); send(al);
  }, d));
  setTimeout(() => { attacks[id] = { type: 'attack', id, state: 'done', step: 'done', progress: 1, startedAt: attacks[id].startedAt }; send({ type: 'attack', ...attacks[id] }); }, 15000);
}
setTimeout(() => run('A1'), 5000);
setTimeout(() => run('A3'), 30000);
server.listen(4000, () => console.log('mock feed on :4000'));
