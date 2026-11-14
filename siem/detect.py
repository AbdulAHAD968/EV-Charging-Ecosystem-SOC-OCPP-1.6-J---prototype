"""Detection engine: executes the same logic as siem/wazuh/local_rules.xml and siem/splunk/queries.spl
over the CSMS logs, scores the alerts against ground truth and writes alerts.csv / evaluation.json / query_results.txt."""
import json, os, sys
import pandas as pd

ROOT = os.path.join(os.path.dirname(__file__), "..", "output")
OUT = f"{ROOT}/siem"; os.makedirs(OUT, exist_ok=True)
INV = json.load(open(f"{ROOT}/ground_truth/inventory.json"))
KNOWN_IPS = {v["ip"]: k for k, v in INV.items()}
FW = "2.4.1"

def load():
    rows = []
    for f in ("ocpp_gateway", "transactions", "system"):
        rows += [json.loads(l) for l in open(f"{ROOT}/logs/csms/{f}.log")]
    df = pd.DataFrame(rows); df["ts"] = pd.to_datetime(df["timestamp"], utc=True)
    return df.sort_values("ts").reset_index(drop=True)

ALERTS = []
def alert(rid, name, scen, ts, entity, detail, count=1, sev=10):
    ALERTS.append(dict(rule_id=rid, rule=name, scenario_hint=scen, time=ts, entity=entity, count=count, severity=sev, detail=detail))

def burst(ts, n, window, cooldown):
    """Sliding window: yield (time, count) the first time n events fall inside `window` s; re-arm after a quiet `cooldown` s."""
    ts = sorted(ts); i = 0; last_alert = None; last_ev = None
    for j, t in enumerate(ts):
        while (t - ts[i]).total_seconds() > window: i += 1
        c = j - i + 1
        if last_ev is not None and (t - last_ev).total_seconds() > cooldown: last_alert = None
        last_ev = t
        if c >= n and last_alert is None:
            last_alert = t; yield t, c

