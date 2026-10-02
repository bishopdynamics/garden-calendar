#!/usr/bin/env python3
"""Validate build/varieties/*.json against SCHEMA.md and the crop list. Exit 1 on errors."""
import json, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from crops import CROPS

TAGS = set("""short-season heat-tolerant bolt-resistant cold-hardy disease-resistant compact container heirloom hybrid
open-pollinated low-chill high-chill self-fertile needs-pollinizer everbearing june-bearing day-neutral thornless seedless
storage long-day short-day day-neutral-onion parthenocarpic determinate indeterminate""".split())
BASES = {"transplant", "sow", "slips", "sets", "tubers", "cloves"}
RIPENS = {"early", "mid", "late", "everbearing", "year-round"}
LOCAL = re.compile(r"\b(here|socal|so cal|southern california|inland|claremont|our)\b", re.I)

crops = {c["id"]: c for c in CROPS}
errors, warnings, seen = [], [], {}
for f in sorted((HERE.parent / "varieties").glob("*.json")):
    data = json.loads(f.read_text())
    for cid, entry in data.items():
        where = f"{f.name}:{cid}"
        if cid not in crops:
            errors.append(f"{where}: unknown crop id"); continue
        if cid in seen:
            errors.append(f"{where}: also defined in {seen[cid]}")
        seen[cid] = f.name
        c, vs = crops[cid], entry.get("varieties", [])
        annual = c["rule"]["kind"] != "perennial"
        basis = entry.get("basis")
        if annual and basis not in BASES:
            errors.append(f"{where}: annual crop needs basis in {sorted(BASES)}, got {basis!r}")
        if not annual and basis:
            errors.append(f"{where}: perennial must not have basis")
        if not 2 <= len(vs) <= 16:
            warnings.append(f"{where}: {len(vs)} varieties")
        names = set()
        for v in vs:
            w = f"{where}:{v.get('name')}"
            for k in ("name", "type", "notes"):
                if not v.get(k):
                    errors.append(f"{w}: missing {k}")
            if v.get("name") in names:
                errors.append(f"{w}: duplicate name")
            names.add(v.get("name"))
            if len(v.get("notes", "")) > 140:
                warnings.append(f"{w}: notes {len(v['notes'])} chars")
            if LOCAL.search(v.get("notes", "")):
                warnings.append(f"{w}: notes may be location-specific: {v['notes']!r}")
            bad = set(v.get("tags", [])) - TAGS
            if bad:
                errors.append(f"{w}: unknown tags {sorted(bad)}")
            if annual:
                d = v.get("days")
                if not isinstance(d, int):
                    errors.append(f"{w}: annual needs integer days, got {d!r}")
                else:
                    lo, hi = c["rule"].get("days", [d, d])
                    if c["rule"]["kind"] == "annual" and not (0.5 * lo <= d <= 1.6 * hi):
                        warnings.append(f"{w}: days {d} far from crop range {lo}-{hi}")
            else:
                if "days" in v:
                    errors.append(f"{w}: perennial must not have days")
                if not v.get("years"):
                    errors.append(f"{w}: perennial needs years")
                if v.get("ripens") not in RIPENS:
                    errors.append(f"{w}: ripens must be one of {sorted(RIPENS)}")
                ch = v.get("chill", None)
                if ch is not None and not (isinstance(ch, int) and 0 <= ch <= 2500):
                    errors.append(f"{w}: chill must be an int 0–2500 or null, got {ch!r}")
                z = v.get("zones")
                if z is not None and not (isinstance(z, list) and len(z) == 2 and 1 <= z[0] <= z[1] <= 13):
                    errors.append(f"{w}: zones must be [min,max], got {z!r}")

missing = [cid for cid in crops if cid not in seen]
print(f"{len(seen)} crops with varieties, {sum(len(json.loads(f.read_text())[k]['varieties']) for f in (HERE.parent / 'varieties').glob('*.json') for k in json.loads(f.read_text()))} rows")
if missing:
    print(f"no varieties yet ({len(missing)}): {', '.join(missing)}")
for w in warnings:
    print("warn:", w)
for e in errors:
    print("ERROR:", e)
sys.exit(1 if errors else 0)
