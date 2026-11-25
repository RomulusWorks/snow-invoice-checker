// Opt-in LIVE check against NOAA NCEI. Never run in CI or by `node --test`.
// Usage: node scripts/smoke-noaa.mjs [zip=48226] [date=2026-01-15] [radiusMiles=15]
import fs from 'node:fs/promises';
import { lookupZip } from '../assets/js/zip.js';
import { findEligibleStations } from '../assets/js/stations.js';
import { createWeatherClient, planDateRanges, chunkStationIds } from '../assets/js/weather-client.js';

const [zip = '48226', date = '2026-01-15', radiusArg = '15'] = process.argv.slice(2);
const radiusMiles = Number(radiusArg);
const readJson = async (p) => JSON.parse(await fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8'));

const zcta = await readJson('public/data/zcta-centroids.json');
const { stations } = await readJson('public/data/ghcn-stations-us.json');
const centroid = lookupZip(zip, zcta);
if (!centroid.ok) {
  console.error(centroid.message);
  process.exit(1);
}
const near = findEligibleStations({ centroid, stations, radiusMiles, billedDates: [date] });
console.log(`ZIP ${zip} centroid ${centroid.lat}, ${centroid.lon}; ${near.length} eligible stations within ${radiusMiles} mi.`);
if (near.length === 0) process.exit(0);
const [range] = planDateRanges([date]);
console.log(`Requesting ${range.startDate}..${range.endDate} in ${chunkStationIds(near).length} batch(es)...`);

try {
  const obs = await createWeatherClient().fetchObservations(near.map((s) => s.id), [date]);
  const usable = obs.filter((o) => o.elements.SNOW.usable);
  console.log(`Received ${obs.length} station-day records; ${usable.length} with usable SNOW.`);
  const sample = usable.find((o) => o.date === date) ?? usable[0] ?? obs[0];
  console.log('Sample normalized record:');
  console.log(JSON.stringify(sample, null, 2));
} catch (err) {
  console.error(`LIVE CHECK FAILED: ${err.name}: ${err.message}${err.status ? ` (status ${err.status})` : ''}`);
  process.exit(1);
}
