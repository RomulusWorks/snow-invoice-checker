import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { isValidZipShape, lookupZip, loadZctaData, validateZctaData } from '../assets/js/zip.js';
import { MESSAGES } from '../assets/js/constants.js';

// Real bundled file generated from the Census 2020 ZCTA Gazetteer (read from disk; no network).
const zcta = JSON.parse(await fs.readFile(new URL('../public/data/zcta-centroids.json', import.meta.url), 'utf8'));

test('bundled ZCTA file is non-empty, compact, and valid', async () => {
  const text = await fs.readFile(new URL('../public/data/zcta-centroids.json', import.meta.url), 'utf8');
  assert.equal(text.trimEnd().includes('\n'), false, 'JSON must be written on one line');
  assert.ok(Object.keys(zcta).length > 30000);
  assert.doesNotThrow(() => validateZctaData(zcta));
});

test('SPEC 33: ZIP 01001 (leading zero) is found and key stays a string', () => {
  assert.ok(Object.hasOwn(zcta, '01001'));
  const r = lookupZip('01001', zcta);
  assert.equal(r.ok, true);
  assert.equal(r.zip, '01001');
  assert.equal(typeof r.zip, 'string');
  assert.ok(Number.isFinite(r.lat) && Number.isFinite(r.lon));
  assert.ok(Math.abs(r.lat - 42.06) < 0.1 && Math.abs(r.lon - -72.62) < 0.1);
});

test('urban MI, OH and CO ZIPs are found', () => {
  for (const zip of ['48226', '44113', '80202']) assert.equal(lookupZip(zip, zcta).ok, true, zip);
});

test('SPEC 34: ZIP absent from file returns the exact error and makes no network call', () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('network must not be used'); };
  try {
    assert.equal(Object.hasOwn(zcta, '00000'), false);
    const r = lookupZip('00000', zcta);
    assert.deepEqual(r, { ok: false, code: 'ZIP_NOT_IN_ZCTA', message: MESSAGES.ZIP_NOT_IN_ZCTA });
    assert.equal(r.message, 'This ZIP code is not in the bundled 2020 Census ZIP Code Tabulation Area file. Check the ZIP or use another ZIP for the property area. Some valid USPS ZIP codes do not have a Census ZCTA.');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('invalid ZIP shapes return "Enter a five-digit ZIP code."', () => {
  for (const bad of ['', '1234', '123456', '1001', 'abcde', '12 34', '12345-6789', 1001, null, undefined]) {
    assert.equal(isValidZipShape(bad), false, String(bad));
    const r = lookupZip(bad, zcta);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INVALID_ZIP_SHAPE');
    assert.equal(r.message, 'Enter a five-digit ZIP code.');
  }
});

test('surrounding whitespace is trimmed but the ZIP stays a string', () => {
  const r = lookupZip(' 01001 ', zcta);
  assert.equal(r.ok, true);
  assert.equal(r.zip, '01001');
});

test('inherited object keys are not treated as ZIPs', () => {
  const r = lookupZip('12345', Object.create({ 12345: [1, 2] }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ZIP_NOT_IN_ZCTA');
});

test('validateZctaData rejects malformed data', () => {
  assert.throws(() => validateZctaData(null));
  assert.throws(() => validateZctaData([]));
  assert.throws(() => validateZctaData({}));
  assert.throws(() => validateZctaData({ 1001: [1, 2] }));
  assert.throws(() => validateZctaData({ '01001': [1] }));
  assert.throws(() => validateZctaData({ '01001': ['42', -72] }));
});

test('loadZctaData uses the relative path and validates the body (stubbed fetch)', async () => {
  let seenUrl;
  const data = await loadZctaData(async (url) => { seenUrl = url; return { ok: true, json: async () => ({ '01001': [42, -72] }) }; });
  assert.equal(seenUrl, './public/data/zcta-centroids.json');
  assert.deepEqual(data, { '01001': [42, -72] });
  await assert.rejects(loadZctaData(async () => ({ ok: false, status: 404 })), /HTTP 404/);
});
