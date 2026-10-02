#!/usr/bin/env python3
"""Build the offline location data used by the page (continental US only).

Inputs (downloaded into build/raw/, see build/README.md):
  phzm_us_zipcode_2023.csv          USDA 2023 hardiness zone by ZIP (PRISM / Oregon State)
  2023_Gaz_zcta_national.zip        Census ZIP (ZCTA) centroids
  2023_Gaz_place_national.zip       Census city/town/CDP centroids
  sub-est2023.csv                   Census 2023 city population estimates (for search ranking)
  ann/*.csv, mly/*.csv              NOAA 1991–2020 climate normals, by station

Outputs (in geo/):
  zips.js      window.GEO_ZIPS   "zip,lat,lon,zone;..."   (lat/lon ×100, integer)
  places.js    window.GEO_PLACES "name|ST|lat|lon|zone|pop;..."
  stations.js  window.STATIONS   [[name, lat, lon, elevFt, lf32, ff32, lf28, ff28, tmax[12], tmin[12], d90[12]], ...]
               frost dates are day-of-year (1–365); null = that freeze doesn't occur in a typical (50%) year
"""
import csv, io, json, math, re, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
OUT = HERE.parent / "geo"
OUT.mkdir(exist_ok=True)

# Continental US = lower 48 + DC
CONUS = set("""AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ
NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY""".split())
STATE_FIPS = {}  # filled from the place gazetteer


def in_box(lat, lon):
    return 24 <= lat <= 50 and -125.5 <= lon <= -66


def doy(mmdd):
    """'  01/08' -> day of year (non-leap). Returns None for -9999 / blank."""
    s = (mmdd or "").strip()
    m = re.fullmatch(r"(\d\d)/(\d\d)", s)
    if not m:
        return None
    mo, d = int(m.group(1)), int(m.group(2))
    return sum([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][:mo - 1]) + d


def num(s):
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    return None if v <= -9990 else v


def gaz_rows(name):
    with zipfile.ZipFile(RAW / name) as z:
        text = z.read(z.namelist()[0]).decode("utf-8")
    rows = list(csv.reader(io.StringIO(text), delimiter="\t"))
    hdr = [h.strip() for h in rows[0]]
    return [dict(zip(hdr, (c.strip() for c in r))) for r in rows[1:]]


# ---------------- ZIP codes ----------------
zones = {}
with open(RAW / "phzm_us_zipcode_2023.csv") as f:
    for r in csv.DictReader(f):
        zones[r["zipcode"]] = r["zone"]

zips = []
for r in gaz_rows("2023_Gaz_zcta_national.zip"):
    lat, lon = float(r["INTPTLAT"]), float(r["INTPTLONG"])
    z = r["GEOID"]
    if not in_box(lat, lon) or z not in zones:
        continue
    zips.append((z, lat, lon, zones[z]))
zips.sort()
print(f"zips: {len(zips)}")


def nearest_zip_zone(lat, lon):
    best, bz = 1e9, None
    cl = math.cos(math.radians(lat))
    for _, zl, zo, zn in zips:
        d = (zl - lat) ** 2 + ((zo - lon) * cl) ** 2
        if d < best:
            best, bz = d, zn
    return bz


# ---------------- Places ----------------
pop = {}
with open(RAW / "sub-est2023.csv", encoding="latin1") as f:
    for r in csv.DictReader(f):
        if r["SUMLEV"] == "162":
            pop[r["STATE"] + r["PLACE"]] = int(r["POPESTIMATE2023"])

LSAD = re.compile(r"\s+(city and borough|consolidated government( \(balance\))?|metropolitan government( \(balance\))?|"
                  r"unified government( \(balance\))?|urban county|(city|town|village|borough|CDP|municipality|"
                  r"plantation|comunidad|zona urbana|corporation)( \(balance\))?)$")
places = []
# bucket ZIPs on a 1° grid so nearest-zone lookup for 30k places is fast
grid = {}
for zr in zips:
    grid.setdefault((int(zr[1]), int(zr[2])), []).append(zr)


