// Shared constants and exact user-facing copy (SPEC §9).

export const ZCTA_DATA_URL = './public/data/zcta-centroids.json';
export const STATIONS_DATA_URL = './public/data/ghcn-stations-us.json';

export const RADIUS_OPTIONS_MILES = Object.freeze([10, 15, 25]);
export const DEFAULT_RADIUS_MILES = 15;

// GHCN-Daily source flags accepted for weather values (SPEC §3.3). Case-sensitive.
// Each code was confirmed against the GHCN-Daily readme on 2026-11-25 (see README).
// 'N' = CoCoRaHS (allowed). 'H', 'Z', blank, foreign and unknown codes are excluded.
export const SOURCE_FLAG_ALLOWLIST = Object.freeze(
  ['0', '1', '6', '7', 'A', 'B', 'D', 'F', 'G', 'K', 'M', 'N', 'R', 'T', 'W', 'X', 'd'],
);

export const MM_PER_INCH = 25.4;

export const MESSAGES = Object.freeze({
  INVALID_ZIP_SHAPE: 'Enter a five-digit ZIP code.',
  ZIP_NOT_IN_ZCTA:
    'This ZIP code is not in the bundled 2020 Census ZIP Code Tabulation Area file. Check the ZIP or use another ZIP for the property area. Some valid USPS ZIP codes do not have a Census ZCTA.',
});
