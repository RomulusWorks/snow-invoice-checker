// Pure screening rules (SPEC §6-§9). No DOM, fetch, storage, system clock, or global mutable state.
// Inputs are normalized observations (weather-normalizer.js) and eligible stations (stations.js).
import {
  CONTRACT_TYPES, SERVICE_TYPES, STATUS, RULE_NOT_APPLICABLE, RULE_NOT_APPLIED, RULE_B_CANNOT_FLAG, CONFIDENCE, REASON_CODES,
  STATUS_COPY, REASON_TEMPLATES, EVIDENCE_LABELS,
} from './constants.js';

const RULE_A_CONTRACTS = new Set([
  CONTRACT_TYPES.PER_PUSH, CONTRACT_TYPES.PER_EVENT, CONTRACT_TYPES.PER_INCH_TIERS, CONTRACT_TYPES.SEASONAL_ALLOWANCE,
]);
const RULE_B_CONTRACTS = new Set([CONTRACT_TYPES.PER_PUSH, CONTRACT_TYPES.PER_INCH_TIERS]);
const STORM_GAP_DAYS = 2;
const CONFIDENCE_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 };

// ---------------------------------------------------------------- dates (UTC, date-only)
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

function dayNumber(iso) {
  const m = typeof iso === 'string' ? ISO_DATE.exec(iso) : null;
  if (!m) throw new Error(`Date "${iso}" must be in YYYY-MM-DD format.`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new Error(`Date "${iso}" is not a real date.`);
  }
  return ms / DAY_MS;
}
const isoFromDay = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const addDays = (iso, n) => isoFromDay(dayNumber(iso) + n);

export function getDateWindow(isoDate) {
  return [addDays(isoDate, -1), isoDate, addDays(isoDate, 1)];
}

// ---------------------------------------------------------------- small helpers
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Oldest first: date, then source row number, then id.
const byDateAsc = (a, b) => cmpStr(a.date, b.date) || a.sourceRowNumber - b.sourceRowNumber || cmpStr(a.id, b.id);
// Newest first (SPEC §7.4/§7.5): later date first; ties -> later sourceRowNumber first.
const byNewestFirst = (a, b) => cmpStr(b.date, a.date) || b.sourceRowNumber - a.sourceRowNumber || cmpStr(b.id, a.id);

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const fmt1 = (n) => n.toFixed(1);
const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));

function fillTemplate(code, params = {}) {
  return REASON_TEMPLATES[code].replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in params)) throw new Error(`Missing template value "${k}" for ${code}.`);
    return String(params[k]);
  });
}

