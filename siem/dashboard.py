"""Build the SOC dashboard (self-contained HTML + PNG panels) from CSMS logs and detect.py output."""
import base64, io, json, os, sys
import pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt, matplotlib.dates as mdates
sys.path.insert(0, os.path.dirname(__file__))
import detect

ROOT, FIG = detect.ROOT, f"{detect.ROOT}/dashboard"
os.makedirs(FIG, exist_ok=True)
df = detect.load(); al = pd.read_csv(f"{detect.OUT}/alerts.csv", parse_dates=["time"]); ev = json.load(open(f"{detect.OUT}/evaluation.json"))
sc = pd.read_csv(f"{ROOT}/ground_truth/scenarios.csv", parse_dates=["start_utc", "end_utc"])
C = dict(A1="#2a6fdb", A2="#e08a00", A3="#c62f4b", base="#8a93a0", ok="#2e9d6b")
plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.alpha": .25, "figure.dpi": 130})
fmt = mdates.DateFormatter("%H:%M")

def shade(ax):
    for _, s in sc.iterrows():
        ax.axvspan(s.start_utc, s.end_utc, color=C[s.scenario], alpha=.10, lw=0)
        ax.text(s.start_utc, 1.01, s.scenario, transform=ax.get_xaxis_transform(), color=C[s.scenario], fontsize=8, weight="bold")
    ax.xaxis.set_major_formatter(fmt); ax.set_xlim(df.ts.min(), df.ts.max())

def save(fig, name): fig.tight_layout(); fig.savefig(f"{FIG}/{name}.png"); plt.close(fig)

ws = df[df.event == "ws_auth"]; au = df[df.event == "id_authorize"]; mv = df[df.event == "meter_value"].copy(); sh = df[df.event == "service_health"]

# 1 alert timeline
fig, ax = plt.subplots(figsize=(7, 2.6))
al["bin"] = al.time.dt.floor("1min"); al["grp"] = al.scenario_hint.str[:2]
for g, d in al.groupby("grp"):
    cnt = d.groupby("bin").size(); ax.bar(cnt.index, cnt.values, width=.0006 * 1.4, color=C.get(g, C["base"]), label=g)
shade(ax); ax.set_title("Alerts per minute (colour = scenario hint)", loc="left"); ax.legend(frameon=False, ncol=3, loc="upper left"); save(fig, "01_alerts")

# 2 auth failures
fig, ax = plt.subplots(figsize=(7, 2.6))
f = ws[ws.result == "failure"]; f = f[f.status_code == 401]
for ip, d in f.groupby("src_ip"):
    c = d.groupby(d.ts.dt.floor("1min")).size(); ax.bar(c.index, c.values, width=.0006, color=C["A1"] if ip == "10.10.99.66" else C["base"], label=ip)
ax.set_title("HTTP 401 on WebSocket handshake per minute, by source", loc="left"); ax.legend(frameon=False); shade(ax); save(fig, "02_ws401")

# 3 RFID outcomes
fig, ax = plt.subplots(figsize=(7, 2.6))
x = au.groupby([au.ts.dt.floor("1min"), au.status == "Accepted"]).size().unstack(fill_value=0)
ax.bar(x.index, x.get(True, 0), width=.0006, color=C["ok"], label="Accepted"); ax.bar(x.index, x.get(False, 0), width=.0006, bottom=x.get(True, 0), color=C["A1"], label="Rejected")
ax.set_title("Authorize outcomes per minute (RFID idTag)", loc="left"); ax.legend(frameon=False); shade(ax); save(fig, "03_authorize")

# 4 power vs rated
mv["ratio"] = mv.power_w / (mv.rated_kw * 1000)
fig, ax = plt.subplots(figsize=(7, 2.6))
n = mv[mv.ratio <= 1.2]; b = mv[mv.ratio > 1.2]
ax.scatter(n.ts, n.ratio, s=6, color=C["base"], label="normal"); ax.scatter(b.ts, b.ratio, s=14, color=C["A2"], label="over rating")
ax.axhline(1.2, color="k", ls="--", lw=.8); ax.set_yscale("log"); ax.set_ylabel("reported / rated power")
ax.set_title("MeterValues power relative to charger rating", loc="left"); ax.legend(frameon=False, loc="upper left"); shade(ax); save(fig, "04_power")

# 5 energy register per tx
fig, ax = plt.subplots(figsize=(7, 2.6))
for tid, d in mv.groupby("transaction_id"):
    if d.src_ip.iloc[0] == "10.10.99.66": ax.plot((d.ts - d.ts.min()).dt.total_seconds() / 60, d.energy_wh / 1000, color=C["A2"], lw=1.8, label=f"rogue tx {int(tid)} ({d.cp_id.iloc[0]})")
    elif tid % 3 == 0: ax.plot((d.ts - d.ts.min()).dt.total_seconds() / 60, (d.energy_wh - d.energy_wh.min()) / 1000, color=C["base"], lw=.7, alpha=.7)
ax.set_xlabel("minutes since first sample"); ax.set_ylabel("kWh"); ax.set_title("Energy register: rogue session vs. normal sessions (grey)", loc="left"); ax.legend(frameon=False, loc="upper left"); save(fig, "05_energy")

