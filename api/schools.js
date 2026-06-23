// /api/schools?fromLat=..&fromLng=..[&maxMin=30]
//   -> { schools:[{name, address, minutes, miles, confirmed}], maxMin, scanned }
// Keyless: OpenStreetMap Overpass finds Catholic schools nearby, OSRM computes drive time.

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const OSRM = "https://router.project-osrm.org";

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

const NAME_RE =
  /\b(catholic|sacred heart|our lady|holy (cross|family|trinity|name|redeemer|spirit|rosary|angels)|immaculate|blessed sacrament|st\.?\s|saint\s|cristo rey|guardian angels|divine child|gabriel richard|father gabriel)/i;
const EXCLUDE_RE =
  /\b(lutheran|baptist|methodist|presbyterian|adventist|episcopal|reformed|christian reformed|nazarene|pentecostal|orthodox)\b/i;

function isCatholic(tags) {
  const denom = (tags.denomination || "").toLowerCase();
  const relig = (tags.religion || "").toLowerCase();
  if (denom.includes("catholic")) return { ok: true, confirmed: true };
  const name = tags.name || tags["name:en"] || "";
  if (NAME_RE.test(name)) {
    if (EXCLUDE_RE.test(name)) return { ok: false };
    return { ok: true, confirmed: relig === "christian" };
  }
  return { ok: false };
}

function fmtAddress(tags) {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:state"],
  ].filter(Boolean);
  return parts.join(", ");
}

export default async function handler(req, res) {
  const fromLat = +req.query.fromLat, fromLng = +req.query.fromLng;
  const maxMin = Math.min(120, Math.max(5, +req.query.maxMin || 30));
  if (!fromLat || !fromLng)
    return res.status(400).json({ error: "fromLat and fromLng required" });

  const radius = 45000;
  const q = `[out:json][timeout:20];
(
  node["amenity"="school"](around:${radius},${fromLat},${fromLng});
  way["amenity"="school"](around:${radius},${fromLat},${fromLng});
);
out center tags;`;

  const o = await overpass(q);
  if (!o.ok)
    return res.status(502).json({ error: "overpass_failed", message: o.error });
  const elements = Array.isArray(o.data.elements) ? o.data.elements : [];

  const seen = new Set();
  let cands = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const cat = isCatholic(tags);
    if (!cat.ok) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const name = tags.name || tags["name:en"] || "Unnamed school";
    const key = name.toLowerCase() + "|" + lat.toFixed(3) + "|" + lng.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    cands.push({
      name,
      address: fmtAddress(tags),
      lat,
      lng,
      confirmed: cat.confirmed,
      crow: haversine(fromLat, fromLng, lat, lng),
    });
  }

  cands.sort((a, b) => a.crow - b.crow);
  cands = cands.slice(0, 60);

  if (!cands.length)
    return res.status(200).json({ schools: [], maxMin, scanned: elements.length });

  const coords =
    `${fromLng},${fromLat};` + cands.map((c) => `${c.lng},${c.lat}`).join(";");
  let durations = null, distances = null;
  try {
    const u = `${OSRM}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`;
    const r = await fetch(u, { headers: { "User-Agent": "se-mi-home-analyzer/1.0" } });
    const j = await r.json();
    if (j.code === "Ok") {
      durations = j.durations?.[0];
      distances = j.distances?.[0];
    }
  } catch {}

  const schools = cands.map((c, i) => {
    let minutes = null, miles = null;
    if (durations && durations[i + 1] != null) {
      minutes = Math.round(durations[i + 1] / 60);
      miles = distances && distances[i + 1] != null
        ? +(distances[i + 1] / 1609.34).toFixed(1)
        : null;
    } else {
      const mi = c.crow * 1.3;
      minutes = Math.round((mi / 40) * 60);
      miles = +mi.toFixed(1);
    }
    return { name: c.name, address: c.address, lat: c.lat, lng: c.lng, minutes, miles, confirmed: c.confirmed };
  });

  const within = schools
    .filter((s) => s.minutes != null && s.minutes <= maxMin)
    .sort((a, b) => a.minutes - b.minutes);

  return res.status(200).json({ schools: within, maxMin, scanned: elements.length });
}