function sum(values) {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

// Assigns `excess` units to rows newest-first. Returns Map rowId -> units assigned.
function assignExcessNewestFirst(rows, excess) {
  const out = new Map();
  let remaining = excess;
  for (const r of [...rows].sort(byNewestFirst)) {
    if (remaining <= 0) break;
    const units = Math.min(r.quantity, remaining);
    out.set(r.id, units);
    remaining -= units;
  }
  return out;
}

// ---------------------------------------------------------------- station windows
function dayEvidence(date, el) {
  if (!el) {
    return {
      date, valueInches: null, rawValue: null, measurementFlag: '', qualityFlag: '', sourceFlag: '',
      usable: false, trace: false, presumedZero: false, accumulated: false, excludedReason: 'MISSING', label: null,
    };
  }
  let label = null;
  if (el.usable && el.trace) label = EVIDENCE_LABELS.TRACE;
  else if (el.usable && el.presumedZero) label = EVIDENCE_LABELS.PRESUMED_ZERO;
  else if (el.excludedReason === 'QUALITY_FLAG') label = EVIDENCE_LABELS.REJECTED_QUALITY;
  return {
    date,
    valueInches: el.valueInches,
    rawValue: el.rawValue,
    measurementFlag: el.measurementFlag,
    qualityFlag: el.qualityFlag,
    sourceFlag: el.sourceFlag,
    usable: el.usable === true,
    trace: el.trace === true,
    presumedZero: el.presumedZero === true,
    accumulated: el.accumulated === true,
    excludedReason: el.excludedReason,
    label,
  };
}

// For each eligible station that has at least one record on `dates`, returns its window:
// complete when SNOW is usable on every date (trace and presumed-zero count; missing,
// quality-failed, source-excluded and accumulation days do not). Sorted by distance, then ID.
export function computeStationWindows(observations, dates, stations) {
  const stationById = new Map(stations.map((s) => [s.id, s]));
  const byStation = new Map();
  const wanted = new Set(dates);
  for (const o of observations) {
    if (!stationById.has(o.stationId) || !wanted.has(o.date)) continue;
    if (!byStation.has(o.stationId)) byStation.set(o.stationId, new Map());
    byStation.get(o.stationId).set(o.date, o);
  }
  const windows = [];
  for (const [stationId, recs] of byStation) {
    const s = stationById.get(stationId);
    const days = dates.map((d) => dayEvidence(d, recs.get(d)?.elements?.SNOW ?? null));
    const complete = days.every((d) => d.usable);
    const runningSumInches = sum(days.filter((d) => d.usable).map((d) => d.valueInches));
    const accumulatedValues = days.filter((d) => d.accumulated && d.valueInches !== null).map((d) => d.valueInches);
    const firstRec = [...recs.values()][0];
    windows.push({
      stationId,
      stationName: s.name ?? firstRec.stationName ?? null,
      distanceMiles: Number.isFinite(s.distanceMiles) ? s.distanceMiles : null,
      dates: [...dates],
      days,
      complete,
      totalSnowInches: complete ? runningSumInches : null,
      runningSumInches,
      presumedZero: days.some((d) => d.presumedZero),
      accumulated: days.some((d) => d.accumulated),
      accumulatedMaxInches: accumulatedValues.length ? Math.max(...accumulatedValues) : null,
    });
  }
  return windows.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity) || cmpStr(a.stationId, b.stationId));
}

// SPEC §7.2 step 5: any usable value, accumulation value, or partial running sum >= trigger.
function anyAffirmativeAtOrAbove(windows, trigger) {
  return windows.some((w) => w.runningSumInches >= trigger || (w.accumulatedMaxInches !== null && w.accumulatedMaxInches >= trigger));
}

function weatherSummary(windows) {
  const totals = windows.filter((w) => w.complete).map((w) => w.totalSnowInches);
  return {
    maxSnowInches: totals.length ? Math.max(...totals) : null,
    medianSnowInches: median(totals), // display only
    stationCount: totals.length,
  };
}

// ---------------------------------------------------------------- Rule A
function triggerFor(row, contract) {
  if (row.serviceType === 'walkway') {
    if (contract.walkwayTriggerInches != null) return { trigger: contract.walkwayTriggerInches, inherited: false };
    return { trigger: contract.plowTriggerInches, inherited: true };
  }
  return { trigger: contract.plowTriggerInches, inherited: false };
}

