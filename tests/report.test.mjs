import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildResultsCsv, resultsCsvFilename, parseCsvRecords, RESULTS_CSV_HEADER } from '../assets/js/csv.js';
import { buildReportModel, shortReason, summaryItems, splitSentences } from '../assets/js/report.js';
import { runChecks } from '../assets/js/checks.js';
import { DEMO_ROWS, DEMO_STATIONS, DEMO_OBSERVATIONS, DEMO_LABEL } from '../assets/js/demo-data.js';
import { DISCLAIMER, ATTRIBUTION_TEMPLATE, REPORT_MAX_ROWS, WAITLIST_URL, MESSAGES } from '../assets/js/constants.js';

// SYNTHETIC: the embedded demo dataset run through the real rules.
const contract = { type: 'PER_PUSH', plowTriggerInches: 2, walkwayTriggerInches: null, extraPushesAllowedPerStorm: 1, pricePerPushCents: 42500 };
const billedRows = DEMO_ROWS.map((r, i) => ({
  id: `r${i + 1}`, date: r.date, serviceType: r.serviceType, quantity: Number(r.quantity),
  amountChargedCents: Math.round(Number(r.amount) * 100), sourceRowNumber: i + 1,
}));
const out = runChecks({ billedRows, contract, observations: DEMO_OBSERVATIONS, stations: DEMO_STATIONS, options: { seasonComplete: false } });

test('SPEC 44: results CSV export — all fields quoted, exact header, one line per row', () => {
  const text = buildResultsCsv(out.results, billedRows);
  const lines = text.split('\r\n');
  assert.equal(lines.at(-1), '', 'ends with CRLF');
  lines.pop();
  assert.equal(lines[0], '"date","service_type","quantity","amount_charged","status","reason_codes","reason","confidence","flagged_units","estimated_review_amount","amount_is_rate_estimate","allowance_excess_units","station_max_snow_inches","station_median_snow_inches","station_count"');
  assert.equal(lines.length, 1 + billedRows.length, 'one line per row plus header');
  // Every field quoted: each line parses to exactly 15 cells and starts/ends with a quote.
  for (const line of lines) {
    assert.ok(line.startsWith('"') && line.endsWith('"'), line);
    const [cells] = parseCsvRecords(line);
    assert.equal(cells.length, RESULTS_CSV_HEADER.length);
  }
  const records = parseCsvRecords(text);
  const feb4 = records.find((r) => r[0] === '2026-02-04');
  assert.deepEqual(feb4.slice(0, 6), ['2026-02-04', 'plow', '1', '425.00', 'Worth questioning', 'NO_SIGNIFICANT_SNOW']);
  assert.equal(feb4[7], 'HIGH');
  assert.equal(feb4[8], '1');
  assert.equal(feb4[9], '425.00');
  assert.equal(feb4[10], 'false');
  assert.equal(feb4[12], '0.0');
  assert.equal(feb4[14], '3');
  // Reason text containing quotes/commas survives round-trip.
  assert.equal(feb4[6], out.results[5].reasonText);
  const salt = records.find((r) => r[1] === 'salt');
  assert.deepEqual([salt[4], salt[7], salt[9], salt[12], salt[14]], ['Not checked', '', '', '', '0']);
});

test('results CSV quotes embedded double quotes and exports every row (>18)', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ ...billedRows[1], id: `s${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}`, sourceRowNumber: i + 1 }));
  const res = runChecks({ billedRows: many, contract, observations: [], stations: [], options: {} });
  const text = buildResultsCsv(res.results.map((r) => ({ ...r, reasonText: 'Say "hi", ok' })), many);
  const records = parseCsvRecords(text);
  assert.equal(records.length, 26);
  assert.equal(records[1][6], 'Say "hi", ok');
  assert.ok(text.includes('"Say ""hi"", ok"'));
  assert.equal(resultsCsvFilename('2026-11-25'), 'snow-invoice-checker-results-2026-11-25.csv');
  assert.throws(() => resultsCsvFilename('11/25/2026'));
});

