#!/usr/bin/env bash
# Captures the real Wireshark GUI and live Splunk dashboard screenshots used in the report.
# Requires: Xvfb, wireshark, chromium, chromedriver, python3-selenium, a running Splunk instance
# with the ev_soc app and data loaded (see README.md), and the Splunk admin password.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=docs/screenshots; mkdir -p "$OUT"
SPLUNK_PASS="${SPLUNK_ADMIN_PASSWORD:?set SPLUNK_ADMIN_PASSWORD}"

# start a private virtual display so the real desktop is untouched
Xvfb :99 -screen 0 1600x1000x24 &
XVFB_PID=$!
sleep 2
trap 'kill $XVFB_PID 2>/dev/null' EXIT

shot_wireshark() {
  local file="$1" filter="$2" out="$3" wait="${4:-10}"
  DISPLAY=:99 wireshark -r "$file" -Y "$filter" >/tmp/ws.log 2>&1 &
  local pid=$!
  sleep "$wait"
  DISPLAY=:99 import -window root "$OUT/$out"
  kill $pid 2>/dev/null || true
  sleep 1
}

cd output/pcap
shot_wireshark ev_soc_A1.pcap 'http.response.code==401 && ip.dst==10.10.99.66' wireshark_01_a1_401.png
# Note: this filter needs the TCP stream's handshake, which the A1 slice does not contain,
# so it is applied to the full capture with a local-timezone frame.time window instead.
shot_wireshark ev_soc_full.pcap 'ip.src==10.10.10.15 && websocket.payload.text contains "Authorize" && frame.time >= "2026-11-04 03:44:00" && frame.time < "2026-11-04 03:50:00"' wireshark_02_a1_rfid.png 40
shot_wireshark ev_soc_A2.pcap 'ip.addr==10.10.99.66 && websocket' wireshark_03_a2_rogue.png
shot_wireshark ev_soc_A2.pcap 'websocket.payload.text contains "Power.Active"' wireshark_04_a2_power.png
shot_wireshark ev_soc_A3.pcap 'tcp.flags.syn==1 && tcp.flags.ack==0 && ip.src==10.10.99.66' wireshark_05_a3_syn.png
cd ../..

python3 - "$SPLUNK_PASS" "$OUT" <<'PYEOF'
import sys, time, urllib.parse
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.keys import Keys

password, out = sys.argv[1], sys.argv[2]
opts = Options()
opts.binary_location = "/usr/bin/chromium"
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--window-size=1600,1000")
d = webdriver.Chrome(service=Service(executable_path="/usr/bin/chromedriver"), options=opts)
d.set_window_size(1600, 1000)
d.get("http://localhost:8000/en-US/account/login")
time.sleep(3)
d.find_element("name", "username").send_keys("admin")
p = d.find_element("name", "password")
p.send_keys(password)
p.send_keys(Keys.RETURN)
time.sleep(5)
d.save_screenshot(f"{out}/splunk_01_home.png")

q1 = "search index=ev_soc | stats count by event"
d.get(f"http://localhost:8000/en-US/app/ev_soc/search?q={urllib.parse.quote(q1)}&earliest=0&latest=now")
time.sleep(14)
d.save_screenshot(f"{out}/splunk_02_search_counts.png")

d.get("http://localhost:8000/en-US/app/ev_soc/ev_soc_dashboard")
time.sleep(11)
d.save_screenshot(f"{out}/splunk_03_dashboard.png")

q_a1 = "search index=ev_soc event=ws_auth result=failure | bin _time span=2m | stats count dc(cp_id) as ids by _time src_ip | where count>=10"
d.get(f"http://localhost:8000/en-US/app/ev_soc/search?q={urllib.parse.quote(q_a1)}&earliest=0&latest=now")
time.sleep(9)
d.save_screenshot(f"{out}/splunk_04_a1_bruteforce.png")

q_a3 = "search index=ev_soc event=ws_auth | bin _time span=30s | stats count by _time src_ip | where count>=100"
d.get(f"http://localhost:8000/en-US/app/ev_soc/search?q={urllib.parse.quote(q_a3)}&earliest=0&latest=now")
time.sleep(9)
d.save_screenshot(f"{out}/splunk_05_a3_flood.png")
d.quit()
print("Splunk screenshots done")
PYEOF

echo "all screenshots written to $OUT"
