// DOM wiring, state, validation, demo mode and rendering (SPEC §4, §5, §9.5, §10).
// Pure validation helpers are exported; the UI starts only in a browser.
import { lookupZip, loadZctaData, isValidZipShape } from './zip.js';
import { loadStationData, findEligibleStations } from './stations.js';
import { createWeatherClient, NetworkError, HttpError, InvalidResponseError } from './weather-client.js';
import { runChecks } from './checks.js';
import { parseBilledServicesCsv, rowMessage, buildResultsCsv, resultsCsvFilename } from './csv.js';
import { createStorage } from './storage.js';
import { DEMO_LABEL, DEMO_FORM, DEMO_ROWS, DEMO_STATIONS, DEMO_OBSERVATIONS } from './demo-data.js';
import { buildReportModel, renderReport, renderSummary, summaryItems } from './report.js';
import {
  MESSAGES, STATUS_LABELS, CONTRACT_TYPES, SERVICE_TYPES, DEFAULT_RADIUS_MILES, SUMMARY_LABELS,
  UI_COPY as P5,
} from './constants.js';
import {
  decimalToCents, parseDecimal, isRealIsoDate, formatCents, formatQuantity, formatInches, centsToDecimalText,
} from './format.js';

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, k) => String(values[k]));

const RULE_A_CONTRACTS = new Set([CONTRACT_TYPES.PER_PUSH, CONTRACT_TYPES.PER_EVENT, CONTRACT_TYPES.PER_INCH_TIERS, CONTRACT_TYPES.SEASONAL_ALLOWANCE]);
const TRIGGER_MIN = 0.1;
const TRIGGER_MAX = 12.0;

// =====================================================================================
// Pure validation (no DOM)
// =====================================================================================

export function validateZip(zip) {
  return isValidZipShape(String(zip ?? '').trim()) ? null : MESSAGES.INVALID_ZIP_SHAPE;
}

function optionalCents(raw, field, errors, key) {
  const text = String(raw ?? '').trim();
  if (text === '') return null;
  const cents = decimalToCents(text);
  if (cents === null) errors.push({ key, message: fill(MESSAGES.FIELD_OPTIONAL_NON_NEGATIVE, { field }) });
  return cents;
}

function triggerValue(raw, field, required, errors, key) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    if (required) errors.push({ key, message: fill(MESSAGES.FIELD_REQUIRED, { field }) });
    return null;
  }
  const n = parseDecimal(text);
  if (n === null || n < TRIGGER_MIN || n > TRIGGER_MAX) {
    errors.push({ key, message: fill(MESSAGES.FIELD_RANGE, { field, min: '0.1', max: '12.0' }) });
    return null;
  }
  return n;
}

// Tier table (SPEC §4.4). Returns { tiers, error } — an invalid table never blocks the run;
// it disables tier-based estimates and shows the error.
export function validateTiers(rawTiers) {
  const rows = Array.isArray(rawTiers) ? rawTiers : [];
  const tiers = [];
  const fail = (msg) => ({ tiers: null, error: `${msg} ${MESSAGES.TIER_DISABLED_SUFFIX}` });
  if (rows.length === 0) return fail(fill(MESSAGES.TIER_NUMBERS, { n: 1 }));
  for (let i = 0; i < rows.length; i++) {
    const n = i + 1;
    const min = parseDecimal(String(rows[i].min ?? '').trim());
    const maxText = String(rows[i].max ?? '').trim();
    const max = maxText === '' ? null : parseDecimal(maxText);
    const charge = decimalToCents(String(rows[i].charge ?? '').trim());
    if (min === null || (maxText !== '' && max === null) || charge === null) return fail(fill(MESSAGES.TIER_NUMBERS, { n }));
    if (i === 0 && min !== 0) return fail(MESSAGES.TIER_FIRST_MIN);
    if (max === null && i !== rows.length - 1) return fail(MESSAGES.TIER_OPEN_ENDED);
    if (max !== null && max <= min) return fail(fill(MESSAGES.TIER_MAX_ORDER, { n }));
    if (i > 0 && tiers[i - 1].maxSnowInchesExclusive !== min) return fail(fill(MESSAGES.TIER_CONTIGUOUS, { n, p: n - 1 }));
    tiers.push({ minSnowInches: min, maxSnowInchesExclusive: max, chargePerPushCents: charge });
  }
  return { tiers, error: null };
}

