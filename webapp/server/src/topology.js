// Static lab topology: chargers, credentials and idTag lists (mirrors the Python sim).
export const CSMS_IP = '10.10.20.10';
export const CSMS_PORT = 8080;
export const ATTACKER_IP = '10.10.99.66';
export const ATTACKER_UA = 'python-websockets/12.0';
export const REAL_UA = 'CT-Firmware/2.4.1';
export const FIRMWARE = '2.4.1';
export const VENDOR = 'ChargeTech';

const SPEC = [
  ['CP-01', 'AC', 'CT-AC7', 7.4],
  ['CP-02', 'AC', 'CT-AC7', 7.4],
  ['CP-03', 'AC', 'CT-AC22', 22],
  ['CP-04', 'AC', 'CT-AC22', 22],
  ['CP-05', 'AC', 'CT-AC22', 22],
  ['CP-06', 'AC', 'CT-AC22', 22],
  ['CP-07', 'DC', 'CT-DC50', 50],
  ['CP-08', 'DC', 'CT-DC50', 50],
];

export const CHARGERS = SPEC.map(([id, kind, model, ratedKw], i) => ({
  id, kind, model, ratedKw,
  ip: `10.10.10.${11 + i}`,
  password: `cp0${i + 1}pass`,
  serial: `CT${String(1000 + i * 37)}`,
  firmware: FIRMWARE,
}));
export const BY_ID = Object.fromEntries(CHARGERS.map((c) => [c.id, c]));

const hex = (prefix, n) => `ID-${prefix}${String(n).padStart(7 - prefix.length, '0')}`;
export const VALID_TAGS = Array.from({ length: 12 }, (_, i) => `ID-${String(i + 1).padStart(8, '0')}`);
export const BLOCKED_TAGS = [1, 2, 3].map((n) => hex('B', n));
export const EXPIRED_TAGS = [1, 2, 3].map((n) => hex('E', n));
export const COMPROMISED_TAG = VALID_TAGS[0];

/** Authorization status for an idTag per the lab lists. */
export function tagStatus(tag) {
  if (VALID_TAGS.includes(tag)) return 'Accepted';
  if (BLOCKED_TAGS.includes(tag)) return 'Blocked';
  if (EXPIRED_TAGS.includes(tag)) return 'Expired';
  return 'Invalid';
}
