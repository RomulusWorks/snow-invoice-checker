import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  haversineMiles, findEligibleStations, validateStationData, loadStationData, snowPeriodCoversAnyYear,
} from '../assets/js/stations.js';

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// SYNTHETIC station helper (not real NOAA stations).
const st = (id, lat, lon, firstYear = 1990, lastYear = 2026) =>
  ({ id, name: `SYNTHETIC ${id}`, lat, lon, elevation_m: 100, state: 'MI', snow: { firstYear, lastYear } });

// Latitude due north of (0,0) at exactly `miles` along the Haversine great circle.
const latAtMiles = (miles) => (miles / 3958.7613) * (180 / Math.PI);

test('haversine: zero distance and a known reference distance', () => {
  assert.equal(haversineMiles(42, -83, 42, -83), 0);
  // One degree of latitude = 2*pi*R/360 miles.
  assert.ok(Math.abs(haversineMiles(0, 0, 1, 0) - (2 * Math.PI * 3958.7613) / 360) < 1e-9);
  // Symmetric.
  assert.equal(haversineMiles(42.3, -83.0, 42.5, -83.4), haversineMiles(42.5, -83.4, 42.3, -83.0));
});

test('SPEC 35 (SYNTHETIC): station exactly at radius is included', () => {
  for (const r of [10, 25]) {
    const lat = latAtMiles(r);
    assert.equal(haversineMiles(0, 0, lat, 0), r, 'precondition: boundary distance is exact');
    const out = findEligibleStations({
      centroid: { lat: 0, lon: 0 }, stations: [st('USSYN0000EDGE', lat, 0)], radiusMiles: r, billedDates: ['2025-12-07'],
    });
    assert.equal(out.length, 1, `radius ${r}`);
    assert.equal(out[0].distanceMiles, r);
  }
});

test('SYNTHETIC radius filtering: inside included, outside excluded, sorted by distance, no cap', () => {
  const stations = [
    st('USSYN000000C', latAtMiles(14.9), 0),
    st('USSYN000000A', latAtMiles(3), 0),
    st('USSYN000000D', latAtMiles(15.1), 0),
    st('USSYN000000B', 0, 0),
  ];
  for (let i = 0; i < 150; i++) stations.push(st(`USSYNM${String(i).padStart(6, '0')}`, latAtMiles(5), 0));
  const out = findEligibleStations({ centroid: { lat: 0, lon: 0 }, stations, radiusMiles: 15, billedDates: ['2026-01-15'] });
  assert.equal(out.length, 153, 'all 153 in-radius stations returned (no nearest-N cap)');
  assert.ok(!out.some((s) => s.id === 'USSYN000000D'));
  assert.equal(out[0].id, 'USSYN000000B');
  assert.equal(out[1].id, 'USSYN000000A');
  assert.equal(out.at(-1).id, 'USSYN000000C');
  // Ties at equal distance break by ID.
  const ties = out.filter((s) => s.id.startsWith('USSYNM')).map((s) => s.id);
  assert.deepEqual(ties, [...ties].sort());
  // Input stations are not mutated.
  assert.equal(stations[0].distanceMiles, undefined);
});

test('SYNTHETIC SNOW period eligibility uses billed years', () => {
  const s = [st('USSYNOLD00001', 0, 0, 1950, 2024), st('USSYNNEW00001', 0, 0, 2026, 2026)];
  const ids = (dates) => findEligibleStations({ centroid: { lat: 0, lon: 0 }, stations: s, radiusMiles: 10, billedDates: dates }).map((x) => x.id);
  assert.deepEqual(ids(['2025-12-07']), []);
  assert.deepEqual(ids(['2024-12-07']), ['USSYNOLD00001']);
  assert.deepEqual(ids(['2026-01-15']), ['USSYNNEW00001']);
  assert.deepEqual(ids(['2024-12-20', '2026-01-15']).sort(), ['USSYNNEW00001', 'USSYNOLD00001']);
  assert.equal(snowPeriodCoversAnyYear(s[0], [1950]), true);
  assert.equal(snowPeriodCoversAnyYear(s[0], [1949]), false);
});

test('findEligibleStations rejects invalid inputs instead of defaulting', () => {
  const base = { centroid: { lat: 0, lon: 0 }, stations: [], radiusMiles: 15, billedDates: ['2025-12-07'] };
  assert.throws(() => findEligibleStations({ ...base, radiusMiles: 20 }), /radius/);
  assert.throws(() => findEligibleStations({ ...base, radiusMiles: '15' }), /radius/);
  assert.throws(() => findEligibleStations({ ...base, centroid: null }), /centroid/);
  assert.throws(() => findEligibleStations({ ...base, billedDates: [] }), /billed date/);
  assert.throws(() => findEligibleStations({ ...base, billedDates: ['12/7/25'] }), /YYYY-MM-DD/);
});