// SPEC §8, Rule A. "Any window" = every station window for this row, complete or partial.
function confidenceForNoSnow(windows, complete, gap) {
  const anyPresumedZero = windows.some((w) => w.presumedZero);
  const anyAccumulated = windows.some((w) => w.accumulated);
  const farthest = Math.max(...complete.map((w) => w.distanceMiles ?? Infinity));
  if (complete.length >= 3 && farthest <= 10 && gap >= 1.0 && !anyPresumedZero && !anyAccumulated) return CONFIDENCE.HIGH;
  // Presumed-zero caps confidence at LOW (SPEC §3.5).
  if (complete.length >= 2 && farthest <= 15 && gap >= 0.5 && !anyAccumulated && !anyPresumedZero) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

export function evaluateNoSignificantSnow(row, contract, windows) {
  const { trigger, inherited } = triggerFor(row, contract);
  const windowDates = getDateWindow(row.date);
  const evidence = { triggerInches: trigger, triggerInherited: inherited, windowDates, ...weatherSummary(windows) };
  if (anyAffirmativeAtOrAbove(windows, trigger)) return { status: STATUS.OK, evidence: { ...evidence, affirmativeSnow: true } };
  const complete = windows.filter((w) => w.complete);
  if (complete.length === 0) {
    return { status: STATUS.NOT_ENOUGH_DATA, code: REASON_CODES.INSUFFICIENT_DATA, dates: windowDates, evidence };
  }
  const maxSnow = evidence.maxSnowInches;
  if (maxSnow >= trigger) return { status: STATUS.OK, evidence };
  return {
    status: STATUS.WORTH_QUESTIONING,
    code: REASON_CODES.NO_SIGNIFICANT_SNOW,
    flaggedUnits: row.quantity,
    confidence: confidenceForNoSnow(windows, complete, trigger - maxSnow),
    params: { maxSnow: fmt1(maxSnow), trigger: fmt1(trigger) },
    evidence,
  };
}

// ---------------------------------------------------------------- Rule B
// A new storm starts when the next plow date is more than 2 calendar days after the previous.
export function groupStorms(plowRows) {
  const sorted = [...plowRows].sort(byDateAsc);
  const storms = [];
  let current = [];
  let prevDay = null;
  for (const r of sorted) {
    const d = dayNumber(r.date);
    if (current.length && d - prevDay > STORM_GAP_DAYS) {
      storms.push(current);
      current = [];
    }
    current.push(r);
    prevDay = d;
  }
  if (current.length) storms.push(current);
  return storms;
}

function stormDates(stormRows) {
  const days = new Set();
  for (const r of stormRows) for (const d of getDateWindow(r.date)) days.add(d);
  return [...days].sort();
}

// Returns { status, eventSnowInches, dates, perRow: Map rowId -> rule result }.
// eventSnowInches is also used for tier selection (SPEC §4.4) whenever it is valid.
export function evaluatePushCount(stormRows, contract, observations, stations) {
  const dates = stormDates(stormRows);
  const windows = computeStationWindows(observations, dates, stations);
  const valid = windows.filter((w) => w.complete); // usable on every storm date (A days invalidate)
  const perRow = new Map();
  const billedPushes = sum(stormRows.map((r) => r.quantity));

  // SPEC v1.2 (§7.4 step 0): basePushes >= 1, so allowedPushes >= 1 + extra. A storm with
  // billedPushes <= 1 + extra can never exceed it, so Rule B is not applied and cannot
  // contribute NOT_ENOUGH_DATA. eventSnowInches is still reported for tier pricing (§4.4).
  if (billedPushes <= 1 + contract.extraPushesAllowedPerStorm) {
    const eventSnowInches = valid.length ? Math.max(...valid.map((w) => w.totalSnowInches)) : null;
    for (const r of stormRows) {
      perRow.set(r.id, { status: RULE_NOT_APPLIED, code: RULE_B_CANNOT_FLAG, evidence: { eventSnowInches, stormDates: dates, billedPushes } });
    }
    return { status: RULE_NOT_APPLIED, eventSnowInches, dates, perRow };
  }

  if (valid.length === 0) {
    for (const r of stormRows) perRow.set(r.id, { status: STATUS.NOT_ENOUGH_DATA, code: REASON_CODES.INSUFFICIENT_DATA, dates });
    return { status: STATUS.NOT_ENOUGH_DATA, eventSnowInches: null, dates, perRow };
  }
  const eventSnowInches = Math.max(...valid.map((w) => w.totalSnowInches));
  const trigger = contract.plowTriggerInches;
  const evidence = { eventSnowInches, stormDates: dates, stationCount: valid.length };
  if (eventSnowInches < trigger) {
    for (const r of stormRows) perRow.set(r.id, { status: RULE_NOT_APPLICABLE, evidence });
    return { status: RULE_NOT_APPLICABLE, eventSnowInches, dates, perRow };
  }
  const basePushes = Math.max(1, Math.ceil(eventSnowInches / trigger));
  const allowedPushes = basePushes + contract.extraPushesAllowedPerStorm;
  const excess = billedPushes - allowedPushes;
  const fullEvidence = { ...evidence, basePushes, allowedPushes, billedPushes, excess: Math.max(0, excess) };
  const assigned = excess > 0 ? assignExcessNewestFirst(stormRows, excess) : new Map();
  for (const r of stormRows) {
    const units = assigned.get(r.id);
    if (units > 0) {
      perRow.set(r.id, {
        status: STATUS.WORTH_QUESTIONING,
        code: REASON_CODES.MORE_PUSHES_THAN_SUGGESTED,
        flaggedUnits: units,
        confidence: CONFIDENCE.LOW, // always LOW (SPEC §8)
        params: {
          eventSnow: fmt1(eventSnowInches),
          allowedPushes: fmtNum(allowedPushes),
          extraAllowed: fmtNum(contract.extraPushesAllowedPerStorm),
          billedPushes: fmtNum(billedPushes),
          flaggedUnits: fmtNum(units),
        },
        evidence: fullEvidence,
      });
    } else {
      perRow.set(r.id, { status: STATUS.OK, evidence: fullEvidence });
    }
  }
  return { status: excess > 0 ? STATUS.WORTH_QUESTIONING : STATUS.OK, eventSnowInches, dates, perRow };
}

// ---------------------------------------------------------------- Rule C
const inSeason = (row, contract) => contract.seasonStart <= row.date && row.date <= contract.seasonEnd;

function countsTowardAllowance(row, contract) {
  if (!inSeason(row, contract)) return false;
  return row.serviceType === 'plow' || (row.serviceType === 'walkway' && contract.allowanceCountsWalkway === true);
}

// Returns { seasonPushes, allowance, excessUnits, contractualOverageCents, confidence, perRow }.
export function evaluateAllowance(rows, contract, options) {
  const counted = rows.filter((r) => countsTowardAllowance(r, contract));
  const seasonPushes = sum(counted.map((r) => r.quantity));
  const allowance = contract.pushAllowance;
  const excessUnits = Math.max(0, seasonPushes - allowance);
  const confidence = options.seasonComplete === true ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM;
  const assigned = excessUnits > 0 ? assignExcessNewestFirst(counted, excessUnits) : new Map();
  let contractualOverageCents = 0;
  if (excessUnits > 0) {
    contractualOverageCents = contract.overageRateCents == null ? null : Math.round(excessUnits * contract.overageRateCents);
  }
  const perRow = new Map();
  for (const r of rows) {
    if (!counted.includes(r)) {
      perRow.set(r.id, { status: RULE_NOT_APPLICABLE });
      continue;
    }
    const units = assigned.get(r.id);
    if (units > 0) {
      perRow.set(r.id, {
        status: STATUS.WORTH_QUESTIONING,
        code: REASON_CODES.ALLOWANCE_EXCEEDED,
        allowanceExcessUnits: units,
        confidence,
        params: {
          seasonPushes: fmtNum(seasonPushes),
          allowance: fmtNum(allowance),
          excessPushes: fmtNum(excessUnits),
          lineUnits: fmtNum(units),
        },
      });
    } else {
      perRow.set(r.id, { status: STATUS.OK });
    }
  }
  return {
    seasonPushes, allowance, excessUnits, contractualOverageCents, confidence, perRow,
    seasonMayBeIncomplete: excessUnits === 0 && options.seasonComplete !== true,
  };
}

// ---------------------------------------------------------------- Rule E
export function evaluateDuplicates(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.date}|${r.serviceType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const perRow = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) {
      for (const r of group) perRow.set(r.id, { status: STATUS.OK });
      continue;
    }
    const identical = group.every((r) => r.quantity === group[0].quantity && r.amountChargedCents === group[0].amountChargedCents);
    for (const r of group) {
      perRow.set(r.id, {
        status: STATUS.WORTH_QUESTIONING,
        code: REASON_CODES.DUPLICATE_BILLING,
        flaggedUnits: r.quantity,
        confidence: identical ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM,
        params: { serviceType: r.serviceType, date: r.date },
        groupSize: group.length,
      });
    }
  }
  return perRow;
}

