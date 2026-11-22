const ts = '2026-01-01T10:00:00Z';
const raw = (a) => JSON.stringify(a, null, 2);

export const LESSONS = [
  { id: 'handshake', title: 'Connect: TCP and WebSocket', blurb: 'How a charger gets a login and an open line.' },
  { id: 'anatomy', title: 'Anatomy of an OCPP message', blurb: 'The four fields of every message.' },
  { id: 'session', title: 'A full charging session', blurb: 'Boot to stop, step by step.' },
  { id: 'break', title: 'Break it', blurb: 'Inject an attacker and see which rule fires.' },
  { id: 'quiz', title: 'Quiz', blurb: 'Six questions to check yourself.' },
];

// Handshake lesson. Messages up to the response are common, the response depends on the branch.
export const HANDSHAKE_COMMON = [
  { from: 'cp', to: 'srv', label: 'SYN', cap: 'The charger knocks: "can we talk?" This is the first step of the TCP three-way handshake. A flood of these with no follow-up is a SYN flood.', raw: 'TCP  10.10.10.13 -> server:4000  [SYN]  Seq=0' },
  { from: 'srv', to: 'cp', label: 'SYN, ACK', cap: 'The server answers: "yes, I hear you, do you hear me?"', raw: 'TCP  server:4000 -> 10.10.10.13  [SYN, ACK]' },
  { from: 'cp', to: 'srv', label: 'ACK', cap: 'The charger confirms. A reliable TCP line now exists, but nobody has logged in yet.', raw: 'TCP  10.10.10.13 -> server:4000  [ACK]' },
  { from: 'cp', to: 'srv', label: 'GET /ocpp/CP-03 Upgrade: websocket', cap: 'Over that line the charger sends a plain HTTP request asking to upgrade to a WebSocket. It carries the username and password as HTTP Basic (just Base64 text, not encryption) and asks for the ocpp1.6 sub-protocol.', raw: 'GET /ocpp/CP-03 HTTP/1.1\nUpgrade: websocket\nConnection: Upgrade\nSec-WebSocket-Protocol: ocpp1.6\nAuthorization: Basic Q1AtMDM6Y3AwM3Bhc3M=\nUser-Agent: CT-Firmware/2.4.1' },
];
export const HANDSHAKE_BRANCH = {
  101: { label: '101 Switching Protocols', cap: 'Password accepted. The line is upgraded to a WebSocket and stays open. From here both sides exchange OCPP JSON messages. This is the healthy case (logged as ws_auth success, status_code 101).', raw: 'HTTP/1.1 101 Switching Protocols\nUpgrade: websocket\nSec-WebSocket-Protocol: ocpp1.6', tone: 'result' },
  401: { label: '401 Unauthorized', cap: 'Unknown charger id or wrong password. The server refuses and closes. One now and then is normal (a typo). Ten or more from one IP in two minutes fires rule 100110, the brute force signal.', raw: 'HTTP/1.1 401 Unauthorized\nWWW-Authenticate: Basic realm="ocpp"', tone: 'error' },
  503: { label: '503 Service Unavailable', cap: 'The server is saturated and turns new connections away. Real chargers cannot log in either. Many 503 answers fire rule 100131 and point to a connection flood.', raw: 'HTTP/1.1 503 Service Unavailable\nRetry-After: 5', tone: 'error' },
};

// OCPP anatomy lesson
export const ANATOMY = {
  CALL: {
    arr: [2, '19223201', 'BootNotification', { chargePointVendor: 'ChargeTech', chargePointModel: 'CT-AC22' }],
    explain: ['MessageTypeId: 2 means CALL, a request. Chargers send most requests, but the server can send some too (like RemoteStartTransaction).', 'UniqueId: a random id chosen by the sender. The reply must repeat it so both sides can pair the answer with the question.', 'Action: the name of the operation, for example BootNotification, Authorize, StartTransaction, MeterValues.', 'Payload: the details of the request as a JSON object. Which fields are allowed depends on the action.'],
  },
  CALLRESULT: {
    arr: [3, '19223201', { status: 'Accepted', currentTime: ts, interval: 15 }],
    explain: ['MessageTypeId: 3 means CALLRESULT, a successful reply.', 'UniqueId: the same id as the request. This is the matching key.', null, 'Payload: the answer. There is no Action field, because the reply is tied to the request by its id. Here the server tells the charger to send a Heartbeat every 15 seconds.'],
  },
  CALLERROR: {
    arr: [4, '19223201', 'NotImplemented', 'Unknown action', {}],
    explain: ['MessageTypeId: 4 means CALLERROR, the request failed at the protocol level.', 'UniqueId: again the id of the request that failed.', 'ErrorCode: a short code such as NotImplemented or FormationViolation (in place of an action).', 'ErrorDescription and ErrorDetails follow. This is different from a normal reply with status Rejected: the request itself could not be handled.'],
  },
};

const A = (id, action, payload) => ({ from: 'cp', to: 'srv', label: `CALL ${action}`, kind: 'call', raw: raw([2, id, action, payload]) });
const R = (id, payload, cap) => ({ from: 'srv', to: 'cp', label: 'CALLRESULT', kind: 'result', raw: raw([3, id, payload]), cap });

