# Albania Administrative Map (Vercel-ready)

Simple interactive web map for Albania administrative units, using one embedded GeoJSON file at:

- `public/adm_units_munis_with_polygons.geojson`

## What it does

- Renders admin-unit polygons on a Leaflet map.
- Applies municipality-based colors.
- Clicking an administrative unit cycles the municipality’s active highlighted unit when it contains 2+ admin units.
- Shows:
  - Tooltip: `NAME_ADMIN`
  - Popover/Popup: `NAME_MUNIC`

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Deploy on Vercel

- Push this repo to GitHub.
- Import it in Vercel.
- Set build command: `npm run build`
- Set output directory: default (`.next`).
- No additional env vars required.
