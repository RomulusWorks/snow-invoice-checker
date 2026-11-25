import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  buildNceiUrl, createWeatherClient, planDateRanges, chunkStationIds, cacheKey,
  NetworkError, HttpError, InvalidResponseError, DATA_TYPES,
} from '../assets/js/weather-client.js';

// Stubbed fetch only. No test touches the network.
const meta = JSON.parse(await fs.readFile(new URL('./fixtures/ncei-request-metadata.json', import.meta.url), 'utf8'));
const liveCapture = meta.captures.find((c) => c.file.includes('detroit'));
const liveBody = await fs.readFile(new URL(`./fixtures/${liveCapture.file}`, import.meta.url), 'utf8');

const response = (status, body = '[]') => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const noSleep = async () => {};

function stubFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(url, init) : step;
  };
  fn.calls = calls;
  return fn;
}

test('buildNceiUrl reproduces the exact live-captured URL and enforces 1-20 stations', () => {
  const u = new URL(liveCapture.url);
  const ids = u.searchParams.get('stations').split(',');
  assert.equal(buildNceiUrl(ids, u.searchParams.get('startDate'), u.searchParams.get('endDate')).toString(), liveCapture.url);
  assert.throws(() => buildNceiUrl([], '2026-01-01', '2026-01-02'), /between 1 and 20/);
  assert.throws(() => buildNceiUrl(Array.from({ length: 21 }, (_, i) => `US${i}`), '2026-01-01', '2026-01-02'), /between 1 and 20/);
  assert.equal(buildNceiUrl(['USX'], '2026-01-01', '2026-01-02', 'csv').searchParams.get('format'), 'csv');
  assert.deepEqual(DATA_TYPES, ['SNOW', 'SNWD']);
});

test('SPEC 40: HTTP 503 then 200 -> one retry after 1000 ms, success, cached', async () => {
  const fetchFn = stubFetch([response(503), response(200, liveBody)]);
  const sleeps = [];
  const client = createWeatherClient({ fetchFn, sleep: async (ms) => { sleeps.push(ms); } });
  const obs = await client.fetchBatch(['US1MIWY0163'], '2026-01-13', '2026-01-17');
  assert.equal(fetchFn.calls.length, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.ok(obs.length > 0);
  assert.equal(client.cacheSize(), 1);
  await client.fetchBatch(['US1MIWY0163'], '2026-01-13', '2026-01-17');
  assert.equal(fetchFn.calls.length, 2, 'served from cache');
});

test('SPEC 41: HTTP 400 -> no retry, HttpError(400)', async () => {
  const fetchFn = stubFetch([response(400), response(200)]);
  const client = createWeatherClient({ fetchFn, sleep: noSleep });
  await assert.rejects(client.fetchBatch(['USX'], '2026-01-01', '2026-01-03'), (e) => e instanceof HttpError && e.status === 400);
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(client.cacheSize(), 0);
});

test('SPEC 42: second call with the same key is served from cache (fetch called once)', async () => {
  const fetchFn = stubFetch([response(200, liveBody)]);
  const client = createWeatherClient({ fetchFn, sleep: noSleep });
  const a = await client.fetchBatch(['US1MIWY0163', 'USC00202016'], '2026-01-13', '2026-01-17');
  const b = await client.fetchBatch(['US1MIWY0163', 'USC00202016'], '2026-01-13', '2026-01-17');
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(a, b);
  // A different key is not served from cache.
  await client.fetchBatch(['US1MIWY0163'], '2026-01-13', '2026-01-17');
  assert.equal(fetchFn.calls.length, 2);
});

test('SPEC 43 (via client): live fixture body is normalized and request uses cors/omit', async () => {
  const fetchFn = stubFetch([response(200, liveBody)]);
  const client = createWeatherClient({ fetchFn, sleep: noSleep });
  const obs = await client.fetchBatch(['US1MIWY0163'], '2026-01-13', '2026-01-17');
  assert.equal(obs.length, JSON.parse(liveBody).length);
  assert.ok(obs.every((o) => o.elements.SNOW && o.elements.SNWD));
  const { init } = fetchFn.calls[0];
  assert.equal(init.method, 'GET');
  assert.equal(init.mode, 'cors');
  assert.equal(init.credentials, 'omit');
  assert.ok(init.signal);
});

test('HTTP 429 and 5xx retry once; a second failure is reported, not retried again', async () => {
  for (const status of [429, 500, 502, 504]) {
    const fetchFn = stubFetch([response(status), response(status), response(200)]);
    const client = createWeatherClient({ fetchFn, sleep: noSleep });
    await assert.rejects(client.fetchBatch(['USX'], '2026-01-01', '2026-01-03'), (e) => e instanceof HttpError && e.status === status);
    assert.equal(fetchFn.calls.length, 2, `status ${status}`);
  }
});

test('other 4xx codes fail immediately', async () => {
  for (const status of [401, 403, 404]) {
    const fetchFn = stubFetch([response(status)]);
    const client = createWeatherClient({ fetchFn, sleep: noSleep });
    await assert.rejects(client.fetchBatch(['USX'], '2026-01-01', '2026-01-03'), HttpError);
    assert.equal(fetchFn.calls.length, 1);
  }
});

test('network error retries once, then NetworkError', async () => {
  const fetchFn = stubFetch([new TypeError('Failed to fetch')]);
  const client = createWeatherClient({ fetchFn, sleep: noSleep });
  await assert.rejects(client.fetchBatch(['USX'], '2026-01-01', '2026-01-03'), (e) => e instanceof NetworkError && !e.timedOut);
  assert.equal(fetchFn.calls.length, 2);
});

test('network error then success -> success', async () => {
  const fetchFn = stubFetch([new TypeError('Failed to fetch'), response(200, '[]')]);
  const client = createWeatherClient({ fetchFn, sleep: noSleep });
  assert.deepEqual(await client.fetchBatch(['USX'], '2026-01-01', '2026-01-03'), []);
  assert.equal(fetchFn.calls.length, 2);
});

test('timeout aborts the request, retries once, then NetworkError(timedOut)', async () => {
  const hang = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const fetchFn = stubFetch([hang]);
  const client = createWeatherClient({ fetchFn, sleep: noSleep, timeoutMs: 15 });
  await assert.rejects(client.fetchBatch(['USX'], '2026-01-01', '2026-01-03'), (e) => e instanceof NetworkError && e.timedOut);
  assert.equal(fetchFn.calls.length, 2);
});

test('invalid response body -> InvalidResponseError, no retry, not cached', async () => {
  for (const body of ['<html>error</html>', '{"not":"an array"}', '[{"DATE":"bad","STATION":"USX"}]']) {
    const fetchFn = stubFetch([response(200, body)]);
    const client = createWeatherClient({ fetchFn, sleep: noSleep });
    await assert.rejects(client.fetchBatch(['USX'], '2026-01-01', '2026-01-03'), InvalidResponseError);
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(client.cacheSize(), 0);
  }
});

test('batches of 20 stations with at most 2 requests in flight', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchFn = stubFetch([async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return response(200, '[]');
  }]);
  const client = createWeatherClient({ fetchFn, sleep: noSleep });
  const ids = Array.from({ length: 105 }, (_, i) => `USSYN${String(i).padStart(6, '0')}`);
  await client.fetchObservations(ids, ['2026-01-15']);
  assert.equal(fetchFn.calls.length, 6);
  assert.equal(maxInFlight, 2);
  const sizes = fetchFn.calls.map((c) => new URL(c.url).searchParams.get('stations').split(',').length);
  assert.deepEqual(sizes, [20, 20, 20, 20, 20, 5]);
  for (const c of fetchFn.calls) {
    assert.equal(new URL(c.url).searchParams.get('startDate'), '2026-01-14');
    assert.equal(new URL(c.url).searchParams.get('endDate'), '2026-01-16');
  }
});

