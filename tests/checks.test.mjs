import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  runChecks, getDateWindow, groupStorms, computeStationWindows, evaluateDuplicates, isValidTierTable, selectTier,
} from '../assets/js/checks.js';
import { normalizeElement } from '../assets/js/weather-normalizer.js';
import { STATUS_COPY, REASON_TEMPLATES, STATUS_LABELS } from '../assets/js/constants.js';

// ---------------------------------------------------------------- SYNTHETIC helpers
// All weather below is SYNTHETIC test data built in the normalized shape (SPEC §6.1).
const MM = 25.4;
const synEl = (inches, over = {}) => ({
  valueInches: inches, rawValue: inches == null ? null : String(inches * MM), measurementFlag: '', qualityFlag: '',
  sourceFlag: '7', usable: inches != null, trace: false, presumedZero: false, accumulated: false,
  excludedReason: inches == null ? 'MISSING' : null, ...over,
});
const synObs = (stationId, date, snowEl) => ({
  stationId, stationName: `SYNTHETIC ${stationId}`, latitude: 0, longitude: 0, date,
  elements: { SNOW: snowEl, SNWD: synEl(null) },
});
// Raw-string path through the real normalizer (for flag handling).
const rawObs = (stationId, date, mm, attrs) => synObs(stationId, date, normalizeElement(mm, attrs));
const st = (id, distanceMiles) => ({ id, name: `SYNTHETIC ${id}`, distanceMiles });

// One station, three days of SNOW inches (null = no record), on window around `date`.
function windowObs(stationId, date, [prev, day, next], make = (v) => synEl(v)) {
  return getDateWindow(date).map((d, i) => [prev, day, next][i]).flatMap((v, i) => (v === undefined ? [] : [synObs(stationId, getDateWindow(date)[i], make(v))]));
}

let rowSeq = 0;
const row = (date, serviceType = 'plow', quantity = 1, amountChargedCents = null, extra = {}) => {
  rowSeq++;
  return { id: `r${rowSeq}`, date, serviceType, quantity, amountChargedCents, sourceRowNumber: rowSeq, ...extra };
};

const perPush = (over = {}) => ({
  type: 'PER_PUSH', plowTriggerInches: 2.0, walkwayTriggerInches: null, extraPushesAllowedPerStorm: 1,
  pricePerPushCents: null, ...over,
});
const allowanceContract = (over = {}) => ({
  type: 'SEASONAL_ALLOWANCE', plowTriggerInches: 2.0, walkwayTriggerInches: null, seasonStart: '2025-11-01',
  seasonEnd: '2026-04-30', pushAllowance: 10, overageRateCents: null, allowanceCountsWalkway: false, ...over,
});

function run({ rows, contract = perPush(), observations = [], stations = [], seasonComplete = false }) {
  return runChecks({ billedRows: rows, contract, observations, stations, options: { seasonComplete } });
}

// Three stations at given distances, all with the same three daily values around `date`.
function threeStations(date, values, distances = [3, 6, 9], make) {
  const stations = distances.map((d, i) => st(`USSYN00000${i + 1}`, d));
  const observations = stations.flatMap((s) => windowObs(s.id, date, values, make));
  return { stations, observations };
}

const D = '2025-12-07';

// ---------------------------------------------------------------- SPEC tests 1-15 (Rule A + data)
test('SPEC 1 (SYNTHETIC): 3 complete stations at 0.0 in, 3/6/9 mi, trigger 2.0 -> WQ, NO_SIGNIFICANT_SNOW, HIGH', () => {
  const r = row(D, 'plow', 1, 42500);
  const { results } = run({ rows: [r], ...threeStations(D, [0, 0, 0]) });
  const x = results[0];
  assert.equal(x.status, 'WORTH_QUESTIONING');
  assert.deepEqual(x.reasonCodes, ['NO_SIGNIFICANT_SNOW']);
  assert.equal(x.confidence, 'HIGH');
  assert.equal(x.flaggedUnits, 1);
  assert.equal(x.estimatedAmountCents, 42500);
  assert.equal(x.reasonText, 'Nearby reporting stations recorded at most 0.0 in. of snow in the three-day review window, below the 2.0 in. trigger. This is a reason to ask what site conditions led to the service.');
  assert.equal(x.evidence.maxSnowInches, 0);
  assert.equal(x.evidence.stationCount, 3);
  assert.deepEqual(x.evidence.windowDates, ['2025-12-06', '2025-12-07', '2025-12-08']);
});

test('SPEC 2 (SYNTHETIC): max complete window exactly 2.0 in -> OK', () => {
  const { results } = run({ rows: [row(D)], ...threeStations(D, [0, 2.0, 0]) });
  assert.equal(results[0].status, 'OK');
  assert.deepEqual(results[0].reasonCodes, ['NO_ISSUE']);
  assert.equal(results[0].flaggedUnits, 0);
});

test('SPEC 3 (SYNTHETIC): max 2.1 in -> OK', () => {
  const { results } = run({ rows: [row(D)], ...threeStations(D, [0, 2.1, 0]) });
  assert.equal(results[0].status, 'OK');
});

test('SPEC 4 (SYNTHETIC): D+1 has 2.4 in, D-1 and D = 0 -> OK (next day included)', () => {
  const { results } = run({ rows: [row(D)], ...threeStations(D, [0, 0, 2.4]) });
  assert.equal(results[0].status, 'OK');
});

test('SPEC 5 (SYNTHETIC): D-1 has 2.2 in, D and D+1 = 0 -> OK (previous day included)', () => {
  const { results } = run({ rows: [row(D)], ...threeStations(D, [2.2, 0, 0]) });
  assert.equal(results[0].status, 'OK');
});

