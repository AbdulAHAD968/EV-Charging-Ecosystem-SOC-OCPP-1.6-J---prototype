"""Event scheduler + OCPP-J/WebSocket/TCP packet writer + CSMS log writer."""
import base64, hashlib, heapq, itertools, json, math, random, uuid
from datetime import datetime, timezone
import logging
logging.getLogger("scapy.runtime").setLevel(logging.ERROR)
from scapy.all import Ether, IP, TCP, Raw
import topology as T

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (int(round(ts * 1000)) % 1000)

def ws_frame(payload, masked, rng):
    n = len(payload)
    m = 0x80 if masked else 0
    hdr = bytes([0x81, m | n]) if n < 126 else bytes([0x81, m | 126]) + n.to_bytes(2, "big")
    if masked:
        mk = rng.getrandbits(32).to_bytes(4, "big")
        return hdr + mk + bytes(b ^ mk[i % 4] for i, b in enumerate(payload))
    return hdr + payload

class Conn:
    def __init__(s, w, cp_id, ip, label=None):
        s.w, s.cp_id, s.ip, s.label = w, cp_id, ip, label
        s.sport = w.port(ip)
        s.cseq, s.sseq = w.rng.getrandbits(32), w.rng.getrandbits(32)
        s.last, s.alive, s.timeouts, s.saturated_seen = 0.0, False, 0, False

    def tx(s, ts, client, flags, payload=b""):
        ts = max(ts, s.last + 0.0002); s.last = ts
        if client:
            src, dst, sp, dp, seq, ack = s.ip, T.CSMS_IP, s.sport, T.CSMS_PORT, s.cseq, s.sseq
        else:
            src, dst, sp, dp, seq, ack = T.CSMS_IP, s.ip, T.CSMS_PORT, s.sport, s.sseq, s.cseq
        opts = [("MSS", 1460)] if flags == "S" else []
        p = (Ether(src=T.mac(src, s.ip == T.ATTACKER_IP and client), dst=T.mac(dst, s.ip == T.ATTACKER_IP and not client))
             / IP(src=src, dst=dst, id=s.w.ipid(src), ttl=64)
             / TCP(sport=sp, dport=dp, seq=seq, ack=ack if "A" in flags else 0, flags=flags, window=64240, options=opts)
             / Raw(payload))
        p.time = ts
        s.w.pkts.append(p)
        adv = len(payload) + (1 if ("S" in flags or "F" in flags) else 0)
        if client: s.cseq = (s.cseq + adv) & 0xFFFFFFFF
        else: s.sseq = (s.sseq + adv) & 0xFFFFFFFF
        return ts

