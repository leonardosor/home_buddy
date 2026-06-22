// /api/commute?fromLat=..&fromLng=..&to=ADDRESS  -> { minutes, miles, destMatched }
// Geocodes the destination (keyless) then routes with OSRM (free, no key, free-flow time).
import { geocodeAddress } from "./geocode.js";

function haversine(a, b, c, d) {
  const R = 3958.8,
    t = Math.PI / 180;
  const dLat = (c - a) * t,
    dLng = (d - b) * t,
    la = a * t,
    lc = c * t;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la) * Math.cos(lc) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default async function handler(req, res) {
  const fromLat = +req.query.fromLat,
    fromLng = +req.query.fromLng;
  const to = (req.query.to || "").toString().trim();
  if (!fromLat || !fromLng || !to)
    return res.status(400).json({ error: "fromLat, fromLng, to required" });

  const dest = await geocodeAddress(to);
  if (!dest) return res.status(404).json({ error: "destination_not_found" });

  try {
    const ou = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${dest.lng},${dest.lat}?overview=false`;
    const r = await fetch(ou, { headers: { "User-Agent": "se-mi-home-analyzer/1.0" } });
    const j = await r.json();
    if (j.code === "Ok" && j.routes && j.routes[0]) {
      return res.status(200).json({
        minutes: Math.round(j.routes[0].duration / 60),
        miles: +(j.routes[0].distance / 1609.34).toFixed(1),
        destMatched: dest.matched,
        source: "osrm",
      });
    }
  } catch {}

  // Fallback: straight-line distance * road factor / avg 40 mph
  const mi = haversine(fromLat, fromLng, dest.lat, dest.lng) * 1.3;
  return res.status(200).json({
    minutes: Math.round((mi / 40) * 60),
    miles: +mi.toFixed(1),
    destMatched: dest.matched,
    source: "estimate",
  });
}