test('SPEC 6 (SYNTHETIC): all values missing -> NOT_ENOUGH_DATA; nothing treated as zero', () => {
  // Records exist but SNOW is absent on every day; plus a station with no records at all.
  const { stations, observations } = threeStations(D, [null, null, null]);
  const { results, summary } = run({ rows: [row(D, 'plow', 1, 42500)], stations: [...stations, st('USSYNEMPTY', 1)], observations });
  const x = results[0];
  assert.equal(x.status, 'NOT_ENOUGH_DATA');
  assert.deepEqual(x.reasonCodes, ['INSUFFICIENT_DATA']);
  assert.equal(x.confidence, null);
  assert.equal(x.flaggedUnits, 0);
  assert.equal(x.evidence.maxSnowInches, null);
  assert.equal(x.evidence.medianSnowInches, null);
  assert.equal(x.evidence.stationCount, 0);
  assert.ok(x.evidence.stations.every((w) => w.days.every((d) => d.valueInches === null && d.excludedReason === 'MISSING')));
  assert.equal(x.reasonText, 'Nearby station records were missing or incomplete for 2025-12-06, 2025-12-07, 2025-12-08. No conclusion was made.');
  assert.equal(summary.estimatedReviewAmountCents, 0);
});

test('SPEC 7 (SYNTHETIC): 3 stations <=10 mi, trace all 3 days -> WQ, HIGH; evidence labels "Trace"', () => {
  const trace = () => normalizeElement('0.0', 'T,,7,0700');
  const { results } = run({ rows: [row(D)], ...threeStations(D, [0, 0, 0], [3, 6, 9], trace) });
  const x = results[0];
  assert.equal(x.status, 'WORTH_QUESTIONING');
  assert.equal(x.confidence, 'HIGH');
  for (const w of x.evidence.stations) for (const d of w.days) {
    assert.equal(d.trace, true);
    assert.equal(d.label, 'Trace');
    assert.equal(d.valueInches, 0);
  }
});

test('SPEC 8 (SYNTHETIC): all SNOW values have non-blank quality flags -> NOT_ENOUGH_DATA', () => {
  const q = () => normalizeElement('0.0', ',I,7,0700');
  const { results } = run({ rows: [row(D)], ...threeStations(D, [0, 0, 0], [3, 6, 9], q) });
  assert.equal(results[0].status, 'NOT_ENOUGH_DATA');
  assert.equal(results[0].evidence.stations[0].days[0].label, 'rejected quality data');
});

test('SPEC 9 (SYNTHETIC): only station window has A accumulation of 1.0 in -> NOT_ENOUGH_DATA, no flag', () => {
  const stations = [st('USSYNACC001', 3)];
  const observations = [
    rawObs('USSYNACC001', '2025-12-06', '0.0', ',,7,0700'),
    rawObs('USSYNACC001', '2025-12-07', '25.4', 'A,,7,0700'),
    rawObs('USSYNACC001', '2025-12-08', '0.0', ',,7,0700'),
  ];
  const { results } = run({ rows: [row(D, 'plow', 1, 42500)], stations, observations });
  assert.equal(results[0].status, 'NOT_ENOUGH_DATA');
  assert.equal(results[0].flaggedUnits, 0);
  assert.equal(results[0].evidence.stations[0].accumulated, true);
  assert.equal(results[0].evidence.stations[0].complete, false);
});

test('SPEC 10 (SYNTHETIC): stations 0.0, 0.0, 2.5 in; trigger 2.0 -> OK (max controls)', () => {
  const stations = [st('USSYN1', 3), st('USSYN2', 6), st('USSYN3', 9)];
  const observations = [
    ...windowObs('USSYN1', D, [0, 0, 0]), ...windowObs('USSYN2', D, [0, 0, 0]), ...windowObs('USSYN3', D, [0, 2.5, 0]),
  ];
  const { results } = run({ rows: [row(D)], stations, observations });
  assert.equal(results[0].status, 'OK');
  assert.equal(results[0].evidence.maxSnowInches, 2.5);
  assert.equal(results[0].evidence.medianSnowInches, 0);
});

test('SPEC 11 (SYNTHETIC): partial window (only D, D+1) with 2.3 in on D, no complete windows -> OK', () => {
  // Per-event contract: Rule A only (Rule B does not apply), isolating the affirmative-snow shortcut.
  const stations = [st('USSYN1', 3)];
  const observations = windowObs('USSYN1', D, [undefined, 2.3, 0]);
  const { results } = run({ rows: [row(D)], contract: { type: 'PER_EVENT', plowTriggerInches: 2 }, stations, observations });
  assert.equal(results[0].status, 'OK');
  assert.equal(results[0].ruleResults.A.status, 'OK');
  assert.equal(results[0].evidence.stationCount, 0);
});


test('SPEC 12 (SYNTHETIC): partial window (only D, D+1) values 0, no complete windows -> NOT_ENOUGH_DATA', () => {
  const stations = [st('USSYN1', 3)];
  const observations = windowObs('USSYN1', D, [undefined, 0, 0]);
  const { results } = run({ rows: [row(D)], stations, observations });
  assert.equal(results[0].status, 'NOT_ENOUGH_DATA');
});

test('SPEC 13 (SYNTHETIC): presumed-zero P on one day, otherwise qualifies for HIGH -> WQ, LOW', () => {
  const { stations, observations } = threeStations(D, [0, 0, 0]);
  observations[0] = rawObs(observations[0].stationId, observations[0].date, '0.0', 'P,,0,0700');
  const { results } = run({ rows: [row(D)], stations, observations });
  assert.equal(results[0].status, 'WORTH_QUESTIONING');
  assert.equal(results[0].confidence, 'LOW');
  assert.equal(results[0].evidence.stations.find((w) => w.presumedZero).days[0].label, 'presumed zero');
});

test('SPEC 14 (SYNTHETIC): source flag N (CoCoRaHS), 3 stations at 0.0 -> used; WQ', () => {
  const n = () => normalizeElement('0.0', ',,N');
  const { results } = run({ rows: [row(D)], ...threeStations(D, [0, 0, 0], [3, 6, 9], n) });
  assert.equal(results[0].status, 'WORTH_QUESTIONING');
  assert.equal(results[0].evidence.stationCount, 3);
});

