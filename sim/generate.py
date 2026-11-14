"""Run the whole simulation and write pcap, logs and ground truth to output/."""
import csv, json, os, sys, math, random
sys.path.insert(0, os.path.dirname(__file__))
import topology as T
from world import World, iso
import scenarios as S
from scapy.all import PcapWriter

OUT = os.path.join(os.path.dirname(__file__), "..", "output")

def health(w):
    """CSMS service_health records every 15 s derived from the traffic the gateway actually handled."""
    rng = random.Random(7); step = 15
    for k in range(T.DURATION // step):
        a = T.T0 + k * step; b = a + step
        ev = [s for s in w.stats if a <= s[0] < b]
        msgs = sum(1 for e in ev if e[1] == "msg"); conns = sum(1 for e in ev if e[1] == "conn")
        lat = sorted(e[2] for e in ev) or [18.0]
        p95 = lat[int(0.95 * (len(lat) - 1))]
        err5 = sum(1 for e in ev if e[3])
        cpu = min(99.0, 6 + 1.0 * msgs / step + 3.6 * conns / step + rng.uniform(-1, 1))
        active = w.active_hist[k]
        w.log("system", b - 0.01, "csms-health", "service_health", active_ws=active, msgs_per_s=round(msgs / step, 2), conns_per_s=round(conns / step, 2),
              p95_latency_ms=round(p95, 1), errors_5xx=err5, cpu_pct=round(cpu, 1))

def main(seed=1337):
    w = World(seed); os.makedirs(OUT, exist_ok=True)
    w.active_hist = []
    # snapshot active websocket count every 15 s
    for k in range(T.DURATION // 15):
        w.at(T.T0 + k * 15 + 14.9, lambda: w.active_hist.append(w.active_ws))
    S.normal(w); S.attack1(w); S.attack2(w); S.attack3(w)
    w.run(); health(w)
    os.makedirs(f"{OUT}/logs/csms", exist_ok=True); os.makedirs(f"{OUT}/pcap", exist_ok=True); os.makedirs(f"{OUT}/ground_truth", exist_ok=True)
    for name, fn in (("gateway", "ocpp_gateway.log"), ("transactions", "transactions.log"), ("system", "system.log")):
        with open(f"{OUT}/logs/csms/{fn}", "w") as f:
            for _, r in sorted(w.logs[name], key=lambda x: x[0]): f.write(json.dumps(r) + "\n")
    w.pkts.sort(key=lambda p: p.time)
    pw = PcapWriter(f"{OUT}/pcap/ev_soc_full.pcap", sync=False)
    for p in w.pkts: pw.write(p)
    pw.close()
    with open(f"{OUT}/ground_truth/events.jsonl", "w") as f:
        for r in sorted(w.gt, key=lambda r: r["timestamp"]): f.write(json.dumps(r) + "\n")
    names = {"A1": "Authentication brute force (WebSocket credentials + RFID idTag guessing)",
             "A2": "Rogue charger impersonation with abnormal/fraudulent transactions",
             "A3": "Connection / BootNotification flood causing CSMS service disruption"}
    with open(f"{OUT}/ground_truth/scenarios.csv", "w", newline="") as f:
        wr = csv.writer(f); wr.writerow(["scenario", "name", "start_utc", "end_utc", "attacker_ip", "target"])
        for k, (a, b) in S.WIN.items():
            wr.writerow([k, names[k], iso(a), iso(b), T.ATTACKER_IP, "CSMS 10.10.20.10:8080 / CP-03,CP-05" ])
    json.dump({cp: dict(ip=i["ip"], rated_kw=i["kw"], model=i["model"], firmware=T.FIRMWARE) for cp, i in T.CHARGERS.items()},
              open(f"{OUT}/ground_truth/inventory.json", "w"), indent=2)
    print("packets:", len(w.pkts), {k: len(v) for k, v in w.logs.items()}, "gt events:", len(w.gt))

if __name__ == "__main__":
    main()
