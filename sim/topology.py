"""Static description of the simulated EV-charging network (all synthetic)."""
import random
from datetime import datetime, timezone

T0 = datetime(2026, 11, 4, 8, 0, 0, tzinfo=timezone.utc).timestamp()
DURATION = 2 * 3600          # 08:00 - 10:00 UTC

CSMS_IP, CSMS_PORT = "10.10.20.10", 8080
ADMIN_IP = "10.10.30.5"
ATTACKER_IP = "10.10.99.66"   # rogue Raspberry-Pi class implant on the charger VLAN

FIRMWARE = "2.4.1"
VENDOR = "ChargeTech"

# cp_id: ip, rated kW, connector type, model
CHARGERS = {
    "CP-01": dict(ip="10.10.10.11", kw=7.4,  kind="AC", model="CT-AC7"),
    "CP-02": dict(ip="10.10.10.12", kw=7.4,  kind="AC", model="CT-AC7"),
    "CP-03": dict(ip="10.10.10.13", kw=22.0, kind="AC", model="CT-AC22"),
    "CP-04": dict(ip="10.10.10.14", kw=22.0, kind="AC", model="CT-AC22"),
    "CP-05": dict(ip="10.10.10.15", kw=22.0, kind="AC", model="CT-AC22"),
    "CP-06": dict(ip="10.10.10.16", kw=22.0, kind="AC", model="CT-AC22"),
    "CP-07": dict(ip="10.10.10.17", kw=50.0, kind="DC", model="CT-DC50"),
    "CP-08": dict(ip="10.10.10.18", kw=50.0, kind="DC", model="CT-DC50"),
}

def password(cp_id):
    # deliberately weak, predictable provisioning passwords (a finding in the report)
    return f"cp{int(cp_id[3:]):02d}pass"

_r = random.Random(42)
VALID_TAGS = ["ID-%08X" % _r.getrandbits(32) for _ in range(24)]
BLOCKED_TAGS = ["ID-%08X" % _r.getrandbits(32) for _ in range(3)]
EXPIRED_TAGS = ["ID-%08X" % _r.getrandbits(32) for _ in range(3)]
COMPROMISED_TAG = VALID_TAGS[0]     # card owner who is charging legitimately at CP-07

def mac(ip, attacker=False):
    o = [int(x) for x in ip.split(".")]
    prefix = "b8:27:eb" if attacker else "02:ca:fe"      # b8:27:eb = Raspberry Pi OUI
    return "%s:%02x:%02x:%02x" % (prefix, o[1], o[2], o[3])
