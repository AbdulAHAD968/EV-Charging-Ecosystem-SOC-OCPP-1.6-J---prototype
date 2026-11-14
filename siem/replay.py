"""Replay the CSMS logs into the files monitored by Wazuh/Splunk so they are ingested like live data.
   usage: python3 replay.py --dest /var/log/csms [--speed 20] [--from 08:30 --to 09:50]
   speed=1 is real time; with speed N the frequency windows of the Wazuh rules shrink N-fold, so thresholds are still reached."""
import argparse, glob, heapq, json, os, time
ap = argparse.ArgumentParser(); ap.add_argument("--src", default=os.path.join(os.path.dirname(__file__), "..", "output", "logs", "csms"))
ap.add_argument("--dest", required=True); ap.add_argument("--speed", type=float, default=20); ap.add_argument("--from", dest="t0", default="00:00"); ap.add_argument("--to", dest="t1", default="23:59")
a = ap.parse_args(); os.makedirs(a.dest, exist_ok=True)
rows = []
for f in glob.glob(f"{a.src}/*.log"):
    for l in open(f):
        r = json.loads(l); rows.append((r["timestamp"], os.path.basename(f), l))
rows = sorted(r for r in rows if a.t0 <= r[0][11:16] <= a.t1)
outs = {n: open(os.path.join(a.dest, n), "a", buffering=1) for n in {r[1] for r in rows}}
from datetime import datetime
ts = lambda s: datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%fZ").timestamp()
base = ts(rows[0][0]); start = time.time()
for stamp, name, line in rows:
    d = (ts(stamp) - base) / a.speed - (time.time() - start)
    if d > 0: time.sleep(d)
    outs[name].write(line)
print("replayed", len(rows), "events")
