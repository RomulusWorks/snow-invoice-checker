// NOAA NCEI Access Data Service transport (SPEC §3.1, §11.2).
// Raw NOAA field names are handled only by weather-normalizer.js.
//
// Phase 2 evidence (2026-11-25): a real browser fetch (mode 'cors', credentials 'omit') succeeded
// from http://localhost:8000 and from https://romulusworks.github.io, so the app uses automatic
// JSON mode. The CSV download/upload fallback is not needed (SPEC §3.2).
import { normalizeNceiText, InvalidResponseError } from './weather-normalizer.js';

export { InvalidResponseError };

export const NCEI_ENDPOINT = 'https://www.ncei.noaa.gov/access/services/data/v1';
export const DATA_TYPES = ['SNOW', 'SNWD'];
export const MAX_STATIONS_PER_REQUEST = 20;
export const MAX_CONCURRENT_REQUESTS = 2;
export const REQUEST_TIMEOUT_MS = 20000;
export const RETRY_DELAY_MS = 1000;
const WINTER_GAP_DAYS = 120;

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

// ---- Typed errors ----
export class NetworkError extends Error {
  constructor(message, { timedOut = false, cause } = {}) {
    super(message);
    this.name = 'NetworkError';
    this.timedOut = timedOut;
    if (cause) this.cause = cause;
  }
}

export class HttpError extends Error {
  constructor(status) {
    super(`NOAA's data service returned HTTP ${status}.`);
    this.name = 'HttpError';
    this.status = status;
  }
}

// ---- UTC date-only helpers ----
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function toDayNumber(iso) {
  const m = typeof iso === 'string' ? ISO_DATE.exec(iso) : null;
  if (!m) throw new Error(`Date "${iso}" must be in YYYY-MM-DD format.`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new Error(`Date "${iso}" is not a real date.`);
  }
  return ms / 86400000;
}
const fromDayNumber = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

// Request date ranges for the billed dates: earliest - 1 day through latest + 1 day, split into
// separate ranges wherever consecutive billed dates are more than 120 days apart (SPEC §3.1).
export function planDateRanges(billedDates) {
  if (!Array.isArray(billedDates) || billedDates.length === 0) throw new Error('At least one billed date is required.');
  const days = [...new Set(billedDates.map(toDayNumber))].sort((a, b) => a - b);
  const ranges = [];
  let start = days[0];
  let prev = days[0];
  for (const d of days.slice(1)) {
    if (d - prev > WINTER_GAP_DAYS) {
      ranges.push({ startDate: fromDayNumber(start - 1), endDate: fromDayNumber(prev + 1) });
      start = d;
    }
    prev = d;
  }
  ranges.push({ startDate: fromDayNumber(start - 1), endDate: fromDayNumber(prev + 1) });
  return ranges;
}

export function chunkStationIds(stationIds, size = MAX_STATIONS_PER_REQUEST) {
  const out = [];
  for (let i = 0; i < stationIds.length; i += size) out.push(stationIds.slice(i, i + size));
  return out;
}

export function cacheKey(stationBatch, startDate, endDate) {
  return `${stationBatch.join(',')}|${startDate}|${endDate}|${DATA_TYPES.join(',')}|metric|json`;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryable = (err) => err instanceof NetworkError || (err instanceof HttpError && (err.status >= 500 || err.status === 429));

// Creates a client with an in-memory cache that lives for this page session only.
// fetchFn and sleep are injectable for offline tests.
export function createWeatherClient({
  fetchFn = (...args) => globalThis.fetch(...args),
  sleep = defaultSleep,
  timeoutMs = REQUEST_TIMEOUT_MS,
  retryDelayMs = RETRY_DELAY_MS,
  maxConcurrent = MAX_CONCURRENT_REQUESTS,
} = {}) {
  const cache = new Map();

  async function attempt(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(url, { method: 'GET', mode: 'cors', credentials: 'omit', signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) throw new NetworkError('NOAA request timed out.', { timedOut: true, cause: err });
      throw new NetworkError('NOAA request failed before a response was received.', { cause: err });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new HttpError(res.status);
    let text;
    try {
      text = await res.text();
    } catch (err) {
      throw new NetworkError('NOAA response could not be read.', { cause: err });
    }
    return normalizeNceiText(text); // throws InvalidResponseError (never retried, never cached)
  }

  // One batch (<= 20 stations, one date range): cache, then at most one retry.
  async function fetchBatch(stationBatch, startDate, endDate) {
    const key = cacheKey(stationBatch, startDate, endDate);
    if (cache.has(key)) return cache.get(key);
    const url = buildNceiUrl(stationBatch, startDate, endDate).toString();
    let observations;
    try {
      observations = await attempt(url);
    } catch (err) {
      if (!isRetryable(err)) throw err;
      await sleep(retryDelayMs);
      observations = await attempt(url);
    }
    cache.set(key, observations);
    return observations;
  }

  // All stations for all billed-date ranges, batched by 20, at most `maxConcurrent` in flight.
  async function fetchObservations(stationIds, billedDates) {
    if (!Array.isArray(stationIds) || stationIds.length === 0) throw new Error('At least one station is required.');
    const tasks = [];
    for (const { startDate, endDate } of planDateRanges(billedDates)) {
      for (const batch of chunkStationIds(stationIds)) tasks.push(() => fetchBatch(batch, startDate, endDate));
    }
    const results = new Array(tasks.length);
    let next = 0;
    let failed = false;
    async function worker() {
      while (!failed && next < tasks.length) {
        const i = next++;
        try {
          results[i] = await tasks[i]();
        } catch (err) {
          failed = true; // stop starting new requests; the first error is reported
          throw err;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(maxConcurrent, tasks.length) }, worker));
    return results.flat();
  }

  return { fetchBatch, fetchObservations, cacheSize: () => cache.size, clearCache: () => cache.clear() };
}
