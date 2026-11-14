"""Normal operation and the three controlled attack scenarios."""
import random
import topology as T
from topology import T0, CHARGERS
from world import iso

def at(h, m, s=0): return T0 + h * 3600 - 8 * 3600 + m * 60 + s     # wall-clock helper (UTC)

# attack windows (ground truth)
WIN = {"A1": (at(8, 38), at(8, 49)), "A2": (at(9, 5), at(9, 15)), "A3": (at(9, 38), at(9, 46))}

# ---------------------------------------------------------------- normal
def boot_payload(cp, fw=T.FIRMWARE, serial=None):
    i = CHARGERS[cp]
    return {"chargePointVendor": T.VENDOR, "chargePointModel": i["model"], "firmwareVersion": fw,
            "chargePointSerialNumber": serial or f"SN-{cp}-{i['model']}"}

def now_iso(w):
    from world import iso
    return iso(w.now)

def legit_connect(w, cp):
    c = w.connect(w.now, CHARGERS[cp]["ip"], cp, T.password(cp), f"CT-Firmware/{T.FIRMWARE}")
    if not c: return
    w.conns[cp] = c
    t = w.now + 0.3
    w.call(c, t, "BootNotification", boot_payload(cp), {"status": "Accepted", "currentTime": now_iso(w), "interval": 60})
    w.call(c, t + 0.5, "StatusNotification", {"connectorId": 1, "status": "Available", "errorCode": "NoError"}, {})

def heartbeat(w, cp):
    c = w.conns.get(cp)
    if not c or not c.alive: return legit_connect(w, cp)
    w.call(c, w.now, "Heartbeat", {}, {"currentTime": now_iso(w)})

def session(w, cp, tag, t0, minutes, step=60):
    """Schedule a complete charging session; every message is its own event so that outages can interrupt it."""
    info = CHARGERS[cp]; S = {}
    def conn(): c = w.conns.get(cp); return c if c and c.alive else None
    def st(status): 
        c = conn()
        if c: w.call(c, w.now, "StatusNotification", {"connectorId": 1, "status": status, "errorCode": "NoError"}, {})
    def auth():
        c = conn()
        if c: w.call(c, w.now, "Authorize", {"idTag": tag}, {"idTagInfo": {"status": "Accepted"}})
    def start():
        c = conn()
        if not c: return
        S["tx"] = next(w.tx); S["e0"] = w.meter[cp]
        w.call(c, w.now, "StartTransaction", {"connectorId": 1, "idTag": tag, "meterStart": S["e0"], "timestamp": now_iso(w)},
               {"transactionId": S["tx"], "idTagInfo": {"status": "Accepted"}})
        S["e"] = 0.0
    kw_max = min(info["kw"], 11.0 if info["kind"] == "AC" and info["kw"] > 7.4 else info["kw"])
    peak = w.rng.uniform(0.7, 0.97) * kw_max * 1000
    def mv(k):
        def f():
            c = conn()
            if not c or "tx" not in S: return
            frac = k * step / (minutes * 60)
            p = peak * (1 if info["kind"] == "AC" else max(0.35, 1.15 - frac)) * w.rng.uniform(0.97, 1.03)
            S["e"] += p * step / 3600
            sv = [{"measurand": "Energy.Active.Import.Register", "value": f"{S['e0'] + S['e']:.0f}", "unit": "Wh"},
                  {"measurand": "Power.Active.Import", "value": f"{p:.0f}", "unit": "W"},
                  {"measurand": "Voltage", "value": f"{w.rng.uniform(228, 233):.1f}", "unit": "V"}]
            w.call(c, w.now, "MeterValues", {"connectorId": 1, "transactionId": S["tx"], "meterValue": [{"timestamp": now_iso(w), "sampledValue": sv}]}, {})
        return f
    def stop():
        c = conn()
        if not c or "tx" not in S: return
        w.meter[cp] = S["e0"] + S["e"]
        w.call(c, w.now, "StopTransaction", {"transactionId": S["tx"], "idTag": tag, "meterStop": round(w.meter[cp]), "timestamp": now_iso(w), "reason": "Local"},
               {"idTagInfo": {"status": "Accepted"}})
    w.at(t0, auth); w.at(t0 + 3, lambda: st("Preparing")); w.at(t0 + 8, start); w.at(t0 + 10, lambda: st("Charging"))
    n = int(minutes * 60 / step)
    for k in range(1, n + 1): w.at(t0 + 10 + k * step, mv(k))
    end = t0 + 10 + n * step
    w.at(end + 5, lambda: st("Finishing")); w.at(end + 8, stop); w.at(end + 30, lambda: st("Available"))
    return end + 30

