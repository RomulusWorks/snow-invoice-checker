# Free Snow Invoice Checker

A free, static browser tool for HOA board treasurers and small HOA managers. It compares the
snow-service lines on an invoice with nearby NOAA weather-station snowfall and the contract terms
you enter, and produces a one-page screening report. A flagged item is a question to ask the
contractor, never a conclusion.

**Live site:** https://romulusworks.github.io/snow-invoice-checker/

Everything runs in your browser. There are no accounts, no uploads to a server, no analytics and
no trackers. The only outside request is to NOAA's public data service, which receives station IDs
and dates only — never your ZIP code, contract terms or invoice amounts.

---

## For HOA boards

### How to use it (3 steps)

1. **Property & contract** — enter the property's five-digit ZIP code, a station search radius
   (10, 15 or 25 miles), the contract type and its terms (triggers, prices, season and allowance).
2. **Billed services** — type the invoice lines into the table, or import them from a CSV file
   (see the format below). "Load example" shows a labelled demo with made-up data and no network use.
3. **Check billed services** — review the results, open "Show evidence" on any line, then use
   **Print / Save as PDF** for a one-page board report or **Export results CSV** for every line.

### What each status means

| Status | Meaning |
|---|---|
| **OK** | No issue was identified by this check. This does not prove the charge was correct. |
| **Worth questioning** | This item differs from the weather or contract information entered. Consider asking the contractor for the service log or an explanation. |
| **Not enough data** | Nearby station records were missing or incomplete for this date. No conclusion was made. |
| **Not checked** | This tool does not compare this service type with weather records. Only duplicate entries are checked. |

Missing or incomplete weather data never produces "Worth questioning".

### Disclaimer

> This report is an informational screening tool, not a certified snowfall record, invoice audit, legal opinion, or finding of overbilling. Weather stations may be miles from the property and may report on observation periods that do not match contractor service times. Local snowfall, drifting, ice, pavement conditions, and work performed may differ from station records. A flagged item is only worth asking about; it is not proof that a service was unnecessary or incorrectly billed. Confirm conditions, service logs, contract terms, and invoice details with the contractor before taking action. NOAA/NCEI data are provided as-is and may be revised. This tool is independent and is not affiliated with or endorsed by NOAA.

### Limitations

- A weather station is not the property; snowfall varies over short distances (lakes, terrain, urban heat).
- Daily observation periods do not match contractor service times.
- Rural coverage may be sparse; "Not enough data" is an intended, safe outcome.
- Snowfall is not the only reason for service (drifting, refreezing, black ice, snow banks, emergency access).
- Recent days may be missing or later revised; the access date is shown in the evidence and report.
- Salt and de-icing services are not compared with weather records in this version.
- The ZIP code is located with a Census ZIP Code Tabulation Area centroid, not the property's address.
- This is not contract interpretation or legal advice. Amounts based on the entered contract rate are estimates and are labelled as such.

### CSV import format

Download the sample from the app ("Download sample CSV") or use `public/sample-billed-services.csv`:

```csv
date,service_type,quantity,amount_charged
2025-12-07,plow,1,425.00
2025-12-07,salt,1,85.00
2026-01-15,plow,2,850.00
```

- Header row exactly `date,service_type,quantity,amount_charged` (any letter case), no extra columns.
- `date` is `YYYY-MM-DD`; `service_type` is `plow`, `salt`, `walkway` or `other`;
  `quantity` is a number greater than 0; `amount_charged` is blank or a number ≥ 0, without `$`.
- Quoted fields (RFC 4180) are accepted. Blank lines are ignored.
- The import replaces the table **only if the whole file is valid**; otherwise each problem row is listed.

### Print and export

- **Print / Save as PDF** prints a one-page, landscape US Letter report: summary, up to the first
  18 lines, station list, data attribution and the full disclaimer.
- **Export results CSV** downloads every line with its status, reasons, confidence, review amount
  and weather summary (`snow-invoice-checker-results-YYYY-MM-DD.csv`; exports from the demo are
  named `snow-invoice-checker-results-DEMO-YYYY-MM-DD.csv`). The file is created on your device.

### Remembering entries

Tick "Remember my entries on this device" to keep the form and invoice lines in this browser's local
storage. It is off by default; "Clear saved entries" removes them. Weather data is never stored.