// values: raw strings/booleans from the form. Returns { contract, options, errors, tierError }.
export function validateContractForm(values) {
  const errors = [];
  const type = values.contractType;
  if (!Object.values(CONTRACT_TYPES).includes(type)) throw new Error('Unknown contract type.');
  const contract = { type };
  contract.plowTriggerInches = triggerValue(values.plowTrigger, 'Plow trigger', true, errors, 'plowTrigger');
  contract.walkwayTriggerInches = triggerValue(values.walkwayTrigger, 'Walkway trigger', false, errors, 'walkwayTrigger');
  let tierError = null;

  if (type === CONTRACT_TYPES.PER_PUSH || type === CONTRACT_TYPES.PER_INCH_TIERS) {
    const extra = Number(values.extraPushes);
    contract.extraPushesAllowedPerStorm = [0, 1, 2].includes(extra) ? extra : null;
    if (contract.extraPushesAllowedPerStorm === null) errors.push({ key: 'extraPushes', message: fill(MESSAGES.FIELD_REQUIRED, { field: 'Extra pushes allowed per storm' }) });
  }
  if (type === CONTRACT_TYPES.PER_PUSH) contract.pricePerPushCents = optionalCents(values.pricePerPush, 'Price per push', errors, 'pricePerPush');
  if (type === CONTRACT_TYPES.PER_EVENT) contract.pricePerEventCents = optionalCents(values.pricePerEvent, 'Price per event', errors, 'pricePerEvent');
  if (type === CONTRACT_TYPES.PER_INCH_TIERS) {
    const t = validateTiers(values.tiers);
    contract.tiers = t.tiers ?? [];
    tierError = t.error;
  }
  if (type === CONTRACT_TYPES.SEASONAL_ALLOWANCE) {
    const start = String(values.seasonStart ?? '').trim();
    const end = String(values.seasonEnd ?? '').trim();
    if (!isRealIsoDate(start)) errors.push({ key: 'seasonStart', message: fill(MESSAGES.FIELD_REQUIRED, { field: 'Season start' }) });
    if (!isRealIsoDate(end)) errors.push({ key: 'seasonEnd', message: fill(MESSAGES.FIELD_REQUIRED, { field: 'Season end' }) });
    if (isRealIsoDate(start) && isRealIsoDate(end) && end < start) errors.push({ key: 'seasonEnd', message: MESSAGES.SEASON_END_BEFORE_START });
    contract.seasonStart = start;
    contract.seasonEnd = end;
    const allowanceText = String(values.pushAllowance ?? '').trim();
    if (allowanceText === '') {
      errors.push({ key: 'pushAllowance', message: fill(MESSAGES.FIELD_REQUIRED, { field: 'Push allowance' }) });
    } else {
      contract.pushAllowance = parseDecimal(allowanceText);
      if (contract.pushAllowance === null) errors.push({ key: 'pushAllowance', message: fill(MESSAGES.FIELD_NON_NEGATIVE, { field: 'Push allowance' }) });
    }
    contract.overageRateCents = optionalCents(values.overageRate, 'Overage rate', errors, 'overageRate');
    contract.allowanceCountsWalkway = values.allowanceCountsWalkway === true;
  }
  if (type === CONTRACT_TYPES.SEASONAL_UNLIMITED) contract.seasonalFeeCents = optionalCents(values.seasonalFee, 'Seasonal fee', errors, 'seasonalFee');

  return { contract, options: { seasonComplete: values.seasonComplete === true }, errors, tierError };
}