test('SPEC 15 (SYNTHETIC): source flag H or unknown only -> excluded -> NOT_ENOUGH_DATA', () => {
  for (const attrs of [',,H,0700', ',,Q,0700']) {
    const make = () => normalizeElement('0.0', attrs);
    const { results } = run({ rows: [row(D)], ...threeStations(D, [0, 0, 0], [3, 6, 9], make) });
    assert.equal(results[0].status, 'NOT_ENOUGH_DATA', attrs);
    assert.equal(results[0].evidence.stations[0].days[0].excludedReason, 'SOURCE_NOT_ALLOWED');
  }
});

// ---------------------------------------------------------------- SPEC 16-17 (Rule E)
const snowy = (dates) => {
  const stations = [st('USSYNSNOW1', 2)];
  const all = new Set(dates.flatMap(getDateWindow));
  return { stations, observations: [...all].map((d) => synObs('USSYNSNOW1', d, synEl(5))) };
};

test('SPEC 16 (SYNTHETIC): two identical rows -> both WQ, DUPLICATE_BILLING, HIGH; count = 2', () => {
  const rows = [row(D, 'plow', 1, 42500), row(D, 'plow', 1, 42500)];
  const { results, summary } = run({ rows, contract: { type: 'PER_EVENT', plowTriggerInches: 2 }, ...snowy([D]) });
  for (const x of results) {
    assert.equal(x.status, 'WORTH_QUESTIONING');
    assert.deepEqual(x.reasonCodes, ['DUPLICATE_BILLING']);
    assert.equal(x.confidence, 'HIGH');
    assert.equal(x.flaggedUnits, 1);
    assert.equal(x.reasonText, 'More than one line lists plow on 2025-12-07. Confirm whether these were separate visits or a repeated entry.');
  }
  assert.equal(summary.itemsWorthQuestioning, 2);
  assert.equal(summary.estimatedReviewAmountCents, 85000);
});

test('SPEC 17 (SYNTHETIC): same date/type, different amounts -> both WQ, MEDIUM', () => {
  const rows = [row(D, 'plow', 1, 42500), row(D, 'plow', 1, 40000)];
  const { results } = run({ rows, contract: { type: 'PER_EVENT', plowTriggerInches: 2 }, ...snowy([D]) });
  for (const x of results) {
    assert.equal(x.status, 'WORTH_QUESTIONING');
    assert.equal(x.confidence, 'MEDIUM');
  }
});

// ---------------------------------------------------------------- SPEC 18-22 (Rule C, unlimited)
const seasonDates = ['2025-12-07', '2026-01-15', '2026-02-04'];

test('SPEC 18 (SYNTHETIC): allowance 10, counted pushes 10 -> no ALLOWANCE_EXCEEDED', () => {
  const rows = [row(seasonDates[0], 'plow', 4), row(seasonDates[1], 'plow', 3), row(seasonDates[2], 'plow', 3)];
  const { results, summary, warnings } = run({ rows, contract: allowanceContract(), ...snowy(seasonDates), seasonComplete: true });
  assert.ok(results.every((x) => !x.reasonCodes.includes('ALLOWANCE_EXCEEDED')));
  assert.ok(results.every((x) => x.status === 'OK'));
  assert.deepEqual(summary.contractualOverage, { excessUnits: 0, overageCents: 0 });
  assert.ok(!warnings.some((w) => w.code === 'SEASON_MAY_BE_INCOMPLETE'));
});

test('SPEC 19 (SYNTHETIC): allowance 10, pushes 12, rate $30, season complete -> 2 newest units, $60.00, HIGH', () => {
  const rows = [row(seasonDates[0], 'plow', 4, 170000), row(seasonDates[1], 'plow', 4, 170000), row(seasonDates[2], 'plow', 4, 170000)];
  const { results, summary } = run({
    rows, contract: allowanceContract({ overageRateCents: 3000 }), ...snowy(seasonDates), seasonComplete: true,
  });
  const [a, b, c] = results;
  assert.equal(a.status, 'OK');
  assert.equal(b.status, 'OK');
  assert.equal(c.status, 'WORTH_QUESTIONING');
  assert.deepEqual(c.reasonCodes, ['ALLOWANCE_EXCEEDED']);
  assert.equal(c.allowanceExcessUnits, 2);
  assert.equal(c.flaggedUnits, 0);
  assert.equal(c.confidence, 'HIGH');
  assert.equal(c.estimatedAmountCents, 0);
  assert.equal(c.reasonText, 'The entered season total is 12; the allowance is 10; 2 push(es) are beyond the allowance (2 on this line). Check the service log and overage clause.');
  assert.deepEqual(summary.contractualOverage, { excessUnits: 2, overageCents: 6000 });
  assert.equal(summary.estimatedReviewAmountCents, 0, 'review amount unaffected');
  assert.equal(summary.itemsWorthQuestioning, 1);
});

test('Rule C excess spans rows newest-first with sourceRowNumber tie-break (SYNTHETIC)', () => {
  const rows = [row('2026-01-15', 'plow', 1), row('2026-02-04', 'plow', 1), row('2026-02-04', 'plow', 1)];
  const { results } = run({ rows, contract: allowanceContract({ pushAllowance: 1 }), ...snowy(['2026-01-15', '2026-02-04']), seasonComplete: true });
  // Newest date first; tie on Feb 4 -> later sourceRowNumber first. (Duplicates also flag Feb 4 rows.)
  assert.deepEqual(results.map((x) => x.allowanceExcessUnits), [0, 1, 1]);
});

test('SPEC 20 (SYNTHETIC): same as 19, season not marked complete -> MEDIUM', () => {
  const rows = [row(seasonDates[0], 'plow', 4), row(seasonDates[1], 'plow', 4), row(seasonDates[2], 'plow', 4)];
  const { results } = run({ rows, contract: allowanceContract({ overageRateCents: 3000 }), ...snowy(seasonDates), seasonComplete: false });
  assert.equal(results[2].confidence, 'MEDIUM');
  assert.equal(results[2].allowanceExcessUnits, 2);
});