class World:
    def __init__(self, seed=1337):
        self.rng = random.Random(seed)
        self.pkts, self.logs, self.gt, self.stats = [], {"gateway": [], "transactions": [], "system": []}, [], []
        self.q, self.cnt, self.now = [], itertools.count(), T.T0
        self.conns, self.ports, self.ids = {}, {}, {}
        self.tx = itertools.count(100231)
        self.meter = {cp: self.rng.randint(120000, 900000) for cp in T.CHARGERS}   # Wh registers
        self.last_meter = {}       # tx_id -> (ts, energy_wh)
        self.dos = None            # (start, saturated_from, attack_end, recovered)
        self.active_ws = 0

    # -- scheduling
    def at(self, ts, fn): heapq.heappush(self.q, (ts, next(self.cnt), fn))
    def run(self):
        while self.q:
            ts, _, fn = heapq.heappop(self.q); self.now = ts; fn()

    # -- helpers
    def port(self, ip):
        p = self.ports.get(ip, self.rng.randint(32768, 40000)) + 1
        if p > 60999: p = 32768
        self.ports[ip] = p; return p
    def ipid(self, ip):
        self.ids[ip] = (self.ids.get(ip, self.rng.randint(1, 60000)) + 1) & 0xFFFF; return self.ids[ip]
    def uid(self): return str(uuid.UUID(int=self.rng.getrandbits(128), version=4))
    def log(self, f, ts, component, event, **kw):
        rec = {"timestamp": iso(ts), "host": "csms-01", "component": component, "event": event}; rec.update(kw)
        self.logs[f].append((ts, rec))
    def phase(self, ts):
        if not self.dos: return "normal"
        a, b, c, d = self.dos
        if ts < a or ts >= d: return "normal"
        if ts < b: return "ramp"
        if ts < c + 30: return "saturated"
        return "recovery"
    def latency(self, ts):
        base = self.rng.lognormvariate(math.log(18), 0.35)
        ph = self.phase(ts)
        if ph == "ramp": base *= 1 + 18 * (ts - self.dos[0]) / (self.dos[1] - self.dos[0])
        elif ph == "saturated": base = self.rng.uniform(1500, 6000)
        elif ph == "recovery": base *= 4
        return base
    def gt_add(self, ts, conn, action, **kw):
        if conn.label:
            self.gt.append(dict(timestamp=iso(ts), scenario=conn.label, src_ip=conn.ip, cp_id=conn.cp_id, action=action, **kw))

    # -- WebSocket handshake
    def connect(self, ts, ip, cp_id, pw, ua, label=None, hold=True):
        c = Conn(self, cp_id, ip, label)
        t = c.tx(ts, True, "S"); rtt = 0.0004
        ph = self.phase(ts)
        if ph == "saturated" and not label and self.rng.random() < 0.5:     # SYN backlog full: legit retries go unanswered
            for k in (1, 3):
                c.tx(ts + k, True, "S")
            return None
        c.tx(t + rtt, False, "SA"); t = c.tx(t + 2 * rtt, True, "A")
        key = base64.b64encode(self.rng.getrandbits(128).to_bytes(16, "big")).decode()
        auth = base64.b64encode(f"{cp_id}:{pw}".encode()).decode()
        req = (f"GET /ocpp/{cp_id} HTTP/1.1\r\nHost: {T.CSMS_IP}:{T.CSMS_PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: ocpp1.6\r\n"
               f"Authorization: Basic {auth}\r\nUser-Agent: {ua}\r\n\r\n").encode()
        t = c.tx(t + 0.001, True, "PA", req)
        expected = T.password(cp_id) if cp_id in T.CHARGERS else None
        if ph == "saturated": code, reason = 503, "service_unavailable"
        elif expected is None: code, reason = 401, "unknown_charge_point"
        elif pw != expected: code, reason = 401, "bad_password"
        else: code, reason = 101, "ok"
        lat = self.latency(ts)
        tr = t + lat / 1000 if code != 503 else t + 0.02
        if code == 101:
            acc = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
            resp = (f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {acc}\r\n"
                    f"Sec-WebSocket-Protocol: ocpp1.6\r\n\r\n").encode()
        elif code == 401:
            resp = b'HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="csms"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
        else:
            resp = b"HTTP/1.1 503 Service Unavailable\r\nRetry-After: 30\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        t = c.tx(tr, False, "PA", resp)
        self.log("gateway", tr, "ocpp-gateway", "ws_auth", result="success" if code == 101 else "failure", status_code=code,
                 reason=reason, cp_id=cp_id, src_ip=ip, user_agent=ua, latency_ms=round(lat, 1))
        self.stats.append((tr, "conn", lat, code >= 500))
        self.gt_add(ts, c, "ws_connect", status_code=code)
        if code == 101:
            c.alive = True; self.active_ws += 1; return c
        t = c.tx(t + 0.001, False, "FA"); t = c.tx(t + 0.0004, True, "FA"); c.tx(t + 0.0004, False, "A")
        return None

    def drop(self, conn, ts, reason):
        if not conn.alive: return
        conn.alive = False; self.active_ws -= 1
        if reason == "ping_timeout": conn.tx(ts, False, "R")
        else:
            t = conn.tx(ts, True, "FA"); t = conn.tx(t + 0.0004, False, "FA"); conn.tx(t + 0.0004, True, "A")
        self.log("gateway", ts, "ocpp-gateway", "cp_disconnected", cp_id=conn.cp_id, src_ip=conn.ip, reason=reason)

    # -- OCPP-J call (CP -> CSMS)
    def call(self, conn, ts, action, payload, resp):
        if not conn or not conn.alive: return None
        mid = self.uid()
        msg = json.dumps([2, mid, action, payload], separators=(",", ":")).encode()
        t = conn.tx(ts, True, "PA", ws_frame(msg, True, self.rng))
        lat = self.latency(ts)
        legit_victim = not conn.label and self.phase(ts) == "saturated"
        if legit_victim and self.rng.random() < 0.6:                     # CSMS too loaded to answer
            conn.timeouts += 1
            self.log("gateway", ts + 0.05, "ocpp-gateway", "ocpp_message", direction="in", cp_id=conn.cp_id, src_ip=conn.ip,
                     action=action, msg_id=mid, status="timeout", latency_ms=30000)
            self.stats.append((ts, "msg", 30000.0, True))
            if conn.timeouts >= 3: self.drop(conn, ts + 30, "ping_timeout")
            return None
        conn.timeouts = 0
        body = json.dumps([3, mid, resp], separators=(",", ":")).encode()
        tr = conn.tx(t + lat / 1000, False, "PA", ws_frame(body, False, self.rng))
        status = resp.get("status") or resp.get("idTagInfo", {}).get("status") or "ok"
        self.log("gateway", tr, "ocpp-gateway", "ocpp_message", direction="in", cp_id=conn.cp_id, src_ip=conn.ip,
                 action=action, msg_id=mid, status=status, latency_ms=round(lat, 1))
        self.stats.append((tr, "msg", lat, False))
        self.gt_add(ts, conn, action, status=status)
        self._semantic(conn, tr, action, payload, resp)
        return tr

    def _semantic(self, c, ts, action, p, r):
        cp, ip = c.cp_id, c.ip
        info = T.CHARGERS.get(cp, {})
        if action == "BootNotification":
            self.log("gateway", ts, "ocpp-gateway", "cp_boot", cp_id=cp, src_ip=ip, vendor=p["chargePointVendor"], model=p["chargePointModel"],
                     firmware=p["firmwareVersion"], serial=p["chargePointSerialNumber"])
        elif action == "StatusNotification":
            self.log("gateway", ts, "ocpp-gateway", "cp_status", cp_id=cp, src_ip=ip, connector=p["connectorId"], status=p["status"],
                     error_code=p["errorCode"])
        elif action == "Authorize":
            self.log("transactions", ts, "tx-engine", "id_authorize", cp_id=cp, src_ip=ip, id_tag=p["idTag"], status=r["idTagInfo"]["status"])
        elif action == "StartTransaction":
            self.last_meter[r["transactionId"]] = (ts, p["meterStart"])
            self.log("transactions", ts, "tx-engine", "transaction_start", cp_id=cp, src_ip=ip, transaction_id=r["transactionId"],
                     id_tag=p["idTag"], meter_start_wh=p["meterStart"], connector=p["connectorId"])
        elif action == "StopTransaction":
            self.log("transactions", ts, "tx-engine", "transaction_stop", cp_id=cp, src_ip=ip, transaction_id=p["transactionId"],
                     id_tag=p.get("idTag"), meter_stop_wh=p["meterStop"], reason=p.get("reason", "Local"))
        elif action == "MeterValues":
            sv = {s["measurand"]: float(s["value"]) for s in p["meterValue"][0]["sampledValue"]}
            tid = p["transactionId"]; e = sv["Energy.Active.Import.Register"]
            pts, pe = self.last_meter.get(tid, (ts - 60, e))
            self.last_meter[tid] = (ts, e)
            self.log("transactions", ts, "tx-engine", "meter_value", cp_id=cp, src_ip=ip, transaction_id=tid, energy_wh=e,
                     power_w=sv["Power.Active.Import"], delta_wh=round(e - pe, 1), interval_s=round(ts - pts), rated_kw=info.get("kw"))
        elif action == "DataTransfer":
            self.log("gateway", ts, "ocpp-gateway", "data_transfer", cp_id=cp, src_ip=ip, vendor_id=p["vendorId"], message_id=p.get("messageId"),
                     status=r["status"])