// ---------------------------------------------------------------- combination (SPEC §7.9)
// NOT_APPLICABLE (rule does not apply) and NOT_APPLIED (Rule B cannot flag, v1.2) are both ignored.
const isWeatherRuleApplicable = (res) => res && res.status !== RULE_NOT_APPLICABLE && res.status !== RULE_NOT_APPLIED;

// SPEC v1.2: plow/walkway row on an allowance contract dated outside the season.
const isOutsideSeasonRow = (row, contract) => contract.type === CONTRACT_TYPES.SEASONAL_ALLOWANCE
  && (row.serviceType === 'plow' || row.serviceType === 'walkway') && !inSeason(row, contract);

export function combineResults(row, ruleResults, contract) {
  const { A, B, C, E } = ruleResults;
  const flagging = [A, B, C, E].filter((r) => r && r.status === STATUS.WORTH_QUESTIONING);
  const flaggedUnits = Math.max(0, ...[A, B, E].filter((r) => r && r.status === STATUS.WORTH_QUESTIONING).map((r) => r.flaggedUnits));
  const allowanceExcessUnits = C && C.status === STATUS.WORTH_QUESTIONING ? C.allowanceExcessUnits : 0;
  const base = { rowId: row.id, flaggedUnits, allowanceExcessUnits, ruleResults };
  const outsideSeason = isOutsideSeasonRow(row, contract);

  if (flagging.length > 0) {
    const confidence = flagging.map((r) => r.confidence).reduce((a, b) => (CONFIDENCE_RANK[b] > CONFIDENCE_RANK[a] ? b : a));
    const reasonCodes = flagging.map((r) => r.code);
    const texts = flagging.map((r) => fillTemplate(r.code, r.params));
    if (outsideSeason) {
      // Only Rule E can flag here; OUTSIDE_SEASON explains why weather/allowance were not checked.
      reasonCodes.push(REASON_CODES.OUTSIDE_SEASON);
      texts.push(fillTemplate(REASON_CODES.OUTSIDE_SEASON));
    }
    return {
      ...base,
      status: STATUS.WORTH_QUESTIONING,
      reasonCodes,
      reasonText: texts.join(' '),
      confidence,
    };
  }
  const weatherRules = [A, B].filter(isWeatherRuleApplicable);
  const ned = weatherRules.filter((r) => r.status === STATUS.NOT_ENOUGH_DATA);
  if (ned.length > 0) {
    const dates = [...new Set(ned.flatMap((r) => r.dates))].sort();
    return {
      ...base,
      status: STATUS.NOT_ENOUGH_DATA,
      reasonCodes: [REASON_CODES.INSUFFICIENT_DATA],
      reasonText: fillTemplate(REASON_CODES.INSUFFICIENT_DATA, { dates: dates.join(', ') }),
      confidence: null,
    };
  }
  if (weatherRules.length === 0) {
    let codes = [];
    if (contract.type === CONTRACT_TYPES.SEASONAL_UNLIMITED) codes = [REASON_CODES.SEASONAL_UNLIMITED_DUPLICATE_ONLY];
    else if (row.serviceType === 'salt' || row.serviceType === 'other') codes = [REASON_CODES.SERVICE_TYPE_NOT_CHECKED];
    else if (outsideSeason) codes = [REASON_CODES.OUTSIDE_SEASON];
    return {
      ...base,
      status: STATUS.NOT_CHECKED,
      reasonCodes: codes,
      reasonText: codes.map((c) => fillTemplate(c)).join(' '),
      confidence: null,
    };
  }
  return { ...base, status: STATUS.OK, reasonCodes: [REASON_CODES.NO_ISSUE], reasonText: STATUS_COPY.OK, confidence: null };
}

