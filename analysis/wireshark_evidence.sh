#!/usr/bin/env bash
# Reproduces every Wireshark/tshark finding used in the report. Output -> output/evidence/*.txt
# Open the same filters in the Wireshark GUI (shown in each header) to take screenshots.
set -euo pipefail
cd "$(dirname "$0")/.."; export TZ=UTC
P=output/pcap/ev_soc_full.pcap; E=output/evidence; mkdir -p $E
ATT=10.10.99.66
T() { tshark -r "$P" -t ud "$@" 2>/dev/null; }
{ echo "## Protocol hierarchy"; T -q -z io,phs
  echo; echo "## TCP conversations to CSMS (top 12 by frames)"; T -q -z conv,tcp | head -20
  echo; echo "## OCPP actions in baseline 08:00-08:30 (display filter: websocket && frame.time_relative<1800)"
  T -Y 'websocket && frame.time_relative < 1800 && tcp.dstport==8080' -T fields -e websocket.payload.text | sed -E 's/^\[2,"[^"]*","([A-Za-z]+)".*/\1/' | sort | uniq -c | sort -rn
  echo; echo "## Sample baseline exchange CP-01"
  T -Y 'ip.addr==10.10.10.11 && websocket && frame.time_relative<400' -T fields -e frame.time -e ip.src -e ip.dst -e websocket.payload.text | head -12; } > $E/00_baseline.txt

{ echo "## A1a  WebSocket credential guessing   filter: http.response.code==401 && ip.dst==$ATT"
  T -q -z io,stat,120,"http.response.code==401 && ip.dst==$ATT" | sed -n '/08:3[0-9]\|08:4[0-9]\|Col\|Date/p' ;
  echo; echo "## Failures per attacker (frames):"; T -Y "http.response.code==401" -T fields -e ip.dst | sort | uniq -c
  echo; echo "## Credentials visible in clear (filter: http.authbasic && ip.src==$ATT), first 12 and the success"
  T -Y "http.authbasic && ip.src==$ATT && frame.time<\"2026-11-04 08:50:00\"" -T fields -e frame.time -e http.request.uri -e http.authbasic -e http.user_agent | head -12
  echo ...; T -Y "http.response.code==101 && ip.dst==$ATT && frame.time<\"2026-11-04 08:50:00\"" -T fields -e frame.time -e ip.dst -e http.response.code -e http.sec_websocket_accept
  echo; echo "## A1b  RFID guessing at CP-05   filter: websocket.payload.text contains \"Authorize\" && ip.src==10.10.10.15"
  T -Y 'ip.src==10.10.10.15 && websocket.payload.text contains "\"Authorize\"" && frame.time>="2026-11-04 08:44:00" && frame.time<"2026-11-04 08:50:00"' -T fields -e frame.time -e websocket.payload.text | sed -n '1,5p;$p'
  echo; echo "Authorize responses by status 08:44-08:50 (filter: websocket.payload.text contains \"idTagInfo\")"
  T -Y 'ip.dst==10.10.10.15 && websocket.payload.text contains "idTagInfo" && frame.time>="2026-11-04 08:44:00" && frame.time<"2026-11-04 08:50:00"' -T fields -e websocket.payload.text | grep -o '"status":"[A-Za-z]*"' | sort | uniq -c; } > $E/01_A1_bruteforce.txt