test('bundled station file is non-empty, compact, US-only, and SNOW lastYear >= 2024', async () => {
  const text = await fs.readFile(new URL('../public/data/ghcn-stations-us.json', import.meta.url), 'utf8');
  assert.equal(text.trimEnd().includes('\n'), false, 'JSON must be written on one line');
  const data = validateStationData(JSON.parse(text));
  assert.equal(data.minSnowLastYear, 2024);
  assert.ok(data.stations.length > 1000);
  for (const s of data.stations) {
    assert.ok(s.id.startsWith('US'), s.id);
    assert.ok(s.snow.lastYear >= 2024, s.id);
  }
});

test('validateStationData rejects malformed data', () => {
  assert.throws(() => validateStationData(null));
  assert.throws(() => validateStationData({ stations: [] }));
  assert.throws(() => validateStationData({ stations: [{ id: 'US1', name: 'X', lat: 1, lon: 2 }] }));
  assert.throws(() => validateStationData({ stations: [{ ...st('US1', 1, 2), lat: '1' }] }));
});

test('loadStationData uses the relative path (stubbed fetch)', async () => {
  let seenUrl;
  const body = { stations: [st('USSYN0000001', 1, 2)] };
  const data = await loadStationData(async (url) => { seenUrl = url; return { ok: true, json: async () => body }; });
  assert.equal(seenUrl, './public/data/ghcn-stations-us.json');
  assert.equal(data.stations.length, 1);
  await assert.rejects(loadStationData(async () => ({ ok: false, status: 500 })), /HTTP 500/);
});

// --- Builder test with SYNTHETIC fixed-width files laid out per the GHCN readme ---
const pad = (v, w, right = false) => (right ? String(v).padStart(w) : String(v).padEnd(w));
const stationLine = (id, lat, lon, elev, state, name) =>
  `${pad(id, 11)} ${pad(lat.toFixed(4), 8, true)} ${pad(lon.toFixed(4), 9, true)} ${pad(elev.toFixed(1), 6, true)} ${pad(state, 2)} ${pad(name, 30)}`;
const invLine = (id, lat, lon, el, first, last) =>
  `${pad(id, 11)} ${pad(lat.toFixed(4), 8, true)} ${pad(lon.toFixed(4), 9, true)} ${el} ${first} ${last}`;

test('SPEC 36 (SYNTHETIC): builder excludes a station whose SNOW lastYear is 2010', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghcn-SYNTHETIC-'));
  try {
    const stationsTxt = [
      stationLine('USC00SYN001', 42.1234, -83.5678, 190.5, 'MI', 'SYNTHETIC CURRENT'),
      stationLine('USC00SYN002', 42.2, -83.6, 200, 'MI', 'SYNTHETIC CLOSED 2010'),
      stationLine('USC00SYN003', 42.3, -83.7, 210, 'MI', 'SYNTHETIC NO SNOW'),
      stationLine('CA00SYN0004', 45.0, -75.0, 100, '  ', 'SYNTHETIC NON US'),
    ].join('\r\n') + '\r\n';
    const inventoryTxt = [
      invLine('USC00SYN001', 42.1234, -83.5678, 'SNOW', 1950, 2026),
      invLine('USC00SYN001', 42.1234, -83.5678, 'SNWD', 1950, 2026),
      invLine('USC00SYN002', 42.2, -83.6, 'SNOW', 1960, 2010),
      invLine('USC00SYN003', 42.3, -83.7, 'PRCP', 1960, 2026),
      invLine('CA00SYN0004', 45.0, -75.0, 'SNOW', 1960, 2026),
    ].join('\n') + '\n';
    // Sanity: synthetic lines match readme column positions (ELEMENT 32-35, FIRSTYEAR 37-40, LASTYEAR 42-45).
    const l = inventoryTxt.split('\n')[2];
    assert.equal(l.slice(31, 35), 'SNOW');
    assert.equal(l.slice(41, 45), '2010');

    const sPath = path.join(dir, 'stations-SYNTHETIC.txt');
    const iPath = path.join(dir, 'inventory-SYNTHETIC.txt');
    const oPath = path.join(dir, 'out-SYNTHETIC.json');
    await fs.writeFile(sPath, stationsTxt);
    await fs.writeFile(iPath, inventoryTxt);
    await run(process.execPath, ['scripts/build-ghcn-stations.mjs', sPath, iPath, oPath], { cwd: repoRoot });
    const out = JSON.parse(await fs.readFile(oPath, 'utf8'));
    assert.deepEqual(out.stations.map((s) => s.id), ['USC00SYN001']);
    assert.deepEqual(out.stations[0], {
      id: 'USC00SYN001', name: 'SYNTHETIC CURRENT', lat: 42.1234, lon: -83.5678, elevation_m: 190.5, state: 'MI',
      snow: { firstYear: 1950, lastYear: 2026 },
    });
    assert.equal(out.minSnowLastYear, 2024);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
