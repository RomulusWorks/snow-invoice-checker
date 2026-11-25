import fs from 'node:fs/promises';
import path from 'node:path';

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? 'public/data/zcta-centroids.json';
if (!inputPath) {
  console.error('Usage: node scripts/build-zcta-json.mjs <2020_Gaz_zcta_national.txt> [output.json]');
  process.exit(1);
}

const raw = await fs.readFile(inputPath, 'utf8');
const rows = raw.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
if (rows.length < 2) throw new Error('Gazetteer file is empty or has no data rows.');

const headers = rows[0].split('\t').map((h) => h.trim());
const need = ['GEOID', 'INTPTLAT', 'INTPTLONG'];
const idx = Object.fromEntries(need.map((n) => [n, headers.indexOf(n)]));
for (const n of need) if (idx[n] < 0) throw new Error(`Missing required Gazetteer column: ${n}`);

const out = Object.create(null);
let skipped = 0;
for (const row of rows.slice(1)) {
  const c = row.split('\t');
  const zip = (c[idx.GEOID] ?? '').trim().padStart(5, '0');
  const lat = Number(c[idx.INTPTLAT]);
  const lon = Number(c[idx.INTPTLONG]);
  if (!/^\d{5}$/.test(zip) || !Number.isFinite(lat) || !Number.isFinite(lon)) { skipped++; continue; }
  out[zip] = [lat, lon];
}
if (Object.keys(out).length === 0) throw new Error('No valid ZCTA centroids parsed.');

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(out) + '\n', 'utf8');
console.log(`Wrote ${Object.keys(out).length} ZCTA centroids to ${outputPath}; skipped ${skipped}.`);
