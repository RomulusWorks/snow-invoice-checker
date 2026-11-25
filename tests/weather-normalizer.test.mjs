import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {
  normalizeNceiJson, normalizeNceiText, normalizeElement, InvalidResponseError,
} from '../assets/js/weather-normalizer.js';
import { SOURCE_FLAG_ALLOWLIST } from '../assets/js/constants.js';

const fixturesDir = new URL('./fixtures/', import.meta.url);
const meta = JSON.parse(await fs.readFile(new URL('ncei-request-metadata.json', fixturesDir), 'utf8'));
const liveFiles = meta.captures.map((c) => c.file);
const readFixture = async (f) => fs.readFile(new URL(f, fixturesDir));
const close = (a, b) => Math.abs(a - b) < 1e-12;

test('live fixtures are unmodified (bytes and sha256 match capture metadata)', async () => {
  assert.ok(liveFiles.length >= 1);
  for (const c of meta.captures) {
    assert.match(c.file, /^ncei-daily-summaries-live-\d{4}-\d{2}-\d{2}-/);
    const buf = await readFixture(c.file);
    assert.equal(buf.length, c.bytes, c.file);
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), c.sha256, c.file);
    assert.equal(c.httpStatus, 200);
    assert.match(c.url, /units=metric/);
    assert.match(c.url, /includeAttributes=true/);
  }
});

test('SPEC 43: normalizer on live fixtures matches raw values field-by-field', async () => {
  for (const file of liveFiles) {
    const raw = JSON.parse((await readFixture(file)).toString('utf8'));
    const obs = normalizeNceiJson(raw);
    assert.equal(obs.length, raw.length, file);
    const byKey = new Map(obs.map((o) => [`${o.stationId}|${o.date}`, o]));
    for (const r of raw) {
      const o = byKey.get(`${r.STATION}|${r.DATE}`);
      assert.ok(o, `${file} ${r.STATION} ${r.DATE}`);
      assert.equal(o.stationName, r.NAME);
      assert.equal(o.latitude, Number(r.LATITUDE));
      assert.equal(o.longitude, Number(r.LONGITUDE));
      for (const el of ['SNOW', 'SNWD']) {
        const e = o.elements[el];
        const where = `${file} ${r.STATION} ${r.DATE} ${el}`;
        if (r[el] === undefined) {
          assert.equal(e.excludedReason, 'MISSING', where);
          assert.equal(e.valueInches, null, where);
          assert.equal(e.usable, false, where);
          continue;
        }
        assert.equal(e.rawValue, r[el], where);
        // Confirmed layout: measurement, quality, source[, time].
        const [m, q, s] = r[`${el}_ATTRIBUTES`].split(',');
        assert.equal(e.measurementFlag, m, where);
        assert.equal(e.qualityFlag, q, where);
        assert.equal(e.sourceFlag, s, where);
        const shouldUse = q === '' && SOURCE_FLAG_ALLOWLIST.includes(s) && ['', 'T', 'P'].includes(m);
        assert.equal(e.usable, shouldUse, where);
        if (shouldUse) {
          assert.ok(close(e.valueInches, m === 'T' ? 0 : Number(r[el]) / 25.4), where);
          assert.equal(e.trace, m === 'T', where);
          assert.equal(e.excludedReason, null, where);
        } else {
          assert.equal(e.valueInches, null, where);
          assert.ok(e.excludedReason, where);
        }
      }
    }
  }
});

test('live Detroit storm: CoCoRaHS 66.0 mm -> 2.598 in, usable; absent SNOW is missing', async () => {
  const file = liveFiles.find((f) => f.includes('detroit'));
  const obs = normalizeNceiJson(JSON.parse((await readFixture(file)).toString('utf8')));
  const o = obs.find((x) => x.stationId === 'US1MIWY0163' && x.date === '2026-01-15');
  assert.equal(o.elements.SNOW.rawValue, '66.0');
  assert.equal(o.elements.SNOW.sourceFlag, 'N');
  assert.equal(o.elements.SNOW.usable, true);
  assert.ok(close(o.elements.SNOW.valueInches, 66 / 25.4));
  const absent = obs.find((x) => x.elements.SNOW.excludedReason === 'MISSING');
  assert.ok(absent, 'live fixture contains an absent SNOW value');
  assert.equal(absent.elements.SNOW.valueInches, null);
  const trace = obs.find((x) => x.elements.SNOW.trace);
  assert.ok(trace, 'live fixture contains a trace');
  assert.equal(trace.elements.SNOW.valueInches, 0);
  assert.ok(obs.some((x) => x.elements.SNOW.usable && x.elements.SNOW.valueInches > 0), 'positive snowfall present');
});