def zone_at(lat, lon):
    cl = math.cos(math.radians(lat))
    best, bz = 1e9, None
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for _, zl, zo, zn in grid.get((int(lat) + dy, int(lon) + dx), ()):
                d = (zl - lat) ** 2 + ((zo - lon) * cl) ** 2
                if d < best:
                    best, bz = d, zn
    return bz or nearest_zip_zone(lat, lon)


for r in gaz_rows("2023_Gaz_place_national.zip"):
    st = r["USPS"]
    if st not in CONUS:
        continue
    lat, lon = float(r["INTPTLAT"]), float(r["INTPTLONG"])
    name = LSAD.sub("", r["NAME"]).strip()
    p = pop.get(r["GEOID"], 0)
    places.append((name, st, lat, lon, zone_at(lat, lon), p))
places.sort(key=lambda p: -p[5])
print(f"places: {len(places)}")

# ---------------- Weather stations ----------------
stations = []
skipped = 0
for path in sorted((RAW / "ann").glob("*.csv")):
    mpath = RAW / "mly" / path.name
    if not mpath.exists():
        continue
    with open(path) as f:
        a = next(csv.DictReader(f), None)
    if not a:
        continue
    lat, lon = float(a["LATITUDE"]), float(a["LONGITUDE"])
    st = a["NAME"].strip()[-5:-3]  # "POMONA/FAIRPLEX, CA US" -> CA
    if st not in CONUS or not in_box(lat, lon):
        continue
    with open(mpath) as f:
        mly = sorted(csv.DictReader(f), key=lambda r: int(r["month"]))
    if len(mly) != 12:
        continue
    tmax = [num(r.get("MLY-TMAX-NORMAL")) for r in mly]
    tmin = [num(r.get("MLY-TMIN-NORMAL")) for r in mly]
    d90 = [num(r.get("MLY-TMAX-AVGNDS-GRTH090")) for r in mly]
    gsl32 = num(a.get("ANN-TMIN-PRBGSL-T32FP50"))
    gsl28 = num(a.get("ANN-TMIN-PRBGSL-T28FP50"))
    if None in tmax or None in tmin or gsl32 is None:
        skipped += 1
        continue
    lf32, ff32 = doy(a.get("ANN-TMIN-PRBLST-T32FP50")), doy(a.get("ANN-TMIN-PRBFST-T32FP50"))
    lf28, ff28 = doy(a.get("ANN-TMIN-PRBLST-T28FP50")), doy(a.get("ANN-TMIN-PRBFST-T28FP50"))
    # GSL 365 with no dates = frost-free in a typical year; otherwise dates must exist
    if gsl32 < 365 and (lf32 is None or ff32 is None):
        skipped += 1
        continue
    if gsl28 is not None and gsl28 < 365 and (lf28 is None or ff28 is None):
        lf28 = ff28 = None
    name = re.sub(r",\s*[A-Z]{2} US$", "", a["NAME"].strip()).title()
    stations.append([f"{name}, {st}", round(lat, 3), round(lon, 3), round(float(a["ELEVATION"]) * 3.28084),
                     lf32, ff32, lf28, ff28,
                     [round(x) for x in tmax], [round(x) for x in tmin],
                     [round(x) if x is not None else 0 for x in d90]])
print(f"stations: {len(stations)} (skipped {skipped} without full temperature + frost normals)")

# ---------------- Write ----------------
def write(name, var, payload):
    (OUT / name).write_text(f"// Generated by build/geo.py — do not edit.\nwindow.{var} = {payload};\n")
    print(f"  {name}: {(OUT / name).stat().st_size / 1e6:.2f} MB")


write("zips.js", "GEO_ZIPS", json.dumps(";".join(
    f"{z},{round(lat * 100)},{round(lon * 100)},{zn}" for z, lat, lon, zn in zips)))
write("places.js", "GEO_PLACES", json.dumps(";".join(
    f"{n}|{st}|{round(lat * 100)}|{round(lon * 100)}|{zn}|{p}" for n, st, lat, lon, zn, p in places)))
write("stations.js", "STATIONS", json.dumps(stations, separators=(",", ":")))
