# Free Snow Invoice Checker — Build Specification (v1.1)

> **Authority:** This file is the single source of truth for v1. Implement only what is written here.
> **Location in repo:** `docs/SPEC.md`. Claude Code must read this file and `CLAUDE.md` at the start of every phase.
> **Version history:** v1.0 (25 Nov 2026, original PDF). v1.1 (25 Nov 2026) applies the review fixes listed in §0.2.

---

## 0. How to use this document

### 0.1 For the product owner

1. Run Claude Code **on your own computer** (not a sandboxed web environment). Phases 1–2 must download files from `census.gov` and `ncei.noaa.gov` and call NOAA's live API.
2. Create an empty folder `snow-invoice-checker/`, put this file at `docs/SPEC.md` and the provided `CLAUDE.md` at the root. Run `git init`.
3. Create an empty **public** GitHub repository and connect it (`git remote add origin ...`). GitHub Pages is free for public repos.
4. Paste the Phase 1 prompt from §16. Wait for its completion report. Run its verification commands. Only then paste the next phase. **Never paste all phases at once.**
5. If Claude Code reports a blocker (a failed gate), stop and decide; do not tell it to "just make it work."

**Priority order if instructions ever conflict:** (1) hard constraints and safety wording; (2) exact logic and data-quality rules; (3) module contracts and tests; (4) UI details; (5) visual polish.

### 0.2 Changes from v1.0 (already applied below)

| # | Change | Why |
|---|---|---|
| 1 | CoCoRaHS (source flag `N`) is **allowed**. Phase 2 reports station coverage with and without it. | Excluding it would remove a large share of suburban daily snowfall reports and make most checks return "Not enough data." |
| 2 | Station list keeps only stations whose SNOW record runs through **2024 or later**. Runtime also checks the station's SNOW period covers the billed year. | Avoids querying long-closed stations; smaller file; fewer API requests. |
| 3 | **Salt weather check removed from v1.** Salt and "other" rows get the new status **Not checked** (duplicate check still runs). Weather request reduced to `SNOW,SNWD`. | GHCN-Daily weather-type codes are recorded only when an event occurs, so absence cannot be proven; the check would show "Not enough data" on every salt line. |
| 4 | Rule B (more pushes) flags **only the excess push units** on the latest rows of a storm, and money counts only those units. Rule B applies to per-push and per-inch-tier contracts only. | v1.0 would have counted legitimate pushes in the dollar total; per-event contracts don't bill by push. |
| 5 | Rule A (no significant snow) **also runs** for seasonal-allowance contracts (plow/walkway rows inside the season). | Low-snow pushes still consume the allowance. |
| 6 | Money summary is defined per **flagged unit**, so a row is never over-counted. Rule-C-only rows go to the separate overage figure. | Removes ambiguity in v1.0 §7.10. |
| 7 | GitHub Pages workflow moved to **Phase 1** so the live origin exists for the Phase 2 CORS test. | v1.0 required a deployed-origin test before deployment existed. |
| 8 | Code blocks fixed (`/\r?\n/` regex, `'\n'` strings, wrapped commands). Data JSON written **compact**. `.gitignore` added. Folder map lists every test file. | Copy-paste correctness; file size; keep raw downloads out of the site. |
| 9 | Weather requests run with **max 2 concurrent** batches. | Dense areas can have 100+ stations within 25 miles. |

**v1.2 decisions (Phase 3.5, approved by the product owner)**

| # | Change | Why |
|---|---|---|
| 10 | Rule B is **not applied** (internal status `NOT_APPLIED`, internal code `RULE_B_CANNOT_FLAG`, never shown to the user) for a storm whose `billedPushes <= 1 + extraPushesAllowedPerStorm`. It then cannot contribute NOT_ENOUGH_DATA. Storms with more pushes keep the existing rule, including NOT_ENOUGH_DATA when no complete storm window exists. | `basePushes` is always ≥ 1, so `allowedPushes` ≥ 1 + extra; such a storm can never exceed it. Without this, a line where snow clearly fell (Rule A OK) showed "Not enough data" only because Rule B lacked a full storm window. |
| 11 | New reason code **`OUTSIDE_SEASON`** for plow and walkway rows on a seasonal-allowance contract dated before `seasonStart` or after `seasonEnd`. Rules A and C do not run; Rule E still runs. Not duplicated → NOT_CHECKED with `OUTSIDE_SEASON`; duplicated → WORTH_QUESTIONING with `DUPLICATE_BILLING` and `OUTSIDE_SEASON`. Salt/other rows outside the season are unchanged (`SERVICE_TYPE_NOT_CHECKED`). | v1.1 left these rows NOT_CHECKED with no reason code or copy. |
| 12 | *(Phase 6)* Source flag **`Z`** (Datzilla official additions or replacements) added to the allowlist (§3.3). | NCEI's own corrected values; highest-priority source in the GHCN-Daily readme. Previously excluded as not allowlisted. |
| 13 | *(Phase 6)* Measurement flag `A` handling (§3.5) **kept as written**; NOAA's current definition recorded. | The readme defines `A` as a 6-hour precipitation report, not a multi-day snowfall total; it never appeared on SNOW in 14,177 live values. The §3.5 handling can only block a flag, never create one. |
| 14 | *(Phase 6)* NOAA HTTP error copy (§9.5) no longer mentions a CSV download option. | The CSV fallback was not built because browser CORS works (§3.2); the clause pointed to a feature that does not exist. |
| 15 | *(Phase 6)* Results CSV exported from demo mode is named `snow-invoice-checker-results-DEMO-YYYY-MM-DD.csv` (§12.3). Columns unchanged. | A demo export must never look like a real property check. |
| 16 | *(Phase 6)* A plain (non-module) inline script shows a reload notice (§9.5) if the app has not started 1.5 s after the page load event. | A network hiccup that stops one module file from loading otherwise leaves a silent, non-working page. It also covers the up-to-10-minute GitHub Pages cache window after a deploy, when old and new files can mix. |

---

## 1. Product definition and boundaries

### 1.1 Product summary

A free, static web tool for HOA board treasurers and small HOA management companies. The user enters a five-digit ZIP code, a station search radius, the snow-contract terms, and the billed services (editable table or CSV). The browser retrieves historical daily snowfall from nearby NOAA GHCN-Daily stations, applies conservative screening rules, and produces a clean printable report for a board meeting.

The app is an **informational screening tool**. It does not determine whether a contractor breached a contract, whether a service was necessary, whether a charge is recoverable, or whether an invoice is fraudulent. Drifting, refreezing, pavement temperature, site layout, timing, emergency response and actual work logs are not represented by daily station data.

### 1.2 Exact positioning

- Required product phrase: **"Worth questioning."**
- Prohibited: "You were overcharged," "fraud," "unnecessary," "refund," "money owed," "savings," "overcharge."
- Use: **"Estimated amount associated with items worth reviewing."**

### 1.3 V1 must include

- ZIP validation against a bundled 2020 Census ZCTA centroid dataset.
- Station radius 10 / 15 / 25 miles (default 15).
- Contract type, triggers, conditional contract fields, billed-service editor, CSV paste/upload, example mode.
- NOAA weather retrieval with in-memory session cache, one retry, exact error states, and a manual CSV fallback if browser CORS fails.
- Pure deterministic checking logic in its own module, tested with Node's built-in runner.
- Per-line results with expandable evidence, printable one-page report, results CSV export.
- Waitlist CTA linking to a placeholder Google Form URL.
- Responsive, keyboard-accessible design; opt-in local persistence.

### 1.4 Out of scope for v1

