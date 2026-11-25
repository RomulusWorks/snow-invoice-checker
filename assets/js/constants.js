// Shared constants and exact user-facing copy (SPEC §9).

export const ZCTA_DATA_URL = './public/data/zcta-centroids.json';
export const STATIONS_DATA_URL = './public/data/ghcn-stations-us.json';

export const RADIUS_OPTIONS_MILES = Object.freeze([10, 15, 25]);
export const DEFAULT_RADIUS_MILES = 15;

export const MESSAGES = Object.freeze({
  INVALID_ZIP_SHAPE: 'Enter a five-digit ZIP code.',
  ZIP_NOT_IN_ZCTA:
    'This ZIP code is not in the bundled 2020 Census ZIP Code Tabulation Area file. Check the ZIP or use another ZIP for the property area. Some valid USPS ZIP codes do not have a Census ZCTA.',
});