### Troubleshooting

| Message or problem | What to do |
|---|---|
| "This ZIP code is not in the bundled 2020 Census ZIP Code Tabulation Area file…" | Some valid USPS ZIP codes have no Census ZCTA. Use a nearby ZIP for the same area. |
| "No stations with snowfall records were found within {radius} miles…" | Choose a wider radius (25 miles). Rural areas can have few reporting stations. |
| Many lines show "Not enough data" | Nearby stations did not report every day of the three-day window. Try a wider radius; this outcome is intentional. |
| "We couldn't retrieve NOAA weather data…" or "NOAA's data service returned an error…" | NOAA's service may be busy or down. Your entries are kept; try again later. |
| "The weather response could not be read safely…" | NOAA returned something unexpected. No result was calculated; try again later. |
| A CSV row error such as "Row 3: date must be a real date in YYYY-MM-DD format." | Fix that row in the file (row 1 is the first line after the header) and import again. |
| "Your browser blocked local storage…" | Private browsing or strict settings block storage. The checker still works; entries just won't be remembered. |
| "Part of this page didn't load. Reload the page to use the checker." or the page looks unstyled | Reload the page. A brief connection problem can stop a file loading, and for up to 10 minutes after a new version is published your browser may hold a mix of old and new files. If it persists, wait a few minutes and reload again. |

---

## For developers

### Requirements and commands

Node 20+ is used only for scripts and tests. There is **no `npm install`** and no runtime
dependency; the site is plain HTML, CSS and JavaScript modules. Commands work in Windows
PowerShell and macOS/Linux shells.

```bash
node --test                      # all offline tests
node --test tests/checks.test.mjs
node scripts/serve.mjs 8000      # local preview (or: python -m http.server 8000), then open http://localhost:8000
node scripts/smoke-noaa.mjs      # opt-in LIVE NOAA check: [zip] [date] [radius]; never in CI
```

ES modules do not work from `file://`; always preview over HTTP.

### Bundled data (built by scripts from official files; never hand-written)

Raw downloads go in `data-source/` (git-ignored).

| Output | Source | Build command |
|---|---|---|
| `public/data/zcta-centroids.json` | https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip (extract `2020_Gaz_zcta_national.txt`; Windows PowerShell: `tar -xf`, macOS/Linux: `unzip`) | `node scripts/build-zcta-json.mjs ./data-source/2020_Gaz_zcta_national.txt ./public/data/zcta-centroids.json` |
| `public/data/ghcn-stations-us.json` | https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt and https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-inventory.txt (layout per https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt) | `node scripts/build-ghcn-stations.mjs ./data-source/ghcnd-stations.txt ./data-source/ghcnd-inventory.txt ./public/data/ghcn-stations-us.json` |

Built 2026-11-25: 33,144 ZCTA centroids; 30,235 U.S. stations with a SNOW record through 2024 or later.

### Tests and fixture policy

- `node --test` runs everything offline with Node's built-in runner; no test touches the network.
- `tests/fixtures/ncei-daily-summaries-live-*.json` are **unmodified** live NOAA responses; their URL,
  HTTP status, capture time and sha256 are in `ncei-request-metadata.json`, and a test fails if a byte
  changes. `.gitattributes` keeps line endings untouched. Never edit them.
- Synthetic data always has `SYNTHETIC` in its file or test name.

### Folder map

```text
index.html                     page shell (all paths relative)
assets/css/styles.css          screen + print styles
assets/js/app.js               DOM wiring, state, validation, demo mode, rendering
assets/js/constants.js         enums, defaults, allowlist, all user-facing copy, WAITLIST_URL
assets/js/zip.js               ZCTA lookup        assets/js/stations.js   Haversine, radius, SNOW period
assets/js/weather-client.js    NOAA URL, batching (20 stations, 2 concurrent), 20 s timeout, one retry, cache
assets/js/weather-normalizer.js  the only module that knows raw NOAA field names
assets/js/checks.js            pure screening rules + money summary (no DOM, fetch, storage or clock)
assets/js/csv.js               CSV import + results export   assets/js/report.js   one-page report
assets/js/storage.js           opt-in localStorage   assets/js/format.js   money/dates   assets/js/demo-data.js
public/data/*.json             bundled ZCTA + station data   public/sample-billed-services.csv
scripts/                       data builders, local server, opt-in NOAA smoke check
tests/                         *.test.mjs + fixtures/        docs/SPEC.md   controlling specification
.github/workflows/deploy.yml   test + deploy to GitHub Pages
```