test('SPEC 21 (SYNTHETIC): allowance contract, walkway rows, checkbox off -> walkway not counted', () => {
  const rows = [row(seasonDates[0], 'plow', 2), row(seasonDates[0], 'walkway', 2), row(seasonDates[1], 'walkway', 3)];
  const contract = allowanceContract({ pushAllowance: 2, overageRateCents: 3000 });
  const off = run({ rows, contract, ...snowy(seasonDates), seasonComplete: true });
  assert.ok(off.results.every((x) => x.allowanceExcessUnits === 0));
  assert.deepEqual(off.summary.contractualOverage, { excessUnits: 0, overageCents: 0 });
  const on = run({ rows, contract: { ...contract, allowanceCountsWalkway: true }, ...snowy(seasonDates), seasonComplete: true });
  assert.equal(on.summary.contractualOverage.excessUnits, 5);
});

test('SPEC 22 (SYNTHETIC): unlimited contract; 4 plows on 0-snow days -> NOT_CHECKED (SEASONAL_UNLIMITED_DUPLICATE_ONLY)', () => {
  const dates = ['2025-12-07', '2025-12-20', '2026-01-15', '2026-02-04'];
  const stations = [st('USSYN1', 3), st('USSYN2', 6), st('USSYN3', 9)];
  const observations = stations.flatMap((s) => dates.flatMap((d) => windowObs(s.id, d, [0, 0, 0])));
  const rows = dates.map((d) => row(d, 'plow', 1, 42500));
  const { results, summary } = run({ rows, contract: { type: 'SEASONAL_UNLIMITED', plowTriggerInches: 2 }, stations, observations });
  for (const x of results) {
    assert.equal(x.status, 'NOT_CHECKED');
    assert.deepEqual(x.reasonCodes, ['SEASONAL_UNLIMITED_DUPLICATE_ONLY']);
    assert.equal(x.ruleResults.A.status, 'NOT_APPLICABLE');
    assert.equal(x.ruleResults.B.status, 'NOT_APPLICABLE');
  }
  assert.equal(summary.itemsWorthQuestioning, 0);
});

// ---------------------------------------------------------------- SPEC 23-27 (Rule B, money)
// Storm: 4.0 in on Dec 7, zero on Dec 6, 8, 9 at one station within 10 mi.
function stormFixture() {
  const stations = [st('USSYNSTORM1', 4)];
  const values = { '2025-12-06': 0, '2025-12-07': 4.0, '2025-12-08': 0, '2025-12-09': 0 };
  return { stations, observations: Object.entries(values).map(([d, v]) => synObs('USSYNSTORM1', d, synEl(v))) };
}

test('SPEC 23 (SYNTHETIC): per-push; storm 4.0 in, trigger 2, extra 1, billed 3 -> OK', () => {
  const rows = [row('2025-12-07', 'plow', 2, 85000), row('2025-12-08', 'plow', 1, 42500)];
  const { results } = run({ rows, ...stormFixture() });
  assert.ok(results.every((x) => x.status === 'OK'));
  assert.ok(results.every((x) => x.ruleResults.B.status === 'OK'));
  assert.equal(results[0].ruleResults.B.evidence.allowedPushes, 3);
});

test('SPEC 24 (SYNTHETIC): billed 4 (Dec 7 qty 2 $850, Dec 8 qty 2 $850) -> only Dec 8 flagged, 1 unit, $425.00, LOW', () => {
  const rows = [row('2025-12-07', 'plow', 2, 85000), row('2025-12-08', 'plow', 2, 85000)];
  const { results, summary } = run({ rows, ...stormFixture() });
  const [dec7, dec8] = results;
  assert.equal(dec7.status, 'OK');
  assert.equal(dec8.status, 'WORTH_QUESTIONING');
  assert.deepEqual(dec8.reasonCodes, ['MORE_PUSHES_THAN_SUGGESTED']);
  assert.equal(dec8.flaggedUnits, 1);
  assert.equal(dec8.estimatedAmountCents, 42500);
  assert.equal(dec8.amountIsRateEstimate, false);
  assert.equal(dec8.confidence, 'LOW');
  assert.equal(dec8.reasonText, "Nearby stations recorded up to 4.0 in. for this storm. The conservative screening allowance was 3 push(es), including 1 extra return trip(s); the invoice lists 4. 1 push(es) on this line are beyond that allowance. Ask for the contractor's service log. Weather totals alone cannot show how many visits a site needed (drifting, refreezing and site conditions are not included).");
  assert.equal(summary.estimatedReviewAmountCents, 42500);
});

test('SPEC 25 (SYNTHETIC): per-event contract with "excess" pushes -> Rule B not applied', () => {
  const rows = [row('2025-12-07', 'plow', 3, 127500), row('2025-12-08', 'plow', 3, 127500)];
  const { results } = run({ rows, contract: { type: 'PER_EVENT', plowTriggerInches: 2, pricePerEventCents: 42500 }, ...stormFixture() });
  for (const x of results) {
    assert.equal(x.ruleResults.B.status, 'NOT_APPLICABLE');
    assert.ok(!x.reasonCodes.includes('MORE_PUSHES_THAN_SUGGESTED'));
    assert.equal(x.status, 'OK');
  }
});

test('SPEC 26 (SYNTHETIC): per-push row flagged, qty 2, amount blank, $125/push -> $250.00, rate estimate', () => {
  const r = row(D, 'plow', 2, null);
  const { results, summary } = run({ rows: [r], contract: perPush({ pricePerPushCents: 12500 }), ...threeStations(D, [0, 0, 0]) });
  assert.equal(results[0].status, 'WORTH_QUESTIONING');
  assert.equal(results[0].flaggedUnits, 2);
  assert.equal(results[0].estimatedAmountCents, 25000);
  assert.equal(results[0].amountIsRateEstimate, true);
  assert.equal(summary.estimatedReviewAmountCents, 25000);
  assert.equal(summary.amountUnavailableRows, 0);
});

