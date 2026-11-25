import fs from 'node:fs/promises';
import path from 'node:path';

const MIN_SNOW_LAST_YEAR = 2024;
const [stationsPath, inventoryPath, outputPath = 'public/data/ghcn-stations-us.json'] = process.argv.slice(2);
if (!stationsPath || !inventoryPath) {
  console.error('Usage: node scripts/build-ghcn-stations.mjs <ghcnd-stations.txt> <ghcnd-inventory.txt> [output.json]');
  process.exit(1);
}

const num = (v) => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : null; };
const lines = (text) => text.split(/\r?\n/).filter((l) => l.trim());

const stationMap = new Map();
for (const line of lines(await fs.readFile(stationsPath, 'utf8'))) {
  const id = line.slice(0, 11).trim();
  if (!id.startsWith('US')) continue;
  const s = {
    id,
    name: line.slice(41, 71).trim(),
    lat: num(line.slice(12, 20)),
    lon: num(line.slice(21, 30)),
    elevation_m: num(line.slice(31, 37)),
    state: line.slice(38, 40).trim(),
  };
  if (s.lat === null || s.lon === null || !s.name) continue;
  stationMap.set(id, s);
}

const snowPeriods = new Map();
for (const line of lines(await fs.readFile(inventoryPath, 'utf8'))) {
  const id = line.slice(0, 11).trim();
  if (!stationMap.has(id)) continue;
  if (line.slice(31, 35).trim() !== 'SNOW') continue;
  const firstYear = Number(line.slice(36, 40).trim());
  const lastYear = Number(line.slice(41, 45).trim());
  if (!Number.isInteger(firstYear) || !Number.isInteger(lastYear)) continue;
  snowPeriods.set(id, { firstYear, lastYear });
}

const stations = [];
for (const [id, s] of stationMap) {
  const snow = snowPeriods.get(id);
  if (!snow || snow.lastYear < MIN_SNOW_LAST_YEAR) continue;
  stations.push({ ...s, snow });
}
stations.sort((a, b) => a.id.localeCompare(b.id));
if (stations.length === 0) throw new Error('No eligible US SNOW stations found.');

const output = {
  source: 'NOAA NCEI GHCN-Daily station and inventory files',
  builtAt: new Date().toISOString().slice(0, 10),
  minSnowLastYear: MIN_SNOW_LAST_YEAR,
  stations,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(output) + '\n', 'utf8');
console.log(`Wrote ${stations.length} US SNOW stations (lastYear >= ${MIN_SNOW_LAST_YEAR}) to ${outputPath}.`);