def rfid_event(w, cp, tag, t):
    def f():
        c = w.conns.get(cp)
        if c and c.alive:
            status = "Blocked" if tag in T.BLOCKED_TAGS else "Expired" if tag in T.EXPIRED_TAGS else "Invalid"
            w.call(c, w.now, "Authorize", {"idTag": tag}, {"idTagInfo": {"status": status}})
    w.at(t, f)

def normal(w):
    rng = w.rng
    for i, cp in enumerate(CHARGERS):
        w.at(T0 + 2 + i * 1.7, lambda cp=cp: legit_connect(w, cp))
        t = T0 + 20 + i * 6
        while t < T0 + T.DURATION - 5:
            w.at(t, lambda cp=cp: heartbeat(w, cp)); t += 60 + rng.uniform(-1.5, 1.5)
    tags = [t for t in T.VALID_TAGS if t != T.COMPROMISED_TAG]; busy = {}
    for cp, info in CHARGERS.items():
        t = T0 + rng.uniform(120, 900)
        for _ in range(rng.randint(3, 4)):
            dur = rng.randint(10, 22) if info["kind"] == "DC" else rng.randint(12, 30)
            if t + dur * 60 > T0 + T.DURATION - 120: break
            if cp == "CP-07" and abs(t - at(9, 2)) < 1800: t += 1800; continue
            tag = next(x for x in rng.sample(tags, len(tags)) if all(t + dur * 60 + 120 < a or t - 120 > b for a, b in busy.get(x, [])))
            busy.setdefault(tag, []).append((t, t + dur * 60 + 60))
            t = session(w, cp, tag, t, dur) + rng.uniform(300, 1500)
    # the card owner that gets cloned in A1 charges legitimately at CP-07 (overlaps A2)
    session(w, "CP-07", T.COMPROMISED_TAG, at(9, 2), 22)
    # benign anomalies used as baseline for false-positive analysis
    rfid_event(w, "CP-02", "ID-DEADBEEF", at(8, 15)); rfid_event(w, "CP-06", T.EXPIRED_TAGS[0], at(9, 10, 20)); rfid_event(w, "CP-01", T.BLOCKED_TAGS[0], at(9, 52))
    def bad_pw():      # one failed reconnect after a maintenance password change - benign baseline noise
        w.connect(w.now, CHARGERS["CP-04"]["ip"], "CP-04", "cp04pas", f"CT-Firmware/{T.FIRMWARE}")
    w.at(at(8, 25), bad_pw)
    for t, ok in ((at(8, 5), True), (at(8, 58), False), (at(8, 59), True), (at(9, 30), True)):
        w.at(t, lambda t=t, ok=ok: w.log("system", w.now, "csms-admin", "admin_login", user="soc-admin", src_ip=T.ADMIN_IP, result="success" if ok else "failure"))

# ---------------------------------------------------------------- A1: credential / RFID guessing
DICT = ["admin", "password", "123456", "charger", "ocpp", "ocpp1.6", "12345678", "qwerty", "letmein", "welcome1", "chargetech", "cp0000", "default"]

def attack1(w):
    a, _ = WIN["A1"]; rng = w.rng
    ids = list(CHARGERS) + ["CP-09", "CP-10"]
    t = a
    for i in range(52):
        cp, pw = rng.choice(ids), rng.choice(DICT)
        w.at(t, lambda cp=cp, pw=pw: w.connect(w.now, T.ATTACKER_IP, cp, pw, "python-websockets/12.0", label="A1"))
        t += rng.uniform(2.5, 4.0)
    def win():
        c = w.connect(w.now, T.ATTACKER_IP, "CP-03", T.password("CP-03"), "python-websockets/12.0", label="A1")
        if c: w.at(w.now + 4, lambda: w.drop(c, w.now, "client_closed"))
    w.at(t + 5, win)
    # phase b: card emulator held to CP-05 reader, 60 random tags then a hit on the cloned card
    t = at(8, 44); cp = "CP-05"
    for i in range(60):
        tag = "ID-%08X" % rng.getrandbits(32)
        def f(tag=tag):
            c = w.conns.get(cp)
            if c and c.alive:
                c.label = "A1"; w.call(c, w.now, "Authorize", {"idTag": tag}, {"idTagInfo": {"status": "Invalid"}}); c.label = None
        w.at(t, f); t += rng.uniform(3.5, 5.0)
    def hit():
        c = w.conns.get(cp)
        if c and c.alive:
            c.label = "A1"; w.call(c, w.now, "Authorize", {"idTag": T.COMPROMISED_TAG}, {"idTagInfo": {"status": "Accepted"}}); c.label = None
    w.at(t + 2, hit)