- Contract/invoice PDF upload, OCR, AI analysis, any AI API.
- Accounts, authentication, database, email capture, analytics, tracking, server.
- Payments, contacting contractors, legal advice, definitive audit findings.
- Salt/de-icing weather checks (see §0.2 #3). Landscaping, pool, janitorial or other vendor types.
- Any claim that a station reading equals site-specific snowfall.

---

## 2. Hard constraints and engineering decisions

| Area | Binding decision |
|---|---|
| Hosting | GitHub Pages, static files only. |
| Runtime | Plain HTML, CSS, native JavaScript ES modules. No framework, no bundler. |
| Dependencies | No runtime npm dependencies. No `npm install`. Node 20+ used only for scripts and tests. |
| Backend | None. No serverless function, worker, proxy, database, API gateway. |
| Cost | Zero running cost. NOAA/NCEI and Census public resources only. |
| Secrets | None required. Never commit a secret. |
| Personal data | No account, no form submission from the app. ZIP and invoice details stay in the browser. NOAA receives station IDs and dates only. |
| Storage | `localStorage` optional, opt-in, every call in `try/catch`. App works when storage is blocked. |
| Browsers | Current Chrome, Safari, Firefox, Edge; desktop and mobile. |
| Accessibility | Semantic HTML, explicit labels, keyboard operation, visible focus, WCAG AA contrast, responsive tables. |

### 2.1 Do not change these decisions

Do not add React, Vue, Angular, Next.js, Tailwind tooling, Firebase, Supabase, Vercel/Netlify functions, paid geocoders, commercial weather APIs, analytics, or AI services. Do not create a backend "just for CORS." If NOAA cannot be read in-browser, use the CSV download + upload fallback (§3.2). If that fallback is not workable, **stop and ask the product owner**.

### 2.2 Local development

```bash
# Node 20+ required for tests and build scripts. No npm install.
node --version
node --test

# Serve over HTTP (ES modules do not work from file://)
python -m http.server 8000          # macOS/Linux/Windows if Python installed
# or, Node core only (no packages):
node scripts/serve.mjs 8000
# open http://localhost:8000
```

`scripts/serve.mjs` is a ~30-line static file server using only `node:http`, `node:fs`, `node:path` (correct MIME types for `.html .css .js .mjs .json .csv`). README commands must work in Windows PowerShell and macOS/Linux shells.

### 2.3 `.gitignore`

```gitignore
data-source/
*.zip
.DS_Store
node_modules/
```

---

## 3. Data sources

### 3.1 Weather: NOAA NCEI GHCN-Daily via the Access Data Service

GHCN-Daily is NCEI's integrated database of daily land-station summaries (snowfall, snow depth, precipitation, temperature, etc.). Coverage and record periods vary by station. [S1]

Endpoint: `https://www.ncei.noaa.gov/access/services/data/v1` (HTTPS GET). Documented parameters include `dataset`, `stations`, `startDate`, `endDate`, `dataTypes`, `format`, `includeAttributes`, `includeStationName`, `includeStationLocation`, `units`. Data type codes are case-sensitive. [S2]

**Exact v1 request**

```text
GET https://www.ncei.noaa.gov/access/services/data/v1
    ?dataset=daily-summaries
    &stations=<up to 20 comma-separated GHCN IDs>
    &startDate=<earliest billed date - 1 day>
    &endDate=<latest billed date + 1 day>
    &dataTypes=SNOW,SNWD
    &includeAttributes=true
    &includeStationName=true
    &includeStationLocation=true
    &format=json
    &units=metric
```

```js
// assets/js/weather-client.js (URL builder)
export const NCEI_ENDPOINT = 'https://www.ncei.noaa.gov/access/services/data/v1';
export const DATA_TYPES = ['SNOW', 'SNWD'];

export function buildNceiUrl(stationIds, startDate, endDate, format = 'json') {
  if (!Array.isArray(stationIds) || stationIds.length < 1 || stationIds.length > 20) {
    throw new Error('NCEI request must contain between 1 and 20 station IDs.');
  }
  const url = new URL(NCEI_ENDPOINT);
  const p = url.searchParams;
  p.set('dataset', 'daily-summaries');
  p.set('stations', stationIds.join(','));
  p.set('startDate', startDate);
  p.set('endDate', endDate);
  p.set('dataTypes', DATA_TYPES.join(','));
  p.set('includeAttributes', 'true');
  p.set('includeStationName', 'true');
  p.set('includeStationLocation', 'true');
  p.set('format', format);
  p.set('units', 'metric');
  return url;
}
```

Rules:
- Build URLs with `URL`/`URLSearchParams`, never string concatenation.
- Max 20 station IDs per request; run **at most 2 requests concurrently**.
- Date range = earliest billed date − 1 day through latest billed date + 1 day. If billed dates span more than one winter (gap > 120 days), split into separate ranges per cluster of dates.

**Response shape is NOT verified.** The NCEI docs confirm JSON output and that `includeAttributes=true` adds an attribute string per data type (documented pattern: measurement flag, quality flag, source flag, observation time — e.g. `T,,N,0700`), but give no sample body. The block below is an **illustration only**, never a fixture:

```json
[
  {
    "DATE": "2025-12-01",
    "STATION": "USC00000000",
    "NAME": "EXAMPLE",
    "LATITUDE": "42.0000",
    "LONGITUDE": "-83.0000",
    "SNOW": "0.0",
    "SNOW_ATTRIBUTES": "T,,N,0700",
    "SNWD": "0.0",
    "SNWD_ATTRIBUTES": ",,N,0700"
  }
]
```

Phase 2 captures the real body and the normalizer is written against it. The normalizer is the **only** module that knows raw API field names.

**Live capture requirement (Phase 2):**

```text
tests/fixtures/ncei-daily-summaries-live-<capture-date>.json   # unmodified body
tests/fixtures/ncei-request-metadata.json                      # URL, HTTP status, capture time, dataTypes, units, doc URL
```

Capture at least: one response with positive snowfall, one with zero or trace if available, one with an absent value, all with attributes. Edge cases not present in live data go in `tests/fixtures/ncei-daily-summaries-SYNTHETIC-edge-cases.json`; synthetic records are never called live.

**Data freshness:** GHCN-Daily updates daily, but recent days can arrive late and values can be revised (archive-ready replacements typically 45–60 days after month end). [S1] Show the access date and "data may be revised" in evidence and report.

### 3.2 CORS: mandatory proof

Browser CORS is **not verified**. A public URL that opens in a tab does not prove `fetch` can read it. Test from `http://localhost:8000` and from the live GitHub Pages origin (deployed in Phase 1).

```bash
# Header check (necessary, not sufficient)
curl -sS -D - -o /tmp/ncei-body.json -H "Origin: http://localhost:8000" "<exact encoded NCEI URL>"
# Required: HTTP 200, valid JSON, and Access-Control-Allow-Origin: * (or the exact origin)
```

```js
// Browser proof — run in DevTools on the app's own origin
fetch(exactUrl, { method: 'GET', mode: 'cors', credentials: 'omit' })
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(d => console.log('CORS PASS', d))
  .catch(e => console.error('CORS FAIL', e));
```

Never use `mode: "no-cors"`. Never add a proxy.

**If CORS fails — no-backend fallback:**
1. Keep the same station discovery, query builder, normalizer and checks.
2. Show a **"Download NOAA data CSV"** link per batch (same query, `format=csv`), opened as a normal navigation.
3. Show an **"Upload NOAA CSV"** file input (multiple files allowed); parse locally. CSV column handling is derived from a **real captured CSV** in Phase 2.
4. Show: "NOAA data could not be loaded directly in this browser. Download the CSV below, then upload the file here. The data stays on this device."
5. If neither JSON fetch nor CSV fallback can be verified, stop Phase 2 and report.

### 3.3 Licensing, provenance and source flags

NCEI's open-data policy: NOAA/federal environmental data are public domain in the U.S. [S3] GHCN-Daily merges multiple sources and records a **source flag** per value. [S1, S4]

**Source flag allowlist (v1.1):** `0, 1, 6, 7, A, B, D, F, G, K, M, N, R, T, W, X`, plus `d` only if the Phase 2 readme check confirms its meaning. `N` = CoCoRaHS (allowed). Exclude `H`, all foreign/non-U.S. codes, blank, and unknown codes. Phase 2 must re-read the current readme [S4] and confirm each allowed code; remove any code whose meaning is unclear. *(v1.2, Phase 6, owner decision: `Z` — "Datzilla official additions or replacements", NCEI's own corrected values and the highest-priority source in the readme — is **added** to the allowlist.)*

Source flag `T` (SNOTEL) and measurement flag `T` (trace) are different fields; store them separately.

If the API does not expose a per-value source flag, weather values must not produce a "Worth questioning" finding; mark weather checks "Not enough data" and report the blocker.

**Attribution (app + report):**
"Weather data: NOAA National Centers for Environmental Information (NCEI), Global Historical Climatology Network Daily (GHCN-Daily), Version 3. Accessed [date]. Dataset DOI: 10.7289/V5D21VHZ. This tool is independent and is not affiliated with or endorsed by NOAA."

### 3.4 Elements and units

| Element | Meaning | Raw `.dly` unit | v1 use |
|---|---|---|---|
| SNOW | Daily snowfall | mm | Convert to inches (mm ÷ 25.4). The only variable used for rules. |
| SNWD | Snow depth on ground | mm | Evidence context only. Never a substitute for SNOW. |

Phase 2 must confirm the unit returned with `units=metric` from the live response. Do not double-convert.

### 3.5 Missing values, traces, flags

| Condition | Treatment |
|---|---|
| Field absent / empty / null / `-9999` | **Missing**, never zero. |
| Measurement flag `T` (trace) | Valid observed trace → 0.0 in for comparisons; label "Trace" in evidence. |
| Measurement flag `P` (missing, presumed zero) | Counts as a usable day but caps confidence at LOW; label "presumed zero." |
| Measurement flag `A` (multi-day accumulation) | Do not assign to the day; window is `accumulated=true`; blocks HIGH/MEDIUM no-snow findings for that station. If the accumulated value ≥ trigger, treat as evidence snow occurred (Rule A returns OK). *(v1.2 note: NOAA's current readme defines measurement flag `A` as "precipitation total from one report of 6-hour precipitation amount"; it was not observed on SNOW in 14,177 live values. This handling is kept because it can only block a flag.)* |
| Non-blank quality flag | Exclude from calculations; show as "rejected quality data." |
| Blank quality flag | Passed QC; usable if source flag allowed. |
| Source flag blank / not allowlisted | Exclude; show reason in evidence. |
| Attributes missing although requested | Fail Phase 2 gate. |

Parse attribute strings by the documented order (measurement, quality, source, time) **only after** the live fixture confirms it.

### 3.6 RCC-ACIS — not used in v1

ACIS (`https://data.rcc-acis.org/StnMeta|StnData|MultiStnData`) was evaluated. [S5] Its disclaimer gives no clear public-domain grant and CORS was not verified. [S6] Do not switch to ACIS without a separate owner decision.

### 3.7 Station metadata → `public/data/ghcn-stations-us.json`

Download during development (not runtime calls) into `data-source/`:

```text
https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt
https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-inventory.txt
https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt
```

Fixed-width layouts per readme [S4]: stations — ID 1–11, LAT 13–20, LON 22–30, ELEV 32–37, STATE 39–40, NAME 42–71. Inventory — ID 1–11, LAT 13–20, LON 22–30, ELEMENT 32–35, FIRSTYEAR 37–40, LASTYEAR 42–45. **Phase 1 must confirm these against the downloaded readme.**

Include a station only if: ID starts with `US`, valid lat/lon and name, has a SNOW inventory record, and SNOW `lastYear >= MIN_SNOW_LAST_YEAR` (2024).

Output (compact JSON, one line):

```json
{"source":"NOAA NCEI GHCN-Daily station and inventory files","builtAt":"2026-11-25","minSnowLastYear":2024,"stations":[{"id":"USC00000000","name":"EXAMPLE","lat":42.0,"lon":-83.0,"elevation_m":190.0,"state":"MI","snow":{"firstYear":1950,"lastYear":2026}}]}
```

**`scripts/build-ghcn-stations.mjs`**

```js
import fs from 'node:fs/promises';
import path from 'node:path';

const MIN_SNOW_LAST_YEAR = 2024;
const [stationsPath, inventoryPath, outputPath = 'public/data/ghcn-stations-us.json'] = process.argv.slice(2);
if (!stationsPath || !inventoryPath) {
  console.error('Usage: node scripts/build-ghcn-stations.mjs <ghcnd-stations.txt> <ghcnd-inventory.txt> [output.json]');
  process.exit(1);
}

const num = (v) => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : null; };
const lines = (text) => text.split(/\r?\n/).filter((l) => l.trim());

const stationMap = new Map();
for (const line of lines(await fs.readFile(stationsPath, 'utf8'))) {
  const id = line.slice(0, 11).trim();
  if (!id.startsWith('US')) continue;
  const s = {
    id,
    name: line.slice(41, 71).trim(),
    lat: num(line.slice(12, 20)),
    lon: num(line.slice(21, 30)),
    elevation_m: num(line.slice(31, 37)),
    state: line.slice(38, 40).trim(),
  };
  if (s.lat === null || s.lon === null || !s.name) continue;
  stationMap.set(id, s);
}

const snowPeriods = new Map();
for (const line of lines(await fs.readFile(inventoryPath, 'utf8'))) {
  const id = line.slice(0, 11).trim();
  if (!stationMap.has(id)) continue;
  if (line.slice(31, 35).trim() !== 'SNOW') continue;
  const firstYear = Number(line.slice(36, 40).trim());
  const lastYear = Number(line.slice(41, 45).trim());
  if (!Number.isInteger(firstYear) || !Number.isInteger(lastYear)) continue;
  snowPeriods.set(id, { firstYear, lastYear });
}

const stations = [];
for (const [id, s] of stationMap) {
  const snow = snowPeriods.get(id);
  if (!snow || snow.lastYear < MIN_SNOW_LAST_YEAR) continue;
  stations.push({ ...s, snow });
}
stations.sort((a, b) => a.id.localeCompare(b.id));
if (stations.length === 0) throw new Error('No eligible US SNOW stations found.');

const output = {
  source: 'NOAA NCEI GHCN-Daily station and inventory files',
  builtAt: new Date().toISOString().slice(0, 10),
  minSnowLastYear: MIN_SNOW_LAST_YEAR,
  stations,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(output) + '\n', 'utf8');
console.log(`Wrote ${stations.length} US SNOW stations (lastYear >= ${MIN_SNOW_LAST_YEAR}) to ${outputPath}.`);
```

```bash
node scripts/build-ghcn-stations.mjs ./data-source/ghcnd-stations.txt ./data-source/ghcnd-inventory.txt ./public/data/ghcn-stations-us.json
```

**Runtime station eligibility:** distance ≤ radius (Haversine, inclusive) **and** `snow.firstYear <= billedYear <= snow.lastYear` for at least one billed date's year. No nearest-N cap.

### 3.8 ZIP → centroid: Census 2020 ZCTA Gazetteer → `public/data/zcta-centroids.json`

Source: `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip` [S7]. Extract `2020_Gaz_zcta_national.txt` into `data-source/` (`unzip` on macOS/Linux; `tar -xf file.zip` in Windows PowerShell).

A ZCTA is a Census approximation of USPS ZIP areas; not every USPS ZIP has one. [S8] The UI calls it a "ZIP code area" lookup and never says the centroid is the property location.

Output (compact): `{"01001":[42.06,-72.62],...}` — key = 5-char string (leading zeros kept), value = `[lat, lon]`.

**`scripts/build-zcta-json.mjs`**

```js
import fs from 'node:fs/promises';
import path from 'node:path';

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? 'public/data/zcta-centroids.json';
if (!inputPath) {
  console.error('Usage: node scripts/build-zcta-json.mjs <2020_Gaz_zcta_national.txt> [output.json]');
  process.exit(1);
}

const raw = await fs.readFile(inputPath, 'utf8');
const rows = raw.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
if (rows.length < 2) throw new Error('Gazetteer file is empty or has no data rows.');

const headers = rows[0].split('\t').map((h) => h.trim());
const need = ['GEOID', 'INTPTLAT', 'INTPTLONG'];
const idx = Object.fromEntries(need.map((n) => [n, headers.indexOf(n)]));
for (const n of need) if (idx[n] < 0) throw new Error(`Missing required Gazetteer column: ${n}`);

const out = Object.create(null);
let skipped = 0;
for (const row of rows.slice(1)) {
  const c = row.split('\t');
  const zip = (c[idx.GEOID] ?? '').trim().padStart(5, '0');
  const lat = Number(c[idx.INTPTLAT]);
  const lon = Number(c[idx.INTPTLONG]);
  if (!/^\d{5}$/.test(zip) || !Number.isFinite(lat) || !Number.isFinite(lon)) { skipped++; continue; }
  out[zip] = [lat, lon];
}
if (Object.keys(out).length === 0) throw new Error('No valid ZCTA centroids parsed.');

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(out) + '\n', 'utf8');
console.log(`Wrote ${Object.keys(out).length} ZCTA centroids to ${outputPath}; skipped ${skipped}.`);
```

```bash
node scripts/build-zcta-json.mjs ./data-source/2020_Gaz_zcta_national.txt ./public/data/zcta-centroids.json
```

Fail loudly if header names change. Verify a leading-zero ZIP (e.g. `01001`), an urban MI/OH/CO ZIP, and a ZIP absent from the file.

---

## 4. Inputs

### 4.1 Property and station search

| Field | Required / default | Validation |
|---|---|---|
| Property ZIP code | Required | Exactly 5 digits, kept as string, must exist in ZCTA JSON. |
| Station radius | 15 miles | Select: 10, 15, 25. Inclusive. |

Help text: "We use a Census ZIP Code Tabulation Area centroid to find nearby stations. It may not be the exact property location." Show the centroid inside a "Location method" disclosure.

### 4.2 Contract types

| Contract type | Fields and rules |
|---|---|
| Per-push | Optional price per push. Rules A, B, E. |
| Per-event | Optional price per event. Quantity = events. Rules A, E. (Rule B not applied — billing is not per push.) |
| Per-inch tiers | Tier table (§4.4). Rules A, B, E. |
| Seasonal flat fee with push allowance | Required season start/end, allowance; optional overage rate; checkbox "Allowance counts walkway services too" (off). Rules A (in-season rows), C, E. |
| Seasonal flat fee, unlimited | Optional fee amount (display only). Rule E only. |

### 4.3 Thresholds

| Field | Default | Validation |
|---|---|---|
| Plow trigger | 2.0 in | Required, 0.1–12.0. |
| Walkway trigger | blank → inherit plow trigger | Optional, 0.1–12.0. Evidence states when inherited. |
| Extra pushes allowed per storm | 1 | Select 0/1/2. Shown only for per-push and tier contracts. |
| Season start / end | none | Required for allowance contract; YYYY-MM-DD; end ≥ start; may cross Dec 31. |
| Push allowance | none | Required for allowance contract; number ≥ 0. |
| Overage rate | none | Optional, ≥ 0 USD per push. Missing → show excess quantity, no dollar estimate. |
| "I entered every billed push for this season" | unchecked | Allowance contract only. Affects confidence. |

### 4.4 Tier table (per-inch tiers)

Rows: `[min_snow_inches, max_snow_inches_exclusive)` with `charge_per_push`. First min = 0.0; adjacent rows meet exactly (no gaps/overlaps); only the last max may be blank (= infinity). If invalid: accept the invoice, disable tier-based estimates, show the exact validation error.

```json
[
  { "min_snow_inches": 0.0, "max_snow_inches_exclusive": 2.0,  "charge_per_push": 95.00 },
  { "min_snow_inches": 2.0, "max_snow_inches_exclusive": 5.0,  "charge_per_push": 145.00 },
  { "min_snow_inches": 5.0, "max_snow_inches_exclusive": null, "charge_per_push": 210.00 }
]
```

Tier selection uses the storm's `eventSnowInches` (§7.4). No match → estimate unavailable.

### 4.5 Billed-services editor

Columns: Date (required), Service type (`plow | walkway | salt | other`), Quantity (required, > 0, default 1), Amount charged (optional USD ≥ 0). Add/edit/remove rows; keyboard editable; horizontally scrollable on mobile. Amounts stored as **integer cents**. Blank amount = unknown (not $0).

### 4.6 Local persistence

Checkbox "Remember my entries on this device" (default off). If on, save inputs + rows to `localStorage`; every call in `try/catch`; corrupt state ignored with a notice. Buttons "Clear saved entries" and "Reset". Weather data is never stored in `localStorage`.

---

## 5. CSV import

### 5.1 Columns and sample (`public/sample-billed-services.csv`)

```csv
date,service_type,quantity,amount_charged
2025-12-07,plow,1,425.00
2025-12-07,salt,1,85.00
2025-12-08,plow,1,425.00
2026-01-15,plow,2,850.00
2026-01-15,walkway,1,95.00
2026-02-04,plow,1,425.00
2026-02-18,walkway,1,95.00
2026-03-02,plow,1,425.00
```

A "Download sample CSV" button serves this file. Users can paste CSV text or choose a `.csv` file. Import replaces the table **only if the whole file validates**.

### 5.2 Parser rules

- UTF-8 with or without BOM; CRLF or LF.
- RFC 4180 quoting (commas and `""` inside quoted cells).
- Header names case-insensitive after trim; exactly `date,service_type,quantity,amount_charged` in that order; no extra columns.
- `date`: real Gregorian date, `YYYY-MM-DD` only.
- `service_type`: `plow|salt|walkway|other`, case-insensitive, stored lowercase.
- `quantity`: finite decimal > 0.
- `amount_charged`: blank or finite decimal ≥ 0 (an optional leading `$` is NOT accepted).
- Fully blank lines ignored; partially blank rows rejected.
- Errors show row number (1 = first data row) and the exact message. Never silently fix values.

### 5.3 Exact CSV error messages

| Condition | Message |
|---|---|
| No content | "Paste CSV text or choose a CSV file to import." |
| Missing header | "The CSV is missing the required header row: date, service_type, quantity, amount_charged." |
| Extra/unknown column | "The CSV contains an unexpected column. Use only: date, service_type, quantity, amount_charged." |
| Invalid date | "Row {n}: date must be a real date in YYYY-MM-DD format." |
| Invalid service type | "Row {n}: service_type must be plow, salt, walkway, or other." |
| Invalid quantity | "Row {n}: quantity must be a number greater than 0." |
| Invalid amount | "Row {n}: amount_charged must be blank or a number greater than or equal to 0." |
| Partially blank row | "Row {n}: every column except amount_charged must have a value." |
| Bad quoting | "The CSV has an unmatched quote or invalid quoted field. Check row {n} and try again." |

---

## 6. Data contracts between modules

### 6.1 Normalized station observation (output of `weather-normalizer.js`)

```js
{
  stationId: 'USC00000000',
  stationName: '...',
  latitude: 42.0,
  longitude: -83.0,
  distanceMiles: 8.4,          // added by stations.js
  date: '2025-12-01',
  elements: {
    SNOW: {
      valueInches: 0,           // null when missing
      rawValue: '0.0',
      measurementFlag: 'T',     // '', 'T', 'P', 'A', ...
      qualityFlag: '',
      sourceFlag: 'N',
      usable: true,             // passed quality + source rules and not missing
      trace: true,
      presumedZero: false,
      accumulated: false,
      excludedReason: null      // e.g. 'QUALITY_FLAG', 'SOURCE_NOT_ALLOWED', 'MISSING'
    },
    SNWD: { /* same shape, context only */ }
  }
}
```

### 6.2 Billed row

```js
{ id: 'r1', date: '2026-01-15', serviceType: 'plow', quantity: 2, amountChargedCents: 85000 /* or null */, sourceRowNumber: 4 }
```

### 6.3 Check result (one per billed row)

```js
{
  rowId: 'r1',
  status: 'OK' | 'WORTH_QUESTIONING' | 'NOT_ENOUGH_DATA' | 'NOT_CHECKED',
  reasonCodes: ['NO_SIGNIFICANT_SNOW', 'DUPLICATE_BILLING'],   // all matched rule codes
  reasonText: 'Combined plain-English text',
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null,               // null for OK / NOT_ENOUGH_DATA / NOT_CHECKED
  flaggedUnits: 2,              // units of this row counted toward the review amount (0 if none)
  allowanceExcessUnits: 0,      // units beyond seasonal allowance (Rule C)
  estimatedAmountCents: 85000,  // review amount for this row, or null if unavailable
  amountIsRateEstimate: false,
  ruleResults: { A: {...}, B: {...}, C: {...}, E: {...} },      // per-rule status + evidence
  evidence: { stations: [...], windowDates: [...], maxSnowInches, medianSnowInches, stationCount }
}
```

Reason codes: `NO_SIGNIFICANT_SNOW`, `MORE_PUSHES_THAN_SUGGESTED`, `ALLOWANCE_EXCEEDED`, `DUPLICATE_BILLING`, `INSUFFICIENT_DATA`, `NO_ISSUE`, `SERVICE_TYPE_NOT_CHECKED`, `SEASONAL_UNLIMITED_DUPLICATE_ONLY`, `OUTSIDE_SEASON` *(v1.2)*.

---

## 7. Checking logic

### 7.1 Date window

For billed date D: `windowDates(D) = [D-1, D, D+1]` (UTC date-only arithmetic). Previous day included because morning observations cover the prior 24 hours; next day included because late storms appear in the next morning's report. This is a screening heuristic, not exact time matching.

A station's window is **complete** when SNOW is `usable` on all three dates (trace and presumed-zero count as usable values; missing, quality-failed or source-excluded do not). Partial windows are kept as evidence only.

### 7.2 Station combination

1. ZIP → centroid; if absent, stop before any weather call.
2. Eligible stations = within radius and SNOW period covers the billed year (§3.7).
3. For each complete window: `totalSnowInches` = sum of the three daily SNOW values (trace = 0). Flags on the window: `presumedZero` if any day has P; `accumulated` if any day has A (A days are not summed).
4. `maxSnow` = max of complete-window totals; `medianSnow` = median (display only). **Max drives all decisions.**
5. Affirmative-snow shortcut: if **any** usable value in **any** window (complete or partial, including an A accumulation value) or any partial-window running sum is ≥ the trigger, snow is considered to have occurred → no-snow rule returns OK.

### 7.3 Rule A — no significant snow

Applies to `plow` and `walkway` rows under per-push, per-event, per-inch tiers, and seasonal-allowance (rows inside the season only). Not applied to unlimited contracts. *(v1.2)* Seasonal-allowance plow/walkway rows outside the season get reason code `OUTSIDE_SEASON` (§7.5, §7.9).

```js
function evaluateNoSignificantSnow(row, contract, windows) {
  const trigger = row.serviceType === 'walkway' && contract.walkwayTriggerInches != null
    ? contract.walkwayTriggerInches : contract.plowTriggerInches;
  if (windows.anyAffirmativeAtOrAbove(trigger)) return { status: 'OK' };
  const complete = windows.complete();   // excludes accumulated windows from HIGH/MEDIUM eligibility via confidence
  if (complete.length === 0) return { status: 'NOT_ENOUGH_DATA', code: 'INSUFFICIENT_DATA' };
  const totals = complete.map(w => w.totalSnowInches);
  const maxSnow = Math.max(...totals);
  if (maxSnow >= trigger) return { status: 'OK' };
  return {
    status: 'WORTH_QUESTIONING', code: 'NO_SIGNIFICANT_SNOW',
    flaggedUnits: row.quantity,
    confidence: confidenceForNoSnow(complete, trigger - maxSnow),
    evidence: { maxSnow, medianSnow: median(totals), stationCount: complete.length, trigger }
  };
}
```

Comparison is strictly `maxSnow < trigger` → flag. Compare at full precision; display to 1 decimal.

### 7.4 Rule B — more pushes than snowfall suggests

Applies to `plow` rows under **per-push** and **per-inch tiers** only.

0. *(v1.2)* For each storm (grouped as in step 1), if `billedPushes <= 1 + extraPushesAllowedPerStorm`, Rule B is **not applied** to every row in that storm (internal status `NOT_APPLIED`, internal code `RULE_B_CANNOT_FLAG`, never shown to the user) and steps 2–6 do not decide its result; it cannot contribute NOT_ENOUGH_DATA. Justification: `basePushes` is always ≥ 1, so `allowedPushes` ≥ 1 + extra, and such a storm can never exceed it. `eventSnowInches` is still computed when available, for tier selection (§4.4). Storms with `billedPushes > 1 + extra` follow steps 1–6 unchanged.
1. Sort plow rows by date. Group into storms: a new storm starts when the next plow date is more than 2 calendar days after the previous plow date in the group.
2. Storm window dates = union of `windowDates(D)` for every D in the storm (each station-day counted once).
3. A station's storm total is valid only if SNOW is usable on every date of the storm window (accumulation days make that station invalid for this rule).
4. `eventSnowInches` = max valid station storm total. If none valid → Rule B result `NOT_ENOUGH_DATA` for every row in the storm.
5. If `eventSnowInches < plowTrigger` → Rule B not applied (Rule A covers it).
6. Otherwise:

```text
basePushes    = max(1, ceil(eventSnowInches / plowTriggerInches))
allowedPushes = basePushes + extraPushesAllowedPerStorm
billedPushes  = sum(quantity of plow rows in storm)
excess        = billedPushes - allowedPushes
if excess > 0:
   walk rows newest-date first (ties: later sourceRowNumber first) and assign excess units
   to them until excess is exhausted; each touched row gets
   WORTH_QUESTIONING, code MORE_PUSHES_THAN_SUGGESTED, flaggedUnits = units assigned, confidence LOW
else: OK
```

Always LOW confidence. Reason text must say weather totals cannot determine how many site visits were needed.

### 7.5 Rule C — seasonal allowance exceeded

Applies only to seasonal-allowance contracts.

```text
counted rows = plow rows (and walkway rows if checkbox on) with seasonStart <= date <= seasonEnd
seasonPushes = sum(quantity of counted rows)
excess       = max(0, seasonPushes - allowance)
if excess > 0:
   assign excess units newest-first (same tie rule as Rule B);
   touched rows: WORTH_QUESTIONING, code ALLOWANCE_EXCEEDED, allowanceExcessUnits = units assigned
   contractualOverageCents = excess * overageRateCents   (null if no rate)
```

Confidence: HIGH if "I entered every billed push" is checked; otherwise MEDIUM. Never claim the season stayed within allowance unless the user checked that box (if not exceeded and box unchecked, Rule C is OK but the summary notes "season may be incomplete").

Rows outside the season appear in results but don't count toward the allowance. *(v1.2)* Plow and walkway rows outside the season: Rules A and C do not run; Rule E still runs. If not flagged as a duplicate → NOT_CHECKED with reason code `OUTSIDE_SEASON`. If flagged as a duplicate → WORTH_QUESTIONING with `DUPLICATE_BILLING`, and `reasonCodes` also includes `OUTSIDE_SEASON`. Salt and other rows outside the season keep `SERVICE_TYPE_NOT_CHECKED`.

### 7.6 Rule E — duplicate billing

Group rows by identical `date` + `serviceType`. Groups of 2+ → every row `WORTH_QUESTIONING`, code `DUPLICATE_BILLING`, `flaggedUnits = quantity`.
- HIGH: all rows in the group identical in quantity and amount.
- MEDIUM: otherwise (separate visits may be legitimate).
Never merge or delete rows. Runs for all contract types and all service types.

### 7.7 Not checked — salt and other

`salt` and `other` rows: no weather rules. If Rule E flags them → WORTH_QUESTIONING. Otherwise status `NOT_CHECKED`, code `SERVICE_TYPE_NOT_CHECKED`.

### 7.8 Unlimited seasonal contracts

Only Rule E runs. Rows not flagged as duplicates → `NOT_CHECKED`, code `SEASONAL_UNLIMITED_DUPLICATE_ONLY`.

### 7.9 Combining rules into one result per row

1. Any rule WORTH_QUESTIONING → row status WORTH_QUESTIONING. `reasonCodes` lists all matched codes; `reasonText` joins their copy. Row `confidence` = the highest confidence among flagging rules. *(v1.2)* For a seasonal-allowance plow/walkway row outside the season, `OUTSIDE_SEASON` is appended to `reasonCodes` (and its copy to `reasonText`); it does not affect confidence.
2. Else, if any applicable weather rule returned NOT_ENOUGH_DATA → NOT_ENOUGH_DATA. *(v1.2)* A rule with status `NOT_APPLIED` (Rule B, §7.4 step 0) is ignored here, exactly like a rule that does not apply to the contract type.
3. Else, if no weather rule was applicable (salt/other/unlimited/outside the allowance season) → NOT_CHECKED. *(v1.2)* Reason code: `SEASONAL_UNLIMITED_DUPLICATE_ONLY` for unlimited contracts; `SERVICE_TYPE_NOT_CHECKED` for salt/other; `OUTSIDE_SEASON` for seasonal-allowance plow/walkway rows outside the season.
4. Else → OK.

Row `flaggedUnits` = **max** of `flaggedUnits` from rules A, B and E (never summed). Rule C units are tracked separately in `allowanceExcessUnits`.

### 7.10 Money

- **Total billed** = sum of non-blank amounts.
- **Items worth questioning** = count of rows with status WORTH_QUESTIONING.
- **Per-unit amount** for a row = `amountChargedCents / quantity` if amount present; else the contract rate (per push, per event, or selected tier charge) with `amountIsRateEstimate = true`; else unavailable.
- **Row review amount** = `round(perUnitAmount × flaggedUnits)` when `flaggedUnits > 0`.
- **Estimated amount associated with items worth reviewing** = sum of row review amounts. Rows whose amount is unavailable are counted in "amount unavailable: N rows."
- **Estimated contractual overage at the entered rate** = Rule C figure, shown separately, never added to the review amount.
- Rows flagged only by Rule C contribute 0 to the review amount.
- Each row is counted once. All math in integer cents.

---

## 8. Confidence rules

| Rule | HIGH | MEDIUM | LOW |
|---|---|---|---|
| A — no significant snow | ≥3 complete windows; every contributing station ≤10 mi; maxSnow ≥1.0 in below trigger; no presumed-zero or accumulation in any window | ≥2 complete windows; every station ≤15 mi; maxSnow ≥0.5 in below trigger; no accumulation | Anything else that still flags (1 window, station >15 mi, gap <0.5 in, presumed-zero, accumulation) |
| B — more pushes | never | never | always |
| C — allowance | season marked complete | season not marked complete | — |
| E — duplicate | exact duplicates | same date/type, different qty or amount | — |

Never round confidence up.

---

## 9. Exact user-facing copy

### 9.1 Landing

> **Check snow-removal invoices against nearby weather records.**
> Enter your ZIP code, snow contract terms, and the services you were billed for. We'll compare those entries with nearby NOAA station records and highlight items that may be worth asking your contractor about. This is an informational screen, not a certified snowfall record or a finding of overbilling.

### 9.2 Status labels

| Status | Label | Copy |
|---|---|---|
| OK | OK | "No issue was identified by this check. This does not prove the charge was correct." |
| WORTH_QUESTIONING | Worth questioning | "This item differs from the weather or contract information entered. Consider asking the contractor for the service log or an explanation." |
| NOT_ENOUGH_DATA | Not enough data | "Nearby station records were missing or incomplete for this date. No conclusion was made." |
| NOT_CHECKED | Not checked | "This tool does not compare this service type with weather records. Only duplicate entries are checked." |

### 9.3 Reason templates

| Code | Template |
|---|---|
| NO_SIGNIFICANT_SNOW | "Nearby reporting stations recorded at most {maxSnow} in. of snow in the three-day review window, below the {trigger} in. trigger. This is a reason to ask what site conditions led to the service." |
| MORE_PUSHES_THAN_SUGGESTED | "Nearby stations recorded up to {eventSnow} in. for this storm. The conservative screening allowance was {allowedPushes} push(es), including {extraAllowed} extra return trip(s); the invoice lists {billedPushes}. {flaggedUnits} push(es) on this line are beyond that allowance. Ask for the contractor's service log. Weather totals alone cannot show how many visits a site needed (drifting, refreezing and site conditions are not included)." |
| ALLOWANCE_EXCEEDED | "The entered season total is {seasonPushes}; the allowance is {allowance}; {excessPushes} push(es) are beyond the allowance ({lineUnits} on this line). Check the service log and overage clause." |
| DUPLICATE_BILLING | "More than one line lists {serviceType} on {date}. Confirm whether these were separate visits or a repeated entry." |
| SERVICE_TYPE_NOT_CHECKED | "Salt and other services are not compared with weather records in this version. Only duplicate entries are checked." |
| SEASONAL_UNLIMITED_DUPLICATE_ONLY | "This contract is a flat seasonal fee with unlimited service. Individual snowfall totals do not determine a per-push charge under the terms entered, so this tool only checks duplicate-looking entries." |
| INSUFFICIENT_DATA | "Nearby station records were missing or incomplete for {dates}. No conclusion was made." |
| OUTSIDE_SEASON | "This date is outside the contract season entered, so it is not counted toward the allowance or compared with weather records. Only duplicate entries are checked." |

### 9.4 Disclaimer (app, visible before use, and on every report)

> This report is an informational screening tool, not a certified snowfall record, invoice audit, legal opinion, or finding of overbilling. Weather stations may be miles from the property and may report on observation periods that do not match contractor service times. Local snowfall, drifting, ice, pavement conditions, and work performed may differ from station records. A flagged item is only worth asking about; it is not proof that a service was unnecessary or incorrectly billed. Confirm conditions, service logs, contract terms, and invoice details with the contractor before taking action. NOAA/NCEI data are provided as-is and may be revised. This tool is independent and is not affiliated with or endorsed by NOAA.

### 9.5 Empty, loading, error states

| State | Copy |
|---|---|
| No rows | "Add a billed service or import a CSV to begin." |
| No results yet | "Your report will appear here after you run the check." |
| Loading | "Finding nearby stations and checking the weather records…" |
| No stations in radius | "No stations with snowfall records were found within {radius} miles of this ZIP Code Area. Try a wider radius. No weather conclusion was made." |
| Network/timeout | "We couldn't retrieve NOAA weather data. Check your connection and try once more. Your entries are still here." |
| NOAA HTTP error | "NOAA's data service returned an error ({status}). No result was calculated. Try again later." *(v1.2, Phase 6: "or use the CSV download option" removed — the CSV fallback was not needed because browser CORS works, §3.2.)* |
| Invalid response | "The weather response could not be read safely. No result was calculated. Please try again later." |
| Invalid ZIP shape | "Enter a five-digit ZIP code." |
| ZIP not in ZCTA file | "This ZIP code is not in the bundled 2020 Census ZIP Code Tabulation Area file. Check the ZIP or use another ZIP for the property area. Some valid USPS ZIP codes do not have a Census ZCTA." |
| No bill rows on run | "Add at least one billed service before running the check." |
| Storage blocked | "Your browser blocked local storage. The checker still works, but entries will not be remembered after you close this page." |
| Corrupt saved data | "Saved entries could not be read and were skipped. You can continue with a fresh check." |
| CORS fallback | "NOAA data could not be loaded directly in this browser. Download the CSV below, then upload the file here. The data stays on this device." |
| Report truncation | "This one-page report shows the first 18 billed lines. Export the results CSV for the full line-by-line detail." |
| *(v1.2, Phase 6)* App did not start (shown by an inline check 1.5 s after page load) | "Part of this page didn't load. Reload the page to use the checker. Your entries stay on this device." |
| Contract field errors | "{Field name} is required for this contract type." / "{Field name} must be between {min} and {max}." / "Season end date must be on or after the start date." |
| *(v1.2, approved Phase 4)* Optional money field invalid (price per push/event, overage rate, seasonal fee) | "{Field name} must be blank or a number greater than or equal to 0." |
| *(v1.2, approved Phase 4)* Push allowance invalid | "Push allowance must be a number greater than or equal to 0." |
| *(v1.2, approved Phase 4)* Tier table invalid (§4.4) — one of: | "Tier {n}: inches and charge per push must be numbers greater than or equal to 0." / "Tier 1 must start at 0 inches." / "Tier {n} must start where tier {p} ends." / "Tier {n}: “Up to” must be greater than “From”." / "Only the last tier may leave “Up to” blank." — each followed by "Tier-based estimates are turned off until the tier table is fixed." |
| *(v1.2, approved Phase 4)* Help text | Walkway trigger: "Optional. Leave blank to use the plow trigger." Optional fields: "Optional." Location method: "ZIP Code Tabulation Area {zip} centroid: {lat}, {lon}" |
| *(v1.2, approved Phase 5)* Summary notes (§7.5, §7.10) | Allowance exceeded, no overage rate: "{n} push(es) beyond the allowance; no overage rate entered, so no dollar estimate." Not exceeded and season not marked complete: "The season may be incomplete: not every billed push was marked as entered." |
| *(v1.2, approved Phase 5)* Evidence panel (§10.1 item 6) | "Show evidence" / "Review window: {dates}. Trigger: {trigger} in." / "(walkway trigger left blank, so the plow trigger is used)" / "Highest complete three-day total: {max} in. Median: {median} in. Complete station windows: {count}." / "Storm total used for push count: {eventSnow} in. over {dates}." (only when Rule B decided the line) / "No nearby station reported for these dates." / "NOAA data accessed {date}. Data may be revised." |
| *(v1.2, approved Phase 5)* Excluded-value reasons (§3.5) | Missing: "missing, not treated as zero" · Quality flag: "rejected quality data" · Source not allowlisted: "source not accepted" · Accumulation: "multi-day total, not assigned to one day" · Attributes missing: "flags missing" · Attributes unreadable: "flags unreadable" · Unknown measurement flag: "unknown measurement flag" · Non-numeric value: "unreadable value" |
| *(v1.2, approved Phase 5)* Report lines (§12.1) | Real run: "Generated {date}. NOAA data accessed {date}; data may be revised." Demo or no weather needed: "Generated {date}." Stations: "Stations with records for the billed dates ({n}):" / "No weather stations were needed for these lines." Walkway trigger blank: "Same as plow trigger". Invalid tiers: "Not valid (tier-based estimates turned off)". Demo reports show the DEMO DATA label and omit the NOAA attribution. |
| *(v1.2, approved — layout update)* Action bar and results | Line count: "No billed lines yet" / "1 billed line" / "{n} billed lines". Status-count row accessible name: "Results by status" (counts reuse the §9.2 status labels). |

---

## 10. UI

### 10.1 Page order

1. Header: wordmark "Snow Invoice Checker", descriptor "A free HOA board screening tool".
2. Landing copy (§9.1) + disclaimer in a compact, readable disclosure (open by default on first visit).
3. Property & contract: ZIP, radius, contract type, conditional fields, triggers.
4. Billed services: table, add/remove, CSV paste/upload, "Download sample CSV", "Load example".
5. Primary button "Check billed services" (disabled only while running; inputs preserved on error).
6. Results: summary metrics, per-line table (status, reason, confidence, amount), expandable evidence (`<details>`) listing station name, ID, distance, dates, values, trace/presumed-zero/accumulation markers, excluded records with reasons, access date. "Export results CSV".
7. Report preview card + "Print / Save as PDF".
8. Waitlist CTA.
9. Footer: attribution (§3.3) and source links.

### 10.2 Example mode

"Load example" fills the form and instantly renders a report from an embedded deterministic demo dataset (`assets/js/demo-data.js`) — **no network request**. Whole result labelled **"DEMO DATA — NOT A REAL PROPERTY CHECK."** Editing any input or clicking "Clear example" exits demo mode and discards demo results. Demo data should produce at least one of each status.

### 10.3 Waitlist CTA

> Want a full line-by-line audit of your contract and invoices? **Join the waitlist.**

Link `https://forms.gle/REPLACE_WITH_REAL_FORM_ID` — `target="_blank" rel="noopener noreferrer"`. Store the URL in `constants.js` as `WAITLIST_URL`. No embedded form, no email collection.

### 10.4 Visual direction

Calm civic-data look: off-white background, dark ink text, teal action accent, restrained amber for "Worth questioning," neutral grey for "Not checked." No alarming red default, no charts, no stock photos, no "AI" motifs. Below 700px: stacked cards, horizontally scrollable table, 16px+ inputs, full-width primary buttons. System font stack.

### 10.5 Accessibility

Visible `<label for>` on every input; help text via `aria-describedby`; no placeholder-only labels; all controls keyboard operable; visible focus ring; logical tab order; status updates via `aria-live="polite"`; status never shown by colour alone; WCAG AA contrast; `<details>/<summary>` for evidence; respect `prefers-reduced-motion`.

---

## 11. Project structure

```text
snow-invoice-checker/
  CLAUDE.md
  README.md
  .gitignore
  index.html
  docs/
    SPEC.md
  assets/
    css/styles.css
    js/
      app.js              DOM wiring, state, validation, demo mode, rendering
      constants.js        enums, defaults, allowlist, copy strings, WAITLIST_URL
      zip.js              load ZCTA JSON, validate ZIP, return centroid
      stations.js         load station list, Haversine, radius + period eligibility
      weather-client.js   URL builder, fetch, batching (max 2 concurrent), cache, one retry, typed errors
      weather-normalizer.js  raw NOAA JSON/CSV -> normalized observations (only module knowing raw fields)
      checks.js           pure rules + summary (no DOM, fetch, storage, clock)
      csv.js              RFC4180 parse/validate import; results export
      report.js           printable report markup + summary formatting
      storage.js          safe optional localStorage
      format.js           currency, dates, decimals
      demo-data.js        deterministic demo observations + rows
  public/
    data/
      zcta-centroids.json
      ghcn-stations-us.json
    sample-billed-services.csv
  scripts/
    build-zcta-json.mjs
    build-ghcn-stations.mjs
    serve.mjs
    smoke-noaa.mjs        opt-in manual live check; never run in CI
  tests/
    zip.test.mjs
    stations.test.mjs
    weather-client.test.mjs
    weather-normalizer.test.mjs
    checks.test.mjs
    csv.test.mjs
    report.test.mjs
    fixtures/
      ncei-daily-summaries-live-<capture-date>.json
      ncei-request-metadata.json
      ncei-daily-summaries-SYNTHETIC-edge-cases.json
      ncei-csv-live-<capture-date>.csv      (only if CSV fallback is needed)
  .github/workflows/deploy.yml
```

All asset/data paths in `index.html` and JS are **relative** (e.g. `./public/data/...`) so they work under the GitHub Pages project subpath.

### 11.1 Pure checking API (`checks.js`)

```js
export function runChecks({ billedRows, contract, observations, stations, options }) {}
//   options: { seasonComplete: boolean }   -> returns { results, summary, warnings }
export function getDateWindow(isoDate) {}
export function groupStorms(plowRows) {}
export function computeStationWindows(observations, dates) {}
export function evaluateNoSignificantSnow(row, contract, windows) {}
export function evaluatePushCount(stormRows, contract, observations) {}
export function evaluateAllowance(rows, contract, options) {}
export function evaluateDuplicates(rows) {}
export function combineResults(row, ruleResults, contract) {}
export function calculateSummary(results, rows, contract) {}
```

Deterministic, stable sorts, integer cents, no system clock (report timestamp passed in by `app.js`).

### 11.2 Weather cache and retry

```text
cacheKey = stationBatch.join(',') + '|' + startDate + '|' + endDate + '|' + DATA_TYPES.join(',') + '|metric|json'

fetchWithOneRetry(url):
  if cache has key -> return cached normalized data
  attempt fetch (timeout 20s via AbortController)
  network error / timeout / HTTP 5xx / 429 -> wait 1000ms, retry exactly once
  other HTTP 4xx -> fail immediately
  validate body with normalizer; on failure throw InvalidResponseError (do not retry, do not cache)
  cache only validated results in an in-memory Map for this page session
```

Typed errors: `NetworkError`, `HttpError(status)`, `InvalidResponseError`, `CorsBlockedError` (a `TypeError` from fetch where the curl check shows the server is up is treated as possible CORS; app then offers the CSV fallback).

### 11.3 Haversine

```js
const R_EARTH_MILES = 3958.7613;
export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_MILES * Math.asin(Math.sqrt(a));
}
```

---

## 12. Report, print, export

### 12.1 Report contents

Title "Snow service invoice review"; ZIP + note that a Census ZCTA centroid was used; contract type, triggers, radius, season/allowance if relevant, rate notes; date generated and weather access date; data attribution + station list (ID, name, distance); summary metrics (total billed, items worth questioning, estimated amount associated with items worth reviewing, amount-unavailable count, separate contractual overage if relevant); compact table of up to 18 rows (date, service, qty, amount, status, short reason, confidence); full disclaimer; truncation note if >18 rows.

### 12.2 Print

`window.print()` + `@media print`: `@page { size: letter landscape; margin: 0.35in; }`. Hide inputs, buttons, evidence, CTA. Text ≥ 7.5pt. If 18 rows don't fit legibly, reduce the row limit (constant `REPORT_MAX_ROWS`) and update the truncation copy — never shrink text below 7.5pt. Test Chrome and Safari. No server-side PDF.

### 12.3 Results CSV export

Columns:
`date,service_type,quantity,amount_charged,status,reason_codes,reason,confidence,flagged_units,estimated_review_amount,amount_is_rate_estimate,allowance_excess_units,station_max_snow_inches,station_median_snow_inches,station_count`

All fields quoted (RFC 4180), UTF-8, filename `snow-invoice-checker-results-YYYY-MM-DD.csv` (*v1.2, Phase 6:* `snow-invoice-checker-results-DEMO-YYYY-MM-DD.csv` when exported from demo mode; columns unchanged). Export all rows.

---

## 13. Required automated tests

Node built-in runner (`node:test`, `node:assert/strict`). Offline and deterministic. Weather inputs for `checks.test.mjs` are built with a small helper that creates normalized observations (label helper output as SYNTHETIC in test names).

| # | Input | Expected |
|---|---|---|
| 1 | Plow, trigger 2.0; 3 complete stations at 0.0 in; distances 3, 6, 9 mi | WORTH_QUESTIONING, NO_SIGNIFICANT_SNOW, HIGH |
| 2 | Max complete window = exactly 2.0 in | OK |
| 3 | Max = 2.1 in | OK |
| 4 | D+1 has 2.4 in, D-1 and D = 0 | OK (next day included) |
| 5 | D-1 has 2.2 in, D and D+1 = 0 | OK (previous day included) |
| 6 | All values missing | NOT_ENOUGH_DATA; nothing treated as zero |
| 7 | 3 stations ≤10 mi, trace all 3 days | WORTH_QUESTIONING, HIGH; evidence labels "Trace" |
| 8 | All SNOW values have non-blank quality flags | NOT_ENOUGH_DATA |
| 9 | Only station window has A accumulation of 1.0 in | NOT_ENOUGH_DATA (no complete window), no flag |
| 10 | Stations 0.0, 0.0, 2.5 in; trigger 2.0 | OK (max controls) |
| 11 | Partial window (only D, D+1) with 2.3 in on D; no complete windows | OK (affirmative snow) |
| 12 | Partial window (only D, D+1) values 0; no complete windows | NOT_ENOUGH_DATA |
| 13 | Presumed-zero P on one day, otherwise qualifies for HIGH | WORTH_QUESTIONING, LOW |
| 14 | Source flag `N` (CoCoRaHS) values, 3 stations at 0.0 | Used; WORTH_QUESTIONING (allowlisted) |
| 15 | Source flag `H` or unknown, only stations | Excluded → NOT_ENOUGH_DATA |
| 16 | Two identical rows (date/type/qty/amount) | Both WORTH_QUESTIONING, DUPLICATE_BILLING, HIGH; count = 2 |
| 17 | Same date/type, different amounts | Both WORTH_QUESTIONING, MEDIUM |
| 18 | Allowance 10, counted pushes 10 | No ALLOWANCE_EXCEEDED |
| 19 | Allowance 10, pushes 12, rate $30, season complete | 2 excess units on newest rows; overage $60.00; HIGH; review amount unaffected |
| 20 | Same as 19, season not marked complete | MEDIUM |
| 21 | Allowance contract, walkway rows, checkbox off | Walkway not counted |
| 22 | Unlimited contract; 4 plows on 0-snow days | No snow/push flags; status NOT_CHECKED (SEASONAL_UNLIMITED_DUPLICATE_ONLY) |
| 23 | Per-push; storm 4.0 in, trigger 2, extra 1, billed 3 | OK (allowed = ceil(4/2)+1 = 3) |
| 24 | Same, billed 4 across rows Dec 7 (qty 2) and Dec 8 (qty 2), amounts $850 and $850 | Only Dec 8 row flagged, flaggedUnits 1, review amount $425.00, LOW |
| 25 | Per-event contract with "excess" pushes | Rule B not applied |
| 26 | Per-push row flagged, qty 2, amount blank, price per push $125 | Review amount $250.00, amountIsRateEstimate true |
| 27 | One row matches duplicate + no-snow, amount $85.00 | One result; reasonCodes has both; review amount $85.00 once |
| 28 | Salt row, no duplicate | NOT_CHECKED |
| 29 | Salt row duplicated | WORTH_QUESTIONING, DUPLICATE_BILLING |
| 30 | Allowance contract, in-season plow on 0-snow days (3 stations) | Rule A flags (WORTH_QUESTIONING) |
| 31 | Walkway trigger blank | Uses plow trigger; evidence says inherited |
| 32 | Storm grouping: plows Dec 7, Dec 9, Dec 13 | Storms: [Dec 7, Dec 9], [Dec 13] |
| 33 | ZIP `01001` (leading zero) | Found; key stays string |
| 34 | ZIP absent from file | Exact error; no weather fetch called |
| 35 | Haversine: station exactly at radius | Included |
| 36 | Station with SNOW lastYear 2010 in raw inventory | Excluded by builder |
| 37 | CSV missing header | Exact message; table unchanged |
| 38 | CSV quoted field with comma and `""` | Parsed correctly |
| 39 | CSV row 3 date `12/7/25` | "Row 3: date must be a real date in YYYY-MM-DD format." |
| 40 | Client: HTTP 503 then 200 | One retry, success, cached |
| 41 | Client: HTTP 400 | No retry; HttpError(400) |
| 42 | Client: second call same key | Served from cache, fetch called once |
| 43 | Normalizer on live fixture | Field-by-field match to raw values; flags parsed per confirmed layout |
| 44 | Results CSV export | All fields quoted; header exact; one line per row |
| 45 | *(v1.2)* Per-push, extra=1, single plow push qty 1; Rule A has a qualifying partial window ≥ trigger (2.3 in); no complete storm window | Row OK (not NOT_ENOUGH_DATA); Rule B = NOT_APPLIED |
| 46 | *(v1.2)* Per-push, extra=1, storm with 2 pushes total, no complete storm window, Rule A OK | Row OK; Rule B = NOT_APPLIED |
| 47 | *(v1.2)* Per-push, extra=1, storm with 3 pushes total, no complete storm window, Rule A OK | NOT_ENOUGH_DATA (existing behavior preserved) |
| 48 | *(v1.2)* Per-push, extra=0, single push qty 1, no complete storm window, Rule A OK | OK; Rule B = NOT_APPLIED (1 ≤ 1 + 0) |
| 49 | *(v1.2)* Allowance contract, season Nov 1 – Apr 30, plow on May 15, not duplicated | NOT_CHECKED, reasonCodes = [OUTSIDE_SEASON], exact §9.3 copy, not counted toward allowance, no weather check run |
| 50 | *(v1.2)* Same contract, two identical plow lines on May 15 | Both WORTH_QUESTIONING, DUPLICATE_BILLING HIGH, reasonCodes includes OUTSIDE_SEASON, not counted toward allowance |
| 51 | *(v1.2)* Same contract, salt on May 15 | NOT_CHECKED, SERVICE_TYPE_NOT_CHECKED |

### 13.1 Fixture rules

- At least one unmodified live NCEI response with metadata (Phase 2).
- Synthetic data: filename and test names contain `SYNTHETIC`. Never edit the live file.
- No test touches the network. `scripts/smoke-noaa.mjs` is the only live check and never runs in CI.

### 13.2 Commands

```bash
node --test
node --test tests/checks.test.mjs
```

---

## 14. Deployment

### 14.1 `.github/workflows/deploy.yml` (created in Phase 1)

```yaml
name: Deploy static site to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - uses: actions/configure-pages@v6
      - name: Run offline tests
        run: node --test
      - name: Assemble site
        run: |
          mkdir -p _site
          cp index.html _site/
          cp -r assets public _site/
      - uses: actions/upload-pages-artifact@v5
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

Only `index.html`, `assets/`, `public/` are published (no tests, scripts, docs, raw data). Owner must set **Settings → Pages → Source: GitHub Actions**. Verify action major versions are current before launch. *(v1.2, Phase 6: verified 2026-11-25 — checkout v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5, all Node 24; CI tests run on Node 24 LTS because Node 20 reached end of life.)*

### 14.2 README

End-user section (3 steps, meaning of each status, disclaimer, limitations, CSV format, print/export, CSV fallback if shown). Developer section (Node 20+, no npm install, serve commands, data build scripts with source URLs, tests, fixture policy, folder map, deploy steps, observed NOAA schema from Phase 2, source register §22). Troubleshooting (unknown ZIP, few stations, network errors, malformed CSV, storage blocked).

---

## 15. CLAUDE.md

Provided as a separate file at the repo root. Its rules are binding.

---

## 16. Build phases (paste one at a time)

General rule for every phase: read `CLAUDE.md` and `docs/SPEC.md`; implement only that phase; run `node --test`; report changed files, commands, test output, browser checks, blockers, and any spec mismatch with evidence. "No tests exist yet" is not a pass.

### Phase 1 — skeleton, geography data, deploy pipeline

```text
PHASE 1 — PROJECT SKELETON, STATIC DATA, DEPLOY PIPELINE

Read CLAUDE.md and docs/SPEC.md (sections 2, 3.7, 3.8, 11, 14). Implement only Phase 1.
Do not build weather fetching, checking rules, forms or results.

1. Create the folder structure from SPEC §11, .gitignore (§2.3), and scripts/serve.mjs (§2.2).
2. Download the Census 2020 ZCTA Gazetteer ZIP (§3.8) into data-source/, extract it, and
   create scripts/build-zcta-json.mjs exactly as specified. Run it to produce
   public/data/zcta-centroids.json (compact). Never hand-write data.
3. Download ghcnd-stations.txt, ghcnd-inventory.txt and readme.txt (§3.7) into data-source/.
   Confirm the fixed-width column positions against the downloaded readme. Create
   scripts/build-ghcn-stations.mjs as specified (SNOW lastYear >= 2024) and run it.
4. Implement assets/js/zip.js and assets/js/stations.js (Haversine, inclusive radius,
   SNOW period eligibility, no station cap).
5. Tests: tests/zip.test.mjs and tests/stations.test.mjs covering SPEC tests 33–36,
   invalid ZIP shape, and radius filtering.
6. Minimal accessible index.html shell (header, landing copy §9.1, disclaimer §9.4)
   using relative paths.
7. Add .github/workflows/deploy.yml exactly as in §14.1. Commit and push to main.
   Tell me to set Settings → Pages → Source: GitHub Actions, then confirm the
   deployed URL loads and both JSON files load under the project subpath.

Report: source URLs, ZCTA count, station count, file sizes, sample keys, test output, deployed URL.

DEFINITION OF DONE
- Both JSON files generated by scripts from official files; non-empty; compact.
- Column positions confirmed against readme.
- All Phase 1 tests pass with `node --test`.
- Site deployed on GitHub Pages; JSON loads under subpath.
- No weather calls, no fake data.
If any download or build fails, report the blocker; do not substitute data.
```

### Phase 2 — live NOAA verification, normalizer, client

```text
PHASE 2 — LIVE NOAA VERIFICATION BEFORE ANY CHECK LOGIC

Read CLAUDE.md and docs/SPEC.md (sections 3.1–3.5, 6.1, 11.2). No checking rules this phase.

1. Implement buildNceiUrl (§3.1). Pick a real snowy ZIP (e.g. a Michigan or Colorado ZIP),
   find stations within 15 mi, and request a real winter date range from last season.
2. Capture at least one unmodified live JSON response + metadata into tests/fixtures (§3.1).
   Verify: field names, value types, date format, how missing values appear, SNOW/SNWD
   units with units=metric, attribute string layout, and the actual source/quality/
   measurement flags seen. Re-read the current GHCN readme and confirm every code in the
   source allowlist (§3.3); remove any whose meaning is unclear.
3. Coverage report: for 3 test ZIPs (one urban, one suburban, one rural snowy area) report
   station counts within 10/15/25 mi and how many complete 3-day windows exist on a sample
   storm date, WITH and WITHOUT source flag N. Write the results in README.
4. CORS: test a real browser fetch from http://localhost:8000 AND from the deployed GitHub
   Pages URL (§3.2). Record evidence. If both pass → automatic JSON mode. If either fails →
   capture a real format=csv response, and implement the CSV download + upload fallback.
5. Implement weather-normalizer.js against the captured response (only module knowing raw
   fields): missing vs trace vs P vs A, quality flags, source allowlist, excludedReason.
6. Implement weather-client.js: batching of 20, max 2 concurrent, 20s timeout, one retry
   (1000 ms) on network/5xx/429, no retry on other 4xx, in-memory cache of validated
   results only, typed errors (§11.2).
7. Tests: weather-normalizer.test.mjs (live fixture + SYNTHETIC edge cases: missing, T, P,
   A, quality flag, N allowed, H excluded, unknown excluded, blank source excluded) and
   weather-client.test.mjs (SPEC tests 40–43) with a stubbed fetch. No network in tests.
8. scripts/smoke-noaa.mjs: opt-in live check printing station count and a sample record.

STOP if attributes cannot establish source/quality, or if neither JSON fetch nor the CSV
fallback can be verified. Report instead of guessing.

DEFINITION OF DONE
- Real unmodified fixture + metadata committed.
- Observed schema, units, flags and coverage numbers documented in README.
- CORS result documented for both origins, or CSV fallback verified with a real CSV.
- Normalizer and client tests pass; `node --test` passes.
```

### Phase 3 — checking logic

```text
PHASE 3 — PURE CHECKING LOGIC + FULL TEST SUITE

Read CLAUDE.md and docs/SPEC.md sections 6, 7, 8, 9.3. Implement assets/js/checks.js only
(plus constants). No DOM, fetch, storage or clock in checks.js.

Implement: date windows, station windows and completeness, affirmative-snow shortcut,
max/median, Rule A (incl. allowance contracts), storm grouping, Rule B (per-push and tier
only, excess units newest-first), Rule C (excess units newest-first, separate overage),
Rule E, NOT_CHECKED for salt/other/unlimited, result combination (§7.9), confidence (§8),
money summary per flagged unit (§7.10), reason text from §9.3 templates.

Write tests/checks.test.mjs implementing SPEC tests 1–32 with exact assertions on status,
codes, confidence, flaggedUnits and cents. Do not invent rules or thresholds.

DEFINITION OF DONE
- Tests 1–32 pass; `node --test` passes overall.
- checks.js imports nothing from the browser and makes no network calls.
- Every formula matches the spec; each row counted once in money totals.
```

### Phase 4 — input UI

```text
PHASE 4 — INPUT UI, CSV IMPORT, DEMO MODE, STATES

Read CLAUDE.md and docs/SPEC.md sections 4, 5, 9.5, 10. Build the input side of the page.

- All fields and conditional contract fields with validation and exact error copy.
- Billed-services table (add/edit/remove, keyboard, mobile scroll).
- csv.js import: all-or-nothing, exact messages (§5.3); tests 37–39 in tests/csv.test.mjs.
- Sample CSV download; Load example using demo-data.js with zero network requests and the
  DEMO DATA label; editing exits demo mode.
- Wire the real run: ZIP → stations → weather (automatic or CSV fallback per Phase 2) →
  runChecks. Show loading and every error state.
- storage.js: opt-in persistence, every call in try/catch, corrupt-data notice.
- Accessibility per §10.5. Results area may show a plain placeholder table this phase.

Browser checks: valid/invalid ZIP, no rows, valid and malformed CSV, example (Network tab
shows zero NOAA requests), edited example, storage blocked, 375px width, keyboard only.

DEFINITION OF DONE
- Inputs validated; invalid input never triggers a network request.
- CSV import all-or-nothing; demo is offline and labelled.
- Real run works end-to-end on the verified weather path.
- `node --test` passes.
```

### Phase 5 — results, report, export, waitlist

```text
PHASE 5 — RESULTS, REPORT, PRINT, EXPORT, WAITLIST

Read CLAUDE.md and docs/SPEC.md sections 7.10, 9, 10.1, 10.3, 12. Do not change checks.js
unless a failing test proves a bug (then cite the spec section and add the test).

- Summary metrics (§7.10) incl. amount-unavailable count and separate contractual overage.
- Per-line results table with status label, reason, confidence, review amount (marked
  "Estimated from entered contract rate" when applicable).
- Expandable evidence per row (§10.1 item 6).
- report.js + print CSS (§12.1–12.2): Letter landscape, one page, REPORT_MAX_ROWS, truncation
  copy, full disclaimer, attribution, station list.
- Results CSV export (§12.3) with test 44 in tests/report.test.mjs.
- Waitlist CTA (§10.3).

Browser checks: example and a real run; expand evidence; export CSV and open it; print
preview in Chrome and Safari (or document why Safari couldn't be tested) with ≤18 and >18
rows; CTA opens a new tab.

DEFINITION OF DONE
- Totals match spec; each row counted once; overage separate.
- Print = one landscape page with disclaimer; truncation works.
- Export includes every row, correctly quoted.
- `node --test` passes.
```

### Phase 6 — QA and launch readiness

```text
PHASE 6 — FINAL QA AND LAUNCH READINESS

Audit the repo against docs/SPEC.md and CLAUDE.md. Fix defects only; no new features.

1. `node --test` passes.
2. Browser matrix: Chrome, Safari, Firefox, Edge (desktop) + a phone-size viewport. Record
   anything not testable and why.
3. On the deployed URL: a real run with live NOAA data (or the CSV fallback) for a snowy ZIP.
4. Walk the acceptance checklist (§17) item by item and report pass/fail.
5. Search all user-facing text for forbidden words (§1.2); confirm disclaimer in app + report.
6. Confirm no keys, server code, analytics, trackers, accounts or runtime dependencies.
7. Accessibility pass with browser dev tools (labels, focus, contrast, keyboard, overflow).
8. Final README update.

Report: deployed URL, test output, live-data evidence, browser matrix, checklist results,
remaining limitations. Never claim completion with an open release-blocking item.
```

---

## 17. Acceptance checklist

- [ ] Landing copy matches §9.1; disclaimer visible before use and on every report.
- [ ] Valid ZIP finds centroid; invalid/unsupported ZIP stops before weather calls; approximation explained.
- [ ] All eligible stations within radius are used (SNOW period covers billed year); no cap.
- [ ] Source allowlist applied (N allowed, H/unknown/blank excluded); coverage documented.
- [ ] NOAA schema, units and attributes documented from a live capture.
- [ ] Browser CORS works on GitHub Pages with evidence, OR CSV download/upload fallback verified.
- [ ] One retry max; max 2 concurrent requests; cache memory-only.
- [ ] Missing never becomes zero; trace / presumed-zero / accumulation / quality / source handled distinctly.
- [ ] D-1/D/D+1 windows; storm station-days not double-counted.
- [ ] Max drives decisions; median display-only.
- [ ] Rule A needs complete windows (or affirmative snow → OK); runs for allowance contracts.
- [ ] Rule B flags only excess units, LOW only, per-push and tier contracts only.
- [ ] Rule C explicit about season scope, completeness and separate overage.
- [ ] Duplicates preserved; HIGH vs MEDIUM correct.
- [ ] Salt/other and unlimited contracts show Not checked unless duplicated.
- [ ] Money counted per flagged unit, each row once.
- [ ] Example loads instantly, labelled demo, zero network requests.
- [ ] CSV import/export exact; all-or-nothing import.
- [ ] Print is one landscape Letter page with all required fields.
- [ ] Waitlist link is the placeholder (until replaced); no personal data collected.
- [ ] All `localStorage` use is opt-in and in try/catch.
- [ ] Browser matrix and phone layout tested or documented.
- [ ] GitHub Pages deploy green; assets load under project subpath; only site files published.
- [ ] No server, paid API, key, AI API, tracker, analytics, account or database.

---

## 18. Assumptions and how to verify

| Assumption | Verify / if false |
|---|---|
| ZCTA centroid is an acceptable ZIP-area proxy | Explained in UI; unsupported ZIPs get the exact error. No paid geocoder. |
| NCEI supports `SNOW,SNWD` for `daily-summaries` with attributes | Phase 2 live capture. If attributes missing → stop. |
| `units=metric` returns mm for SNOW/SNWD | Phase 2 compares against readme and known values; convert once. |
| Browser CORS allowed | Phase 2 tests both origins; else CSV fallback. |
| Allowlisted source codes are trustworthy public sources | Phase 2 re-reads readme; remove unclear codes. |
| Enough stations report SNOW daily (incl. zeros) to form complete windows | Phase 2 coverage report. If coverage is poor everywhere, report to owner before Phase 3. |
| 3-day window is a fair screen | Documented heuristic; dates shown per station. |
| 2-day storm grouping and +1 extra push are fair tolerances | Heuristics; LOW confidence; user can choose 0/1/2 extra. |
| Tier contracts are flat charge per push per band | Owner confirms against real contracts; else no tier estimate. |
| 18 rows fit one printed page | Phase 5 print test; lower `REPORT_MAX_ROWS` if needed. |

---

## 19. Known v1 limitations

- A station is not the property; snow varies over short distances (lakes, terrain, urban heat).
- Daily observation periods don't match contractor service times.
- Rural coverage may be sparse; "Not enough data" is an intended safe outcome.
- Snowfall isn't the only reason for service (drifting, refreezing, black ice, banks, emergency access).
- Recent days may be missing or revised; access date is shown.
- Salt/de-icing services are not checked against weather in v1.
- Not contract interpretation or legal advice.
- Rate-based amounts are estimates and labelled as such.

---

## 20. V2 roadmap (out of scope for v1)

Paid full-audit tier; contract/invoice upload and extraction; human line-by-line review; salt checks if a reliable freezing-event source is found; other vendor contracts (landscaping, pool, janitorial); accounts and saved projects. Do not build any of these in v1.

---

## 21. Launch plan

1. Replace `WAITLIST_URL` with a real Google Form; pass Phase 6.
2. Ask permission, then share in HOA/condo board communities (Reddit, Facebook HOA groups, community-association manager groups, local board networks). Follow group rules; no spam; disclose you built it.
3. Ask a few treasurers to test with a past invoice and tell you whether the report is clear and whether they'd pay for a full review.
4. Measure demand by waitlist sign-ups only.

**Launch post:**

> I built a free tool for HOA board treasurers who want a second look at snow-removal invoices.
>
> You enter the ZIP code, basic snow-contract terms, and the dates/services you were billed for. It compares those entries with nearby NOAA weather-station records and highlights items that may be worth asking the contractor about.
>
> It is not a certified snowfall report and it does not claim a contractor overcharged anyone. Station readings are estimates, and local conditions and service logs still matter. The goal is to give board members a clearer starting point for asking questions.
>
> I'd appreciate feedback from treasurers or community managers willing to test it with a past invoice. It's free: [DEPLOYED URL]
>
> I'm also gauging interest in a future full line-by-line review service, but that isn't part of the current tool.

---

## 22. Source register

| ID | Source | Used for |
|---|---|---|
| S1 | NOAA NCEI GHCN-Daily product page — https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily | Dataset scope, updates, revisions |
| S2 | NCEI Access Data Service API docs — https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation | Endpoint and parameters |
| S3 | NCEI Open Data Policy — https://www.ncei.noaa.gov/sites/default/files/2023-12/NCEI%20PD-10-2-02%20-%20Open%20Data%20Policy%20Signed.pdf | Public-domain status |
| S4 | GHCN-Daily readme — https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt | Units, flags, file layouts, DOI |
| S5 | RCC-ACIS Web Services docs — https://docs.rcc-acis.org/acisws/ | Evaluated, not used |
| S6 | RCC-ACIS disclaimer — https://www.rcc-acis.org/disclaimer.html | Licensing caveat |
| S7 | Census 2020 Gazetteer files — https://www.census.gov/geographies/reference-files/2020/geo/gazetter-file.html (Census's own spelling) | ZCTA download |
| S8 | Census ZCTA explanation — https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html | ZCTA limitations |

NCEI has shown notices about a cloud migration and temporary access delays. Re-check the NCEI alerts page during Phase 2 and before launch; handle transient errors clearly. Never fake data because of an outage.

**Final instruction:** Build only v1. Every weather-based "Worth questioning" must rest on valid, complete, allowlisted records. Missing or unverified data always produces "Not enough data," never a flag. The tool helps people ask better questions; it does not accuse contractors.