test('live Duluth: real source H excluded; real quality flag I excluded', async () => {
  const file = liveFiles.find((f) => f.includes('duluth'));
  const obs = normalizeNceiJson(JSON.parse((await readFixture(file)).toString('utf8')));
  const els = obs.flatMap((o) => [o.elements.SNOW, o.elements.SNWD]);
  const h = els.filter((e) => e.sourceFlag === 'H');
  assert.ok(h.length > 0);
  assert.ok(h.every((e) => !e.usable && ['SOURCE_NOT_ALLOWED', 'QUALITY_FLAG'].includes(e.excludedReason)));
  const qi = els.filter((e) => e.qualityFlag === 'I');
  assert.ok(qi.length > 0);
  assert.ok(qi.every((e) => !e.usable && e.excludedReason === 'QUALITY_FLAG'));
});

test('live Silverthorne: real quality flag G excluded', async () => {
  const file = liveFiles.find((f) => f.includes('silverthorne'));
  const obs = normalizeNceiJson(JSON.parse((await readFixture(file)).toString('utf8')));
  const g = obs.flatMap((o) => [o.elements.SNOW, o.elements.SNWD]).filter((e) => e.qualityFlag === 'G');
  assert.ok(g.length > 0);
  assert.ok(g.every((e) => !e.usable && e.excludedReason === 'QUALITY_FLAG'));
});

// ---- SYNTHETIC edge cases ----
const synthetic = JSON.parse(await fs.readFile(new URL('ncei-daily-summaries-SYNTHETIC-edge-cases.json', fixturesDir), 'utf8'));
const syn = normalizeNceiJson(synthetic);
const snowOn = (date) => syn.find((o) => o.date === date).elements.SNOW;

test('SYNTHETIC: missing values are never zero (absent, empty, -9999)', () => {
  for (const d of ['2026-01-01', '2026-01-02', '2026-01-03']) {
    const e = snowOn(d);
    assert.equal(e.valueInches, null, d);
    assert.equal(e.usable, false, d);
    assert.equal(e.excludedReason, 'MISSING', d);
  }
});

test('SYNTHETIC: trace T -> 0.0 in, usable, labelled trace', () => {
  const e = snowOn('2026-01-04');
  assert.deepEqual([e.valueInches, e.usable, e.trace, e.excludedReason], [0, true, true, null]);
});

test('SYNTHETIC: presumed zero P -> usable, presumedZero', () => {
  const e = snowOn('2026-01-05');
  assert.deepEqual([e.valueInches, e.usable, e.presumedZero, e.excludedReason], [0, true, true, null]);
});

test('SYNTHETIC: accumulation A -> not a usable daily value, accumulated, value kept', () => {
  const e = snowOn('2026-01-06');
  assert.equal(e.usable, false);
  assert.equal(e.accumulated, true);
  assert.equal(e.excludedReason, 'ACCUMULATED');
  assert.ok(close(e.valueInches, 1));
});

test('SYNTHETIC: non-blank quality flag excluded', () => {
  const e = snowOn('2026-01-07');
  assert.deepEqual([e.usable, e.valueInches, e.excludedReason, e.qualityFlag], [false, null, 'QUALITY_FLAG', 'X']);
});

test('SYNTHETIC: source N (CoCoRaHS) allowed', () => {
  const e = snowOn('2026-01-08');
  assert.equal(e.usable, true);
  assert.equal(e.sourceFlag, 'N');
  assert.ok(close(e.valueInches, 2));
});

