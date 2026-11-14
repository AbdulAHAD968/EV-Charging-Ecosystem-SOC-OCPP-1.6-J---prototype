#!/usr/bin/env bash
# Reproduce everything: simulation -> detection -> dashboard -> Wireshark evidence -> report (about 3 min)
set -euo pipefail; cd "$(dirname "$0")"
python3 sim/generate.py            # output/logs, output/pcap, output/ground_truth
python3 siem/detect.py > output/siem/detect_console.txt
python3 siem/dashboard.py          # output/dashboard/dashboard.html
bash analysis/wireshark_evidence.sh > /dev/null
python3 docs/make_diagrams.py 2>/dev/null || (cd docs && python3 make_diagrams.py)
python3 docs/build_report.py docs/report.md docs/EV_SOC_Report.docx