{ echo "## A2  rogue CP-03 session   filter: ip.addr==$ATT && websocket"
  T -Y "ip.addr==$ATT && frame.time>=\"2026-11-04 09:05:00\" && frame.time<\"2026-11-04 09:16:00\" && tcp.dstport==8080 && websocket" -T fields -e frame.time -e ip.src -e websocket.payload.text | cut -c1-260 | sed -n '1,12p;100,104p'
  echo; echo "## Duplicate session proof: CP-03 handshakes by source IP (filter: http.request.uri contains \"CP-03\")"
  T -Y 'http.request.uri contains "/ocpp/CP-03" && frame.time<"2026-11-04 09:30:00"' -T fields -e ip.src -e http.user_agent | sort | uniq -c
  echo; echo "## Reported power values (W) in MeterValues from rogue vs legit CP-03 (filter: websocket.payload.text contains \"Power.Active\")"
  echo "rogue:"; T -Y "ip.src==$ATT && websocket.payload.text contains \"Power.Active\" && frame.time<\"2026-11-04 09:16:00\"" -T fields -e websocket.payload.text | grep -o 'Power.Active.Import","value":"[0-9]*' | head -5
  echo "legit CP-03 (10.10.10.13):"; T -Y 'ip.src==10.10.10.13 && websocket.payload.text contains "Power.Active"' -T fields -e websocket.payload.text | grep -o 'Power.Active.Import","value":"[0-9]*' | head -5
  echo; echo "## DataTransfer probes (filter: websocket.payload.text contains \"DataTransfer\")"
  T -Y 'websocket.payload.text contains "DataTransfer"' -T fields -e frame.time -e ip.src -e websocket.payload.text; } > $E/02_A2_rogue_charger.txt

{ echo "## A3  flood   filter: tcp.flags.syn==1 && tcp.flags.ack==0 && ip.src==$ATT"
  echo "SYN count from attacker 09:38-09:46: $(T -Y "tcp.flags.syn==1 && tcp.flags.ack==0 && ip.src==$ATT && frame.time>=\"2026-11-04 09:38:00\" && frame.time<\"2026-11-04 09:46:30\"" | wc -l)"
  echo "SYN count from all chargers   09:38-09:46: $(T -Y "tcp.flags.syn==1 && tcp.flags.ack==0 && ip.src==10.10.10.0/24 && frame.time>=\"2026-11-04 09:38:00\" && frame.time<\"2026-11-04 09:46:30\"" | wc -l)"
  echo; echo "## Frames per 30 s (I/O graph data, filter ip.src==$ATT)"; T -q -z io,stat,30,"ip.src==$ATT","http.response.code==503","http.response.code==101" -Y 'frame.time>="2026-11-04 09:30:00" && frame.time<"2026-11-04 09:50:00"'
  echo; echo "## HTTP responses by code during the attack window (filter: http.response.code)"
  T -Y 'http.response.code && frame.time>="2026-11-04 09:38:00" && frame.time<"2026-11-04 09:46:30"' -T fields -e http.response.code | sort | uniq -c
  echo; echo "## Half-open connections: first 5 SYNs from attacker"
  T -Y "tcp.flags.syn==1 && tcp.flags.ack==0 && ip.src==$ATT" -T fields -e frame.time -e tcp.srcport -e tcp.dstport | head -5
  echo; echo "## Legit-charger SYNs during saturation (SYN retries get no SYN/ACK)"
  T -Y 'tcp.flags.syn==1 && tcp.flags.ack==0 && ip.src==10.10.10.0/24 && frame.time>="2026-11-04 09:39:00" && frame.time<"2026-11-04 09:46:00"' -T fields -e frame.time -e ip.src | head -8
  echo; echo "## Distinct BootNotification serial numbers from attacker (filter: websocket.payload.text contains \"FLOOD-\")"
  T -Y 'websocket.payload.text contains "FLOOD-"' -T fields -e websocket.payload.text | grep -o 'FLOOD-[0-9A-F]*' | sort -u | wc -l; } > $E/03_A3_flood.txt

# slice per-scenario pcaps for the GUI
for s in "A1 08:38:00 08:50:00" "A2 09:05:00 09:16:00" "A3 09:37:00 09:47:00"; do set -- $s
  editcap -A "2026-11-04 $2" -B "2026-11-04 $3" $P output/pcap/ev_soc_$1.pcap; done
echo "evidence written to $E"; ls -la $E output/pcap
