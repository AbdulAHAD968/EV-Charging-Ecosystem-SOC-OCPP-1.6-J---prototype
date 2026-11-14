# EV Charging Ecosystem SOC (OCPP 1.6-J) - prototype
Run `./run_all.sh` (needs python3 + scapy, pandas, matplotlib, python-docx, tshark). ~3 min.

- `sim/` simulator: 8 chargers + CSMS, normal traffic, attacks A1 (brute force), A2 (rogue charger), A3 (flood)
- `output/pcap/` full + per-attack pcaps (open in Wireshark) - `output/logs/csms/` JSON logs - `output/ground_truth/` labels
- `siem/splunk/` Splunk app (index, lookup, saved searches, dashboard) and SPL query file - `siem/detect.py` engine - `siem/dashboard.py`
- `siem/wazuh/` an equivalent Wazuh rule set, included as an alternative SIEM implementation (not the one used for this submission)
- `output/dashboard/dashboard.html` dashboard - `output/evidence/` tshark evidence - `output/siem/` alerts + evaluation
- `docs/EV_SOC_Report.docx` (source `docs/report.md`)

The assignment allows either Wazuh or Splunk; this submission uses Splunk, fully deployed and verified live (see below). The Wazuh rules in `siem/wazuh/` implement the same detection logic and are provided for reference or for a site that prefers Wazuh, but were not the path run for this submission.

## Splunk - VERIFIED LIVE (installed at /opt/splunk, web UI http://localhost:8000)
App `siem/splunk/ev_soc_app` is installed at `/opt/splunk/etc/apps/ev_soc` (index `ev_soc`, JSON sourcetype `ev_json`, lookup `ev_inventory`, 5 saved searches, dashboard "EV Charging SOC"). Logs were copied to `/opt/splunk_data/ev_soc/` (monitored) and confirmed ingested: `index=ev_soc | stats count by event` returns 16,559 events across ws_auth, cp_boot, cp_disconnected, ocpp_message, meter_value, service_health, id_authorize, transaction_start/stop, data_transfer, admin_login, cp_status. All 5 saved searches were executed through the Splunk REST API against this live index and each fired on the correct attack (A1 brute force, A1 RFID guessing, A2 rogue session, A2 implausible power, A3 connection flood) - see `docs/report.md` section 7 for the exact numbers returned by Splunk. Login: admin / (see team's Splunk credentials - not stored in this repo).

## Screenshots
`docs/screenshots/` has 10 screenshots: 5 from the actual Wireshark GUI (applied filters, packet lists, hex dumps) and 5 from the live Splunk web UI (home page, event-count search, the full dashboard, and two attack-detection searches). They were captured with `docs/capture_screenshots.sh` (needs `SPLUNK_ADMIN_PASSWORD` set, Xvfb, and chromedriver; it runs Wireshark and a headless Chromium on a private virtual display so the real desktop is untouched) and are already embedded in `docs/EV_SOC_Report.docx`.
