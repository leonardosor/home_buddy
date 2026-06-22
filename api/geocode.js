// /api/geocode?address=...  -> { lat, lng, matched }
// Keyless: US Census geocoder first, OpenStreetMap Nominatim fallback.
// Used as a fallback so detractor distances + commute still work even without a RentCast key.

export async function geocodeAddress(address) {
  // 1) US Census (keyless, US street addresses)
  try {
    const cu = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(
      address
    )}&benchmark=Public_AR_Current&format=json`;
    const cr = await fetch(cu);
    if (cr.ok) {
      const cj = await cr.json();
      const m = cj?.result?.addressMatches?.[0];
      if (m && m.coordinates)
        return { lat: m.coordinates.y, lng: m.coordinates.x, matched: m.matchedAddress };
    }
  } catch {}
  // 2) Nominatim fallback
  try {
    const nu = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      address
    )}&format=json&limit=1&countrycodes=us`;
    const nr = await fetch(nu, { headers: { "User-Agent": "se-mi-home-analyzer/1.0" } });
    const nj = await nr.json();
    if (Array.isArray(nj) && nj[0])
      return { lat: +nj[0].lat, lng: +nj[0].lon, matched: nj[0].display_name };
  } catch {}
  return null;
}

export default async function handler(req, res) {
  const address = (req.query.address || "").toString().trim();
  if (!address) return res.status(400).json({ error: "address required" });
  const g = await geocodeAddress(address);
  if (!g) return res.status(404).json({ error: "not_found" });
  return res.status(200).json(g);
}
