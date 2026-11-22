# EV-SOC Live

A localhost-only lab that simulates an EV charging network and a small SOC around it. Eight simulated chargers talk OCPP 1.6-J to a deliberately weak central system. Three scripted attacks run against it, and a detection engine raises alerts on the resulting logs. Everything is shown live in a browser.

## Run

```
cd webapp
npm run install:all     # root, server and client dependencies
npm run dev             # server on :4000 (node --watch) and Vite client on :5173
```

Open http://localhost:5173. The server alone: `cd server && npm start`. Set `PORT` to change the server port.

## Docker / Coolify deployment

A single Dockerfile builds the React client and serves it from the same Express process
that runs the OCPP backend, so the whole app is one container on one port: no reverse
proxy or CORS setup is needed.

```
cd webapp
docker compose up --build      # local test, http://localhost:4000
```

To deploy with Coolify: point it at this repository with build context `webapp/` and
Dockerfile path `webapp/Dockerfile`, and set the exposed/internal port to **4000**. Do
not use port 8000: Coolify reserves that for itself on the host. `PORT` is read from the
environment if you need a different internal port (set it both as a container env var
and in Coolify's port mapping).

The image has no external dependencies (no database, no third-party API) and all state
is in-memory, so there is nothing else to configure. `GET /healthz` is the health check
endpoint.

### Protecting the demo controls on a public URL

If this is reachable at a public domain, anyone with the link can otherwise start
attacks or reset the live demo (the read-only Site/Dashboard views and the data itself
are not sensitive: everything is synthetic lab data). To stop that, set a `CONTROL_TOKEN`
environment variable on the Coolify service, any value you choose. With it set:

- `POST /api/attack/:id/start`, `POST /api/attack/:id/stop` and `POST /api/reset` all
  require a matching `X-Control-Token` header, and return 401 without it.
- Every read-only route (`GET /api/state`, `GET /api/rules`, the `/ui` live feed, every
  page in the browser) stays open, so the demo is still viewable by anyone with the link.
- As the operator, open the deployed site, open the browser devtools console, and run:
  `localStorage.setItem('evsoc.controlToken', '<the same value you set in Coolify>')`.
  The Attack Console and Reset button will then work from that browser.
- If `CONTROL_TOKEN` is left unset (e.g. local dev, or a private deployment only you can
  reach), this check is skipped entirely and nothing changes.

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