// rows: [{ date, serviceType, quantity, amount }] raw strings. Uses the §5.3 row messages.
export function validateRows(rows) {
  const errors = [];
  const billedRows = [];
  rows.forEach((r, i) => {
    const n = i + 1;
    const date = String(r.date ?? '').trim();
    const serviceType = String(r.serviceType ?? '').trim().toLowerCase();
    const qtyText = String(r.quantity ?? '').trim();
    const amountText = String(r.amount ?? '').trim();
    if (date === '' || serviceType === '' || qtyText === '') {
      errors.push({ row: i, field: date === '' ? 'date' : serviceType === '' ? 'serviceType' : 'quantity', message: rowMessage('PARTIALLY_BLANK', n) });
      return;
    }
    const before = errors.length;
    if (!isRealIsoDate(date)) errors.push({ row: i, field: 'date', message: rowMessage('INVALID_DATE', n) });
    if (!SERVICE_TYPES.includes(serviceType)) errors.push({ row: i, field: 'serviceType', message: rowMessage('INVALID_SERVICE_TYPE', n) });
    const quantity = parseDecimal(qtyText);
    if (quantity === null || !(quantity > 0)) errors.push({ row: i, field: 'quantity', message: rowMessage('INVALID_QUANTITY', n) });
    const amountChargedCents = amountText === '' ? null : decimalToCents(amountText);
    if (amountText !== '' && amountChargedCents === null) errors.push({ row: i, field: 'amount', message: rowMessage('INVALID_AMOUNT', n) });
    if (errors.length === before) {
      billedRows.push({ id: `r${n}`, date, serviceType, quantity, amountChargedCents, sourceRowNumber: n });
    }
  });
  return { billedRows, errors };
}

// Rows whose result depends on weather (Rules A/B). Others need no NOAA request.
export function rowsNeedingWeather(billedRows, contract) {
  if (!RULE_A_CONTRACTS.has(contract.type)) return [];
  return billedRows.filter((r) => (r.serviceType === 'plow' || r.serviceType === 'walkway')
    && (contract.type !== CONTRACT_TYPES.SEASONAL_ALLOWANCE || (contract.seasonStart <= r.date && r.date <= contract.seasonEnd)));
}

// =====================================================================================
// Browser UI
// =====================================================================================

const FIELD_IDS = {
  zip: 'zip', radius: 'radius', contractType: 'contract-type', plowTrigger: 'plow-trigger', walkwayTrigger: 'walkway-trigger',
  extraPushes: 'extra-pushes', pricePerPush: 'price-per-push', pricePerEvent: 'price-per-event', seasonStart: 'season-start',
  seasonEnd: 'season-end', pushAllowance: 'push-allowance', overageRate: 'overage-rate', seasonalFee: 'seasonal-fee',
};
const CHECKBOX_IDS = { allowanceCountsWalkway: 'allowance-walkway', seasonComplete: 'season-complete' };
const DEFAULT_FORM = {
  zip: '', radius: String(DEFAULT_RADIUS_MILES), contractType: CONTRACT_TYPES.PER_PUSH, plowTrigger: '2.0', walkwayTrigger: '',
  extraPushes: '1', pricePerPush: '', pricePerEvent: '', seasonStart: '', seasonEnd: '', pushAllowance: '', overageRate: '',
  seasonalFee: '', allowanceCountsWalkway: false, seasonComplete: false, tiers: [{ min: '0', max: '', charge: '' }],
};

class BundledDataError extends Error {}