# 6 handshakes per 10 s
fig, ax = plt.subplots(figsize=(7, 2.6))
w = ws.assign(b=ws.ts.dt.floor("10s")).groupby(["b", "status_code"]).size().unstack(fill_value=0)
bottom = 0
for code, col in ((101, C["ok"]), (401, C["A1"]), (503, C["A3"])):
    if code in w: ax.bar(w.index, w[code], width=.0001, bottom=bottom, color=col, label=str(code)); bottom = bottom + w[code]
ax.set_title("WebSocket handshakes per 10 s by HTTP status", loc="left"); ax.legend(frameon=False, ncol=3); shade(ax); save(fig, "06_handshakes")

# 7 CSMS health
fig, axs = plt.subplots(1, 1, figsize=(7, 2.6)); ax = axs
ax.plot(sh.ts, sh.cpu_pct, color=C["A3"], label="CPU %"); ax.set_ylabel("CPU %")
a2 = ax.twinx(); a2.plot(sh.ts, sh.p95_latency_ms, color=C["A2"], lw=1, label="p95 latency ms"); a2.set_yscale("log"); a2.set_ylabel("p95 ms"); a2.grid(False)
ax.set_title("CSMS health: CPU and p95 latency", loc="left"); shade(ax); save(fig, "07_health")

# 8 fleet availability
fig, ax = plt.subplots(figsize=(7, 2.6))
hb = df[(df.event == "ocpp_message") & (df.action == "Heartbeat") & (df.status == "ok")]
c = hb.groupby(hb.ts.dt.floor("1min")).size(); ax.plot(c.index, c.values, color=C["ok"], label="answered heartbeats / min")
t = df[(df.event == "ocpp_message") & (df.status == "timeout")]; ct = t.groupby(t.ts.dt.floor("1min")).size(); ax.bar(ct.index, ct.values, width=.0006, color=C["A3"], label="timed-out requests")
ax.set_title("Fleet availability: heartbeats answered vs timeouts (8 chargers)", loc="left"); ax.legend(frameon=False, loc="lower left"); shade(ax); save(fig, "08_fleet")

# 9 CSMS connections per charger-IP
fig, ax = plt.subplots(figsize=(7, 2.6))
ax.plot(sh.ts, sh.active_ws, color=C["A3"]); ax.set_title("Active WebSocket sessions on CSMS (8 chargers = normal)", loc="left"); shade(ax); save(fig, "09_active_ws")

def b64(n): return base64.b64encode(open(f"{FIG}/{n}.png", "rb").read()).decode()
tiles = [("Total alerts", ev["overall"]["total_alerts"]), ("Scenarios detected", ev["overall"]["scenarios_detected"]),
         ("Alert precision", f"{ev['overall']['alert_precision']:.0%}"), ("Median time-to-detect", f"{pd.Series([ev[k]['time_to_detect_s'] for k in ('A1','A2','A3')]).median():.0f} s")]
rows = "".join(f"<tr><td>{r.time:%H:%M:%S}</td><td>{r.rule_id}</td><td>{r.rule}</td><td>{r.entity}</td><td class=l>{r.detail}</td><td>{r.severity}</td></tr>" for r in al.itertuples())
erows = "".join(f"<tr><td>{k}</td><td>{ev[k]['name']}</td><td>{ev[k]['time_to_detect_s']} s</td><td>{ev[k]['indicator_recall']:.0%}</td><td>{ev[k]['alerts_in_window']}</td></tr>" for k in ("A1", "A2", "A3"))
panels = "".join(f"<figure><img src='data:image/png;base64,{b64(n)}'></figure>" for n in ["01_alerts", "02_ws401", "03_authorize", "04_power", "05_energy", "06_handshakes", "07_health", "08_fleet", "09_active_ws"])
html = f"""<!doctype html><meta charset=utf-8><title>EV Charging SOC Dashboard</title>
<style>:root{{--bg:#f6f7f9;--fg:#1c2330;--card:#fff;--bd:#dde1e8}}@media(prefers-color-scheme:dark){{:root{{--bg:#12161d;--fg:#e6e9ef;--card:#1b212b;--bd:#2c3442}}}}
body{{background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif;margin:0;padding:20px 16px}}h1{{margin:0 0 4px}}.sub{{opacity:.7;margin-bottom:16px}}
.tiles{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}}.tile{{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:12px}}.tile b{{display:block;font-size:26px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:12px}}figure{{margin:0;background:#fff;border:1px solid var(--bd);border-radius:8px;padding:6px}}img{{width:100%}}
table{{border-collapse:collapse;width:100%;background:var(--card);margin:10px 0 20px;font-size:12px}}td,th{{border:1px solid var(--bd);padding:4px 7px;text-align:left}}.l{{max-width:520px}}h2{{margin-top:24px}}</style>
<h1>EV Charging Ecosystem SOC</h1><div class=sub>Simulated 8-charger site, 2026-11-04 08:00-10:00 UTC. Shaded bands = ground-truth attack windows (A1 brute force, A2 rogue charger, A3 flood).</div>
<div class=tiles>{''.join(f'<div class=tile>{k}<b>{v}</b></div>' for k, v in tiles)}</div>
<div class=grid>{panels}</div>
<h2>Detection evaluation</h2><table><tr><th>Scenario<th>Name<th>Time to detect<th>Indicator recall<th>Alerts</tr>{erows}</table>
<h2>Alerts</h2><table><tr><th>Time (UTC)<th>Rule<th>Name<th>Entity<th>Detail<th>Sev</tr>{rows}</table>"""
open(f"{FIG}/dashboard.html", "w").write(html); print("dashboard written")