test('SPEC 27 (SYNTHETIC): one row matches duplicate + no-snow, $85.00 -> one result, both codes, $85.00 once', () => {
  const rows = [row(D, 'plow', 1, 8500), row(D, 'plow', 1, 8500)];
  const { results, summary } = run({ rows, ...threeStations(D, [0, 0, 0]) });
  assert.equal(results.length, 2);
  const x = results[0];
  assert.equal(x.status, 'WORTH_QUESTIONING');
  assert.deepEqual(x.reasonCodes, ['NO_SIGNIFICANT_SNOW', 'DUPLICATE_BILLING']);
  assert.equal(x.flaggedUnits, 1);
  assert.equal(x.estimatedAmountCents, 8500);
  assert.equal(x.confidence, 'HIGH');
  assert.equal(summary.estimatedReviewAmountCents, 17000, 'each of the two rows counted once');
});

// ---------------------------------------------------------------- SPEC 28-32
test('SPEC 28 (SYNTHETIC): salt row, no duplicate -> NOT_CHECKED', () => {
  const { results } = run({ rows: [row(D, 'salt', 1, 8500)], ...threeStations(D, [0, 0, 0]) });
  assert.equal(results[0].status, 'NOT_CHECKED');
  assert.deepEqual(results[0].reasonCodes, ['SERVICE_TYPE_NOT_CHECKED']);
  assert.equal(results[0].reasonText, 'Salt and other services are not compared with weather records in this version. Only duplicate entries are checked.');
  assert.equal(results[0].confidence, null);
});

test('SPEC 29 (SYNTHETIC): salt row duplicated -> WQ, DUPLICATE_BILLING', () => {
  const { results } = run({ rows: [row(D, 'salt', 1, 8500), row(D, 'salt', 1, 8500)] });
  for (const x of results) {
    assert.equal(x.status, 'WORTH_QUESTIONING');
    assert.deepEqual(x.reasonCodes, ['DUPLICATE_BILLING']);
  }
});

test('SPEC 30 (SYNTHETIC): allowance contract, in-season plow on 0-snow days (3 stations) -> Rule A flags', () => {
  const { results } = run({ rows: [row(D, 'plow', 1, 0)], contract: allowanceContract(), ...threeStations(D, [0, 0, 0]) });
  assert.equal(results[0].status, 'WORTH_QUESTIONING');
  assert.deepEqual(results[0].reasonCodes, ['NO_SIGNIFICANT_SNOW']);
});

test('SPEC 31 (SYNTHETIC): walkway trigger blank -> uses plow trigger; evidence says inherited', () => {
  const contract = perPush({ plowTriggerInches: 3.0, walkwayTriggerInches: null });
  const { results } = run({ rows: [row(D, 'walkway')], contract, ...threeStations(D, [0, 2.5, 0]) });
  assert.equal(results[0].status, 'WORTH_QUESTIONING');
  assert.equal(results[0].evidence.triggerInches, 3.0);
  assert.equal(results[0].evidence.triggerInherited, true);
  const own = run({ rows: [row(D, 'walkway')], contract: { ...contract, walkwayTriggerInches: 1.0 }, ...threeStations(D, [0, 2.5, 0]) });
  assert.equal(own.results[0].status, 'OK');
  assert.equal(own.results[0].evidence.triggerInherited, false);
});

test('SPEC 32: storm grouping Dec 7, Dec 9, Dec 13 -> [Dec 7, Dec 9], [Dec 13]', () => {
  const rows = [row('2025-12-13'), row('2025-12-07'), row('2025-12-09')];
  const storms = groupStorms(rows).map((s) => s.map((r) => r.date));
  assert.deepEqual(storms, [['2025-12-07', '2025-12-09'], ['2025-12-13']]);
});

