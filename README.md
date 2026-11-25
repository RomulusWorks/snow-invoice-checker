# Free Snow Invoice Checker

A free, static browser tool for HOA treasurers. It compares snow-service invoice lines with
nearby NOAA GHCN-Daily station snowfall and produces an informational screening report.
A flagged item is a question to ask the contractor, never a conclusion. See `docs/SPEC.md`.

> Work in progress (Phases 1–2: skeleton, static data, deploy pipeline, live NOAA
> verification). The full user and developer guide is written in later phases.

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

## NOAA weather data — observed schema (Phase 2, captured 2026-11-25)

Endpoint `https://www.ncei.noaa.gov/access/services/data/v1`, `dataset=daily-summaries`,
`dataTypes=SNOW,SNWD`, `includeAttributes=true`, `format=json`, `units=metric`.
Live captures and request metadata (URL, HTTP status, time, sha256) are in `tests/fixtures/`.

| Item | Observed |
|---|---|
| Body | JSON array, one record per station per date. HTTP 200, `application/json;charset=utf-8`. |
| Record keys | `DATE`, `STATION`, `NAME`, `LATITUDE`, `LONGITUDE`, `ELEVATION`, `SNOW`, `SNOW_ATTRIBUTES`, `SNWD`, `SNWD_ATTRIBUTES` |
| Value types | Every value is a string, e.g. `"SNOW":"66.0"`, `"LATITUDE":"42.35647"` |
| Date format | `YYYY-MM-DD` |
| Missing values | The `SNOW`/`SNWD` key is **absent** from the record, or the whole station-date record is absent. No `-9999` or empty strings were seen (both are still treated as missing). Of 20 stations requested for Detroit, only 14 returned any rows. |
| Units (`units=metric`) | **Millimetres** for SNOW and SNWD. Confirmed by requesting `units=standard` for the same records: 76.0 mm ↔ 3.0 in, 66.0 mm ↔ 2.6 in, 10.0 mm ↔ 0.4 in. Converted once: inches = mm ÷ 25.4. |
| Attribute layout | `measurement,quality,source[,observationTime]`. CoCoRaHS (`N`) values have **3 parts** (no time), e.g. `",,N"`, `"T,,N"`; others have 4, e.g. `",,7,0900"`, `"T,,7,0700"`. Every value came with attributes. |
| Measurement flags seen | blank, `T` (trace; value always `"0.0"`). No `P` or `A` in 14,177 live SNOW values (Nov 2025–Apr 2026) across MI, MN, VT, WY, ND, WI, NY, CO. Note: the current readme defines measurement flag `A` as a 6-hour *precipitation* report, not a multi-day snowfall accumulation; the SPEC §3.5 handling of `A` is kept (it can only block a flag). |
| Quality flags seen | blank, `I` (internal consistency), `G` (gap check). Any non-blank quality flag excludes the value. |
| Source flags seen | `N` (CoCoRaHS), `7` (COOP via WxCoder3), `1` (NWS CF6), `H` (HPRCC real-time — excluded), `Z` (Datzilla — not allowlisted, excluded) |

### Source flag allowlist (confirmed against the GHCN-Daily readme, 2026-11-25)

`0` COOP Summary of the Day (DSI-3200) · `1` NWS CF6 daily summaries · `6` CDMP COOP (DSI-3206) ·
`7` COOP via WxCoder3 (DSI-3207) · `A` ASOS real-time · `B` ASOS 2000–2005 (DSI-3211) ·
`D` NWS CF6 via High Plains RCC · `F` U.S. Fort data · `G` GCOS / other government-supplied ·
`K` COOP digitized from paper forms · `M` Monthly METAR Extract · `N` CoCoRaHS ·
`R` NCEI Reference Network (CRN/RCRN) · `T` SNOTEL · `W` WBAN/ASOS Summary of the Day (ISD) ·
`X` U.S. First-Order Summary of the Day (DSI-3210) · `d` NWS Daily Summary Messages via High Plains RCC
(confirmed, so included). Excluded: `H`, `Z`, blank, lowercase/foreign codes, and anything unknown.
Flags are case-sensitive.

### Browser CORS (SPEC §3.2)

A real browser `fetch(url, { mode: 'cors', credentials: 'omit' })` of the same NCEI URL returned
HTTP 200 with readable JSON (71 records, response type `cors`) from **both** origins:
`http://localhost:8000` (2026-11-25T14:58:36Z) and `https://romulusworks.github.io` (2026-11-25T14:58:27Z).
NCEI sends `Access-Control-Allow-Origin: *`. **Result: automatic JSON mode; the CSV fallback is not needed.**

### Station coverage (live, 2026-11-25)

Stations = bundled stations within the radius whose SNOW period covers 2026. A complete window =
usable SNOW on D−1, D and D+1. "Without N" counts only windows with no CoCoRaHS day.

| ZIP (area) | Storm date D | Radius | Stations | Returned data | Complete windows with N | Without N | Max 3-day total |
|---|---|---|---|---|---|---|---|
| 48226 (urban, Detroit MI) | 2026-01-15 | 10 mi | 10 | 7 | 3 | 3 | 3.0 in |
| | | 15 mi | 19 | 15 | 5 | 4 | 6.2 in |
| | | 25 mi | 49 | 36 | 13 | 8 | 6.7 in |
| 48375 (suburban, Novi MI) | 2026-01-15 | 10 mi | 20 | 14 | 7 | 1 | 5.6 in |
| | | 15 mi | 30 | 20 | 8 | 1 | 5.6 in |
| | | 25 mi | 80 | 54 | 20 | 10 | 7.3 in |
| 49738 (rural, Grayling MI) | 2026-01-05 | 10 mi | 1 | 1 | 1 | 1 | 5.0 in |
| | | 15 mi | 2 | 2 | 1 | 1 | 5.0 in |
| | | 25 mi | 9 | 9 | 5 | 4 | 6.8 in |

Grayling's storm date is the day with the largest usable station value within 15 mi, Dec 2025–Feb 2026.
Many listed stations return no data, or not every day, so complete windows are far fewer than stations.
Excluding CoCoRaHS would sharply cut suburban coverage (Novi, 10 mi: 7 → 1).

Live check (opt-in, never in CI): `node scripts/smoke-noaa.mjs [zip] [date] [radius]`.

## Deploy

GitHub Pages via `.github/workflows/deploy.yml` on push to `main`. Repository setting:
**Settings → Pages → Source: GitHub Actions**. Only `index.html`, `assets/` and `public/` are published.

Weather data: NOAA National Centers for Environmental Information (NCEI), Global Historical
Climatology Network Daily (GHCN-Daily), Version 3. Dataset DOI: 10.7289/V5D21VHZ. This tool is
independent and is not affiliated with or endorsed by NOAA.
