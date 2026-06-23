// /api/cities?fromLat=..&fromLng=..[&radiusKm=35]
//   -> { cities:[{name, population, restaurants, perCapita, miles}], note }
// Keyless: OpenStreetMap Overpass. "perCapita" = restaurants per 1,000 residents.
// Restaurants are counted within a radius of each city/town center (OSM has no cheap
// per-municipality join), so figures are approximate and best for comparison, not exact.

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export const config = { maxDuration: 30 };

async function overpass(q) {
  let lastErr = "no endpoints";
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 18000);
      const r = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "se-mi-home-analyzer/1.0",
        },
        body: "data=" + encodeURIComponent(q),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) { lastErr = `HTTP ${r.status} @ ${ep}`; continue; }
      const text = await r.text();
      try {
        return { ok: true, data: JSON.parse(text) };
      } catch {
        lastErr = `non-JSON @ ${ep}`;
        continue;
      }
    } catch (e) {
      lastErr = `${e && e.name === "AbortError" ? "timeout" : String(e)} @ ${ep}`;
    }
  }
  return { ok: false, error: lastErr };
}

function haversine(a, b, c, d) {
  const R = 3958.8, t = Math.PI / 180;
  const dLat = (c - a) * t, dLng = (d - b) * t, la = a * t, lc = c * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lc) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default async function handler(req, res) {
  const fromLat = +req.query.fromLat, fromLng = +req.query.fromLng;
  const radiusKm = Math.min(80, Math.max(5, +req.query.radiusKm || 35));
  if (!fromLat || !fromLng)
    return res.status(400).json({ error: "fromLat and fromLng required" });
  const radius = Math.round(radiusKm * 1000);

  const placeQ = `[out:json][timeout:20];
(
  node["place"~"^(city|town)$"]["population"](around:${radius},${fromLat},${fromLng});
);
out tags;`;

  const po = await overpass(placeQ);
  if (!po.ok)
    return res.status(502).json({ error: "overpass_failed", message: po.error });
  const places = (po.data.elements || [])
    .map((el) => {
      const pop = parseInt((el.tags.population || "").replace(/[^\d]/g, ""), 10);
      return {
        name: el.tags.name || "Unknown",
        lat: el.lat,
        lng: el.lon,
        population: pop > 0 ? pop : null,
      };
    })
    .filter((p) => p.population && p.lat != null);

  if (!places.length)
    return res.status(200).json({ cities: [], note: "No population-tagged cities found nearby." });

  const byName = new Map();
  for (const p of places) {
    p.crow = haversine(fromLat, fromLng, p.lat, p.lng);
    const prev = byName.get(p.name);
    if (!prev || p.crow < prev.crow) byName.set(p.name, p);
  }
  let cities = [...byName.values()].sort((a, b) => a.crow - b.crow).slice(0, 14);

  cities.forEach((c) => {
    c.rMeters = c.population > 50000 ? 6000 : c.population > 15000 ? 4000 : 2500;
  });
  const parts = cities
    .map(
      (c, i) =>
        `node["amenity"="restaurant"](around:${c.rMeters},${c.lat},${c.lng})->.r${i};\n.r${i} out count;`
    )
    .join("\n");
  const restQ = `[out:json][timeout:60];\n${parts}`;

  const ro = await overpass(restQ);
  if (ro.ok && Array.isArray(ro.data.elements)) {
    const counts = ro.data.elements
      .filter((e) => e.type === "count")
      .map((e) => parseInt(e.tags?.total ?? e.count ?? "0", 10));
    cities.forEach((c, i) => {
      c.restaurants = counts[i] != null ? counts[i] : null;
    });
  } else {
    cities.forEach((c) => (c.restaurants = null));
  }

  const out = cities.map((c) => ({
    name: c.name,
    population: c.population,
    restaurants: c.restaurants,
    perCapita:
      c.restaurants != null && c.population
        ? +((c.restaurants / c.population) * 1000).toFixed(2)
        : null,
    miles: +(c.crow).toFixed(1),
  }));
  out.sort((a, b) => (b.perCapita ?? -1) - (a.perCapita ?? -1));

  return res.status(200).json({
    cities: out,
    note:
      "Restaurants per 1,000 residents. Counts are within a radius of each town center (OSM data), so treat as approximate.",
  });
}