// ---------------------------------------------------------------- money (SPEC §7.10)
export function selectTier(tiers, eventSnowInches) {
  if (!Array.isArray(tiers) || eventSnowInches == null) return null;
  return tiers.find((t) => t.minSnowInches <= eventSnowInches
    && (t.maxSnowInchesExclusive == null || eventSnowInches < t.maxSnowInchesExclusive)) ?? null;
}

// SPEC §4.4: first min = 0; adjacent rows meet exactly; only the last max may be blank.
export function isValidTierTable(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return false;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const last = i === tiers.length - 1;
    if (!Number.isFinite(t.minSnowInches) || !Number.isInteger(t.chargePerPushCents) || t.chargePerPushCents < 0) return false;
    if (i === 0 && t.minSnowInches !== 0) return false;
    if (t.maxSnowInchesExclusive == null) {
      if (!last) return false;
    } else if (!Number.isFinite(t.maxSnowInchesExclusive) || t.maxSnowInchesExclusive <= t.minSnowInches) {
      return false;
    }
    if (!last && tiers[i + 1].minSnowInches !== t.maxSnowInchesExclusive) return false;
  }
  return true;
}

// Contract rate per unit for a row with a blank amount. Rates are per push/event, so only plow
// rows receive a rate estimate. Returns cents or null.
function contractRateCents(row, contract, eventSnowInches, tiersValid) {
  if (row.serviceType !== 'plow') return null;
  switch (contract.type) {
    case CONTRACT_TYPES.PER_PUSH: return contract.pricePerPushCents ?? null;
    case CONTRACT_TYPES.PER_EVENT: return contract.pricePerEventCents ?? null;
    case CONTRACT_TYPES.PER_INCH_TIERS: {
      if (!tiersValid) return null;
      return selectTier(contract.tiers, eventSnowInches)?.chargePerPushCents ?? null;
    }
    default: return null;
  }
}