// ---------------------------------------------------------------- SPEC v1.2 (Phase 3.5) tests 45-51
// Partial windows only: each station has no record on D-1, so no complete window exists.
function partialSnow(dates, inches = 2.3) {
  const stations = [st('USSYNPART1', 3)];
  const observations = dates.flatMap((d) => [synObs('USSYNPART1', d, synEl(inches)), synObs('USSYNPART1', addDaysIso(d, 1), synEl(0))]);
  return { stations, observations };
}
function addDaysIso(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
const OUTSIDE_SEASON_COPY = 'This date is outside the contract season entered, so it is not counted toward the allowance or compared with weather records. Only duplicate entries are checked.';

test('SPEC 45 (SYNTHETIC): per-push, extra 1, single push qty 1, partial window 2.3 in, no complete storm window -> OK; Rule B NOT_APPLIED', () => {
  const { results } = run({ rows: [row(D, 'plow', 1, 42500)], contract: perPush({ extraPushesAllowedPerStorm: 1 }), ...partialSnow([D]) });
  const x = results[0];
  assert.equal(x.ruleResults.A.status, 'OK');
  assert.equal(x.ruleResults.B.status, 'NOT_APPLIED');
  assert.equal(x.ruleResults.B.code, 'RULE_B_CANNOT_FLAG');
  assert.equal(x.status, 'OK');
  assert.deepEqual(x.reasonCodes, ['NO_ISSUE']);
  assert.ok(!x.reasonText.includes('RULE_B_CANNOT_FLAG'));
  assert.equal(x.flaggedUnits, 0);
});

test('SPEC 46 (SYNTHETIC): per-push, extra 1, storm with 2 pushes, no complete storm window, Rule A OK -> OK; Rule B NOT_APPLIED', () => {
  const rows = [row('2025-12-07', 'plow', 1), row('2025-12-08', 'plow', 1)];
  const { results } = run({ rows, contract: perPush({ extraPushesAllowedPerStorm: 1 }), ...partialSnow(['2025-12-07', '2025-12-08']) });
  for (const x of results) {
    assert.equal(x.ruleResults.A.status, 'OK');
    assert.equal(x.ruleResults.B.status, 'NOT_APPLIED');
    assert.equal(x.status, 'OK');
  }
});

test('SPEC 47 (SYNTHETIC): per-push, extra 1, storm with 3 pushes, no complete storm window, Rule A OK -> NOT_ENOUGH_DATA (unchanged)', () => {
  const rows = [row('2025-12-07', 'plow', 2), row('2025-12-08', 'plow', 1)];
  const { results } = run({ rows, contract: perPush({ extraPushesAllowedPerStorm: 1 }), ...partialSnow(['2025-12-07', '2025-12-08']) });
  for (const x of results) {
    assert.equal(x.ruleResults.A.status, 'OK');
    assert.equal(x.ruleResults.B.status, 'NOT_ENOUGH_DATA');
    assert.equal(x.status, 'NOT_ENOUGH_DATA');
    assert.deepEqual(x.reasonCodes, ['INSUFFICIENT_DATA']);
  }
});

test('SPEC 48 (SYNTHETIC): per-push, extra 0, single push qty 1, no complete storm window, Rule A OK -> OK; Rule B NOT_APPLIED', () => {
  const { results } = run({ rows: [row(D, 'plow', 1)], contract: perPush({ extraPushesAllowedPerStorm: 0 }), ...partialSnow([D]) });
  assert.equal(results[0].ruleResults.B.status, 'NOT_APPLIED');
  assert.equal(results[0].status, 'OK');
});

test('SPEC 45-48 note (SYNTHETIC): tier contract keeps tier pricing when Rule B is NOT_APPLIED', () => {
  const tiers = [
    { minSnowInches: 0, maxSnowInchesExclusive: 2, chargePerPushCents: 9500 },
    { minSnowInches: 2, maxSnowInchesExclusive: null, chargePerPushCents: 14500 },
  ];
  // Single push on a 0-snow day with 3 complete stations: Rule A flags, Rule B NOT_APPLIED, eventSnow 0 -> tier 0-2.
  const { results } = run({
    rows: [row(D, 'plow', 1, null)],
    contract: { type: 'PER_INCH_TIERS', plowTriggerInches: 2, extraPushesAllowedPerStorm: 1, tiers },
    ...threeStations(D, [0, 0, 0]),
  });
  assert.equal(results[0].ruleResults.B.status, 'NOT_APPLIED');
  assert.equal(results[0].status, 'WORTH_QUESTIONING');
  assert.equal(results[0].estimatedAmountCents, 9500);
  assert.equal(results[0].amountIsRateEstimate, true);
});

test('SPEC 49 (SYNTHETIC): allowance Nov 1-Apr 30, plow on May 15, not duplicated -> NOT_CHECKED, OUTSIDE_SEASON, not counted, no weather', () => {
  const rows = [row('2026-05-15', 'plow', 1, 42500), row('2026-01-15', 'plow', 1, 42500)];
  const contract = allowanceContract({ seasonStart: '2025-11-01', seasonEnd: '2026-04-30', pushAllowance: 1, overageRateCents: 3000 });
  const { results, summary } = run({ rows, contract, ...threeStations('2026-05-15', [0, 0, 0]), seasonComplete: true });
  const may = results[0];
  assert.equal(may.status, 'NOT_CHECKED');
  assert.deepEqual(may.reasonCodes, ['OUTSIDE_SEASON']);
  assert.equal(may.reasonText, OUTSIDE_SEASON_COPY);
  assert.equal(may.confidence, null);
  assert.equal(may.ruleResults.A.status, 'NOT_APPLICABLE');
  assert.equal(may.ruleResults.C.status, 'NOT_APPLICABLE');
  assert.deepEqual(may.evidence.stations, [], 'no weather check run');
  assert.equal(may.allowanceExcessUnits, 0);
  // Only the in-season push counts: 1 push vs allowance 1 -> no excess.
  assert.deepEqual(summary.contractualOverage, { excessUnits: 0, overageCents: 0 });
});

test('SPEC 50 (SYNTHETIC): same contract, two identical plow lines on May 15 -> both WQ, DUPLICATE_BILLING HIGH, includes OUTSIDE_SEASON, not counted', () => {
  const rows = [row('2026-05-15', 'plow', 1, 42500), row('2026-05-15', 'plow', 1, 42500)];
  const contract = allowanceContract({ seasonStart: '2025-11-01', seasonEnd: '2026-04-30', pushAllowance: 0, overageRateCents: 3000 });
  const { results, summary } = run({ rows, contract, seasonComplete: true });
  for (const x of results) {
    assert.equal(x.status, 'WORTH_QUESTIONING');
    assert.deepEqual(x.reasonCodes, ['DUPLICATE_BILLING', 'OUTSIDE_SEASON']);
    assert.equal(x.confidence, 'HIGH');
    assert.equal(x.allowanceExcessUnits, 0);
    assert.equal(x.ruleResults.C.status, 'NOT_APPLICABLE');
    assert.ok(x.reasonText.endsWith(OUTSIDE_SEASON_COPY));
    assert.equal(x.estimatedAmountCents, 42500);
  }
  // Allowance 0 and nothing counted -> no excess even though 2 plow lines exist.
  assert.deepEqual(summary.contractualOverage, { excessUnits: 0, overageCents: 0 });
});

test('SPEC 51 (SYNTHETIC): same contract, salt on May 15 -> NOT_CHECKED, SERVICE_TYPE_NOT_CHECKED', () => {
  const contract = allowanceContract({ seasonStart: '2025-11-01', seasonEnd: '2026-04-30' });
  const { results } = run({ rows: [row('2026-05-15', 'salt', 1, 8500)], contract });
  assert.equal(results[0].status, 'NOT_CHECKED');
  assert.deepEqual(results[0].reasonCodes, ['SERVICE_TYPE_NOT_CHECKED']);
});

test('v1.2: walkway outside the season on an allowance contract also gets OUTSIDE_SEASON (SYNTHETIC)', () => {
  const contract = allowanceContract({ seasonStart: '2025-11-01', seasonEnd: '2026-04-30', allowanceCountsWalkway: true });
  const { results } = run({ rows: [row('2025-10-20', 'walkway', 1)], contract });
  assert.deepEqual(results[0].reasonCodes, ['OUTSIDE_SEASON']);
});

// ---------------------------------------------------------------- additional rule checks
test('Rule A confidence: MEDIUM and LOW boundaries (SYNTHETIC)', () => {
  // 2 stations within 15 mi, gap 0.5 -> MEDIUM.
  const med = run({ rows: [row(D)], ...threeStations(D, [0, 1.5, 0], [8, 14]) });
  assert.equal(med.results[0].confidence, 'MEDIUM');
  // Same but one station at 16 mi -> LOW.
  const far = run({ rows: [row(D)], ...threeStations(D, [0, 1.5, 0], [8, 16]) });
  assert.equal(far.results[0].confidence, 'LOW');
  // 3 stations <= 10 mi but gap 0.9 -> not HIGH (MEDIUM).
  const gap = run({ rows: [row(D)], ...threeStations(D, [0, 1.1, 0]) });
  assert.equal(gap.results[0].confidence, 'MEDIUM');
  // One complete window -> LOW.
  const one = run({ rows: [row(D)], ...threeStations(D, [0, 0, 0], [3]) });
  assert.equal(one.results[0].confidence, 'LOW');
});

test('Rule B: no valid storm totals -> NOT_ENOUGH_DATA for every row in the storm (SYNTHETIC)', () => {
  // Dec 7 window complete and snowy (Rule A OK) but Dec 9 missing -> storm window incomplete.
  // extra = 0 so billedPushes (2) > 1 + extra and Rule B can flag (v1.2 skip does not apply).
  const stations = [st('USSYN1', 3)];
  const observations = ['2025-12-06', '2025-12-07', '2025-12-08'].map((d, i) => synObs('USSYN1', d, synEl([0, 4, 0][i])));
  const { results } = run({ rows: [row('2025-12-07'), row('2025-12-08')], contract: perPush({ extraPushesAllowedPerStorm: 0 }), stations, observations });
  for (const x of results) {
    assert.equal(x.ruleResults.B.status, 'NOT_ENOUGH_DATA');
    assert.equal(x.status, 'NOT_ENOUGH_DATA');
  }
});

test('Rule B: event below trigger -> not applied, Rule A covers it (SYNTHETIC)', () => {
  // extra = 0 so billedPushes (2) > 1 + extra and the event-below-trigger path is reached.
  const { results } = run({ rows: [row(D), row(D)], contract: perPush({ extraPushesAllowedPerStorm: 0 }), ...threeStations(D, [0, 0, 0]) });
  assert.equal(results[0].ruleResults.B.status, 'NOT_APPLICABLE');
  assert.deepEqual(results[0].reasonCodes, ['NO_SIGNIFICANT_SNOW', 'DUPLICATE_BILLING']);
});

test('Rule B station-days counted once across overlapping windows (SYNTHETIC)', () => {
  // Dec 7 and Dec 8 windows overlap on Dec 7-8; 4.0 in on Dec 7 must be counted once.
  const rows = [row('2025-12-07', 'plow', 1), row('2025-12-08', 'plow', 1)];
  const { results } = run({ rows, ...stormFixture() });
  assert.equal(results[0].ruleResults.B.evidence.eventSnowInches, 4.0);
});

test('per-inch tiers: tier rate from storm eventSnow; invalid table disables estimate (SYNTHETIC)', () => {
  const tiers = [
    { minSnowInches: 0, maxSnowInchesExclusive: 2, chargePerPushCents: 9500 },
    { minSnowInches: 2, maxSnowInchesExclusive: 5, chargePerPushCents: 14500 },
    { minSnowInches: 5, maxSnowInchesExclusive: null, chargePerPushCents: 21000 },
  ];
  assert.equal(isValidTierTable(tiers), true);
  assert.equal(selectTier(tiers, 4.0).chargePerPushCents, 14500);
  assert.equal(selectTier(tiers, 5.0).chargePerPushCents, 21000);
  const contract = { type: 'PER_INCH_TIERS', plowTriggerInches: 2, extraPushesAllowedPerStorm: 1, tiers };
  const rows = [row('2025-12-07', 'plow', 2, null), row('2025-12-08', 'plow', 2, null)];
  const { results } = run({ rows, contract, ...stormFixture() });
  assert.equal(results[1].flaggedUnits, 1);
  assert.equal(results[1].estimatedAmountCents, 14500);
  assert.equal(results[1].amountIsRateEstimate, true);

  const gapTiers = [tiers[0], { ...tiers[1], minSnowInches: 2.5 }, tiers[2]];
  assert.equal(isValidTierTable(gapTiers), false);
  const bad = run({ rows, contract: { ...contract, tiers: gapTiers }, ...stormFixture() });
  assert.equal(bad.results[1].estimatedAmountCents, null);
  assert.equal(bad.summary.amountUnavailableRows, 1);
  assert.ok(bad.warnings.some((w) => w.code === 'TIER_TABLE_INVALID'));
  assert.equal(isValidTierTable([{ ...tiers[0], minSnowInches: 1 }]), false);
  assert.equal(isValidTierTable([{ ...tiers[0], maxSnowInchesExclusive: null }, tiers[1]]), false);
});

test('money: blank amount and no rate -> amount unavailable; non-plow rows get no rate estimate (SYNTHETIC)', () => {
  const rows = [row(D, 'plow', 1, null), row(D, 'walkway', 1, null), row(D, 'plow', 1, 12345)];
  const { results, summary } = run({ rows, contract: perPush({ pricePerPushCents: 12500 }), ...threeStations(D, [0, 0, 0]) });
  assert.equal(results[0].estimatedAmountCents, 12500);
  assert.equal(results[1].estimatedAmountCents, null);
  assert.equal(summary.totalBilledCents, 12345);
  assert.equal(summary.amountUnavailableRows, 1);
  assert.equal(summary.itemsWorthQuestioning, 3);
});

test('money: fractional per-unit amounts round once per row in integer cents (SYNTHETIC)', () => {
  const rows = [row('2025-12-07', 'plow', 3, 10000), row('2025-12-08', 'plow', 3, 10000)];
  // 4.0 in storm, allowed 3, billed 6 -> excess 3, all on Dec 8 row: 10000 * 3/3.
  const { results } = run({ rows, ...stormFixture() });
  assert.equal(results[1].flaggedUnits, 3);
  assert.equal(results[1].estimatedAmountCents, 10000);
  const two = run({ rows: [row('2025-12-07', 'plow', 3, 10000), row('2025-12-08', 'plow', 2, 10000)], ...stormFixture() });
  assert.equal(two.results[1].flaggedUnits, 2);
  assert.equal(two.results[1].estimatedAmountCents, 10000);
  const one = run({ rows: [row('2025-12-07', 'plow', 3, 10000), row('2025-12-08', 'plow', 1, 10000)], ...stormFixture() });
  assert.equal(one.results[1].flaggedUnits, 1);
  assert.equal(one.results[1].estimatedAmountCents, 10000);
  const third = run({ rows: [row('2025-12-07', 'plow', 1, 10000), row('2025-12-08', 'plow', 3, 10000)], ...stormFixture() });
  assert.equal(third.results[1].flaggedUnits, 1);
  assert.equal(third.results[1].estimatedAmountCents, 3333);
});

test('allowance: not exceeded and season not marked complete -> "season may be incomplete" warning', () => {
  const { warnings } = run({ rows: [row(D, 'plow', 1)], contract: allowanceContract(), ...snowy([D]) });
  assert.ok(warnings.some((w) => w.code === 'SEASON_MAY_BE_INCOMPLETE'));
});

test('allowance: no overage rate -> excess shown, overage null', () => {
  const rows = [row(D, 'plow', 12)];
  const { summary } = run({ rows, contract: allowanceContract(), ...snowy([D]), seasonComplete: true });
  assert.deepEqual(summary.contractualOverage, { excessUnits: 2, overageCents: null });
});

test('computeStationWindows: complete vs partial, only eligible stations, sorted by distance', () => {
  const stations = [st('USSYNB', 9), st('USSYNA', 2)];
  const observations = [...windowObs('USSYNA', D, [0, 1, 0]), ...windowObs('USSYNB', D, [0, undefined, 0]), ...windowObs('USSYNX', D, [9, 9, 9])];
  const w = computeStationWindows(observations, getDateWindow(D), stations);
  assert.deepEqual(w.map((x) => [x.stationId, x.complete, x.totalSnowInches]), [['USSYNA', true, 1], ['USSYNB', false, null]]);
  assert.equal(w[1].days[1].excludedReason, 'MISSING');
});

test('getDateWindow uses UTC date-only arithmetic across month/year/leap boundaries', () => {
  assert.deepEqual(getDateWindow('2026-01-01'), ['2025-12-31', '2026-01-01', '2026-01-02']);
  assert.deepEqual(getDateWindow('2024-03-01'), ['2024-02-29', '2024-03-01', '2024-03-02']);
  assert.throws(() => getDateWindow('2026-02-30'));
});

test('evaluateDuplicates: groups by date + service type only', () => {
  const rows = [row(D, 'plow'), row(D, 'walkway'), row('2025-12-08', 'plow')];
  const res = evaluateDuplicates(rows);
  assert.ok([...res.values()].every((r) => r.status === 'OK'));
});

test('runChecks is deterministic and does not mutate inputs', () => {
  const rows = [row(D, 'plow', 1, 8500), row(D, 'plow', 1, 8500)];
  const fx = threeStations(D, [0, 0, 0]);
  const snapshot = JSON.stringify({ rows, fx });
  const a = run({ rows, ...fx });
  const b = run({ rows, ...fx });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify({ rows, fx }), snapshot);
});

