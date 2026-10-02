// Sanity sweep: evaluate every crop at many ZIPs and report anomalies.
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "../..");
const ctx = { window: {} }; vm.createContext(ctx);
for (const f of ["data.js", "geo/stations.js", "geo/zips.js", "engine.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
const { CROPS, STATIONS, GEO_ZIPS, GardenEngine: E } = ctx.window;
const zips = GEO_ZIPS.split(";").map(r => { const [z, la, lo, zn] = r.split(","); return { z, lat: la / 100, lon: lo / 100, zone: zn }; });
const N = +(process.argv[2] || 400), step = Math.floor(zips.length / N);
const issues = {}, suit = {}, counts = [];
let t0 = Date.now();
for (let i = 0; i < zips.length; i += step) {
  const z = zips[i], C = E.prepare(E.climateFrom(STATIONS, z.lat, z.lon), z.zone, z.lat);
  let n = 0;
  for (const c of CROPS) {
    const r = E.evaluate(c, C);
    suit[c.id] = (suit[c.id] || 0) + (r.suitable ? 1 : 0);
    if (!r.suitable) continue; n++;
    const add = k => (issues[k] ??= []).length < 6 && issues[k].push(`${c.id}@${z.z}(${z.zone})`);
    if (!r.harvest.length) add("planted but no harvest");
    if (r.harvest.length === 12 && c.season === "warm") add("warm crop harvested all year");
    if (new Set([...r.sow, ...r.transplant, ...r.plant]).size >= 11 && c.season !== "perennial") add("planted 11+ months");
  }
  counts.push([n, z.z, z.zone, C.stations[0].mi]);
}
const ms = (Date.now() - t0) / counts.length;
counts.sort((a, b) => a[0] - b[0]);
console.log(`${counts.length} ZIPs, ${ms.toFixed(0)} ms per location`);
console.log("fewest suitable:", counts.slice(0, 5).map(c => `${c[1]} z${c[2]} ${c[0]} crops`).join(", "));
console.log("most suitable:", counts.slice(-3).map(c => `${c[1]} z${c[2]} ${c[0]} crops`).join(", "));
console.log("farthest station:", counts.reduce((a, c) => c[3] > a[3] ? c : a)[1], counts.reduce((a, c) => Math.max(a, c[3]), 0).toFixed(1), "mi");
console.log("never suitable:", Object.entries(suit).filter(([, v]) => !v).map(([k]) => k).join(", ") || "none");
console.log("suitable share (lowest):", Object.entries(suit).sort((a, b) => a[1] - b[1]).slice(0, 12).map(([k, v]) => `${k} ${Math.round(100 * v / counts.length)}%`).join(", "));
for (const [k, v] of Object.entries(issues)) console.log(`${k}: ${v.join(", ")}`);
