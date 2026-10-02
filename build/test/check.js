// Run the engine outside the browser.
//   node build/test/check.js                 -> Claremont vs. hand-curated reference + summary for test cities
//   node build/test/check.js 55401 tomato    -> one ZIP, optionally filtered to crop ids
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "../..");
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ["data.js", "geo/stations.js", "geo/zips.js", "engine.js"])
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
const { CROPS, STATIONS, GEO_ZIPS, GardenEngine: E } = ctx.window;

const ZIPS = new Map(GEO_ZIPS.split(";").map(r => { const [z, la, lo, zn] = r.split(","); return [z, { lat: la / 100, lon: lo / 100, zone: zn }]; }));
const M = "JFMAMJJASOND";
const bar = ms => Array.from({ length: 12 }, (_, i) => (ms.includes(i + 1) ? M[i] : "·")).join("");
const fmt = d => d == null ? "none" : new Date(2001, 0, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function at(zip) {
  const z = ZIPS.get(zip);
  if (!z) throw new Error("unknown zip " + zip);
  const clim = E.climateFrom(STATIONS, z.lat, z.lon);
  return E.prepare(clim, z.zone, z.lat);
}

function show(zip, filter) {
  const C = at(zip);
  console.log(`\n== ${zip}  zone ${C.zone}  last frost ${fmt(C.lf32)}  first frost ${fmt(C.ff32)}  frost-free ${C.frostFreeDays}d  90°F days ${Math.round(C.hotDays)}`);
  console.log("   stations: " + C.stations.map(s => `${s.name} (${s.mi.toFixed(1)} mi, ${s.elev} ft)`).join("; "));
  let hidden = [];
  for (const c of CROPS) {
    if (filter.length && !filter.includes(c.id)) continue;
    const r = E.evaluate(c, C);
    if (!r.suitable) { hidden.push(c.id); continue; }
    const act = ["indoors", "sow", "transplant", "plant"].filter(k => r[k].length).map(k => `${k[0].toUpperCase()}:${bar(r[k])}`).join(" ");
    console.log(`  ${c.id.padEnd(16)} ${act.padEnd(48)} H:${bar(r.harvest)}${r.asAnnual ? " (annual)" : ""}${r.marginal ? " (marginal)" : ""}`);
  }
  if (hidden.length) console.log(`  not suitable (${hidden.length}): ${hidden.join(", ")}`);
}

function compareClaremont() {
  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "claremont_reference.json"), "utf8"));
  const C = at("91711");
  let tot = 0, n = 0;
  console.log("== Claremont 91711: engine vs hand-curated (planting = union of all planting actions)");
  for (const c of CROPS) {
    const want = ref[c.id];
    if (!want) continue;
    const r = E.evaluate(c, C);
    const wp = new Set([...want.indoors, ...want.sow, ...want.transplant, ...want.plant]);
    const gp = new Set([...r.indoors, ...r.sow, ...r.transplant, ...r.plant]);
    const jac = (a, b) => { const u = new Set([...a, ...b]); return u.size ? [...a].filter(x => b.has(x)).length / u.size : 1; };
    const sp = jac(wp, gp), sh = jac(new Set(want.harvest), new Set(r.harvest));
    tot += (sp + sh) / 2; n++;
    const flag = !r.suitable ? "  !! UNSUITABLE: " + r.reason : (sp < 0.5 || sh < 0.5 ? "  <-- check" : "");
    console.log(`  ${c.id.padEnd(16)} plant ref ${bar([...wp])} got ${bar([...gp])} ${sp.toFixed(2)} | harvest ref ${bar(want.harvest)} got ${bar(r.harvest)} ${sh.toFixed(2)}${flag}`);
  }
  console.log(`  mean agreement: ${(tot / n).toFixed(2)}`);
}

const [zip, ...filter] = process.argv.slice(2);
if (zip) show(zip, filter);
else {
  compareClaremont();
  // Minneapolis, Atlanta, Phoenix, Seattle, Boston, Denver, Houston, Fargo
  for (const z of ["55401", "30303", "85004", "98101"]) show(z, ["tomato", "pepper", "lettuce", "peas", "pea", "garlic", "okra", "watermelon", "spinach", "broccoli", "kale", "onion", "strawberry", "apple", "peach", "orange", "fig", "rhubarb", "currant"]);
}