function reviewAmount(row, flaggedUnits, contract, eventSnowInches, tiersValid) {
  if (!(flaggedUnits > 0)) return { estimatedAmountCents: 0, amountIsRateEstimate: false };
  if (row.amountChargedCents != null) {
    return { estimatedAmountCents: Math.round((row.amountChargedCents * flaggedUnits) / row.quantity), amountIsRateEstimate: false };
  }
  const rate = contractRateCents(row, contract, eventSnowInches, tiersValid);
  if (rate == null) return { estimatedAmountCents: null, amountIsRateEstimate: false };
  return { estimatedAmountCents: Math.round(rate * flaggedUnits), amountIsRateEstimate: true };
}

export function calculateSummary(results, rows, contract) {
  const totalBilledCents = sum(rows.filter((r) => r.amountChargedCents != null).map((r) => r.amountChargedCents));
  const flagged = results.filter((r) => r.flaggedUnits > 0);
  const excessUnits = sum(results.map((r) => r.allowanceExcessUnits));
  let contractualOverage = null;
  if (contract.type === CONTRACT_TYPES.SEASONAL_ALLOWANCE) {
    let overageCents = 0;
    if (excessUnits > 0) overageCents = contract.overageRateCents == null ? null : Math.round(excessUnits * contract.overageRateCents);
    contractualOverage = { excessUnits, overageCents };
  }
  return {
    rowCount: rows.length,
    totalBilledCents,
    itemsWorthQuestioning: results.filter((r) => r.status === STATUS.WORTH_QUESTIONING).length,
    estimatedReviewAmountCents: sum(flagged.filter((r) => r.estimatedAmountCents != null).map((r) => r.estimatedAmountCents)),
    amountUnavailableRows: flagged.filter((r) => r.estimatedAmountCents == null).length,
    contractualOverage,
    statusCounts: Object.fromEntries(Object.values(STATUS).map((s) => [s, results.filter((r) => r.status === s).length])),
  };
}

// ---------------------------------------------------------------- input validation
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const isOptionalCents = (v) => v == null || isNonNegInt(v);

function validateInputs({ billedRows, contract, observations, stations, options }) {
  if (!Array.isArray(billedRows)) throw new Error('billedRows must be an array.');
  if (!Array.isArray(observations)) throw new Error('observations must be an array.');
  if (!Array.isArray(stations)) throw new Error('stations must be an array.');
  if (!options || typeof options !== 'object') throw new Error('options must be an object.');
  if (!contract || !Object.values(CONTRACT_TYPES).includes(contract.type)) throw new Error('Unknown contract type.');
  if (!(Number.isFinite(contract.plowTriggerInches) && contract.plowTriggerInches > 0)) throw new Error('plowTriggerInches must be a positive number.');
  if (contract.walkwayTriggerInches != null && !(Number.isFinite(contract.walkwayTriggerInches) && contract.walkwayTriggerInches > 0)) {
    throw new Error('walkwayTriggerInches must be blank or a positive number.');
  }
  for (const k of ['pricePerPushCents', 'pricePerEventCents', 'overageRateCents']) {
    if (!isOptionalCents(contract[k])) throw new Error(`${k} must be blank or whole cents >= 0.`);
  }
  if (RULE_B_CONTRACTS.has(contract.type) && ![0, 1, 2].includes(contract.extraPushesAllowedPerStorm)) {
    throw new Error('extraPushesAllowedPerStorm must be 0, 1 or 2.');
  }
  if (contract.type === CONTRACT_TYPES.SEASONAL_ALLOWANCE) {
    dayNumber(contract.seasonStart);
    dayNumber(contract.seasonEnd);
    if (contract.seasonEnd < contract.seasonStart) throw new Error('Season end date must be on or after the start date.');
    if (!(Number.isFinite(contract.pushAllowance) && contract.pushAllowance >= 0)) throw new Error('pushAllowance must be a number >= 0.');
  }
  const ids = new Set();
  for (const r of billedRows) {
    if (typeof r.id !== 'string' || ids.has(r.id)) throw new Error('Every billed row needs a unique string id.');
    ids.add(r.id);
    dayNumber(r.date);
    if (!SERVICE_TYPES.includes(r.serviceType)) throw new Error(`Row ${r.id}: unknown service type.`);
    if (!(Number.isFinite(r.quantity) && r.quantity > 0)) throw new Error(`Row ${r.id}: quantity must be greater than 0.`);
    if (!isOptionalCents(r.amountChargedCents)) throw new Error(`Row ${r.id}: amountChargedCents must be null or whole cents >= 0.`);
    if (!Number.isInteger(r.sourceRowNumber)) throw new Error(`Row ${r.id}: sourceRowNumber must be an integer.`);
  }
}

