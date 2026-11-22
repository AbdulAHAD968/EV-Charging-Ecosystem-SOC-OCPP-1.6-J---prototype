// Detection rule catalog (metadata only, no behaviour).
// Each entry describes one rule id as defined in CONTRACT.md "Detection rules".
// The engine (engine.js) is the only place that actually evaluates these rules.

export const RULES = [
  {
    id: 100110,
    name: 'WebSocket credential brute force',
    scenario: 'A1',
    logic: '>=10 ws_auth failures / 120 s per src_ip',
  },
  {
    id: 100111,
    name: 'Session from non-registered address',
    scenario: 'A1/A2',
    logic: 'ws_auth success from src_ip not registered for cp_id',
  },
  {
    id: 100112,
    name: 'RFID idTag guessing',
    scenario: 'A1',
    logic: '>=10 rejected id_authorize / 120 s per cp_id',
  },
  {
    id: 100113,
    name: 'idTag accepted after guessing burst',
    scenario: 'A1',
    logic: 'Accepted id_authorize within 300 s after a 100112 burst on that cp_id',
  },
  {
    id: 100120,
    name: 'Unexpected firmware / serial',
    scenario: 'A2',
    logic: 'cp_boot firmware != 2.4.1',
  },
  {
    id: 100121,
    name: 'Implausible power',
    scenario: 'A2',
    logic: 'meter_value power_w > 1.2 * rated_kw * 1000',
  },
  {
    id: 100122,
    name: 'Energy register decreased',
    scenario: 'A2',
    logic: 'meter_value energy_delta_wh < 0',
  },
  {
    id: 100123,
    name: 'DataTransfer probing',
    scenario: 'A2',
    logic: 'data_transfer status == UnknownVendorId',
  },
  {
    id: 100124,
    name: 'meterStart = 0',
    scenario: 'A2',
    logic: 'transaction_start meter_start == 0',
  },
  {
    id: 100125,
    name: 'Concurrent idTag use',
    scenario: 'A2',
    logic: 'same id_tag active at two chargers at once',
  },
  {
    id: 100130,
    name: 'Connection flood',
    scenario: 'A3',
    logic: '>=40 ws_auth / 10 s per src_ip (scaled for the compressed lab)',
  },
  {
    id: 100131,
    name: 'CSMS returning 503',
    scenario: 'A3',
    logic: '>=15 HTTP 503 / 10 s (scaled for the compressed lab)',
  },
  {
    id: 100132,
    name: 'Fleet heartbeat loss',
    scenario: 'A3',
    logic: '>=3 cp_disconnected ping_timeout / 180 s',
  },
  {
    id: 100133,
    name: 'CSMS resource exhaustion',
    scenario: 'A3',
    logic: 'service_health cpu_pct >= 90',
  },
  {
    id: 100135,
    name: 'BootNotification flood',
    scenario: 'A3',
    logic: '>=12 BootNotification (cp_boot) / 10 s per src_ip (scaled for the compressed lab)',
  },
];

export default RULES;
