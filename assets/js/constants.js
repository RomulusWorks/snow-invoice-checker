// Shared constants and exact user-facing copy (SPEC §9).

export const ZCTA_DATA_URL = './public/data/zcta-centroids.json';
export const STATIONS_DATA_URL = './public/data/ghcn-stations-us.json';

export const RADIUS_OPTIONS_MILES = Object.freeze([10, 15, 25]);
export const DEFAULT_RADIUS_MILES = 15;

// GHCN-Daily source flags accepted for weather values (SPEC §3.3). Case-sensitive.
// Each code was confirmed against the GHCN-Daily readme on 2026-11-25 (see README).
// 'N' = CoCoRaHS (allowed). 'Z' = Datzilla official additions/replacements (allowed, owner
// decision in Phase 6, SPEC v1.2). 'H', blank, foreign and unknown codes are excluded.
export const SOURCE_FLAG_ALLOWLIST = Object.freeze(
  ['0', '1', '6', '7', 'A', 'B', 'D', 'F', 'G', 'K', 'M', 'N', 'R', 'T', 'W', 'X', 'Z', 'd'],
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

// Per-rule status when Rule B is skipped because it cannot flag (SPEC v1.2, §7.4). Internal only.
export const RULE_NOT_APPLIED = 'NOT_APPLIED';
// Internal per-rule code for RULE_NOT_APPLIED (never shown to the user).
export const RULE_B_CANNOT_FLAG = 'RULE_B_CANNOT_FLAG';

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
  OUTSIDE_SEASON: 'OUTSIDE_SEASON',
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
  OUTSIDE_SEASON: 'This date is outside the contract season entered, so it is not counted toward the allowance or compared with weather records. Only duplicate entries are checked.',
});

// Evidence labels named in SPEC §3.5.
export const EVIDENCE_LABELS = Object.freeze({
  TRACE: 'Trace',
  PRESUMED_ZERO: 'presumed zero',
  REJECTED_QUALITY: 'rejected quality data',
});

// ---- Report, export, waitlist (SPEC §3.3, §9.4, §10.3, §12) ----
export const REPORT_MAX_ROWS = 18;
export const WAITLIST_URL = 'https://forms.gle/REPLACE_WITH_REAL_FORM_ID';
export const REPORT_TITLE = 'Snow service invoice review';

// Exact copy, SPEC §9.4.
export const DISCLAIMER = 'This report is an informational screening tool, not a certified snowfall record, invoice audit, legal opinion, or finding of overbilling. Weather stations may be miles from the property and may report on observation periods that do not match contractor service times. Local snowfall, drifting, ice, pavement conditions, and work performed may differ from station records. A flagged item is only worth asking about; it is not proof that a service was unnecessary or incorrectly billed. Confirm conditions, service logs, contract terms, and invoice details with the contractor before taking action. NOAA/NCEI data are provided as-is and may be revised. This tool is independent and is not affiliated with or endorsed by NOAA.';

// Exact copy, SPEC §3.3. {date} = weather access date.
export const ATTRIBUTION_TEMPLATE = 'Weather data: NOAA National Centers for Environmental Information (NCEI), Global Historical Climatology Network Daily (GHCN-Daily), Version 3. Accessed {date}. Dataset DOI: 10.7289/V5D21VHZ. This tool is independent and is not affiliated with or endorsed by NOAA.';

// SPEC §4.2 contract type names.
export const CONTRACT_TYPE_LABELS = Object.freeze({
  PER_PUSH: 'Per-push',
  PER_EVENT: 'Per-event',
  PER_INCH_TIERS: 'Per-inch tiers',
  SEASONAL_ALLOWANCE: 'Seasonal flat fee with push allowance',
  SEASONAL_UNLIMITED: 'Seasonal flat fee, unlimited',
});

// SPEC §7.10 summary labels.
export const SUMMARY_LABELS = Object.freeze({
  TOTAL_BILLED: 'Total billed',
  ITEMS_WORTH_QUESTIONING: 'Items worth questioning',
  REVIEW_AMOUNT: 'Estimated amount associated with items worth reviewing',
  AMOUNT_UNAVAILABLE: 'amount unavailable: {n} rows',
  CONTRACTUAL_OVERAGE: 'Estimated contractual overage at the entered rate',
  RATE_ESTIMATE: 'Estimated from entered contract rate',
});

