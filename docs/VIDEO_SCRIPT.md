# 2-Minute Video Script (about 270 words)

Audience: anyone, no technical background needed. Speak slowly, one person or three short turns. Stay under 2:00.

**0:00 to 0:20, The problem (slide 2)**
Electric car chargers are computers on the internet. They handle payments and plug into the power grid. But the protocol they use, OCPP, sends passwords in plain text and trusts whatever it is told. If an attacker takes over a charger, they can steal electricity, bill the wrong person, or knock a whole site offline.

**0:20 to 0:40, What we built (slides 3 and 4)**
We built a Security Operations Center for a charging site. It is the "control room" that watches the chargers and raises an alarm when something looks wrong. We simulated eight chargers and a central server for two hours of normal use, and recorded everything: the network packets and the server logs.

**0:40 to 1:15, The three attacks (slide 8)**
Then we attacked our own system three ways. One: guessing passwords and stolen card numbers. Two: a fake charger pretending to be a real one, reporting 184 kilowatts from a 22 kilowatt machine. Three: flooding the server with connections until real chargers dropped offline.

**1:15 to 1:45, Detection (slides 10 and 11)**
We found them with two tools. Wireshark lets us read the raw traffic, for example the failed logins. Splunk collects the logs and runs searches that count suspicious events. All three attacks were caught within 30 seconds, with 19 alerts and no false alarms.

**1:45 to 2:00, Why it matters (slide 12)**
Real-world use: any operator of charging stations, or other smart infrastructure, can reuse this approach. The fix is simple in principle: encrypt the connection, give every charger a unique identity, and check that the numbers make sense.