test('runChecks rejects invalid inputs instead of defaulting', () => {
  const ok = { billedRows: [row(D)], contract: perPush(), observations: [], stations: [], options: {} };
  assert.throws(() => runChecks({ ...ok, contract: { ...perPush(), type: 'WEEKLY' } }), /contract type/);
  assert.throws(() => runChecks({ ...ok, contract: perPush({ plowTriggerInches: 0 }) }));
  assert.throws(() => runChecks({ ...ok, contract: perPush({ extraPushesAllowedPerStorm: 3 }) }));
  assert.throws(() => runChecks({ ...ok, contract: perPush({ pricePerPushCents: 12.5 }) }));
  assert.throws(() => runChecks({ ...ok, billedRows: [{ ...row(D), quantity: 0 }] }));
  assert.throws(() => runChecks({ ...ok, billedRows: [{ ...row(D), serviceType: 'mow' }] }));
  assert.throws(() => runChecks({ ...ok, billedRows: [{ ...row(D), amountChargedCents: 1.5 }] }));
  assert.throws(() => runChecks({ ...ok, billedRows: [{ ...row(D), date: '12/7/25' }] }));
  assert.throws(() => runChecks({ ...ok, contract: allowanceContract({ seasonEnd: '2025-10-01' }) }));
});

// ---------------------------------------------------------------- exact copy vs SPEC
test('status labels, status copy and reason templates match SPEC §9.2 / §9.3 exactly', async () => {
  const spec = await fs.readFile(new URL('../docs/SPEC.md', import.meta.url), 'utf8');
  for (const [status, label] of Object.entries(STATUS_LABELS)) {
    assert.ok(spec.includes(`| ${status} | ${label} | "${STATUS_COPY[status]}" |`), `§9.2 ${status}`);
  }
  for (const [code, text] of Object.entries(REASON_TEMPLATES)) {
    assert.ok(spec.includes(`| ${code} | "${text}" |`), `§9.3 ${code}`);
  }
});

test('checks.js imports nothing browser-specific and uses no clock, network or storage', async () => {
  const src = await fs.readFile(new URL('../assets/js/checks.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./constants.js']);
  const banned = [/\bfetch\s*\(/, /\bdocument\b/, /\bwindow\b/, /\bglobalThis\b/, /\blocalStorage\b/, /\bsessionStorage\b/,
    /\bDate\.now\b/, /new Date\(\s*\)/, /\bMath\.random\b/, /\bXMLHttpRequest\b/, /\bsetTimeout\b/];
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  for (const re of banned) assert.ok(!re.test(code), String(re));
});
