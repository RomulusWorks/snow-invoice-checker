# CLAUDE.md — Free Snow Invoice Checker

## Product
A free, static browser tool for HOA treasurers and small HOA managers. It compares entered
snow-service invoice lines with nearby NOAA GHCN-Daily station snowfall and user-entered
contract terms, and produces a screening report. It does NOT decide whether a contractor
overcharged.

## Authority
`docs/SPEC.md` is the controlling specification. Read it and this file at the start of every
phase. Implement only the phase the user pastes. Do not add features or change approved rules.
If the spec defines a verification gate, run it and report the evidence. Never guess past a
failed gate — stop and report.

## Absolute constraints
- Static HTML/CSS/vanilla JavaScript ES modules. No framework, bundler, or build system.
- GitHub Pages only. No backend, serverless function, proxy, worker, or database.
- No paid service, commercial weather API, AI API, API key, or secret.
- No `npm install`; no runtime npm dependencies. Node 20+ only for scripts/tests.
- NOAA/NCEI GHCN-Daily data only, filtered by the source-flag allowlist in SPEC §3.3.
- ZIP centroids come only from the bundled Census 2020 ZCTA Gazetteer JSON.
- No accounts, email collection, analytics, trackers, or remote storage.
- User invoice data stays in the browser. `localStorage` is opt-in and every call is in try/catch.
- Never use `fetch(..., { mode: 'no-cors' })`. Never add a CORS proxy.
- All paths relative so the site works under the GitHub Pages project subpath.

## User-facing language
- Statuses: OK / Worth questioning / Not enough data / Not checked.
- NEVER write: overcharged, overcharge, fraud, stolen, unnecessary, refund, money owed,
  savings, proven overbilling, or that work was not performed.
- A flag is a question for the contractor, never a conclusion.
- Full disclaimer (SPEC §9.4) in the app and on every report.
- Use the exact copy in SPEC §5.3 and §9. Do not improvise user-facing text.

## Data rules
- Missing weather is never zero. Missing or incomplete data never creates a flag.
- Trace = 0.0 in (labelled). Presumed-zero (P) caps confidence at LOW. Accumulation (A) is
  never assigned to a single day.
- Max station total drives decisions; median is display-only.
- Capture real, unmodified NOAA responses as fixtures. Never fabricate a "live" fixture.
  Synthetic test data must have SYNTHETIC in its filename/test name.
- The normalizer is the only module that knows raw NOAA field names.

## Architecture
- `assets/js/checks.js`: pure functions only — no DOM, fetch, storage, system clock, or global
  mutable state.
- Weather transport in `weather-client.js`; raw parsing in `weather-normalizer.js`;
  CSV in `csv.js`; ZIP/station geometry in `zip.js` / `stations.js`.
- Money in integer cents. Dates as `YYYY-MM-DD` strings with UTC date-only arithmetic.
- Weather cache: in-memory per page session. One retry maximum. Max 2 concurrent requests.

## Commands
- `node --test` — all offline tests (must pass before reporting any phase complete).
- `node scripts/build-zcta-json.mjs <txt> [out.json]`
- `node scripts/build-ghcn-stations.mjs <stations.txt> <inventory.txt> [out.json]`
- `python -m http.server 8000` or `node scripts/serve.mjs 8000` — local preview.
- `node scripts/smoke-noaa.mjs` — opt-in live NOAA check; never in CI or tests.

## Conventions
- Small ES modules with explicit exports; prefer `const`.
- Validate external data at boundaries; no silent defaults for unknown values.
- Stable sorts; deterministic functions.
- Keep labels, focus states, `aria-live` messages, and keyboard operation intact.

## Phase discipline
- Work only on the current phase. Inspect existing files before editing.
- Run `node --test` at the end of every phase; do not report completion with failures.
- End each phase with: changed files, commands run, test output, browser checks done,
  blockers, and any spec mismatch with evidence.
- If a live check fails (NOAA schema, CORS, downloads), report it and follow the spec's
  fallback. Do not fabricate data or claim a pass.

## Forbidden shortcuts
- No mock weather in production paths (demo mode uses clearly labelled `demo-data.js` only).
- No hand-written ZIP or station datasets.
- No treating missing as zero.
- No unapproved fields, dashboards, charts, accounts, uploads, or features.
- No claims that a result is certified, legally conclusive, or proof of a bad invoice.
