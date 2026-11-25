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

// ---- Checking (SPEC §4.2, §6.3, §7, §8) ----
export const CONTRACT_TYPES = Object.freeze({
  PER_PUSH: 'PER_PUSH',
  PER_EVENT: 'PER_EVENT',
  PER_INCH_TIERS: 'PER_INCH_TIERS',
  SEASONAL_ALLOWANCE: 'SEASONAL_ALLOWANCE',
  SEASONAL_UNLIMITED: 'SEASONAL_UNLIMITED',
});

export const SERVICE_TYPES = Object.freeze(['plow', 'walkway', 'salt', 'other']);

export const STATUS = Object.freeze({
  OK: 'OK',
  WORTH_QUESTIONING: 'WORTH_QUESTIONING',
  NOT_ENOUGH_DATA: 'NOT_ENOUGH_DATA',
  NOT_CHECKED: 'NOT_CHECKED',
});

// Per-rule status for a rule that does not apply to a row (internal; never shown as a row status).
export const RULE_NOT_APPLICABLE = 'NOT_APPLICABLE';

export const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' });

export const REASON_CODES = Object.freeze({
  NO_SIGNIFICANT_SNOW: 'NO_SIGNIFICANT_SNOW',
  MORE_PUSHES_THAN_SUGGESTED: 'MORE_PUSHES_THAN_SUGGESTED',
  ALLOWANCE_EXCEEDED: 'ALLOWANCE_EXCEEDED',
  DUPLICATE_BILLING: 'DUPLICATE_BILLING',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  NO_ISSUE: 'NO_ISSUE',
  SERVICE_TYPE_NOT_CHECKED: 'SERVICE_TYPE_NOT_CHECKED',
  SEASONAL_UNLIMITED_DUPLICATE_ONLY: 'SEASONAL_UNLIMITED_DUPLICATE_ONLY',
});

// Exact copy, SPEC §9.2.
export const STATUS_LABELS = Object.freeze({
  OK: 'OK',
  WORTH_QUESTIONING: 'Worth questioning',
  NOT_ENOUGH_DATA: 'Not enough data',
  NOT_CHECKED: 'Not checked',
});

export const STATUS_COPY = Object.freeze({
  OK: 'No issue was identified by this check. This does not prove the charge was correct.',
  WORTH_QUESTIONING: 'This item differs from the weather or contract information entered. Consider asking the contractor for the service log or an explanation.',
  NOT_ENOUGH_DATA: 'Nearby station records were missing or incomplete for this date. No conclusion was made.',
  NOT_CHECKED: 'This tool does not compare this service type with weather records. Only duplicate entries are checked.',
});

// Exact copy, SPEC §9.3. {placeholders} are filled by checks.js.
export const REASON_TEMPLATES = Object.freeze({
  NO_SIGNIFICANT_SNOW: 'Nearby reporting stations recorded at most {maxSnow} in. of snow in the three-day review window, below the {trigger} in. trigger. This is a reason to ask what site conditions led to the service.',
  MORE_PUSHES_THAN_SUGGESTED: "Nearby stations recorded up to {eventSnow} in. for this storm. The conservative screening allowance was {allowedPushes} push(es), including {extraAllowed} extra return trip(s); the invoice lists {billedPushes}. {flaggedUnits} push(es) on this line are beyond that allowance. Ask for the contractor's service log. Weather totals alone cannot show how many visits a site needed (drifting, refreezing and site conditions are not included).",
  ALLOWANCE_EXCEEDED: 'The entered season total is {seasonPushes}; the allowance is {allowance}; {excessPushes} push(es) are beyond the allowance ({lineUnits} on this line). Check the service log and overage clause.',
  DUPLICATE_BILLING: 'More than one line lists {serviceType} on {date}. Confirm whether these were separate visits or a repeated entry.',
  SERVICE_TYPE_NOT_CHECKED: 'Salt and other services are not compared with weather records in this version. Only duplicate entries are checked.',
  SEASONAL_UNLIMITED_DUPLICATE_ONLY: 'This contract is a flat seasonal fee with unlimited service. Individual snowfall totals do not determine a per-push charge under the terms entered, so this tool only checks duplicate-looking entries.',
  INSUFFICIENT_DATA: 'Nearby station records were missing or incomplete for {dates}. No conclusion was made.',
});

// Evidence labels named in SPEC §3.5.
export const EVIDENCE_LABELS = Object.freeze({
  TRACE: 'Trace',
  PRESUMED_ZERO: 'presumed zero',
  REJECTED_QUALITY: 'rejected quality data',
});

export const MESSAGES = Object.freeze({
  INVALID_ZIP_SHAPE: 'Enter a five-digit ZIP code.',
  ZIP_NOT_IN_ZCTA:
    'This ZIP code is not in the bundled 2020 Census ZIP Code Tabulation Area file. Check the ZIP or use another ZIP for the property area. Some valid USPS ZIP codes do not have a Census ZCTA.',
});