// ---------------------------------------------------------------- entry point
export function runChecks({ billedRows, contract, observations, stations, options }) {
  validateInputs({ billedRows, contract, observations, stations, options });
  const warnings = [];
  const isAllowance = contract.type === CONTRACT_TYPES.SEASONAL_ALLOWANCE;

  const tiersValid = contract.type === CONTRACT_TYPES.PER_INCH_TIERS ? isValidTierTable(contract.tiers) : false;
  if (contract.type === CONTRACT_TYPES.PER_INCH_TIERS && !tiersValid) warnings.push({ code: 'TIER_TABLE_INVALID' });

  const duplicates = evaluateDuplicates(billedRows);
  const allowance = isAllowance ? evaluateAllowance(billedRows, contract, options) : null;
  if (allowance?.seasonMayBeIncomplete) warnings.push({ code: 'SEASON_MAY_BE_INCOMPLETE' });

  // Rule B per storm; eventSnow per plow row is also used for tier pricing.
  const ruleB = new Map();
  const eventSnowByRow = new Map();
  if (RULE_B_CONTRACTS.has(contract.type)) {
    for (const storm of groupStorms(billedRows.filter((r) => r.serviceType === 'plow'))) {
      const res = evaluatePushCount(storm, contract, observations, stations);
      for (const r of storm) {
        ruleB.set(r.id, res.perRow.get(r.id));
        eventSnowByRow.set(r.id, res.eventSnowInches);
      }
    }
  }

  const results = billedRows.map((row) => {
    const weatherEligible = (row.serviceType === 'plow' || row.serviceType === 'walkway') && RULE_A_CONTRACTS.has(contract.type);
    const aApplies = weatherEligible && (!isAllowance || inSeason(row, contract));

    const windows = aApplies ? computeStationWindows(observations, getDateWindow(row.date), stations) : [];
    const A = aApplies ? evaluateNoSignificantSnow(row, contract, windows) : { status: RULE_NOT_APPLICABLE };
    const B = ruleB.get(row.id) ?? { status: RULE_NOT_APPLICABLE };
    const C = allowance ? allowance.perRow.get(row.id) : { status: RULE_NOT_APPLICABLE };
    const E = duplicates.get(row.id);

    const combined = combineResults(row, { A, B, C, E }, contract);
    const money = reviewAmount(row, combined.flaggedUnits, contract, eventSnowByRow.get(row.id) ?? null, tiersValid);
    const summary = aApplies ? weatherSummary(windows) : { maxSnowInches: null, medianSnowInches: null, stationCount: 0 };
    return {
      ...combined,
      ...money,
      evidence: {
        stations: windows,
        windowDates: aApplies ? getDateWindow(row.date) : [],
        triggerInches: A.evidence?.triggerInches ?? null,
        triggerInherited: A.evidence?.triggerInherited ?? false,
        ...summary,
      },
    };
  });

  return { results, summary: calculateSummary(results, billedRows, contract), warnings };
}