export const SESSION_LANES = [{ id: 'cp', label: 'Charger CP-03' }, { id: 'srv', label: 'CSMS server' }];

export const SESSION_STEPS = [
  { ...A('b1', 'BootNotification', { chargePointVendor: 'ChargeTech', chargePointModel: 'CT-AC22', firmwareVersion: '2.4.1' }), cap: 'Boot. The charger introduces itself: vendor, model and firmware 2.4.1. The server uses this to check it is the expected hardware.' },
  R('b1', { status: 'Accepted', currentTime: ts, interval: 15 }, 'The server accepts it and sets the heartbeat interval. The id b1 matches the request.'),
  { ...A('s1', 'StatusNotification', { connectorId: 1, status: 'Available', errorCode: 'NoError' }), cap: 'Status. The charger reports that connector 1 is free and healthy.' },
  R('s1', {}, 'An empty payload is a plain acknowledgement.'),
  { ...A('h1', 'Heartbeat', {}), cap: 'Heartbeat. A small "I am alive" message sent every 15 seconds in this lab. If several chargers stop sending these, rule 100132 (ping timeout) can fire.' },
  R('h1', { currentTime: ts }, 'The server replies with its clock.'),
  { ...A('a1', 'Authorize', { idTag: 'ID-00000001' }), cap: 'Authorize. A driver taps an RFID card. The charger asks if this card is allowed.' },
  R('a1', { idTagInfo: { status: 'Accepted' } }, 'Accepted. Other answers are Invalid, Expired or Blocked. Many rejected cards in a row fire rule 100112.'),
  { ...A('t1', 'StartTransaction', { connectorId: 1, idTag: 'ID-00000001', meterStart: 120340, timestamp: ts }), cap: 'StartTransaction. Charging begins and the energy meter reading at the start is recorded.' },
  R('t1', { transactionId: 4711, idTagInfo: { status: 'Accepted' } }, 'The server hands out a transaction id (4711) that links the next messages together.'),
  { ...A('m1', 'MeterValues', { transactionId: 4711, meterValue: [{ sampledValue: [{ measurand: 'Power.Active.Import', value: '11800', unit: 'W' }] }] }), cap: 'MeterValues. Every 5 seconds in this lab the charger reports power. 11.8 kW on a 22 kW charger is a normal ratio (about 0.53). Above 120 percent of the rating would fire rule 100121.' },
  R('m1', {}, 'Acknowledged.'),
  { ...A('t2', 'StopTransaction', { transactionId: 4711, meterStop: 128940, timestamp: ts, idTag: 'ID-00000001' }), cap: 'StopTransaction. Charging ends. meterStop (128940) is higher than meterStart (120340), so 8.6 kWh were delivered. A meter that goes backwards fires rule 100122.' },
  R('t2', { idTagInfo: { status: 'Accepted' } }, 'Session complete. The cycle returns to Available.'),
];

export const BREAK_LANES = [{ id: 'cp', label: 'Charger' }, { id: 'att', label: 'Attacker 10.10.99.66' }, { id: 'srv', label: 'CSMS server' }];

const at = (label, cap, rule, rawText, to = 'srv', from = 'att') => ({ from, to, label, kind: 'attack', cap, rule, raw: rawText });
const legit = SESSION_STEPS.slice(0, 2).map((s) => ({ ...s }));

