export const EXPECTED = {
  A1: ['100110', '100111', '100112', '100113'],
  A2: ['100111', '100120', '100121', '100122', '100123', '100124', '100125'],
  A3: ['100130', '100131', '100132', '100133', '100135'],
};

export const ATTACKS = [
  {
    id: 'A1',
    title: 'A1 Brute force',
    blurb:
      'The attacker guesses charger passwords from a short word list, one try every few seconds. When a guess works, it logs in as that charger and then tries many RFID card numbers until one is accepted. It is quiet and slow, like someone trying keys on a door.',
  },
  {
    id: 'A2',
    title: 'A2 Rogue charger',
    blurb:
      'Using a stolen password, the attacker opens a second session that pretends to be a real charger. It sends a wrong firmware version, impossible power readings, a meter that goes backwards and messages to an unknown vendor. The server now sees two chargers claiming to be the same one.',
  },
  {
    id: 'A3',
    title: 'A3 Connection flood',
    blurb:
      'The attacker opens hundreds of connections as fast as it can. The server runs out of capacity, starts answering 503 (busy), real chargers drop off and CPU climbs towards 100 percent. Nothing is stolen, the goal is to knock the service over.',
  },
];

export const RULE_HELP = {
  100110: 'Ten or more failed WebSocket logins from one IP in 120 seconds.',
  100111: 'A successful login from an IP that is not registered for that charger.',
  100112: 'Ten or more rejected RFID cards on one charger in 120 seconds.',
  100113: 'A card is Accepted within 300 seconds after a burst of rejections: the guess worked.',
  100120: 'A charger boots with firmware other than 2.4.1.',
  100121: 'Power above 120 percent of the charger rating.',
  100122: 'The energy meter went backwards (negative delta).',
  100123: 'DataTransfer from an unknown vendor id.',
  100124: 'A transaction started with meter reading exactly 0.',
  100125: 'The same card is charging at two chargers at once.',
  100130: 'A burst of WebSocket handshakes from one IP (scaled for the lab: 40 in 10 s).',
  100131: 'Many HTTP 503 answers (scaled for the lab: 15 in 10 s).',
  100132: 'Three or more chargers dropped with ping timeout in 180 seconds.',
  100133: 'Service CPU at 90 percent or more.',
  100135: 'A burst of BootNotification messages from one IP (scaled: 12 in 10 s).',
};