test('shortReason keeps only the opening sentence(s) of each approved reason', () => {
  const noSnow = out.results[5].reasonText;
  assert.equal(shortReason(noSnow), splitSentences(noSnow)[0]);
  assert.ok(shortReason(noSnow).startsWith('Nearby reporting stations recorded at most 0.0 in.'));
  const pushes = "Nearby stations recorded up to 4.0 in. for this storm. The conservative screening allowance was 3 push(es), including 1 extra return trip(s); the invoice lists 4. 1 push(es) on this line are beyond that allowance. Ask for the contractor's service log.";
  assert.equal(shortReason(pushes), 'Nearby stations recorded up to 4.0 in. for this storm. The conservative screening allowance was 3 push(es), including 1 extra return trip(s); the invoice lists 4.');
  const combined = `${noSnow} More than one line lists plow on 2026-02-04. Confirm whether these were separate visits or a repeated entry.`;
  assert.equal(shortReason(combined), `${splitSentences(noSnow)[0]} More than one line lists plow on 2026-02-04.`);
  assert.equal(shortReason('No issue was identified by this check. This does not prove the charge was correct.'), 'No issue was identified by this check.');
});

test('report model: rows capped at REPORT_MAX_ROWS (18) with truncation copy; demo label; no NOAA attribution for demo', () => {
  assert.equal(REPORT_MAX_ROWS, 18);
  const rows25 = Array.from({ length: 25 }, (_, i) => ({ ...billedRows[1], id: `s${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}`, sourceRowNumber: i + 1 }));
  const res = runChecks({ billedRows: rows25, contract, observations: [], stations: [], options: {} });
  const base = { results: res.results, summary: res.summary, warnings: res.warnings, billedRows: rows25, contract, zip: '48226', radiusMiles: 15, generatedDate: '2026-11-25', accessDate: '2026-11-25' };
  const m = buildReportModel(base);
  assert.equal(m.rows.length, 18);
  assert.equal(m.totalRows, 25);
  assert.equal(m.truncationNote, 'This one-page report shows the first 18 billed lines. Export the results CSV for the full line-by-line detail.');
  assert.equal(m.title, 'Snow service invoice review');
  assert.equal(m.disclaimer, DISCLAIMER);
  assert.equal(m.attribution, ATTRIBUTION_TEMPLATE.replace('{date}', '2026-11-25'));
  assert.equal(m.demoLabel, null);
  const exact = buildReportModel({ ...base, results: res.results.slice(0, 18), billedRows: rows25.slice(0, 18) });
  assert.equal(exact.truncationNote, null, 'exactly 18 rows: no truncation note');
  const lower = buildReportModel({ ...base, maxRows: 15 });
  assert.equal(lower.truncationNote, 'This one-page report shows the first 15 billed lines. Export the results CSV for the full line-by-line detail.');
  const demo = buildReportModel({ ...base, demo: true, demoLabel: DEMO_LABEL });
  assert.equal(demo.demoLabel, 'DEMO DATA — NOT A REAL PROPERTY CHECK.');
  assert.equal(demo.attribution, null);
});

test('summary items follow §7.10: review amount, unavailable count, separate overage', () => {
  const items = summaryItems(out.summary, out.warnings);
  assert.deepEqual(items.map((i) => [i.label, i.value]), [
    ['Total billed', '$2,825.00'],
    ['Items worth questioning', '2'],
    ['Estimated amount associated with items worth reviewing', '$850.00'],
  ]);
  const withOverage = summaryItems({ ...out.summary, amountUnavailableRows: 2, contractualOverage: { excessUnits: 2, overageCents: 6000 } });
  assert.equal(withOverage[2].note, 'amount unavailable: 2 rows');
  assert.deepEqual([withOverage[3].label, withOverage[3].value], ['Estimated contractual overage at the entered rate', '$60.00']);
  const noRate = summaryItems({ ...out.summary, contractualOverage: { excessUnits: 2, overageCents: null } });
  assert.match(noRate[3].note, /^2 push\(es\) beyond the allowance/);
});

test('disclaimer, attribution and waitlist link match SPEC and index.html', async () => {
  const spec = await fs.readFile(new URL('../docs/SPEC.md', import.meta.url), 'utf8');
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(spec.includes(`> ${DISCLAIMER}`), 'SPEC §9.4');
  assert.ok(html.includes(DISCLAIMER), 'index.html disclaimer');
  assert.ok(spec.includes(`"${ATTRIBUTION_TEMPLATE.replace('{date}', '[date]')}"`), 'SPEC §3.3');
  assert.equal(WAITLIST_URL, 'https://forms.gle/REPLACE_WITH_REAL_FORM_ID');
  assert.ok(html.includes('Want a full line-by-line audit of your contract and invoices?'));
  assert.ok(/<a [^>]*id="waitlist-link"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/.test(html));
  assert.ok(spec.includes(MESSAGES.REPORT_TRUNCATION));
});