function startApp() {
  const $ = (id) => document.getElementById(id);
  const storage = createStorage();
  const weatherClient = createWeatherClient();
  const state = { rows: [], tiers: [], demo: false, running: false, nextKey: 1 };
  let zctaPromise = null;
  let stationsPromise = null;

  const newRow = (r = {}) => ({ key: state.nextKey++, date: r.date ?? '', serviceType: r.serviceType ?? 'plow', quantity: r.quantity ?? '1', amount: r.amount ?? '' });
  const newTier = (t = {}) => ({ key: state.nextKey++, min: t.min ?? '', max: t.max ?? '', charge: t.charge ?? '' });

  // ---------- data loading (bundled static files, lazily, once) ----------
  function getZcta() {
    zctaPromise ??= loadZctaData().catch((e) => { zctaPromise = null; throw new BundledDataError(e.message); });
    return zctaPromise;
  }
  function getStations() {
    stationsPromise ??= loadStationData().catch((e) => { stationsPromise = null; throw new BundledDataError(e.message); });
    return stationsPromise;
  }

  // ---------- form values ----------
  function readForm() {
    const v = {};
    for (const [k, id] of Object.entries(FIELD_IDS)) v[k] = $(id).value;
    for (const [k, id] of Object.entries(CHECKBOX_IDS)) v[k] = $(id).checked;
    v.tiers = state.tiers.map(({ min, max, charge }) => ({ min, max, charge }));
    return v;
  }
  function writeForm(values) {
    const v = { ...DEFAULT_FORM, ...values };
    for (const [k, id] of Object.entries(FIELD_IDS)) {
      const el = $(id);
      const val = String(v[k] ?? '');
      if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === val)) continue;
      el.value = val;
    }
    for (const [k, id] of Object.entries(CHECKBOX_IDS)) $(id).checked = v[k] === true;
    const tiers = Array.isArray(v.tiers) && v.tiers.length ? v.tiers : DEFAULT_FORM.tiers;
    state.tiers = tiers.map((t) => newTier({ min: String(t.min ?? ''), max: String(t.max ?? ''), charge: String(t.charge ?? '') }));
    renderTiers();
    applyContractVisibility();
  }

  function applyContractVisibility() {
    const type = $('contract-type').value;
    for (const el of document.querySelectorAll('[data-show-for]')) {
      el.hidden = !el.dataset.showFor.split(' ').includes(type);
    }
  }

  // ---------- billed rows table ----------
  function cellInput(row, idx, field, labelText, attrs) {
    const id = `row-${row.key}-${field}`;
    const td = document.createElement('td');
    const label = document.createElement('label');
    label.className = 'visually-hidden';
    label.htmlFor = id;
    label.textContent = `Row ${idx + 1} ${labelText}`;
    let input;
    if (field === 'serviceType') {
      input = document.createElement('select');
      for (const t of SERVICE_TYPES) {
        const o = document.createElement('option');
        o.value = t;
        o.textContent = t;
        input.append(o);
      }
    } else {
      input = document.createElement('input');
      Object.assign(input, attrs);
    }
    input.id = id;
    input.value = row[field];
    input.dataset.rowKey = String(row.key);
    input.dataset.field = field;
    td.append(label, input);
    return td;
  }

  function renderRows() {
    const body = $('rows-body');
    body.replaceChildren();
    state.rows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.append(
        cellInput(row, idx, 'date', 'date', { type: 'date' }),
        cellInput(row, idx, 'serviceType', 'service type'),
        cellInput(row, idx, 'quantity', 'quantity', { type: 'text', inputMode: 'decimal' }),
        cellInput(row, idx, 'amount', 'amount charged', { type: 'text', inputMode: 'decimal' }),
      );
      const td = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'link-danger';
      btn.textContent = 'Remove';
      btn.setAttribute('aria-label', `Remove row ${idx + 1}`);
      btn.dataset.removeRow = String(row.key);
      td.append(btn);
      tr.append(td);
      body.append(tr);
    });
    $('no-rows').hidden = state.rows.length > 0;
    $('services-table').hidden = state.rows.length === 0;
  }

  function renderTiers() {
    const body = $('tier-body');
    body.replaceChildren();
    state.tiers.forEach((tier, idx) => {
      const tr = document.createElement('tr');
      for (const [field, text] of [['min', 'from (inches)'], ['max', 'up to, not including (inches)'], ['charge', 'charge per push (USD)']]) {
        const id = `tier-${tier.key}-${field}`;
        const td = document.createElement('td');
        const label = document.createElement('label');
        label.className = 'visually-hidden';
        label.htmlFor = id;
        label.textContent = `Tier ${idx + 1} ${text}`;
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.id = id;
        input.value = tier[field];
        input.dataset.tierKey = String(tier.key);
        input.dataset.field = field;
        td.append(label, input);
        tr.append(td);
      }
      const td = document.createElement('td');
      if (state.tiers.length > 1) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'link-danger';
        btn.textContent = 'Remove';
        btn.setAttribute('aria-label', `Remove tier ${idx + 1}`);
        btn.dataset.removeTier = String(tier.key);
        td.append(btn);
      }
      tr.append(td);
      body.append(tr);
    });
  }

  // ---------- messages ----------
  function announce(text, { notice = false } = {}) {
    const el = $('status');
    el.replaceChildren();
    if (!text) return;
    const p = document.createElement('p');
    p.textContent = text;
    if (notice) p.className = 'notice';
    el.append(p);
  }

  function clearErrors() {
    for (const el of document.querySelectorAll('.field-error')) { el.hidden = true; el.textContent = ''; }
    for (const el of document.querySelectorAll('[aria-invalid="true"]')) el.removeAttribute('aria-invalid');
    for (const id of ['rows-errors', 'form-errors']) { $(id).hidden = true; $(id).replaceChildren(); }
  }

  function showFieldError(key, message) {
    const input = $(FIELD_IDS[key] ?? key);
    const err = $(`${FIELD_IDS[key] ?? key}-error`);
    if (input) input.setAttribute('aria-invalid', 'true');
    if (err) { err.textContent = message; err.hidden = false; }
    return input;
  }

  function showList(id, messages) {
    const ul = $(id);
    ul.replaceChildren(...messages.map((m) => { const li = document.createElement('li'); li.textContent = m; return li; }));
    ul.hidden = messages.length === 0;
  }

  // ---------- persistence ----------
  function persist() {
    if (!$('remember').checked || state.demo) return;
    const ok = storage.save({ form: readForm(), rows: state.rows.map(({ date, serviceType, quantity, amount }) => ({ date, serviceType, quantity, amount })) });
    if (!ok) {
      $('remember').checked = false;
      announce(MESSAGES.STORAGE_BLOCKED, { notice: true });
    }
  }

  function restoreSaved() {
    const saved = storage.load();
    if (saved.status === 'corrupt') announce(MESSAGES.CORRUPT_SAVED, { notice: true });
    if (saved.status !== 'ok') return;
    writeForm(saved.data.form);
    state.rows = saved.data.rows.map((r) => newRow({
      date: String(r.date ?? ''), serviceType: SERVICE_TYPES.includes(r.serviceType) ? r.serviceType : 'plow',
      quantity: String(r.quantity ?? ''), amount: String(r.amount ?? ''),
    }));
    renderRows();
    $('remember').checked = true;
  }

  // ---------- results ----------
  let lastRun = null;

  function clearResults() {
    lastRun = null;
    $('results-body').replaceChildren();
    $('results-summary').replaceChildren();
    $('results-content').hidden = true;
    $('results-empty').hidden = false;
    $('results-demo-label').hidden = true;
    $('report').replaceChildren();
    $('report-section').hidden = true;
  }

  function node(tag, className, ...children) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    for (const c of children) if (c != null) e.append(c);
    return e;
  }

  function dayCell(day) {
    if (day.usable) {
      const marks = [day.label, day.sourceFlag ? `source ${day.sourceFlag}` : null].filter(Boolean).join(' · ');
      return node('td', 'nowrap', `${formatInches(day.valueInches)} in.`, marks ? node('span', 'evidence-mark', ` ${marks}`) : null);
    }
    const reason = P5.EXCLUDED[day.excludedReason] ?? day.excludedReason;
    const value = day.valueInches != null ? `${formatInches(day.valueInches)} in. ` : '— ';
    return node('td', 'evidence-excluded', value, node('span', 'evidence-mark', `(${reason})`));
  }

  function renderEvidence(r, run) {
    const ev = r.evidence;
    if (!ev.windowDates.length) return null;
    const details = node('details', 'evidence');
    details.append(node('summary', null, P5.EVIDENCE_SUMMARY));
    details.append(node('p', null, fill(P5.EVIDENCE_WINDOW, { dates: ev.windowDates.join(', '), trigger: formatInches(ev.triggerInches) }),
      ev.triggerInherited ? ` ${P5.EVIDENCE_TRIGGER_INHERITED}` : null));
    if (ev.stationCount > 0) {
      details.append(node('p', null, fill(P5.EVIDENCE_MAX_MEDIAN, {
        max: formatInches(ev.maxSnowInches), median: formatInches(ev.medianSnowInches), count: ev.stationCount,
      })));
    }
    // Storm total only when Rule B actually decided this line (OK or Worth questioning).
    const b = ['OK', 'WORTH_QUESTIONING'].includes(r.ruleResults.B?.status) ? r.ruleResults.B.evidence : null;
    if (b && b.eventSnowInches != null && b.stormDates) {
      details.append(node('p', null, fill(P5.EVIDENCE_STORM, { eventSnow: formatInches(b.eventSnowInches), dates: `${b.stormDates[0]} to ${b.stormDates.at(-1)}` })));
    }
    if (ev.stations.length === 0) {
      details.append(node('p', null, P5.EVIDENCE_NO_STATIONS));
    } else {
      const table = node('table', 'evidence-table');
      const head = node('tr', null, ...['Station', 'ID', 'Distance', ...ev.windowDates, '3-day total'].map((h) => {
        const th = node('th', null, h);
        th.scope = 'col';
        return th;
      }));
      table.append(node('thead', null, head));
      const body = node('tbody');
      for (const w of ev.stations) {
        body.append(node('tr', null,
          node('td', null, w.stationName ?? ''), node('td', 'nowrap', w.stationId),
          node('td', 'num', w.distanceMiles == null ? '' : `${w.distanceMiles.toFixed(1)} mi`),
          ...w.days.map(dayCell),
          node('td', 'num', w.complete ? `${formatInches(w.totalSnowInches)} in.` : '—')));
      }
      table.append(body);
      details.append(node('div', 'table-scroll', table));
    }
    details.append(node('p', 'evidence-access', run.demo ? DEMO_LABEL : fill(P5.EVIDENCE_ACCESS, { date: run.accessDate })));
    return details;
  }

  function reviewAmountCell(r) {
    const cell = node('td', 'num');
    if (!(r.flaggedUnits > 0)) return cell;
    cell.append(r.estimatedAmountCents == null ? '—' : formatCents(r.estimatedAmountCents));
    if (r.amountIsRateEstimate) cell.append(node('span', 'rate-note', SUMMARY_LABELS.RATE_ESTIMATE));
    return cell;
  }

  // run: { out, billedRows, contract, options, zip, radiusMiles, stations, observations, accessDate, generatedDate, demo }
  function renderResults(run) {
    lastRun = run;
    const { out, billedRows } = run;
    renderSummary($('results-summary'), summaryItems(out.summary, out.warnings));
    const body = $('results-body');
    body.replaceChildren();
    out.results.forEach((r, i) => {
      const row = billedRows[i];
      body.append(node('tr', null,
        node('td', 'nowrap', row.date), node('td', null, row.serviceType), node('td', 'num', formatQuantity(row.quantity)),
        node('td', 'num', formatCents(row.amountChargedCents)),
        node('td', 'nowrap', node('span', `status-badge status-${r.status}`, STATUS_LABELS[r.status])),
        node('td', 'reason', r.reasonText), node('td', null, r.confidence ?? ''), reviewAmountCell(r)));
      const evidence = renderEvidence(r, run);
      if (evidence) {
        const td = node('td', null, evidence);
        td.colSpan = 8;
        body.append(node('tr', 'evidence-row', td));
      }
    });
    $('results-demo-label').textContent = DEMO_LABEL;
    $('results-demo-label').hidden = !run.demo;
    $('results-empty').hidden = true;
    $('results-content').hidden = false;

    const observed = new Set(run.observations.map((o) => o.stationId));
    renderReport($('report'), buildReportModel({
      results: out.results, summary: out.summary, warnings: out.warnings, billedRows, contract: run.contract,
      zip: run.zip, radiusMiles: run.radiusMiles, seasonComplete: run.options.seasonComplete,
      stationsUsed: run.stations.filter((s) => observed.has(s.id)), generatedDate: run.generatedDate,
      accessDate: run.accessDate, demo: run.demo, demoLabel: DEMO_LABEL,
    }));
    $('report-section').hidden = false;
  }

  // Local calendar date (YYYY-MM-DD) for "generated", "accessed" and export filenames.
  function localIsoDate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function exportCsv() {
    if (!lastRun) return;
    const text = buildResultsCsv(lastRun.out.results, lastRun.billedRows);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = resultsCsvFilename(localIsoDate(), { demo: lastRun.demo });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- demo mode ----------
  function enterDemo() {
    clearErrors();
    announce('');
    writeForm({ ...DEFAULT_FORM, ...DEMO_FORM });
    state.rows = DEMO_ROWS.map((r) => newRow(r));
    renderRows();
    state.demo = true;
    $('demo-banner-label').textContent = DEMO_LABEL;
    $('demo-banner').hidden = false;
    const values = readForm();
    const { contract, options } = validateContractForm(values);
    const { billedRows } = validateRows(state.rows);
    const out = runChecks({ billedRows, contract, observations: DEMO_OBSERVATIONS, stations: DEMO_STATIONS, options });
    renderResults({
      out, billedRows, contract, options, zip: values.zip, radiusMiles: Number(values.radius), stations: DEMO_STATIONS,
      observations: DEMO_OBSERVATIONS, accessDate: null, generatedDate: localIsoDate(), demo: true,
    });
    $('location-method').hidden = true;
  }

  function exitDemo() {
    if (!state.demo) return;
    state.demo = false;
    $('demo-banner').hidden = true;
    clearResults();
  }

  // ---------- run ----------
  function errorMessage(err) {
    if (err instanceof HttpError) return fill(MESSAGES.HTTP_ERROR, { status: err.status });
    if (err instanceof InvalidResponseError) return MESSAGES.INVALID_RESPONSE;
    if (err instanceof NetworkError || err instanceof BundledDataError) return MESSAGES.NETWORK;
    console.error(err);
    return MESSAGES.NETWORK;
  }

  function setRunning(running) {
    state.running = running;
    $('run-check').disabled = running;
    $('checker-form').setAttribute('aria-busy', String(running));
  }

  async function runCheck() {
    if (state.running) return;
    exitDemo();
    clearErrors();
    announce('');
    const values = readForm();
    const fieldErrors = [];
    const zipError = validateZip(values.zip);
    if (zipError) fieldErrors.push({ key: 'zip', message: zipError });
    const { contract, options, errors, tierError } = validateContractForm(values);
    fieldErrors.push(...errors);
    const { billedRows, errors: rowErrors } = validateRows(state.rows);

    let firstInvalid = null;
    for (const e of fieldErrors) firstInvalid ??= showFieldError(e.key, e.message);
    if (tierError) { $('tier-error').textContent = tierError; $('tier-error').hidden = false; }
    if (rowErrors.length) {
      showList('rows-errors', rowErrors.map((e) => e.message));
      for (const e of rowErrors) {
        const input = $(`row-${state.rows[e.row].key}-${e.field}`);
        input?.setAttribute('aria-invalid', 'true');
        firstInvalid ??= input;
      }
    }
    if (state.rows.length === 0) {
      $('form-errors').textContent = MESSAGES.NO_ROWS_ON_RUN;
      $('form-errors').hidden = false;
      firstInvalid ??= $('add-row');
    }
    if (firstInvalid) { firstInvalid.focus(); return; } // invalid input: no network request

    setRunning(true);
    clearResults(); // never leave results from earlier inputs next to a new run's outcome
    announce(MESSAGES.LOADING);
    try {
      const zip = values.zip.trim();
      const location = lookupZip(zip, await getZcta());
      if (!location.ok) {
        announce('');
        showFieldError('zip', location.message).focus();
        return;
      }
      $('location-method-text').textContent = `ZIP Code Tabulation Area ${zip} centroid: ${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`;
      $('location-method').hidden = false;

      const weatherRows = rowsNeedingWeather(billedRows, contract);
      const radiusMiles = Number(values.radius);
      let stations = [];
      let observations = [];
      let accessDate = null;
      if (weatherRows.length > 0) {
        const weatherDates = weatherRows.map((r) => r.date);
        const { stations: all } = await getStations();
        stations = findEligibleStations({ centroid: location, stations: all, radiusMiles, billedDates: weatherDates });
        if (stations.length === 0) {
          announce(fill(MESSAGES.NO_STATIONS, { radius: radiusMiles }));
          clearResults();
          return;
        }
        observations = await weatherClient.fetchObservations(stations.map((s) => s.id), weatherDates);
        accessDate = localIsoDate();
        $('footer-access-date').textContent = accessDate;
      }
      const out = runChecks({ billedRows, contract, observations, stations, options });
      announce('');
      renderResults({
        out, billedRows, contract, options, zip, radiusMiles, stations, observations, accessDate,
        generatedDate: localIsoDate(), demo: false,
      });
      $('results').focus();
    } catch (err) {
      announce(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  // ---------- events ----------
  const form = $('checker-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); runCheck(); });

  // Any user edit exits demo mode and discards demo results.
  const onEdit = (e) => {
    const t = e.target;
    if (t.id === 'remember' || t.id === 'csv-text' || t.id === 'csv-file') return;
    exitDemo();
    if (t.dataset.rowKey) {
      const row = state.rows.find((r) => String(r.key) === t.dataset.rowKey);
      if (row) row[t.dataset.field] = t.value;
    } else if (t.dataset.tierKey) {
      const tier = state.tiers.find((x) => String(x.key) === t.dataset.tierKey);
      if (tier) tier[t.dataset.field] = t.value;
    }
    if (t.id === 'contract-type') applyContractVisibility();
    persist();
  };
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);

  $('add-row').addEventListener('click', () => {
    exitDemo();
    const row = newRow();
    state.rows.push(row);
    renderRows();
    persist();
    $(`row-${row.key}-date`).focus();
  });

  $('rows-body').addEventListener('click', (e) => {
    const key = e.target.closest('[data-remove-row]')?.dataset.removeRow;
    if (!key) return;
    exitDemo();
    const idx = state.rows.findIndex((r) => String(r.key) === key);
    state.rows.splice(idx, 1);
    renderRows();
    persist();
    const next = state.rows[idx] ?? state.rows[idx - 1];
    (next ? document.querySelector(`[data-remove-row="${next.key}"]`) : $('add-row')).focus();
  });

  $('add-tier').addEventListener('click', () => {
    exitDemo();
    const prev = state.tiers[state.tiers.length - 1];
    const tier = newTier({ min: prev ? prev.max : '' });
    state.tiers.push(tier);
    renderTiers();
    persist();
    $(`tier-${tier.key}-min`).focus();
  });

  $('tier-body').addEventListener('click', (e) => {
    const key = e.target.closest('[data-remove-tier]')?.dataset.removeTier;
    if (!key) return;
    exitDemo();
    state.tiers = state.tiers.filter((t) => String(t.key) !== key);
    renderTiers();
    persist();
    $('add-tier').focus();
  });

  function importCsvText(text) {
    showList('csv-errors', []);
    const r = parseBilledServicesCsv(text);
    if (!r.ok) {
      showList('csv-errors', r.errors); // table unchanged
      $('csv-errors').firstElementChild?.scrollIntoView({ block: 'nearest' });
      return;
    }
    exitDemo();
    state.rows = r.rows.map((row) => newRow({
      date: row.date, serviceType: row.serviceType, quantity: formatQuantity(row.quantity), amount: centsToDecimalText(row.amountChargedCents),
    }));
    renderRows();
    persist();
    $('services-heading').scrollIntoView({ block: 'start' });
  }
  $('import-csv').addEventListener('click', () => importCsvText($('csv-text').value));
  $('csv-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importCsvText(await file.text());
    e.target.value = '';
  });

  $('load-example').addEventListener('click', enterDemo);
  $('clear-example').addEventListener('click', () => {
    exitDemo();
    writeForm(DEFAULT_FORM);
    state.rows = [];
    renderRows();
    persist();
    $('load-example').focus();
  });

  $('remember').addEventListener('change', (e) => {
    if (e.target.checked) persist();
    else storage.clear();
  });
  $('clear-saved').addEventListener('click', () => {
    storage.clear();
    $('remember').checked = false;
  });
  $('reset').addEventListener('click', () => {
    exitDemo();
    clearErrors();
    announce('');
    writeForm(DEFAULT_FORM);
    state.rows = [];
    renderRows();
    $('location-method').hidden = true;
    clearResults();
    persist();
  });

  $('export-csv').addEventListener('click', exportCsv);
  $('print-report').addEventListener('click', () => window.print());

  // ---------- start ----------
  $('footer-access-date').textContent = localIsoDate();
  writeForm(DEFAULT_FORM);
  renderRows();
  restoreSaved();
  // Last step: tell the inline load check in index.html that the app started (SPEC v1.2).
  document.documentElement.setAttribute('data-app-ready', 'true');
  $('load-failed').hidden = true;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
  else startApp();
}