test('fetchObservations stops starting new batches after a failure', async () => {
  const fetchFn = stubFetch([response(400)]);
  const client = createWeatherClient({ fetchFn, sleep: noSleep, maxConcurrent: 1 });
  const ids = Array.from({ length: 60 }, (_, i) => `USSYN${i}`);
  await assert.rejects(client.fetchObservations(ids, ['2026-01-15']), HttpError);
  assert.equal(fetchFn.calls.length, 1);
});

test('planDateRanges: D-1..D+1 and split when billed dates are > 120 days apart (UTC)', () => {
  assert.deepEqual(planDateRanges(['2026-01-15']), [{ startDate: '2026-01-14', endDate: '2026-01-16' }]);
  assert.deepEqual(planDateRanges(['2026-03-02', '2025-12-07', '2026-01-15']), [{ startDate: '2025-12-06', endDate: '2026-03-03' }]);
  assert.deepEqual(planDateRanges(['2025-01-01', '2025-12-31']), [
    { startDate: '2024-12-31', endDate: '2025-01-02' },
    { startDate: '2025-12-30', endDate: '2026-01-01' },
  ]);
  // Exactly 120 days apart stays one range.
  assert.deepEqual(planDateRanges(['2025-11-01', '2026-03-01']), [{ startDate: '2025-10-31', endDate: '2026-03-02' }]);
  assert.deepEqual(planDateRanges(['2024-02-28', '2024-03-01']), [{ startDate: '2024-02-27', endDate: '2024-03-02' }]);
  assert.throws(() => planDateRanges([]));
  assert.throws(() => planDateRanges(['2026-02-30']));
});

test('chunking and cache key format', () => {
  assert.deepEqual(chunkStationIds(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.equal(cacheKey(['US1', 'US2'], '2026-01-14', '2026-01-16'), 'US1,US2|2026-01-14|2026-01-16|SNOW,SNWD|metric|json');
});
