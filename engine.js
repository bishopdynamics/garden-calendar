// Garden rule engine: turns a location's climate normals into planting/harvest months per crop.
// Works in the browser (window.GardenEngine) and in Node (module.exports) for build/test.
(function (root) {
  "use strict";

  const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MSTART = MDAYS.reduce((a, d, i) => (a.push(a[i] + d), a), [1]).slice(0, 12); // doy of 1st of month
  const MID = MSTART.map((s, i) => s + (MDAYS[i] - 1) / 2);
  const wrap = d => ((Math.round(d) - 1) % 365 + 365) % 365 + 1;
  const monthOf = d => { const x = wrap(d); let m = 11; while (MSTART[m] > x) m--; return m + 1; };
  const zoneNum = z => parseInt(z, 10) + (/b$/.test(z) ? 0.5 : 0);
  const SLOT = 3; // evaluate a candidate planting date every 3 days

  // ---------- Climate ----------

  function interpMonthly(arr) {
    const out = new Float64Array(366);
    for (let d = 1; d <= 365; d++) {
      let i1 = MID.findIndex(m => m > d); if (i1 === -1) i1 = 0;
      const i0 = (i1 + 11) % 12;
      const span = (MID[i1] - MID[i0] + 365) % 365, t = ((d - MID[i0] + 365) % 365) / span;
      out[d] = arr[i0] + (arr[i1] - arr[i0]) * t;
    }
    return out;
  }

  // Combine nearby stations (inverse-distance weighted) into one climate.
  function climateFrom(stations, lat, lon) {
    const cl = Math.cos(lat * Math.PI / 180);
    const near = stations.map(s => {
      const dy = (s[1] - lat) * 69.05, dx = (s[2] - lon) * 69.05 * cl;
      return { s, mi: Math.hypot(dx, dy) };
    }).sort((a, b) => a.mi - b.mi);
    let use = near.filter(n => n.mi <= Math.max(30, near[0].mi * 1.6)).slice(0, 3);
    if (!use.length) use = [near[0]];
    const w = use.map(n => 1 / Math.max(n.mi, 1) ** 2), W = w.reduce((a, b) => a + b, 0);
    const avg = f => use.reduce((a, n, i) => a + f(n.s) * w[i], 0) / W;
    const monthly = k => Array.from({ length: 12 }, (_, m) => avg(s => s[k][m]));
    // frost dates: frost-free if the weighted majority of stations are frost-free
    const frost = (iL, iF) => {
      const fz = use.map((n, i) => n.s[iL] == null ? 0 : w[i]).reduce((a, b) => a + b, 0);
      if (fz < W / 2) return [null, null];
      const withF = use.map((n, i) => [n, w[i]]).filter(([n]) => n.s[iL] != null);
      const ww = withF.reduce((a, [, x]) => a + x, 0);
      // circular mean so Dec/Jan dates average correctly
      const cmean = idx => {
        let sx = 0, sy = 0;
        for (const [n, x] of withF) { const a = n.s[idx] / 365 * 2 * Math.PI; sx += Math.cos(a) * x; sy += Math.sin(a) * x; }
        return wrap(((Math.atan2(sy / ww, sx / ww) / (2 * Math.PI)) * 365 + 365) % 365 || 365);
      };
      return [cmean(iL), cmean(iF)];
    };
    const [lf32, ff32] = frost(4, 5), [lf28, ff28] = frost(6, 7);
    return {
      stations: use.map(n => ({ name: n.s[0], mi: n.mi, elev: n.s[3] })),
      lf32, ff32, lf28, ff28,
      tmax: monthly(8), tmin: monthly(9), d90: monthly(10),
    };
  }

  // Average winter chill hours (hours between 32 and 45°F, Oct–Mar). Each day's temperature is modeled as a
  // sine wave between its normal low and high; day-to-day weather is approximated by averaging over a normal
  // spread (σ = 8°F) around those normals, since averages alone hide the cold snaps that supply chill in mild areas.
  function chillHours(tmax, tmin) {
    const below = (x, lo, hi) => { // fraction of a sinusoidal day spent at or below x
      if (x <= lo) return 0; if (x >= hi) return 1;
      const m = (hi + lo) / 2, a = (hi - lo) / 2;
      return 1 - Math.acos((x - m) / a) / Math.PI;
    };
    const OFF = [-16, -8, 0, 8, 16], W = [0.054, 0.242, 0.399, 0.242, 0.054], WS = W.reduce((a, b) => a + b, 0);
    let h = 0;
    for (const d of [...range(274, 365), ...range(1, 90)]) {
      for (let k = 0; k < OFF.length; k++) {
        const lo = tmin[d] + OFF[k], hi = tmax[d] + OFF[k];
        h += 24 * (below(45, lo, hi) - below(32, lo, hi)) * W[k] / WS;
      }
    }
    return Math.round(h / 10) * 10;
  }

  function prepare(clim, zone, lat) {
    const tmax = interpMonthly(clim.tmax), tmin = interpMonthly(clim.tmin);
    const tavg = tmax.map((x, i) => (x + tmin[i]) / 2);
    const frost32 = new Uint8Array(366), frost28 = new Uint8Array(366);
    const mark = (arr, lf, ff) => { if (lf == null) return; for (let d = 1; d <= 365; d++) arr[d] = (ff <= lf ? (d >= ff && d <= lf) : (d >= ff || d <= lf)) ? 1 : 0; };
    mark(frost32, clim.lf32, clim.ff32);
    mark(frost28, clim.lf28, clim.ff28);
    const z = zoneNum(zone);
    const frostFreeDays = clim.lf32 == null ? 365 : 365 - frost32.reduce((a, b) => a + b, 0);
    const hotDays = clim.d90.reduce((a, b) => a + b, 0);
    // winter is "mild" when the coldest month averages above 45°F
    const mAvg = clim.tmax.map((x, i) => (x + clim.tmin[i]) / 2);
    const chill = chillHours(tmax, tmin);
    const mildWinter = Math.min(...mAvg) > 50, warmSummer = Math.max(...clim.tmax) >= 85;
    return { ...clim, zone, z, lat, tmax, tmin, tavg, frost32, frost28, frostFreeDays, hotDays, mildWinter, warmSummer, chill };
  }

  // ---------- Helpers over day ranges (inclusive, wrapping) ----------
  function range(a, b) { const out = []; for (let d = a; d <= b; d++) out.push(wrap(d)); return out; }
  const mean = (arr, a, b) => { const r = range(a, b); return r.reduce((s, d) => s + arr[d], 0) / r.length; };
  const anyIn = (arr, a, b) => range(a, b).some(d => arr[d]);

  function toMonths(days, minCount) {
    const cnt = new Array(13).fill(0);
    for (const d of days) cnt[monthOf(d)]++;
    const months = [];
    for (let m = 1; m <= 12; m++) if (cnt[m] >= minCount) months.push(m);
    return months;
  }
  const slotsToMonths = slots => toMonths(slots, 3);       // ≥ ~9 days of a month must be valid
  const daysToMonths = days => toMonths(days, 7);          // harvest: ≥ a week in the month

  // ---------- Annual crops ----------
  // r = { hardy: 0..3, tPlant:[min,max] tavg at planting, days:[min,max], span, heatMax, heatMin,
  //       fruitHeatMax, growMin, lead:[w1,w2], methods:["sow","transplant","plant"], germ }
  // Days to maturity are converted to growing degree days, so crops grow slower in cool weather.
  function matureDay(r, C, p, days, method) {
    // catalog days-to-maturity assume typical northern-US growing weather: ~19 modified degree days/day
    // for warm crops (base 50°F), ~20 per day for cool crops (base 40°F)
    const base = r.base ?? (r.hardy === 0 ? 50 : 40);
    const need = days * (r.hardy === 0 ? 19 : 20);
    let d = p + (method === "sow" ? (r.germ ?? 7) : 0), acc = 0;
    // warm crops use the standard "modified" degree day: highs capped at 86°F, lows floored at the base
    const warm = r.hardy === 0;
    for (let i = 0; i < 330; i++, d++) {
      const x = wrap(d);
      acc += warm ? Math.max(0, (Math.min(C.tmax[x], 86) + Math.max(C.tmin[x], base)) / 2 - base) : Math.max(0, C.tavg[x] - base);
      if (acc >= need) return d;
    }
    return null;
  }

  function plantingOK(r, C, p, method) {
    if (C.tavg[p] < r.tPlant[0] || C.tavg[p] > r.tPlant[1]) return false;
    if (r.springOnly && C.tavg[wrap(p + 20)] <= C.tavg[p]) return false;
    const mature = matureDay(r, C, p, r.days[0], method);
    if (mature == null) return false;
    // frost tolerance
    if (r.hardy === 0) { if (anyIn(C.frost32, p - 10, mature + 14)) return false; }
    else if (r.hardy === 1) { if (mean(C.tmin, p, mature) < 33 || C.frost28[p]) return false; }
    else if (r.hardy === 2) { if (mean(C.tmin, p, mature) < 26) return false; }
    else { if (mean(C.tmin, p, mature) < 18) return false; }
    // enough warmth to grow at a normal pace, and still warm enough when it starts producing
    if (r.growMin != null && (mean(C.tavg, p, mature) < r.growMin || C.tavg[wrap(mature)] < r.growMin - 4)) return false;
    // cool crops bolt / turn bitter if it's hot when they mature
    if (r.heatMax != null && mean(C.tmax, mature - 14, mature + 7) > r.heatMax) return false;
    // heat lovers need real heat to ripen
    if (r.heatMin != null && mean(C.tmax, mature - Math.round((mature - p) / 2), mature) < r.heatMin) return false;
    // fruit set fails in extreme heat (e.g. tomatoes above ~95°F)
    if (r.fruitHeatMax != null && mean(C.tmax, mature - 30, mature) > r.fruitHeatMax) return false;
    if (r.nightHeatMax != null && mean(C.tmin, mature - 30, mature) > r.nightHeatMax) return false;
    return true;
  }

  function harvestDays(r, C, p, method) {
    const start = matureDay(r, C, p, r.days[0], method);
    const last = matureDay(r, C, p, r.days[1], method) ?? start;
    const out = [];
    for (let d = start; d <= last + (r.span ?? 21); d++) {
      const x = wrap(d);
      if (r.hardy === 0 && (C.frost32[x] || (r.growMin != null && C.tavg[x] < r.growMin - 6))) break;
      if (r.hardy === 1 && C.frost28[x]) break;
      if (r.hardy >= 2 && C.tmin[x] < (r.hardy === 2 ? 18 : 8)) break;
      if (r.heatMax != null && C.tmax[x] > r.heatMax + 6) break;
      if (r.fruitHeatMax != null && C.tmax[x] > r.fruitHeatMax + 4) break;
      if (r.nightHeatMax != null && C.tmin[x] > r.nightHeatMax + 3) break;
      if (r.hardy >= 1 && C.tmax[x] < 34) break; // frozen solid
      out.push(x);
    }
    return out;
  }

  function evalAnnual(r, C) {
    const res = { indoors: [], sow: [], transplant: [], plant: [], harvest: [] };
    const slots = { sow: [], transplant: [], plant: [], indoors: [] }, harvest = [];
    for (const method of r.methods) {
      for (let p = 1; p <= 365; p += SLOT) {
        if (!plantingOK(r, C, p, method)) continue;
        slots[method].push(p);
        harvest.push(...harvestDays(r, C, p, method));
        if (method === "transplant" && r.lead) for (let w = r.lead[0] * 7; w <= r.lead[1] * 7; w += SLOT) slots.indoors.push(wrap(p - w));
      }
    }
    for (const k of ["sow", "transplant", "plant"]) res[k] = slotsToMonths(slots[k]);
    res.indoors = r.lead ? slotsToMonths([...new Set(slots.indoors)]) : [];
    res.harvest = daysToMonths([...new Set(harvest)]);
    return res;
  }

  // ---------- Per-variety timing ----------
  const METHOD_FOR_BASIS = { transplant: "transplant", sow: "sow" };
  // When to plant `crop` in month m (1-12) at this location: the middle of the valid planting days that month.
  function plantDayIn(crop, C, m) {
    const r = ruleFor(crop, C);
    if (!r || r.kind !== "annual") return null;
    const method = METHOD_FOR_BASIS[crop.basis] && r.methods.includes(METHOD_FOR_BASIS[crop.basis])
      ? METHOD_FOR_BASIS[crop.basis] : r.methods.includes("plant") ? "plant" : r.methods[0];
    const ok = [];
    for (let d = MSTART[m - 1]; d < MSTART[m - 1] + MDAYS[m - 1]; d += 2) if (plantingOK(r, C, d, method)) ok.push(d);
    if (!ok.length) return null;
    return { day: ok[Math.floor(ok.length / 2)], method, rule: r };
  }
  // First-harvest date for a variety with `days` to maturity, planted in month m. ok=false: it wouldn't finish in time.
  function varietyTiming(crop, C, m, days) {
    const p = plantDayIn(crop, C, m);
    if (!p) return null;
    const rv = { ...p.rule, days: [days, days] };
    const mature = matureDay(rv, C, p.day, days, p.method);
    return { plantDay: p.day, mature: mature == null ? null : wrap(mature), ok: mature != null && plantingOK(rv, C, p.day, p.method),
             waitDays: mature == null ? null : mature - p.day };
  }
  // the rule actually used at this location (zone variants / annual fallback applied)
  function ruleFor(crop, C) {
    let r = crop.rule;
    const v = (r.variants || []).find(v => (v.minZone == null || C.z >= v.minZone) && (v.maxLat == null || C.lat < v.maxLat));
    if (v) r = { ...r, ...v.rule };
    if (r.zones && C.z < r.zones[0] && r.annualElse) r = r.annualElse;
    return r;
  }

  // ---------- Fall-planted, overwintering crops (garlic, bulb onions, favas) ----------
  // r = { kind:"overwinter", plantTavg:[lo,hi] (falling temps), harvestTavg: tavg at which harvest begins, harvestDays }
  function evalOverwinter(r, C) {
    const plantDays = [];
    for (let d = 1; d <= 365; d += SLOT) {
      const falling = C.tavg[wrap(d + 20)] < C.tavg[d];
      if (falling && C.tavg[d] >= r.plantTavg[0] && C.tavg[d] <= r.plantTavg[1]) plantDays.push(d);
    }
    // in very cold winters (ground frozen for months) favas and similar can't overwinter
    if (r.minWinterTmin != null && Math.min(...C.tmin.slice(1)) < r.minWinterTmin) return null;
    // harvest: when spring warming reaches harvestTavg
    let h = null;
    for (let d = r.harvestMinDoy ?? 32; d <= 300; d++) if (C.tavg[d] >= r.harvestTavg) { h = d; break; }
    const harvest = h ? range(h, h + (r.harvestDays ?? 30)) : [];
    return { indoors: [], sow: r.method === "sow" ? slotsToMonths(plantDays) : [], transplant: [],
             plant: r.method === "sow" ? [] : slotsToMonths(plantDays), harvest: daysToMonths(harvest) };
  }

  // ---------- Perennials ----------
  function springBloom(C, t) {
    // first spring day the average temperature reaches t; mild-winter places default to mid-February
    if (Math.min(...Array.from(C.tavg).slice(1, 60)) >= t) return 41;
    for (let d = 1; d <= 200; d++) if (C.tavg[d] >= t && C.tavg[wrap(d - 1)] < t) return d;
    return 41;
  }

  function perennialPlantDays(r, C) {
    const out = [];
    for (let d = 1; d <= 365; d += SLOT) {
      const t = C.tavg[d], m = monthOf(d);
      let ok = false;
      if (r.plantType === "bareroot") {
        // dormant planting: cool but workable soil; spring only where winters are harsh
        ok = t >= 36 && t <= 58 && (C.z >= 8 || m <= 6) && !(C.z >= 8 && m >= 4 && m <= 9);
      } else if (r.plantType === "evergreen") {
        // tender evergreens (citrus, avocado): after frost danger, before summer heat; or early fall in mild areas
        const safe = !anyIn(C.frost32, d - 21, d + 60);
        ok = safe && t >= 57 && t <= 73 && C.tmax[d] <= 90;
      } else if (r.plantType === "container") {
        // nursery-pot perennials: spring after last frost, or fall at least ~6 weeks before frost
        ok = !anyIn(C.frost28, d - 7, d + 45) && t >= 48 && t <= 70 && C.tmax[d] <= 88;
      }
      if (ok) out.push(d);
    }
    // mild-winter fall planting (strawberries, artichokes) when tavg is falling through [lo, hi]
    if (r.fallTavg && C.z >= 8 && C.warmSummer) {
      for (let d = 200; d <= 365; d += SLOT) {
        if (C.tavg[d] >= r.fallTavg[0] && C.tavg[d] <= r.fallTavg[1]) out.push(d);
      }
    }
    return out;
  }

  function perennialHarvest(r, C) {
    const h = r.harvest;
    if (!h) return [];
    if (h.type === "fixed") return h.months;
    if (h.type === "bloom") {
      const b = springBloom(C, h.bloomT ?? 50);
      return daysToMonths(range(b + h.days[0], b + h.days[1]).filter(d => !C.frost28[d] || C.mildWinter));
    }
    if (h.type === "fall") {
      // ripens as autumn cools (persimmons): from when tavg falls through `tavg` for `days`
      for (let d = 200; d <= 365; d++) if (C.tavg[d] <= h.tavg) return daysToMonths(range(d, d + h.days));
      return daysToMonths(range(305, 305 + h.days)); // never that cool: November onward
    }
    if (h.type === "temp") {
      // harvest while tavg within [lo, hi] and no hard freeze (perennial leaves/stalks/herbs)
      const days = [];
      for (let d = 1; d <= 365; d++) {
        if (C.frost28[d] && !h.evergreen) continue;
        const t = C.tavg[d];
        if (t >= h.tavg[0] && t <= h.tavg[1] && (!h.springOnly || d < 200)) days.push(d);
      }
      return daysToMonths(days);
    }
    return [];
  }

  function evalPerennial(r, C) {
    return { indoors: [], sow: [], transplant: [], plant: slotsToMonths(perennialPlantDays(r, C)), harvest: perennialHarvest(r, C) };
  }

  // ---------- Public ----------
  function evaluate(crop, C) {
    let r = crop.rule, asAnnual = false;
    // zone-dependent variants, e.g. short-day fall onions in the South vs long-day spring onions in the North
    const v = (r.variants || []).find(v => (v.minZone == null || C.z >= v.minZone) && (v.maxLat == null || C.lat < v.maxLat));
    if (v) r = { ...r, ...v.rule };
    if (r.zones && (C.z < r.zones[0] || C.z > r.zones[1])) {
      if (r.annualElse && C.z < r.zones[0]) { r = r.annualElse; asAnnual = true; }
      else return { suitable: false, reason: zoneReason(r.zones, C), indoors: [], sow: [], transplant: [], plant: [], harvest: [] };
    }
    let res = r.kind === "perennial" ? evalPerennial(r, C) : r.kind === "overwinter" ? evalOverwinter(r, C) : evalAnnual(r, C);
    if (!res) return { suitable: false, reason: "Winters here are too cold for it to survive in the ground.", indoors: [], sow: [], transplant: [], plant: [], harvest: [] };
    const planted = x => x.indoors.length + x.sow.length + x.transplant.length + x.plant.length;
    if (!planted(res) && r.kind === "annual") {
      // marginal: works with short-season varieties and soil-warming tricks (black plastic, row cover)
      const relaxed = { ...r, days: [Math.round(r.days[0] * 0.8), r.days[1]], tPlant: [r.tPlant[0] - 3, r.tPlant[1]],
        heatMin: r.heatMin != null ? r.heatMin - 4 : null, growMin: r.growMin != null ? r.growMin - 3 : null,
        heatMax: r.heatMax != null ? r.heatMax + 3 : null };
      const alt = evalAnnual(relaxed, C);
      if (planted(alt) && alt.harvest.length)
        return { ...alt, suitable: true, marginal: true, asAnnual,
                 reason: r.hardy === 0 ? "Marginal here: choose the fastest short-season varieties and warm the soil with black plastic or row cover."
                                       : "Marginal here: choose fast, bolt-resistant varieties and give it some afternoon shade." };
    }
    if (!planted(res)) return { ...res, suitable: false, reason: noWindowReason(crop, C) };
    if (!res.harvest.length) return { ...res, suitable: false, reason: "The growing season here is too short or cool for it to ripen." };
    return { ...res, suitable: true, asAnnual };
  }

  const zname = n => `${Math.floor(n)}${n % 1 ? "b" : "a"}`;
  function zoneReason([lo, hi], C) {
    return C.z < lo ? `Needs zone ${zname(lo)} or warmer to survive winter; this location is ${C.zone}.`
                    : `Needs more winter cold than zone ${C.zone} provides (grows best up to zone ${zname(hi)}).`;
  }
  function noWindowReason(crop, C) {
    const r = crop.rule;
    if (r.heatMin != null) return "Summers here aren't hot or long enough for it to ripen.";
    if (r.heatMax != null && C.hotDays > 60) return "It's too hot here for this cool-season crop to mature before bolting.";
    if (C.frostFreeDays < 120) return "The frost-free season here is too short.";
    return "No reliable planting window in this climate.";
  }

  // Location context notes shown on the crop detail ("local tips")
  function localTips(crop, C, res) {
    const t = crop.localTips || {};
    const out = [];
    if (t.hot && C.hotDays >= 40) out.push(t.hot);
    if (t.short && C.frostFreeDays < 150) out.push(t.short);
    if (t.cold && C.z < 6) out.push(t.cold);
    if (t.mild && C.mildWinter) out.push(t.mild);
    if (t.south && C.lat < 36) out.push(t.south);
    if (t.north && C.lat >= 36) out.push(t.north);
    return out;
  }

  const api = { climateFrom, prepare, evaluate, localTips, monthOf, zoneNum, MSTART, wrap, varietyTiming, plantDayIn };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GardenEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