test('SYNTHETIC: source H, unknown source, and blank source excluded', () => {
  for (const d of ['2026-01-09', '2026-01-10', '2026-01-11', '2026-01-16']) {
    const e = snowOn(d);
    assert.equal(e.usable, false, d);
    assert.equal(e.excludedReason, 'SOURCE_NOT_ALLOWED', d);
    assert.equal(e.valueInches, null, d);
  }
});

test('SYNTHETIC: source Z (Datzilla official corrections) allowed — SPEC v1.2 owner decision', () => {
  const z = normalizeElement('25.4', ',,Z,0700');
  assert.equal(z.sourceFlag, 'Z');
  assert.equal(z.usable, true);
  assert.equal(z.excludedReason, null);
  assert.ok(close(z.valueInches, 1));
  assert.equal(normalizeElement('25.4', ',,z,0700').excludedReason, 'SOURCE_NOT_ALLOWED', 'lowercase z is a different (foreign) code');
});

test('SYNTHETIC: source flags are case-sensitive (d allowed, n excluded)', () => {
  assert.equal(snowOn('2026-01-18').usable, true);
  assert.equal(snowOn('2026-01-19').excludedReason, 'SOURCE_NOT_ALLOWED');
});

test('SYNTHETIC: missing/unreadable attributes, unknown measurement flag, bad values excluded', () => {
  assert.equal(snowOn('2026-01-12').excludedReason, 'ATTRIBUTES_MISSING');
  assert.equal(snowOn('2026-01-17').excludedReason, 'ATTRIBUTES_UNREADABLE');
  assert.equal(snowOn('2026-01-13').excludedReason, 'UNKNOWN_MEASUREMENT_FLAG');
  assert.equal(snowOn('2026-01-14').excludedReason, 'INVALID_VALUE');
  assert.equal(snowOn('2026-01-15').excludedReason, 'INVALID_VALUE');
  for (const d of ['2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-17']) {
    assert.equal(snowOn(d).valueInches, null, d);
  }
});

test('SYNTHETIC: source flag T (SNOTEL) and measurement flag T (trace) are stored separately', () => {
  const snotel = normalizeElement('25.4', ',,T,0000');
  assert.equal(snotel.sourceFlag, 'T');
  assert.equal(snotel.measurementFlag, '');
  assert.equal(snotel.trace, false);
  assert.ok(close(snotel.valueInches, 1));
  const trace = normalizeElement('0.0', 'T,,7,0700');
  assert.equal(trace.measurementFlag, 'T');
  assert.equal(trace.sourceFlag, '7');
  assert.equal(trace.trace, true);
});

test('SYNTHETIC: unsafe structures throw InvalidResponseError', () => {
  assert.throws(() => normalizeNceiJson({}), InvalidResponseError);
  assert.throws(() => normalizeNceiJson([null]), InvalidResponseError);
  assert.throws(() => normalizeNceiJson([{ DATE: '2026-01-01' }]), InvalidResponseError);
  assert.throws(() => normalizeNceiJson([{ DATE: '2026-02-30', STATION: 'USX' }]), InvalidResponseError);
  assert.throws(() => normalizeNceiJson([{ DATE: '01/02/2026', STATION: 'USX' }]), InvalidResponseError);
  assert.throws(() => normalizeNceiJson([{ DATE: '2026-01-01', STATION: 'USX' }, { DATE: '2026-01-01', STATION: 'USX' }]), InvalidResponseError);
  assert.throws(() => normalizeNceiText('<html>Service unavailable</html>'), InvalidResponseError);
  assert.deepEqual(normalizeNceiText('[]'), []);
});

test('output is sorted by station then date (deterministic)', () => {
  const out = normalizeNceiJson([
    { DATE: '2026-01-02', STATION: 'USB' }, { DATE: '2026-01-01', STATION: 'USB' }, { DATE: '2026-01-03', STATION: 'USA' },
  ]);
  assert.deepEqual(out.map((o) => `${o.stationId} ${o.date}`), ['USA 2026-01-03', 'USB 2026-01-01', 'USB 2026-01-02']);
});