// Results, evidence and report labels — approved by the product owner in Phase 5 (SPEC v1.2, §9.5).
export const UI_COPY = Object.freeze({
  OVERAGE_NO_RATE: '{n} push(es) beyond the allowance; no overage rate entered, so no dollar estimate.',
  SEASON_MAY_BE_INCOMPLETE: 'The season may be incomplete: not every billed push was marked as entered.',
  EVIDENCE_SUMMARY: 'Show evidence',
  EVIDENCE_WINDOW: 'Review window: {dates}. Trigger: {trigger} in.',
  EVIDENCE_TRIGGER_INHERITED: '(walkway trigger left blank, so the plow trigger is used)',
  EVIDENCE_MAX_MEDIAN: 'Highest complete three-day total: {max} in. Median: {median} in. Complete station windows: {count}.',
  EVIDENCE_STORM: 'Storm total used for push count: {eventSnow} in. over {dates}.',
  EVIDENCE_NO_STATIONS: 'No nearby station reported for these dates.',
  EVIDENCE_ACCESS: 'NOAA data accessed {date}. Data may be revised.',
  EXCLUDED: {
    MISSING: 'missing, not treated as zero',
    QUALITY_FLAG: 'rejected quality data',
    SOURCE_NOT_ALLOWED: 'source not accepted',
    ACCUMULATED: 'multi-day total, not assigned to one day',
    ATTRIBUTES_MISSING: 'flags missing',
    ATTRIBUTES_UNREADABLE: 'flags unreadable',
    UNKNOWN_MEASUREMENT_FLAG: 'unknown measurement flag',
    INVALID_VALUE: 'unreadable value',
  },
  REPORT_GENERATED: 'Generated {generated}. NOAA data accessed {access}; data may be revised.',
  REPORT_GENERATED_NO_WEATHER: 'Generated {generated}.',
  WALKWAY_SAME_AS_PLOW: 'Same as plow trigger',
  TIERS_NOT_VALID: 'Not valid (tier-based estimates turned off)',
  REPORT_STATIONS: 'Stations with records for the billed dates ({n}):',
  REPORT_NO_STATIONS: 'No weather stations were needed for these lines.',
  PRINT_BUTTON: 'Print / Save as PDF',
  EXPORT_BUTTON: 'Export results CSV',
});

// Action-bar line count and status-count label — approved by the product owner (SPEC v1.2, §9.5).
export const LAYOUT_COPY = Object.freeze({
  ROW_COUNT_NONE: 'No billed lines yet',
  ROW_COUNT_ONE: '1 billed line',
  ROW_COUNT_MANY: '{n} billed lines',
  STATUS_COUNTS_LABEL: 'Results by status',
});

// Exact copy, SPEC §9.5.
export const MESSAGES = Object.freeze({
  INVALID_ZIP_SHAPE: 'Enter a five-digit ZIP code.',
  ZIP_NOT_IN_ZCTA:
    'This ZIP code is not in the bundled 2020 Census ZIP Code Tabulation Area file. Check the ZIP or use another ZIP for the property area. Some valid USPS ZIP codes do not have a Census ZCTA.',
  NO_ROWS: 'Add a billed service or import a CSV to begin.',
  NO_RESULTS: 'Your report will appear here after you run the check.',
  LOADING: 'Finding nearby stations and checking the weather records…',
  NO_STATIONS: 'No stations with snowfall records were found within {radius} miles of this ZIP Code Area. Try a wider radius. No weather conclusion was made.',
  NETWORK: "We couldn't retrieve NOAA weather data. Check your connection and try once more. Your entries are still here.",
  HTTP_ERROR: "NOAA's data service returned an error ({status}). No result was calculated. Try again later.",
  INVALID_RESPONSE: 'The weather response could not be read safely. No result was calculated. Please try again later.',
  NO_ROWS_ON_RUN: 'Add at least one billed service before running the check.',
  STORAGE_BLOCKED: 'Your browser blocked local storage. The checker still works, but entries will not be remembered after you close this page.',
  CORRUPT_SAVED: 'Saved entries could not be read and were skipped. You can continue with a fresh check.',
  CORS_FALLBACK: 'NOAA data could not be loaded directly in this browser. Download the CSV below, then upload the file here. The data stays on this device.',
  REPORT_TRUNCATION: 'This one-page report shows the first 18 billed lines. Export the results CSV for the full line-by-line detail.',
  FIELD_REQUIRED: '{field} is required for this contract type.',
  FIELD_RANGE: '{field} must be between {min} and {max}.',
  SEASON_END_BEFORE_START: 'Season end date must be on or after the start date.',
  // Approved by the product owner in Phase 4 (SPEC v1.2, §9.5).
  FIELD_OPTIONAL_NON_NEGATIVE: '{field} must be blank or a number greater than or equal to 0.',
  FIELD_NON_NEGATIVE: '{field} must be a number greater than or equal to 0.',
  TIER_NUMBERS: 'Tier {n}: inches and charge per push must be numbers greater than or equal to 0.',
  TIER_FIRST_MIN: 'Tier 1 must start at 0 inches.',
  TIER_CONTIGUOUS: 'Tier {n} must start where tier {p} ends.',
  TIER_MAX_ORDER: 'Tier {n}: “Up to” must be greater than “From”.',
  TIER_OPEN_ENDED: 'Only the last tier may leave “Up to” blank.',
  TIER_DISABLED_SUFFIX: 'Tier-based estimates are turned off until the tier table is fixed.',
});
