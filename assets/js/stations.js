// GHCN-Daily station list, Haversine distance, radius + SNOW-period eligibility (SPEC §3.7, §11.3).
// No nearest-N cap: every eligible station within the radius is returned.
import { RADIUS_OPTIONS_MILES, STATIONS_DATA_URL } from './constants.js';

const R_EARTH_MILES = 3958.7613;
export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_MILES * Math.asin(Math.sqrt(a));
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidStation(s) {
  return s !== null && typeof s === 'object'
    && typeof s.id === 'string' && s.id.length > 0
    && typeof s.name === 'string' && s.name.length > 0
    && Number.isFinite(s.lat) && Number.isFinite(s.lon)
    && s.snow !== null && typeof s.snow === 'object'
    && Number.isInteger(s.snow.firstYear) && Number.isInteger(s.snow.lastYear);
}

// Validates the bundled station JSON produced by scripts/build-ghcn-stations.mjs.
export function validateStationData(data) {
  if (data === null || typeof data !== 'object' || !Array.isArray(data.stations)) {
    throw new Error('Station data must be an object with a "stations" array.');
  }
  if (data.stations.length === 0) throw new Error('Station data is empty.');
  data.stations.forEach((s, i) => {
    if (!isValidStation(s)) throw new Error(`Station data has an invalid entry at index ${i}.`);
  });
  return data;
}

export async function loadStationData(fetchFn = globalThis.fetch, url = STATIONS_DATA_URL) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Could not load weather station list (HTTP ${res.status}).`);
  return validateStationData(await res.json());
}

function yearsFromDates(billedDates) {
  if (!Array.isArray(billedDates) || billedDates.length === 0) {
    throw new Error('At least one billed date is required to select stations.');
  }
  const years = new Set();
  for (const d of billedDates) {
    const m = typeof d === 'string' ? ISO_DATE.exec(d) : null;
    if (!m) throw new Error(`Billed date "${d}" must be in YYYY-MM-DD format.`);
    years.add(Number(m[1]));
  }
  return [...years];
}

export function snowPeriodCoversAnyYear(station, years) {
  return years.some((y) => station.snow.firstYear <= y && y <= station.snow.lastYear);
}

// Returns eligible stations with distanceMiles, sorted by distance then ID (deterministic).
// Eligible = distance <= radius (inclusive) AND SNOW period covers at least one billed year.
export function findEligibleStations({ centroid, stations, radiusMiles, billedDates }) {
  if (!RADIUS_OPTIONS_MILES.includes(radiusMiles)) {
    throw new Error(`Station radius must be one of ${RADIUS_OPTIONS_MILES.join(', ')} miles.`);
  }
  if (!centroid || !Number.isFinite(centroid.lat) || !Number.isFinite(centroid.lon)) {
    throw new Error('A valid ZIP code area centroid is required.');
  }
  const years = yearsFromDates(billedDates);
  const out = [];
  for (const s of stations) {
    const distanceMiles = haversineMiles(centroid.lat, centroid.lon, s.lat, s.lon);
    if (distanceMiles <= radiusMiles && snowPeriodCoversAnyYear(s, years)) {
      out.push({ ...s, distanceMiles });
    }
  }
  return out.sort((a, b) => a.distanceMiles - b.distanceMiles || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
