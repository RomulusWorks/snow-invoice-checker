// Raw NOAA NCEI Access Data Service JSON -> normalized observations (SPEC §3.5, §6.1).
// This is the ONLY module that knows raw NCEI field names.
//
// Observed live schema (captured 2026-11-25, see tests/fixtures/ncei-request-metadata.json):
// - Body: JSON array of records, one per station per date; every value is a string.
// - Record keys: DATE (YYYY-MM-DD), STATION, NAME, LATITUDE, LONGITUDE, ELEVATION,
//   and per element <EL> plus <EL>_ATTRIBUTES (EL = SNOW, SNWD).
// - Missing data: the <EL> key is absent from the record, or the whole station-date
//   record is absent. ('', null and '-9999' are also treated as missing.)
// - units=metric: SNOW and SNWD in millimetres (confirmed against units=standard inches).
// - <EL>_ATTRIBUTES: "measurement,quality,source[,observationTime]". CoCoRaHS (source N)
//   values have 3 parts (no time); others have 4, e.g. "T,,7,0900".
import { SOURCE_FLAG_ALLOWLIST, MM_PER_INCH } from './constants.js';

export class InvalidResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidResponseError';
  }
}

const ELEMENTS = ['SNOW', 'SNWD'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;
const KNOWN_MEASUREMENT_FLAGS = new Set(['', 'T', 'P', 'A']);

function isRealIsoDate(s) {
  const m = typeof s === 'string' ? ISO_DATE.exec(s) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function parseCoordinate(v) {
  if (typeof v !== 'string' || !NUMERIC.test(v.trim())) return null;
  return Number(v);
}

function isMissingRaw(raw) {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')
    || raw === '-9999' || raw === -9999;
}

function excluded(base, reason) {
  return { ...base, valueInches: null, usable: false, excludedReason: reason };
}

// Normalizes one element of one record. Exported for tests.
export function normalizeElement(rawValue, rawAttributes) {
  const base = {
    valueInches: null,
    rawValue: rawValue === undefined ? null : rawValue,
    measurementFlag: '',
    qualityFlag: '',
    sourceFlag: '',
    usable: false,
    trace: false,
    presumedZero: false,
    accumulated: false,
    excludedReason: null,
  };
  if (typeof rawAttributes === 'string') {
    const parts = rawAttributes.split(',');
    if (parts.length === 3 || parts.length === 4) {
      base.measurementFlag = parts[0].trim();
      base.qualityFlag = parts[1].trim();
      base.sourceFlag = parts[2].trim();
    }
  }

  if (isMissingRaw(rawValue)) return excluded(base, 'MISSING');
  if (typeof rawValue !== 'string' || !NUMERIC.test(rawValue.trim()) || Number(rawValue) < 0) {
    return excluded(base, 'INVALID_VALUE');
  }
  if (typeof rawAttributes !== 'string') return excluded(base, 'ATTRIBUTES_MISSING');
  const nParts = rawAttributes.split(',').length;
  if (nParts !== 3 && nParts !== 4) return excluded(base, 'ATTRIBUTES_UNREADABLE');
  if (base.qualityFlag !== '') return excluded(base, 'QUALITY_FLAG');
  if (!SOURCE_FLAG_ALLOWLIST.includes(base.sourceFlag)) return excluded(base, 'SOURCE_NOT_ALLOWED');
  if (!KNOWN_MEASUREMENT_FLAGS.has(base.measurementFlag)) return excluded(base, 'UNKNOWN_MEASUREMENT_FLAG');

  const inches = Number(rawValue) / MM_PER_INCH;
  switch (base.measurementFlag) {
    case 'T':
      // Valid observed trace: 0.0 in for comparisons, labelled "Trace".
      return { ...base, valueInches: 0, usable: true, trace: true };
    case 'P':
      // Missing, presumed zero: usable but caps confidence at LOW (applied in checks.js).
      return { ...base, valueInches: inches, usable: true, presumedZero: true };
    case 'A':
      // Multi-day accumulation (SPEC §3.5): never assigned to a single day, so it is not a
      // usable daily value. The value is kept so checks.js can treat >= trigger as evidence
      // that snow occurred.
      return { ...base, valueInches: inches, usable: false, accumulated: true, excludedReason: 'ACCUMULATED' };
    default:
      return { ...base, valueInches: inches, usable: true };
  }
}

// body: parsed JSON from the NCEI daily-summaries endpoint (format=json, units=metric).
// Returns observations sorted by stationId then date. Throws InvalidResponseError when the
// structure cannot be read safely.
export function normalizeNceiJson(body) {
  if (!Array.isArray(body)) throw new InvalidResponseError('NCEI response is not a JSON array.');
  const seen = new Set();
  const out = [];
  body.forEach((rec, i) => {
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
      throw new InvalidResponseError(`NCEI record ${i} is not an object.`);
    }
    if (typeof rec.STATION !== 'string' || rec.STATION.trim() === '') {
      throw new InvalidResponseError(`NCEI record ${i} has no station ID.`);
    }
    if (!isRealIsoDate(rec.DATE)) throw new InvalidResponseError(`NCEI record ${i} has an invalid date.`);
    const key = `${rec.STATION}|${rec.DATE}`;
    if (seen.has(key)) throw new InvalidResponseError(`NCEI response repeats ${rec.STATION} on ${rec.DATE}.`);
    seen.add(key);
    const elements = {};
    for (const el of ELEMENTS) elements[el] = normalizeElement(rec[el], rec[`${el}_ATTRIBUTES`]);
    out.push({
      stationId: rec.STATION,
      stationName: typeof rec.NAME === 'string' ? rec.NAME : null,
      latitude: parseCoordinate(rec.LATITUDE),
      longitude: parseCoordinate(rec.LONGITUDE),
      date: rec.DATE,
      elements,
    });
  });
  return out.sort((a, b) => (a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Parses response text; any JSON or structure failure becomes InvalidResponseError.
export function normalizeNceiText(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new InvalidResponseError('NCEI response is not valid JSON.');
  }
  return normalizeNceiJson(body);
}
