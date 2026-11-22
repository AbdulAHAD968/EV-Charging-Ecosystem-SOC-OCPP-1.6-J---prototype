# EV-SOC Live: shared contract (all agents must follow this exactly)

Stack: Node 18+ (ESM, `"type":"module"`), `ws`, `express`; client = Vite + React 18 + react-router-dom + recharts. No emojis, no em dashes anywhere (code, UI text, comments).

```
webapp/
  package.json            root: scripts "dev" (runs server+client via concurrently), "start", "install:all"
  server/                 port 4000
    src/index.js          express + http + ws servers (OWNER: backend-core)
    src/bus.js            event bus (PROVIDED, do not change API)
    src/logger.js         JSON log writer (PROVIDED)
    src/topology.js       chargers, passwords, tags (OWNER: backend-core)
    src/ocpp.js           OCPP 1.6-J CSMS (OWNER: backend-core)
    src/chargers.js       8 simulated charger clients + normal behaviour (OWNER: backend-core)
    src/health.js         CPU/latency/active-ws model, 1 s ticks (OWNER: backend-core)
    src/packets.js        packet tap (OWNER: backend-core)
    src/attacks/{a1,a2,a3,index}.js   (OWNER: attacks-detection)
    src/detect/{rules,engine,score}.js (OWNER: attacks-detection)
  client/                 Vite dev server port 5173, proxies /api and /ui to :4000
    src/store.js          PROVIDED live store
    src/App.jsx, main.jsx, styles.css, components/*, pages/Site, pages/Dashboard   (OWNER: frontend-core)
    src/pages/Attack*, Inspector*, Scorecard*, Learn*  (OWNER: frontend-pages)
```

## Network
- Everything on `localhost:4000`. OCPP endpoint: `ws://localhost:4000/ocpp/<CP-ID>` sub-protocol `ocpp1.6`, HTTP Basic auth `CP-ID:password`. Passwords: `cp01pass` ... `cp08pass` (weak on purpose). Unknown ID or bad password -> HTTP 401. When health model is saturated -> HTTP 503.
- Browser feed: `ws://localhost:4000/ui` (JSON text frames, server -> client only; client may send `{"type":"hello"}`).
- REST: `GET /api/state` (snapshot), `POST /api/attack/:id/start`, `POST /api/attack/:id/stop` (id = A1|A2|A3), `POST /api/reset` (clears alerts/scores/attacks, reconnects chargers), `GET /api/rules`.

## Charger facts (same as report)
CP-01, CP-02 AC 7.4 kW; CP-03..06 AC 22 kW; CP-07, CP-08 DC 50 kW. IPs 10.10.10.11..18 (display only). Firmware `2.4.1`, vendor `ChargeTech`, models CT-AC7 / CT-AC22 / CT-DC50. Attacker display IP `10.10.99.66`, user-agent `python-websockets/12.0`; real `CT-Firmware/2.4.1`. Normal ratio power/rated mean 0.53 max 0.97. Valid idTags `ID-0000000N`, blocked/expired exist; COMPROMISED_TAG = first valid tag (owner charges at CP-07). Time is real wall-clock; sessions run on compressed timers (a charge lasts 40 to 90 s, MeterValues every 5 s, Heartbeat every 15 s) so a demo is lively.

## Internal bus (server/src/bus.js, PROVIDED)
`bus.emitUi(msg)` broadcasts msg to browsers AND `bus.on('ui', fn)` listeners. `bus.emitLog(file, record)` writes JSON log (logger) and emits `bus.on('log', ({file, record}))`. Detection engine subscribes to `log`. Backend-core calls emitLog for every log record; attacks-detection calls `bus.emitUi({type:'alert',...})`.

## Log records (field names MUST match; detection depends on them)
All records have `timestamp` (ISO), `event`. `file` is one of `ocpp_gateway`, `transactions`, `system`.
- `ws_auth` (ocpp_gateway): `result` success|failure, `status_code` 101|401|503, `cp_id`, `src_ip`, `user_agent`, `latency_ms`. src_ip for real chargers is the registered IP; connections from attack runners declare their identity through header `X-Sim-Src: 10.10.99.66` (the server trusts it for display and logs; absent -> use registered IP of the cp_id, or 127.0.0.1).
- `ocpp_message` (ocpp_gateway): `cp_id`, `src_ip`, `action`, `msg_id`, `status`, `latency_ms`.
- `cp_boot`: `cp_id`, `src_ip`, `firmware`, `serial`, `vendor`, `model`. `cp_status`: `cp_id`, `status`. `cp_disconnected`: `cp_id`, `src_ip`, `reason` (ping_timeout|close).
- `id_authorize` (transactions): `cp_id`, `src_ip`, `id_tag`, `status` Accepted|Invalid|Expired|Blocked.
- `transaction_start`: `cp_id`, `src_ip`, `id_tag`, `transaction_id`, `meter_start`. `transaction_stop`: `cp_id`, `transaction_id`, `meter_stop`, `src_ip`.
- `meter_value`: `cp_id`, `src_ip`, `transaction_id`, `power_w`, `energy_wh`, `rated_kw`, `energy_delta_wh` (vs previous register of that charger; negative = rollback).
- `data_transfer`: `cp_id`, `src_ip`, `vendor_id`, `message_id`, `status` (UnknownVendorId for vendors other than ChargeTech).
- `service_health` (system, every 1 s): `cpu_pct`, `p95_latency_ms`, `active_ws`, `handshakes_per_s`, `http_503_per_s`.