def run(df):
    g = lambda **kw: df[(df[list(kw)] == pd.Series(kw)).all(axis=1)]
    ws = df[df.event == "ws_auth"]
    # --- A1
    for ip, d in ws[ws.result == "failure"].groupby("src_ip"):
        for t, c in burst(d.ts, 10, 120, 120):
            alert(100110, "WebSocket credential brute force", "A1", t, ip, f"{c} failed handshakes in 2 min, {d.cp_id.nunique()} charger IDs targeted", c, 10)
    seen = set()
    for _, r in ws[(ws.result == "success") & (ws.src_ip.map(KNOWN_IPS).fillna("") != ws.cp_id)].iterrows():
        k = (r.cp_id, r.src_ip, r.ts.floor("5min"))
        if k in seen: continue
        seen.add(k)
        alert(100111, "Session from non-registered address", "A1/A2", r.ts, r.src_ip,
              f"{r.cp_id} authenticated from {r.src_ip} (inventory: {INV[r.cp_id]['ip'] if r.cp_id in INV else 'n/a'}), UA={r.user_agent}", 1, 13)
    au = df[(df.event == "id_authorize")]
    rej = au[au.status != "Accepted"]; rej_alerts = {}
    for cp, d in rej.groupby("cp_id"):
        for t, c in burst(d.ts, 10, 120, 120):
            alert(100112, "RFID idTag guessing", "A1", t, cp, f"{c} rejected idTags in 2 min at {cp}", c, 10); rej_alerts[cp] = t
    for cp, t0 in rej_alerts.items():
        a = au[(au.cp_id == cp) & (au.status == "Accepted") & (au.ts > t0) & (au.ts < t0 + pd.Timedelta("5min"))]
        for _, r in a.iterrows():
            alert(100113, "idTag accepted after guessing burst", "A1", r.ts, cp, f"{r.id_tag} accepted at {cp} after rejected-tag burst: probable cloned card", 1, 13)
    # --- A2
    for _, r in df[(df.event == "cp_boot") & (df.firmware != FW)].iterrows():
        alert(100120, "Unexpected firmware / serial", "A2", r.ts, r.src_ip, f"{r.cp_id} booted with firmware {r.firmware}, serial {r.serial}", 1, 12)
    mv = df[df.event == "meter_value"].copy()
    hi = mv[mv.power_w > 1.2 * mv.rated_kw * 1000]
    for tid, d in hi.groupby("transaction_id"):
        r = d.iloc[0]
        alert(100121, "Implausible power", "A2", r.ts, r.src_ip, f"tx {int(tid)} on {r.cp_id} rated {r.rated_kw} kW reported up to {d.power_w.max()/1000:.0f} kW in {len(d)} samples", len(d), 12)
    for _, r in mv[mv.delta_wh < 0].iterrows():
        alert(100122, "Energy register decreased", "A2", r.ts, r.src_ip, f"tx {int(r.transaction_id)} on {r.cp_id}: delta {r.delta_wh:.0f} Wh", 1, 12)
    for _, r in df[(df.event == "data_transfer") & (df.status == "UnknownVendorId")].iterrows():
        alert(100123, "DataTransfer probing", "A2", r.ts, r.src_ip, f"{r.cp_id} sent vendor={r.vendor_id} msg={r.message_id}", 1, 9)
    ts_ = df[df.event == "transaction_start"]
    for _, r in ts_[ts_.meter_start_wh == 0].iterrows():
        alert(100124, "meterStart = 0", "A2", r.ts, r.src_ip, f"tx {int(r.transaction_id)} on {r.cp_id} started with meterStart=0", 1, 12)
    # concurrent use of one idTag on two chargers (Splunk-only rule in the Wazuh set)
    open_tx = {}
    stops = df[df.event == "transaction_stop"].set_index("transaction_id").ts.to_dict()
    for _, r in ts_.iterrows():
        for (tag, cp), end in list(open_tx.items()):
            if tag == r.id_tag and cp != r.cp_id and end > r.ts:
                alert(100125, "Concurrent idTag use", "A2", r.ts, r.id_tag, f"idTag {r.id_tag} active on {cp} and {r.cp_id} simultaneously", 1, 13)
        open_tx[(r.id_tag, r.cp_id)] = stops.get(r.transaction_id, r.ts + pd.Timedelta("1h"))
    # --- A3
    for ip, d in ws.groupby("src_ip"):
        for t, c in burst(d.ts, 100, 30, 60):
            alert(100130, "Connection flood", "A3", t, ip, f"{c} WebSocket handshakes in 30 s from {ip}", c, 12)
    for t, c in burst(ws[ws.status_code == 503].ts, 20, 60, 60):
        alert(100131, "CSMS returning 503", "A3", t, "csms-01", f"{c} HTTP 503 in 60 s", c, 12)
    dis = df[(df.event == "cp_disconnected") & (df.reason == "ping_timeout")]
    for t, c in burst(dis.ts, 3, 180, 180):
        alert(100132, "Fleet heartbeat loss", "A3", t, "fleet", f"{c} chargers dropped by ping timeout in 3 min", c, 12)
    sh = df[df.event == "service_health"]
    for t, c in burst(sh[sh.cpu_pct >= 90].ts, 1, 15, 120):
        r = sh[sh.ts == t].iloc[0]
        alert(100133, "CSMS resource exhaustion", "A3", t, "csms-01", f"cpu={r.cpu_pct}% p95={r.p95_latency_ms} ms active_ws={int(r.active_ws)}", 1, 10)
    boots = df[df.event == "cp_boot"]
    for ip, d in boots.groupby("src_ip"):
        for t, c in burst(d.ts, 20, 30, 60):
            alert(100135, "BootNotification flood", "A3", t, ip, f"{c} BootNotifications in 30 s from {ip}", c, 12)
    return pd.DataFrame(ALERTS).sort_values("time").reset_index(drop=True)

