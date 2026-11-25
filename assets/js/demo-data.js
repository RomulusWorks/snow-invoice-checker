// DEMO DATA — NOT A REAL PROPERTY CHECK.
// Deterministic, embedded demo dataset for "Load example" (SPEC §10.2). Used with no network
// request. Stations and weather values below are invented for demonstration only; they are not
// NOAA records. The example is built to show every status: OK, Worth questioning, Not enough
// data and Not checked.

export const DEMO_LABEL = 'DEMO DATA — NOT A REAL PROPERTY CHECK.';

// Form values (as the user would type them).
export const DEMO_FORM = Object.freeze({
  zip: '48226',
  radius: '15',
  contractType: 'PER_PUSH',
  plowTrigger: '2.0',
  walkwayTrigger: '',
  extraPushes: '1',
  pricePerPush: '425.00',
});

// Same lines as public/sample-billed-services.csv.
export const DEMO_ROWS = Object.freeze([
  { date: '2025-12-07', serviceType: 'plow', quantity: '1', amount: '425.00' },
  { date: '2025-12-07', serviceType: 'salt', quantity: '1', amount: '85.00' },
  { date: '2025-12-08', serviceType: 'plow', quantity: '1', amount: '425.00' },
  { date: '2026-01-15', serviceType: 'plow', quantity: '2', amount: '850.00' },
  { date: '2026-01-15', serviceType: 'walkway', quantity: '1', amount: '95.00' },
  { date: '2026-02-04', serviceType: 'plow', quantity: '1', amount: '425.00' },
  { date: '2026-02-18', serviceType: 'walkway', quantity: '1', amount: '95.00' },
  { date: '2026-03-02', serviceType: 'plow', quantity: '1', amount: '425.00' },
].map(Object.freeze));

export const DEMO_STATIONS = Object.freeze([
  { id: 'DEMO0000001', name: 'DEMO STATION A', distanceMiles: 2.1 },
  { id: 'DEMO0000002', name: 'DEMO STATION B', distanceMiles: 4.8 },
  { id: 'DEMO0000003', name: 'DEMO STATION C', distanceMiles: 7.5 },
].map(Object.freeze));

// Daily snowfall in inches per demo station [A, B, C]; null = no report that day.
const DEMO_SNOW = {
  '2025-12-06': [0, 0, 0],
  '2025-12-07': [4.0, 3.6, 4.4],
  '2025-12-08': [0.2, 0, 0.1],
  '2025-12-09': [0, 0, 0],
  '2026-01-14': [0, 0, 0],
  '2026-01-15': [6.1, 5.8, 6.4],
  '2026-01-16': [0.5, 0.3, 0.4],
  '2026-02-03': [0, 0, 0],
  '2026-02-04': ['T', 0, 0],
  '2026-02-05': [0, 0, 0],
  '2026-02-17': [null, null, null],
  '2026-02-18': [0, null, null],
  '2026-02-19': [null, null, null],
  '2026-03-01': [0, 0, 0],
  '2026-03-02': [0.3, 0.2, 0.4],
  '2026-03-03': [0, 0, 0],
};

function demoElement(v) {
  const base = { qualityFlag: '', sourceFlag: 'N', trace: false, presumedZero: false, accumulated: false };
  if (v === null) {
    return { ...base, valueInches: null, rawValue: null, measurementFlag: '', sourceFlag: '', usable: false, excludedReason: 'MISSING' };
  }
  if (v === 'T') return { ...base, valueInches: 0, rawValue: '0.0', measurementFlag: 'T', usable: true, trace: true, excludedReason: null };
  return { ...base, valueInches: v, rawValue: (v * 25.4).toFixed(1), measurementFlag: '', usable: true, excludedReason: null };
}

// Normalized observations (SPEC §6.1 shape).
export const DEMO_OBSERVATIONS = Object.freeze(Object.entries(DEMO_SNOW).flatMap(([date, values]) =>
  DEMO_STATIONS.map((s, i) => Object.freeze({
    stationId: s.id,
    stationName: s.name,
    latitude: null,
    longitude: null,
    date,
    elements: { SNOW: demoElement(values[i]), SNWD: demoElement(null) },
  }))));