## UI feed messages (server -> browser), each has `type`
- `snapshot`: `{type, chargers:[Charger], alerts:[Alert], attacks:{A1,A2,A3}, health:Health, score:Score, rules:[Rule], packets:[Packet] (last 200), logs:[Log] (last 200)}`
- `charger`: `{type, ...Charger}` Charger = `{id, kind:'AC'|'DC', model, ip, ratedKw, status:'Available'|'Preparing'|'Charging'|'Finishing'|'Offline'|'Faulted', online:bool, powerKw, energyKwh (session), registerKwh, txId|null, idTag|null, firmware, rogue:bool (true while an attacker session is also live on this id), soc:0-100 (car battery, display), progress:0-1}`
- `packet`: `{type, no, ts (ms), src, dst, proto:'TCP'|'HTTP'|'WebSocket', length, info, cp, kind:'syn'|'synack'|'http_req'|'http_401'|'http_101'|'http_503'|'ws_call'|'ws_result'|'close', attack:bool, detail: object}` (detail holds decoded fields e.g. `{authorization:'Basic ...', decoded:'CP-03:admin', json:[2,"id","Authorize",{...}]}`)
- `log`: `{type, file, ...record}`
- `alert`: `{type, id, ts, ruleId, rule, scenario:'A1'|'A2'|'A3', severity:1-15, entity, detail, count}`
- `health`: `{type, ts, cpu, p95, activeWs, hsPerS, http503PerS, rejectedCards1m, online (chargers online count)}` every 1 s
- `attack`: `{type, id:'A1'|'A2'|'A3', state:'idle'|'running'|'done', step:'short text', progress:0-1, startedAt}` plus `{type:'attack_step', id, ts, text}` narrating each attacker action
- `score`: `{type, A1:{state,first_alert_s,time_to_detect_s,rules_expected,rules_fired,recall,alerts}, A2:{...}, A3:{...}, total_alerts, false_positives, benign_events}` recomputed on each alert and attack change
- `rule` shape: `{id, name, scenario, logic}`

## Detection rules (IDs and thresholds, same as report, live on sliding windows)
100110 >=10 ws_auth failures / 120 s per src_ip; 100111 ws_auth success from src_ip not registered for cp_id; 100112 >=10 rejected id_authorize / 120 s per cp; 100113 Accepted within 300 s after 100112 on that cp; 100120 cp_boot firmware != 2.4.1; 100121 power_w > 1.2*rated_kw*1000; 100122 energy_delta_wh < 0; 100123 data_transfer UnknownVendorId; 100124 transaction_start meter_start == 0; 100125 same id_tag active at two chargers; 100130 >=100 ws_auth / 30 s per src_ip (scaled: see attacks-detection: threshold 40 per 10 s since the lab is compressed); 100131 >=20 HTTP 503 / 60 s (use 10 s window, >=15); 100132 >=3 cp_disconnected ping_timeout / 180 s; 100133 service_health cpu_pct >= 90; 100135 >=20 BootNotification / 30 s per src_ip (use 10 s window, >=12). Expected rules per scenario: A1 {100110,100111,100112,100113}; A2 {100111,100120,100121,100122,100123,100124,100125}; A3 {100130,100131,100132,100133,100135}. Rules are idempotent with cooldowns so the same condition does not spam.

## Design (frontend)
Follow `../sample_ppt/DESIGN.md`: cream canvas #faf9f5, card #efe9de, dark #181715, coral #cc785c, ink #141413, muted #6c6a64, hairline #e6dfd8, teal #5db8a6, amber #e8a55a, success #5db872, error #c64545. Display font Georgia/serif weight 400 negative tracking, body Inter/system sans, mono JetBrains Mono/Consolas. Radius 8 buttons, 12 cards, 16 hero, pill badges. Alternate cream and dark panels. No shadows beyond hairlines. Define CSS variables in `client/src/styles.css` (frontend-core owns it; frontend-pages may add `src/pages/*.css`).

## Client store (PROVIDED client/src/store.js)
`import { useLive } from './store'` returns `{connected, chargers (map by id), alerts, attacks, health, healthHistory (last 120), score, rules, packets, logs, attackSteps, startAttack(id), stopAttack(id), reset()}`.

## Routes (client)
`/` Site View, `/dashboard`, `/attacks`, `/inspector`, `/learn`, `/scorecard`. Nav lives in frontend-core `components/Layout.jsx`; pages are default exports from `pages/Site.jsx, Dashboard.jsx` (core) and `pages/Attacks.jsx, Inspector.jsx, Learn.jsx, Scorecard.jsx` (pages agent).
