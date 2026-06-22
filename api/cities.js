// /api/cities?fromLat=..&fromLng=..[&radiusKm=35]
//   -> { cities:[{name, population, restaurants, perCapita, miles}], note }
// Keyless: OpenStreetMap Overpass. "perCapita" = restaurants per 1,000 residents.
// Restaurants are counted within a radius of each city/town center (OSM has no cheap
// per-municipality join), so figures are approximate and best for comparison, not exact.

const OVERPASS = "https://overpass-api.de/api/interpreter";

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

  // 1) Nearby populated places with a known population.
  const placeQ = `[out:json][timeout:25];
(
  node["place"~"^(city|town)$"]["population"](around:${radius},${fromLat},${fromLng});
);
out tags;`;

  let places = [];
  try {
    const r = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(placeQ),
    });
    const j = await r.json();
    places = (j.elements || [])
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
  } catch (e) {
    return res.status(502).json({ error: "overpass_failed", message: String(e) });
  }

  if (!places.length)
    return res.status(200).json({ cities: [], note: "No population-tagged cities found nearby." });

  // De-dupe by name, keep nearest, cap to 14 for a reasonable Overpass count call.
  const byName = new Map();
  for (const p of places) {
    p.crow = haversine(fromLat, fromLng, p.lat, p.lng);
    const prev = byName.get(p.name);
    if (!prev || p.crow < prev.crow) byName.set(p.name, p);
  }
  let cities = [...byName.values()].sort((a, b) => a.crow - b.crow).slice(0, 14);

  // 2) Count restaurants within a radius of each center, scaled to town size.
  //    Bigger places get a wider catchment so we don't undercount sprawl.
  const parts = cities
    .map((c) => {
      const rMeters = c.population > 50000 ? 6000 : c.population > 15000 ? 4000 : 2500;
      c.rMeters = rMeters;
      return `node["amenity"="restaurant"](around:${rMeters},${c.lat},${c.lng});`;
    })
    .join("\n");
  const restQ = `[out:json][timeout:60];
(
${parts}
);
out count;`;

  // Per-city counts need separate queries to attribute correctly; run them in parallel.
  await Promise.all(
    cities.map(async (c) => {
      const q = `[out:json][timeout:25];node["amenity"="restaurant"](around:${c.rMeters},${c.lat},${c.lng});out count;`;
      try {
        const r = await fetch(OVERPASS, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(q),
        });
        const j = await r.json();
        const cnt = j.elements?.[0]?.tags?.total ?? j.elements?.[0]?.count;
        c.restaurants = cnt != null ? parseInt(cnt, 10) : 0;
      } catch {
        c.restaurants = null;
      }
    })
  );

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
  // Sort by restaurants per capita, highest first.
  out.sort((a, b) => (b.perCapita ?? -1) - (a.perCapita ?? -1));

  return res.status(200).json({
    cities: out,
    note:
      "Restaurants per 1,000 residents. Counts are within a radius of each town center (OSM data), so treat as approximate.",
  });
}
