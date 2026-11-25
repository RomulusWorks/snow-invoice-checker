// ZIP validation and Census 2020 ZCTA centroid lookup (SPEC §3.8, §4.1).
// The centroid approximates a ZIP Code Tabulation Area; it is never the property location.
import { MESSAGES, ZCTA_DATA_URL } from './constants.js';

const ZIP_PATTERN = /^\d{5}$/;

export function isValidZipShape(zip) {
  return typeof zip === 'string' && ZIP_PATTERN.test(zip);
}

// Validates the bundled ZCTA JSON: { "01001": [lat, lon], ... }.
export function validateZctaData(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('ZCTA data must be an object keyed by five-digit ZIP strings.');
  }
  const keys = Object.keys(data);
  if (keys.length === 0) throw new Error('ZCTA data is empty.');
  for (const key of keys) {
    const v = data[key];
    if (!ZIP_PATTERN.test(key) || !Array.isArray(v) || v.length !== 2
      || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) {
      throw new Error(`ZCTA data has an invalid entry for key "${key}".`);
    }
  }
  return data;
}

export async function loadZctaData(fetchFn = globalThis.fetch, url = ZCTA_DATA_URL) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Could not load ZIP code area data (HTTP ${res.status}).`);
  return validateZctaData(await res.json());
}

// Pure lookup. Returns { ok: true, zip, lat, lon } or { ok: false, code, message }.
// The ZIP is kept as a string so leading zeros survive.
export function lookupZip(zip, zctaData) {
  const trimmed = typeof zip === 'string' ? zip.trim() : zip;
  if (!isValidZipShape(trimmed)) {
    return { ok: false, code: 'INVALID_ZIP_SHAPE', message: MESSAGES.INVALID_ZIP_SHAPE };
  }
  const entry = Object.prototype.hasOwnProperty.call(zctaData, trimmed) ? zctaData[trimmed] : undefined;
  if (!entry) {
    return { ok: false, code: 'ZIP_NOT_IN_ZCTA', message: MESSAGES.ZIP_NOT_IN_ZCTA };
  }
  return { ok: true, zip: trimmed, lat: entry[0], lon: entry[1] };
}
