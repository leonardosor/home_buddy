// /api/photo?address=..[&lat=..&lng=..][&v=0|1|2]
//   -> a JPEG/PNG photo, proxied server-side so no key ever reaches the browser.
//
// Order of preference:
//   1. Google Street View Static image at the given address (needs GOOGLE_MAPS_API_KEY).
//      `v` picks one of a few field-of-view/pitch variants so a property can show
//      more than one shot without a second panorama lookup.
//   2. Keyless Esri World Imagery aerial crop around lat/lng (no key, no coverage gaps,
//      just not a "photo" — an overhead view).
//   3. A plain SVG placeholder.
//
// No key is required for the app to work; it just falls back to the aerial crop.

const SV_IMAGE = "https://maps.googleapis.com/maps/api/streetview";
const SV_META = "https://maps.googleapis.com/maps/api/streetview/metadata";
const AERIAL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";

// A few distinct-looking crops of the same address so "a few pictures" doesn't
// mean three copies of the same image.
const VARIANTS = [
  { fov: 80, pitch: 0 },
  { fov: 55, pitch: 0 },
  { fov: 90, pitch: 10 },
];

async function streamFrom(url, res) {
  let r;
  try {
    r = await fetch(url);
  } catch {
    return false;
  }
  if (!r.ok) return false;
  const buf = Buffer.from(await r.arrayBuffer());
  res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.status(200).send(buf);
  return true;
}

function placeholder(res, label) {
  const safe = String(label).replace(/[<&>]/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">` +
    `<rect width="100%" height="100%" fill="#eef2f8"/>` +
    `<text x="50%" y="50%" font-family="Arial,Helvetica,sans-serif" font-size="16" fill="#5d6b85" ` +
    `text-anchor="middle" dominant-baseline="middle">${safe}</text></svg>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(svg);
}

export default async function handler(req, res) {
  const address = (req.query.address || "").toString().trim();
  const lat = req.query.lat != null && req.query.lat !== "" ? +req.query.lat : null;
  const lng = req.query.lng != null && req.query.lng !== "" ? +req.query.lng : null;
  const v = Math.max(0, Math.min(VARIANTS.length - 1, parseInt(req.query.v, 10) || 0));
  const key = process.env.GOOGLE_MAPS_API_KEY;

  if (!address && (lat == null || lng == null)) {
    return placeholder(res, "No location");
  }
  const loc = address || `${lat},${lng}`;

  if (key) {
    try {
      const meta = await fetch(
        `${SV_META}?location=${encodeURIComponent(loc)}&key=${key}`
      ).then((r) => r.json());
      if (meta.status === "OK") {
        const { fov, pitch } = VARIANTS[v];
        const svUrl =
          `${SV_IMAGE}?size=640x400&location=${encodeURIComponent(loc)}` +
          `&fov=${fov}&pitch=${pitch}&key=${key}`;
        if (await streamFrom(svUrl, res)) return;
      }
    } catch {
      // fall through to aerial / placeholder
    }
  }

  if (lat != null && lng != null) {
    const d = 0.0011; // ~ a couple hundred feet on each side
    const bbox = [lng - d, lat - d, lng + d, lat + d].join(",");
    const aerialUrl =
      `${AERIAL}?bbox=${bbox}&bboxSR=4326&size=640,400&format=jpg&f=image`;
    if (await streamFrom(aerialUrl, res)) return;
  }

  placeholder(res, key ? "No imagery available" : "No imagery available");
}
