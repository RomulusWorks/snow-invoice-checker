# Free Snow Invoice Checker

A free, static browser tool for HOA treasurers. It compares snow-service invoice lines with
nearby NOAA GHCN-Daily station snowfall and produces an informational screening report.
It does not decide whether a contractor overcharged. See `docs/SPEC.md`.

> Work in progress (Phase 1: skeleton, static data, deploy pipeline). The full user and
> developer guide is written in later phases.

## Developer quick start

Node 20+ is used only for scripts and tests. There is no `npm install`.

```bash
node --test                 # offline tests
node scripts/serve.mjs 8000 # or: python -m http.server 8000
# open http://localhost:8000
```

## Bundled data (built by scripts from official files; never hand-written)

Raw downloads go in `data-source/` (git-ignored).

| Output | Source | Build command |
|---|---|---|
| `public/data/zcta-centroids.json` | https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip (extract `2020_Gaz_zcta_national.txt`; Windows: `tar -xf`, macOS/Linux: `unzip`) | `node scripts/build-zcta-json.mjs ./data-source/2020_Gaz_zcta_national.txt ./public/data/zcta-centroids.json` |
| `public/data/ghcn-stations-us.json` | https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt and https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-inventory.txt (layout per https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt) | `node scripts/build-ghcn-stations.mjs ./data-source/ghcnd-stations.txt ./data-source/ghcnd-inventory.txt ./public/data/ghcn-stations-us.json` |

## Deploy

GitHub Pages via `.github/workflows/deploy.yml` on push to `main`. Repository setting:
**Settings → Pages → Source: GitHub Actions**. Only `index.html`, `assets/` and `public/` are published.

Weather data: NOAA National Centers for Environmental Information (NCEI), Global Historical
Climatology Network Daily (GHCN-Daily), Version 3. Dataset DOI: 10.7289/V5D21VHZ. This tool is
independent and is not affiliated with or endorsed by NOAA.
