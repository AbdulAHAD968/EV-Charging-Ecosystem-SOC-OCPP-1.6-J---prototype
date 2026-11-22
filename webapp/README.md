# EV-SOC Live

A localhost-only lab that simulates an EV charging network and a small SOC around it. Eight simulated chargers talk OCPP 1.6-J to a deliberately weak central system. Three scripted attacks run against it, and a detection engine raises alerts on the resulting logs. Everything is shown live in a browser.

## Run

```
cd webapp
npm run install:all     # root, server and client dependencies
npm run dev             # server on :4000 (node --watch) and Vite client on :5173
```

Open http://localhost:5173. The server alone: `cd server && npm start`. Set `PORT` to change the server port.

## Pages

- `/` Site View: the eight chargers (status, power, energy, SoC, rogue flag).
- `/dashboard`: CPU, latency, handshakes per second, alerts.
- `/attacks`: start and stop A1 (credential stuffing and takeover), A2 (rogue charger and meter tampering), A3 (handshake flood).
- `/inspector`: live packet and log feed with decoded OCPP frames.
- `/learn`, `/scorecard`: explanations and detection scoring.

## Architecture

```
server/src
  index.js      express + http, ws upgrade routing (/ocpp/<id>, /ui), REST
  ocpp.js       OCPP 1.6-J CSMS (Basic auth, 401/503, duplicate sessions allowed, no plausibility checks)
  chargers.js   8 real ws charger clients, compressed timers, auto-reconnect, benign noise
  health.js     CPU/latency model derived from real handshake rates, saturates near 40 handshakes/s
  packets.js    packet tap (syn, http, ws frames) for the Inspector
  topology.js   chargers, passwords (cp01pass ...), idTag lists
  bus.js        event bus; logger.js writes JSON logs to webapp/logs
  attacks/      A1..A3 runners          detect/  rules, engine, score
client/         Vite + React dashboard (proxies /api and /ui to :4000)
```

REST: `GET /api/state`, `POST /api/attack/:id/start|stop`, `POST /api/reset`, `GET /api/rules`.
Browser feed: `ws://localhost:4000/ui` (snapshot first, then streamed messages).

## Ethics note

This is an educational lab. Everything binds to localhost, the weak passwords and missing checks are intentional lab weaknesses, and the attacks only target the simulated CSMS in this repository. Do not point any of this code at systems you do not own.