### Deploy

Push to `main`: GitHub Actions runs `node --test` (Node 24 LTS), then publishes only `index.html`,
`assets/` and `public/` to GitHub Pages. One-time repository setting:
**Settings → Pages → Source: GitHub Actions**. Action versions were verified current on 2026-11-25.

**Before launch:** replace `WAITLIST_URL` in `assets/js/constants.js` **and** the waitlist link
`href` in `index.html` with the real Google Form URL.

### NOAA weather data — observed schema (Phase 2, captured 2026-11-25)

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
| Source flags seen | `N` (CoCoRaHS), `7` (COOP via WxCoder3), `1` (NWS CF6), `H` (HPRCC real-time — excluded), `Z` (Datzilla official corrections — allowed since Phase 6) |

#### Source flag allowlist (confirmed against the GHCN-Daily readme, 2026-11-25)

`0` COOP Summary of the Day (DSI-3200) · `1` NWS CF6 daily summaries · `6` CDMP COOP (DSI-3206) ·
`7` COOP via WxCoder3 (DSI-3207) · `A` ASOS real-time · `B` ASOS 2000–2005 (DSI-3211) ·
`D` NWS CF6 via High Plains RCC · `F` U.S. Fort data · `G` GCOS / other government-supplied ·
`K` COOP digitized from paper forms · `M` Monthly METAR Extract · `N` CoCoRaHS ·
`R` NCEI Reference Network (CRN/RCRN) · `T` SNOTEL · `W` WBAN/ASOS Summary of the Day (ISD) ·
`X` U.S. First-Order Summary of the Day (DSI-3210) · `Z` Datzilla official additions or replacements
(owner decision, Phase 6) · `d` NWS Daily Summary Messages via High Plains RCC (confirmed, so included).
Excluded: `H`, blank, lowercase/foreign codes, and anything unknown.
Flags are case-sensitive.

#### Browser CORS (SPEC §3.2)

A real browser `fetch(url, { mode: 'cors', credentials: 'omit' })` of the same NCEI URL returned
HTTP 200 with readable JSON (71 records, response type `cors`) from **both** origins:
`http://localhost:8000` (2026-11-25T14:58:36Z) and `https://romulusworks.github.io` (2026-11-25T14:58:27Z).
NCEI sends `Access-Control-Allow-Origin: *`. **Result: automatic JSON mode; the CSV fallback is not needed.**

#### Station coverage (live, 2026-11-25)

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

## Source register

| ID | Source | Used for |
|---|---|---|
| S1 | NOAA NCEI GHCN-Daily product page — https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily | Dataset scope, updates, revisions |
| S2 | NCEI Access Data Service API docs — https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation | Endpoint and parameters |
| S3 | NCEI Open Data Policy — https://www.ncei.noaa.gov/sites/default/files/2023-12/NCEI%20PD-10-2-02%20-%20Open%20Data%20Policy%20Signed.pdf | Public-domain status |
| S4 | GHCN-Daily readme — https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt | Units, flags, file layouts, DOI |
| S5 | RCC-ACIS Web Services docs — https://docs.rcc-acis.org/acisws/ | Evaluated, not used |
| S6 | RCC-ACIS disclaimer — https://www.rcc-acis.org/disclaimer.html | Licensing caveat |
| S7 | Census 2020 Gazetteer files — https://www.census.gov/geographies/reference-files/2020/geo/gazetter-file.html | ZCTA download |
| S8 | Census ZCTA explanation — https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html | ZCTA limitations |

## Attribution

Weather data: NOAA National Centers for Environmental Information (NCEI), Global Historical
Climatology Network Daily (GHCN-Daily), Version 3. Dataset DOI: 10.7289/V5D21VHZ. This tool is
independent and is not affiliated with or endorsed by NOAA. ZIP code areas: U.S. Census Bureau,
2020 ZIP Code Tabulation Area Gazetteer file.
