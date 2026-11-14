import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
def box(ax, x, y, w, h, t, c="#e8eef9", ec="#2a4d8f", fs=8.5):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02", fc=c, ec=ec, lw=1.2)); ax.text(x + w / 2, y + h / 2, t, ha="center", va="center", fontsize=fs)
def arr(ax, a, b, t="", c="#444", ls="-"):
    ax.add_patch(FancyArrowPatch(a, b, arrowstyle="-|>", mutation_scale=11, color=c, lw=1.2, ls=ls))
    if t: ax.text((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + .15, t, ha="center", fontsize=7, color=c)
fig, ax = plt.subplots(figsize=(11, 6.2)); ax.set_xlim(0, 22); ax.set_ylim(0, 12.4); ax.axis("off")
ax.add_patch(plt.Rectangle((.2, 5.4), 6.6, 6.5, fc="#f3f8f1", ec="#6a9a5b", ls="--")); ax.text(.4, 11.5, "Charger VLAN 10.10.10.0/24 (field site)", fontsize=8, color="#3d6a30")
for i in range(8):
    box(ax, .5 + (i % 4) * 1.6, 9.2 - (i // 4) * 1.7, 1.4, 1.2, f"CP-0{i+1}\n{'DC50' if i>5 else ('AC22' if i>1 else 'AC7')}", "#e4f2df", "#4d8a3c", 7.5)
box(ax, 2.2, 6.0, 3.0, 1.0, "Site switch / router\n(SPAN port -> sensor)", "#fff7e0", "#b8860b")
ax.add_patch(plt.Rectangle((7.6, 5.4), 5.6, 6.5, fc="#f1f5fc", ec="#2a4d8f", ls="--")); ax.text(7.8, 11.5, "Utility DMZ / Server VLAN 10.10.20.0/24", fontsize=8, color="#2a4d8f")
box(ax, 8.0, 8.8, 4.8, 2.0, "CSMS  10.10.20.10\nOCPP 1.6J gateway :8080 (ws://)\nTransaction engine - Billing\nJSON logs -> /var/log/csms/*.log", "#dce8fa")
box(ax, 8.0, 6.0, 4.8, 1.6, "Wazuh agent (log collection)\ncsms-01 host", "#fff1de", "#c9741a")
ax.add_patch(plt.Rectangle((14.0, 5.4), 7.8, 6.5, fc="#fcf3f5", ec="#a02a47", ls="--")); ax.text(14.2, 11.5, "SOC VLAN 10.10.30.0/24", fontsize=8, color="#a02a47")
box(ax, 14.4, 8.8, 3.4, 2.0, "SIEM\nWazuh manager + indexer\n(or Splunk)\nrules, alerts", "#f9dde4", "#a02a47")
box(ax, 18.2, 8.8, 3.2, 2.0, "Dashboard\n(detect.py / Wazuh UI)\nSOC analyst 10.10.30.5", "#f9dde4", "#a02a47")
box(ax, 14.4, 6.0, 3.4, 1.6, "Wireshark / tshark\nsensor (pcap from SPAN)", "#f9dde4", "#a02a47")
box(ax, 18.2, 6.0, 3.2, 1.6, "Ground-truth labels\n(scenarios.csv, events.jsonl)", "#eeeeee", "#666")
ax.add_patch(plt.Rectangle((.2, .3), 8.0, 4.2, fc="#fff4f4", ec="#c62f4b", ls="--")); ax.text(.4, 4.1, "Attacker (lab only) 10.10.99.66 - rogue Raspberry-Pi implant", fontsize=8, color="#c62f4b")
box(ax, .6, 1.0, 2.2, 2.2, "A1\nCredential & RFID\nbrute force", "#fde3e3", "#c62f4b", 7.5); box(ax, 3.1, 1.0, 2.2, 2.2, "A2\nRogue CP-03 +\nfake transactions", "#fde3e3", "#c62f4b", 7.5); box(ax, 5.6, 1.0, 2.2, 2.2, "A3\nWS / Boot flood\n(DoS)", "#fde3e3", "#c62f4b", 7.5)
ax.add_patch(plt.Rectangle((9.0, .3), 12.8, 4.2, fc="#fafafa", ec="#999", ls=":")); ax.text(9.2, 4.1, "Legend / data flows", fontsize=8)
ax.text(9.4, 3.6, "solid green: OCPP-J over WebSocket/TCP (plaintext, port 8080)\nsolid orange: JSON log shipping (Wazuh agent -> manager, 1514/tcp)\ndashed blue: mirrored packets (SPAN) -> tshark/Wireshark\nred: attack traffic injected from the charger VLAN", fontsize=8, va="top")
arr(ax, (3.7, 7.0), (3.7, 8.9), c="#4d8a3c"); arr(ax, (5.2, 6.7), (8.0, 9.4), c="#4d8a3c"); ax.text(6.0, 8.6, "OCPP-J / WS", fontsize=7, color="#4d8a3c", rotation=45)
arr(ax, (10.4, 8.8), (10.4, 7.6), "logs", c="#c9741a"); arr(ax, (12.8, 6.8), (14.4, 9.2), "agent 1514", c="#c9741a")
arr(ax, (17.8, 9.8), (18.2, 9.8), c="#a02a47"); arr(ax, (5.2, 6.2), (14.4, 5.75), c="#2a4d8f", ls="--"); ax.text(9.0, 5.55, "SPAN copy -> sensor", fontsize=7, color="#2a4d8f")
arr(ax, (4.0, 3.3), (4.0, 6.0), "attacks", c="#c62f4b")
ax.set_title("Figure 1 - Architecture of the EV-charging SOC prototype", fontsize=11, loc="left"); fig.tight_layout(); fig.savefig("figures/architecture.png", dpi=150); plt.close(fig)

fig, ax = plt.subplots(figsize=(8, 4.8)); ax.axis("off"); ax.set_xlim(0, 10); ax.set_ylim(0, 8)
L = [("Application", "OCPP 1.6-J  [2,id,Action,{payload}]  - BootNotification, Authorize, StartTransaction, MeterValues, ...", "#dce8fa"),
     ("Session", "WebSocket (RFC 6455) text frames, sub-protocol 'ocpp1.6', client frames masked", "#e4f2df"),
     ("Authentication", "HTTP/1.1 Upgrade + Basic Auth (cpId:password) - base64 only, NO TLS in this deployment", "#fde3e3"),
     ("Transport", "TCP :8080  (3-way handshake, persistent connection per charger)", "#fff7e0"),
     ("Network", "IPv4  charger VLAN 10.10.10.0/24 -> CSMS 10.10.20.10", "#f3e8fa"),
     ("Link / Physical", "Ethernet (site switch) / 4G backhaul in the field - simulated as Ethernet", "#eeeeee")]
for i, (n, t, c) in enumerate(L):
    box(ax, .2, 7 - i * 1.25, 1.9, 1.0, n, c, "#555", 8); box(ax, 2.2, 7 - i * 1.25, 7.6, 1.0, t, c, "#555", 7.5)
ax.set_title("Figure 2 - Protocol stack used between charger and CSMS", fontsize=11, loc="left"); fig.tight_layout(); fig.savefig("figures/protocol_stack.png", dpi=150); plt.close(fig)