# ---------------------------------------------------------------- A2: rogue charger + fraudulent transactions
def attack2(w):
    a, _ = WIN["A2"]; cp = "CP-03"; st = {}
    def go():
        c = w.connect(w.now, T.ATTACKER_IP, cp, T.password(cp), "python-websockets/12.0", label="A2")
        if not c: return
        st["c"] = c; t = w.now
        P = lambda ts, act, pl, rs: w.at(ts, lambda: w.call(c, w.now, act, pl, rs))
        P(t + 1, "BootNotification", boot_payload(cp, "9.9.9-dev", "SPOOF-0003"), {"status": "Accepted", "currentTime": now_iso(w), "interval": 60})
        P(t + 3, "StatusNotification", {"connectorId": 1, "status": "Preparing", "errorCode": "NoError"}, {})
        P(t + 4, "Authorize", {"idTag": T.COMPROMISED_TAG}, {"idTagInfo": {"status": "Accepted"}})
        txid = next(w.tx)
        P(t + 6, "StartTransaction", {"connectorId": 1, "idTag": T.COMPROMISED_TAG, "meterStart": 0, "timestamp": iso(t + 6)},
          {"transactionId": txid, "idTagInfo": {"status": "Accepted"}})
        P(t + 8, "StatusNotification", {"connectorId": 1, "status": "Charging", "errorCode": "NoError"}, {})
        P(t + 100, "DataTransfer", {"vendorId": "x-diag", "messageId": "shell", "data": "id;uname -a"}, {"status": "UnknownVendorId"})
        P(t + 104, "DataTransfer", {"vendorId": "x-diag", "messageId": "getconfig", "data": ""}, {"status": "UnknownVendorId"})
        e = 0.0
        for k in range(1, 17):
            p = w.rng.uniform(150000, 185000)
            e += p * 30 / 3600
            if k == 11: e -= 6000                                    # register rollback
            sv = [{"measurand": "Energy.Active.Import.Register", "value": f"{e:.0f}", "unit": "Wh"},
                  {"measurand": "Power.Active.Import", "value": f"{p:.0f}", "unit": "W"},
                  {"measurand": "Voltage", "value": "230.0", "unit": "V"}]
            P(t + 10 + k * 30, "MeterValues", {"connectorId": 1, "transactionId": txid, "meterValue": [{"timestamp": iso(t + 10 + k * 30), "sampledValue": sv}]}, {})
        P(t + 10 + 17 * 30, "StopTransaction", {"transactionId": txid, "idTag": T.COMPROMISED_TAG, "meterStop": round(e), "timestamp": iso(t + 10 + 17 * 30), "reason": "Other"},
          {"idTagInfo": {"status": "Accepted"}})
        P(t + 10 + 17 * 30 + 3, "StatusNotification", {"connectorId": 1, "status": "Available", "errorCode": "NoError"}, {})
        w.at(t + 10 + 17 * 30 + 8, lambda: w.drop(c, w.now, "client_closed"))
    w.at(a, go)

# ---------------------------------------------------------------- A3: connection / BootNotification flood (DoS)
def attack3(w):
    a, b = WIN["A3"]
    w.dos = (a, a + 60, b, b + 30 + 30)
    rng = w.rng; flood = []
    t = a
    while t < b:
        rate = 6 + 18 * min(1, (t - a) / 60)               # conn/s: ramps to 24/s
        t += rng.expovariate(rate)
        if t >= b: break
        def f():
            if rng.random() < 0.7:
                c = w.connect(w.now, T.ATTACKER_IP, "CP-03", T.password("CP-03"), "python-websockets/12.0", label="A3")
                if c:
                    flood.append(c)
                    for k in range(rng.randint(1, 2)):
                        w.call(c, w.now + 0.01 * (k + 1), "BootNotification", boot_payload("CP-03", "2.4.1", f"FLOOD-{rng.getrandbits(24):06X}"),
                               {"status": "Accepted", "currentTime": now_iso(w), "interval": 60})
            else:
                w.connect(w.now, T.ATTACKER_IP, f"CP-{rng.randint(11, 9999)}", "x", "python-websockets/12.0", label="A3")
        w.at(t, f)
    # half-open SYN flood on 8080 from the same host
    t = a
    while t < b:
        t += rng.expovariate(8)
        def syn(t=t):
            from world import Conn
            c = Conn(w, "-", T.ATTACKER_IP, "A3"); c.tx(t, True, "S")
            w.gt.append(dict(timestamp=iso(t), scenario="A3", src_ip=T.ATTACKER_IP, cp_id="-", action="syn_only"))
        w.at(t, syn)
    def cleanup():
        for c in flood: 
            if c.alive: w.drop(c, w.now + rng.uniform(0, 3), "client_closed")
    w.at(b + 1, cleanup)