export const BREAK = {
  brute: {
    label: 'Brute force (A1)',
    steps: [
      ...legit,
      at('GET /ocpp/CP-03  (admin)', 'The attacker guesses a password from a word list.', null, 'Authorization: Basic Q1AtMDM6YWRtaW4=  (CP-03:admin)\nUser-Agent: python-websockets/12.0'),
      at('401', 'Rejected. Note the odd user-agent: real chargers say CT-Firmware/2.4.1.', null, 'HTTP/1.1 401 Unauthorized', 'att', 'srv'),
      at('... 10 more failed guesses', 'After ten failures from the same IP inside 120 seconds, the SOC rule fires because a normal charger almost never fails this often.', '100110: 10 or more failed logins from one IP in 120 s', 'ws_auth failure x10  src_ip=10.10.99.66'),
      at('GET /ocpp/CP-03  (cp03pass)', 'The weak provisioning password finally works.', null, 'Authorization: Basic Q1AtMDM6Y3AwM3Bhc3M='),
      at('101', 'Login succeeds. But 10.10.99.66 is not the registered address of CP-03, so the login itself is suspicious.', '100111: successful login from an IP not registered for that charger', 'HTTP/1.1 101 Switching Protocols', 'att', 'srv'),
      at('CALL Authorize ID-0000009x', 'Now the attacker guesses RFID card numbers.', '100112: 10 or more rejected cards in 120 s on one charger', raw([2, 'z1', 'Authorize', { idTag: 'ID-00000042' }])),
      at('CALLRESULT Accepted', 'A guess is accepted. A success right after many rejections is the strongest sign the guess worked.', '100113: Accepted card within 300 s after rejections', raw([3, 'z9', { idTagInfo: { status: 'Accepted' } }]), 'att', 'srv'),
    ],
  },
  rogue: {
    label: 'Rogue second session (A2)',
    steps: [
      ...legit,
      at('Login as CP-03 (stolen password)', 'With a stolen password the attacker opens a second session that claims to be CP-03.', '100111: login from an IP not registered for CP-03', 'GET /ocpp/CP-03  Authorization: Basic ...'),
      at('CALL BootNotification fw 9.9.9', 'The fake charger reports firmware that does not match the fleet.', '100120: firmware is not 2.4.1', raw([2, 'r1', 'BootNotification', { firmwareVersion: '9.9.9', chargePointVendor: 'ChargeTech' }])),
      at('CALL MeterValues 184000 W', 'A 22 kW charger cannot deliver 184 kW. Physics gives it away.', '100121: power above 120 percent of rating', raw([2, 'r2', 'MeterValues', { meterValue: [{ sampledValue: [{ measurand: 'Power.Active.Import', value: '184000' }] }] }])),
      at('CALL MeterValues energy goes down', 'The meter register drops, which real hardware cannot do.', '100122: negative energy delta', raw([2, 'r3', 'MeterValues', { note: 'register lower than previous value' }])),
      at('CALL DataTransfer vendor EvilCorp', 'The attacker probes for hidden vendor features.', '100123: DataTransfer to an unknown vendor', raw([2, 'r4', 'DataTransfer', { vendorId: 'EvilCorp', messageId: 'probe' }])),
      at('CALL StartTransaction meterStart 0', 'Real chargers start from their real register, not zero.', '100124: transaction starts at meter 0', raw([2, 'r5', 'StartTransaction', { idTag: 'ID-00000001', meterStart: 0 }])),
      at('Same card at a second charger', 'The owner is charging at CP-07 and the same card is now active at CP-03. One card cannot be in two places.', '100125: same id tag active at two chargers', raw([2, 'r6', 'StartTransaction', { idTag: 'ID-00000001', connectorId: 1 }])),
    ],
  },
  flood: {
    label: 'Connection flood (A3)',
    steps: [
      ...legit,
      at('Hundreds of handshakes per second', 'The attacker opens connections as fast as it can.', '100130: burst of handshakes from one IP (lab: 40 in 10 s)', 'TCP SYN x 500 from 10.10.99.66'),
      at('503 Service Unavailable', 'The server is full and turns everyone away, including real chargers.', '100131: many HTTP 503 answers (lab: 15 in 10 s)', 'HTTP/1.1 503 Service Unavailable', 'att', 'srv'),
      at('BootNotification burst', 'Flood messages also hammer the boot handler.', '100135: burst of BootNotification from one IP (lab: 12 in 10 s)', raw([2, 'f1', 'BootNotification', {}])),
      { from: 'srv', to: 'cp', label: 'Ping timeout, charger dropped', kind: 'attack', cap: 'Starved of attention, real chargers miss their heartbeats and fall off the network.', rule: '100132: 3 or more chargers lost with ping timeout in 180 s', raw: 'cp_disconnected reason=ping_timeout' },
      { from: 'srv', to: 'srv', note: true, label: 'CPU 99 percent', kind: 'attack', cap: 'The server CPU is pinned. Customers cannot start charging.', rule: '100133: CPU at 90 percent or more', raw: 'service_health cpu_pct=99 active_ws=669' },
    ],
  },
};

export const QUIZ = [
  { q: 'What does the first number in an OCPP-J message mean?', o: ['The charger id', 'The message type: 2 request, 3 reply, 4 error', 'The transaction id', 'The firmware version'], a: 1, why: 'MessageTypeId 2 is CALL, 3 is CALLRESULT and 4 is CALLERROR.' },
  { q: 'Why does a CALLRESULT repeat the request UniqueId?', o: ['To encrypt the payload', 'So the sender can match the reply to its request', 'To count the messages', 'It is only a timestamp'], a: 1, why: 'Many requests can be in flight, so the id is the matching key.' },
  { q: 'Which HTTP status means the WebSocket login worked?', o: ['200', '401', '101', '503'], a: 2, why: '101 Switching Protocols means the connection was upgraded to a WebSocket. 401 is a failed login and 503 means the server is busy.' },
  { q: 'Ten failed logins in two minutes from one IP most likely means what?', o: ['Normal charger behaviour', 'A brute force attempt (rule 100110)', 'A firmware update', 'A meter rollback'], a: 1, why: 'Real chargers rarely fail their login, so a burst from one address suggests password guessing.' },
  { q: 'A 22 kW charger reports 184 kW. Which rule fires?', o: ['100121, power above 120 percent of the rating', '100130, connection burst', '100110, failed logins', '100133, high CPU'], a: 0, why: 'The charger cannot physically deliver that, so the reading must be fake.' },
  { q: 'Why can a low and slow attacker evade rules 100110 and 100112?', o: ['The rules read encrypted data', 'They use fixed thresholds, so staying under the count in the window avoids them', 'The logs are deleted', 'The rules only run at night'], a: 1, why: 'Threshold rules count events in a window. Slower guessing stays below the count, which is a known limitation of this design.' },
];