def evaluate(al):
    sc = pd.read_csv(f"{ROOT}/ground_truth/scenarios.csv", parse_dates=["start_utc", "end_utc"])
    expected = {"A1": {100110, 100111, 100112, 100113}, "A2": {100111, 100120, 100121, 100122, 100123, 100124, 100125},
                "A3": {100130, 100131, 100132, 100133, 100135}}
    res = {}; tp_idx = set()
    for _, s in sc.iterrows():
        a, b = s.start_utc, s.end_utc + pd.Timedelta("90s")
        inwin = (al.time >= a) & (al.time <= b)
        m = al[inwin & al.scenario_hint.str.contains(s.scenario)]
        fired = set(m.rule_id); exp = expected[s.scenario]
        # an alert in the window is a true positive if it names the attacker, the shared service or a targeted asset
        tp_idx |= set(al[inwin & (al.scenario_hint.str.contains(s.scenario) | al.entity.isin([s.attacker_ip, "csms-01", "fleet", "CP-05", "CP-03"]))].index)
        res[s.scenario] = dict(name=s["name"], start=str(s.start_utc), first_alert=str(m.time.min()) if len(m) else None,
                               time_to_detect_s=round((m.time.min() - s.start_utc).total_seconds(), 1) if len(m) else None,
                               rules_expected=sorted(exp), rules_fired=sorted(fired), indicator_recall=round(len(fired & exp) / len(exp), 2),
                               alerts_in_window=len(m), detected=bool(len(m)))
    fp = al[~al.index.isin(tp_idx)]
    res["overall"] = dict(total_alerts=len(al), true_positive_alerts=len(tp_idx), false_positive_alerts=len(fp),
                          alert_precision=round(len(tp_idx) / max(1, len(al)), 3), scenarios_detected=f"{sum(v['detected'] for k, v in res.items() if k != 'overall')}/3")
    return res, fp

def hunts(df):
    out = []; P = lambda t, d: out.append(f"\n=== {t} ===\n{d.to_string() if hasattr(d, 'to_string') else d}")
    ws = df[df.event == "ws_auth"]
    P("H1  ws_auth by source / result (top 8)", ws.groupby(["src_ip", "result"]).size().sort_values(ascending=False).head(8))
    P("H2  Failed handshakes before 08:50 by src_ip", ws[(ws.result == "failure") & (ws.ts < "2026-11-04T08:50Z")].groupby(["src_ip", "status_code"]).size())
    au = df[df.event == "id_authorize"]
    P("H3  idTag outcomes per charger (non-Accepted)", au[au.status != "Accepted"].groupby(["cp_id", "status"]).size())
    P("H4  Sessions from non-registered IP", ws[(ws.result == "success") & (ws.src_ip.map(KNOWN_IPS).fillna("") != ws.cp_id)].groupby(["cp_id", "src_ip", "user_agent"]).size())
    b = df[df.event == "cp_boot"]
    P("H5  Firmware versions seen", b.groupby(["cp_id", "firmware", "serial"]).size().loc[lambda s: ~s.index.get_level_values(1).isin([FW])])
    mv = df[df.event == "meter_value"].copy(); mv["ratio"] = mv.power_w / (mv.rated_kw * 1000)
    P("H6  Meter samples with power > 1.2 x rated", mv[mv.ratio > 1.2].groupby(["cp_id", "src_ip", "transaction_id"]).agg(n=("ratio", "size"), max_kw=("power_w", lambda x: x.max() / 1000), max_ratio=("ratio", "max")))
    P("H7  Normal power/rated ratio (baseline)", mv[mv.ratio <= 1.2].ratio.describe())
    P("H8  Handshake status per 1-min bin around A3 (09:36-09:48)", ws[(ws.ts >= "2026-11-04T09:36Z") & (ws.ts < "2026-11-04T09:48Z")].groupby([ws.ts.dt.floor("1min").dt.strftime("%H:%M"), "status_code"]).size().unstack(fill_value=0))
    sh = df[df.event == "service_health"]
    P("H9  CSMS health peak (09:30-09:50)", (lambda x: x.set_index(x.ts.dt.strftime("%H:%M:%S")))(sh[(sh.ts >= "2026-11-04T09:30Z") & (sh.ts < "2026-11-04T09:50Z")])[["active_ws", "cpu_pct", "p95_latency_ms", "errors_5xx"]].iloc[::4])
    P("H10 ping_timeout disconnects", df[(df.event == "cp_disconnected") & (df.reason == "ping_timeout")][["timestamp", "cp_id", "src_ip"]])
    return "\n".join(out)

if __name__ == "__main__":
    df = load(); al = run(df); res, fp = evaluate(al)
    al.to_csv(f"{OUT}/alerts.csv", index=False); json.dump(res, open(f"{OUT}/evaluation.json", "w"), indent=2, default=str)
    open(f"{OUT}/query_results.txt", "w").write(hunts(df))
    print(al[["time", "rule_id", "rule", "entity", "count"]].to_string()); print(json.dumps(res, indent=1, default=str)); print("FALSE POSITIVES:\n", fp[["time", "rule_id", "entity"]])
