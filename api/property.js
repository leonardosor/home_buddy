// /api/property?address=...  -> RentCast property record + value estimate + (optional) active listing
// Key is read from the RENTCAST_API_KEY environment variable (set in Vercel), never exposed to the browser.

const BASE = "https://api.rentcast.io/v1";

async function rc(path, key) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "X-Api-Key": key, Accept: "application/json" },
  });
  if (!r.ok) return { ok: false, status: r.status };
  try {
    return { ok: true, data: await r.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

export default async function handler(req, res) {
  const address = (req.query.address || "").toString().trim();
  if (!address) return res.status(400).json({ error: "address required" });

  const key = process.env.RENTCAST_API_KEY;
  if (!key)
    return res
      .status(503)
      .json({ error: "no_key", message: "RENTCAST_API_KEY not configured" });

  const a = encodeURIComponent(address);
  const out = { address, source: "rentcast" };

  try {
    // 1) Property record (beds/baths/sqft/year/lot/coords)
    const prop = await rc(`/properties?address=${a}`, key);
    if (prop.ok && Array.isArray(prop.data) && prop.data[0]) {
      const p = prop.data[0];
      out.matched = p.formattedAddress;
      out.beds = p.bedrooms ?? null;
      out.baths = p.bathrooms ?? null;
      out.sqft = p.squareFootage ?? null;
      out.year = p.yearBuilt ?? null;
      out.lotSqft = p.lotSize ?? null;
      out.propertyType = p.propertyType ?? null;
      out.lastSalePrice = p.lastSalePrice ?? null;
      out.lastSaleDate = p.lastSaleDate ?? null;
      if (p.latitude && p.longitude) {
        out.lat = p.latitude;
        out.lng = p.longitude;
      }
    }

    // 2) Value estimate + comparables (great for the comps table)
    const avm = await rc(`/avm/value?address=${a}`, key);
    if (avm.ok && avm.data && avm.data.price) {
      out.avm = Math.round(avm.data.price);
      out.avmLow = avm.data.priceRangeLow ? Math.round(avm.data.priceRangeLow) : null;
      out.avmHigh = avm.data.priceRangeHigh ? Math.round(avm.data.priceRangeHigh) : null;
      if (!out.lat && avm.data.latitude) {
        out.lat = avm.data.latitude;
        out.lng = avm.data.longitude;
      }
      if (Array.isArray(avm.data.comparables)) {
        out.comps = avm.data.comparables
          .filter((c) => c.price && c.squareFootage)
          .slice(0, 6)
          .map((c) => ({ price: Math.round(c.price), sqft: c.squareFootage }));
      }
    }

    // 3) Active sale listing (current asking price), if any
    const list = await rc(`/listings/sale?address=${a}`, key);
    if (list.ok) {
      const l = Array.isArray(list.data) ? list.data[0] : list.data;
      if (l && l.price) {
        out.listPrice = Math.round(l.price);
        out.listingStatus = l.status || "active";
      }
    }

    if (!out.sqft && !out.avm && !out.lat)
      return res.status(404).json({ error: "not_found", address });

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "fetch_failed", message: String(e) });
  }
}
