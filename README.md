# SE Michigan Home Value Analyzer

A small web app for buyers in the Ann Arbor–Detroit corridor (Brighton, Ypsilanti, Belleville, Canton, Saline, etc.). Type a property address and it auto-fills the home's details and comparable sales, then tells you whether the asking price is **overpriced, fair, or underpriced** — adjusting for age, condition, crime, commute time, and proximity to the I-94 hazardous-waste landfill and the proposed Saline / Ypsilanti / Augusta data centers. It also shows the monthly payment with a $200,000 down payment.

## What it uses

- **RentCast API** — auto-fills beds, baths, square footage, year built, last sale price, a value estimate, and nearby comparables from an address. (Free tier ≈ 50 requests/month; each lookup uses ~3 requests, so ~16 lookups/month.)
- **US Census geocoder + OpenStreetMap** — free, keyless address → coordinates (used for commute + location risk, and as a fallback if no RentCast key is set).
- **OSRM** — free, keyless driving-time routing for the commute factor.

No data is stored. The RentCast key lives only on the server (environment variable) and is never exposed to visitors.

## Deploy to Vercel (≈ 5 minutes)

1. **Get a free RentCast key** at https://app.rentcast.io → Dashboard → API key.
2. **Create a Vercel account** at https://vercel.com (free Hobby plan is fine).
3. **Add the project** — easiest of these two:
   - *Drag-and-drop:* install the CLI with `npm i -g vercel`, then run `vercel` inside this folder and follow the prompts. Run `vercel --prod` for the live URL.
   - *GitHub:* push this folder to a GitHub repo, then in Vercel click **Add New → Project → Import** that repo. Framework preset: **Other**. No build command needed.
4. **Set the API key** — in Vercel: **Project → Settings → Environment Variables**, add
   `RENTCAST_API_KEY` = your key, for all environments. Redeploy.
5. **Share the URL** Vercel gives you (e.g. `https://your-app.vercel.app`) with your wife. That's it — nothing to install on her end.

> If you skip the RentCast key, the app still works in manual mode: it geocodes the address (for commute + location risk) and you type the home's details yourself.

## Local development (optional)

```bash
npm i -g vercel
cp .env.example .env.local      # paste your RentCast key
vercel dev                      # http://localhost:3000
```

## Project layout

```
public/index.html     the whole front-end (UI + scoring engine)
api/property.js       RentCast lookup (server-side, holds the key)
api/geocode.js        keyless address -> lat/lng (Census + OSM)
api/commute.js        keyless driving time (OSRM)
package.json          Node 18+, ESM
.env.example          where the RentCast key goes
```

## Tuning the model

Open `public/index.html` and edit the `AREAS` object near the top of the `<script>` block to update the 2026 median **$/sqft** and **crime** figures for any city, or the `SITES` list to add/move detractor locations. The adjustment sizes (age, condition, crime, commute, dump/data-center penalties) are right below in plain functions — change the numbers to match your own judgment.

## Disclaimer

Estimates only — not an appraisal or financial advice. Auto-filled data is public-record and can lag the live listing; always verify price, square footage, taxes, and condition. Commute is typical free-flow driving time, not live traffic.
