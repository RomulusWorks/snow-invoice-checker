// Printable one-page report model + markup, and summary formatting (SPEC §7.10, §12.1).
// buildReportModel and the formatting helpers are pure; renderReport/renderSummary touch the DOM
// only when called in a browser.
import {
  REPORT_MAX_ROWS, REPORT_TITLE, DISCLAIMER, ATTRIBUTION_TEMPLATE, CONTRACT_TYPE_LABELS, SUMMARY_LABELS,
  UI_COPY as P5, MESSAGES, STATUS_LABELS, STATUS_COPY, REASON_TEMPLATES, CONTRACT_TYPES,
} from './constants.js';
import { formatCents, formatInches, formatQuantity } from './format.js';

const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

// ---------------------------------------------------------------- short reason
// Sentence counts taken from the start of each approved reason (no new wording is created).
const SHORT_SENTENCES = { MORE_PUSHES_THAN_SUGGESTED: 2 };
const PREFIXES = [
  ...Object.entries(REASON_TEMPLATES).map(([code, t]) => ({ code, prefix: t.slice(0, t.search(/\{|$/)).split('. ')[0] })),
  { code: 'NO_ISSUE', prefix: STATUS_COPY.OK.split('. ')[0] },
];

export function splitSentences(text) {
  // A sentence ends at ". " followed by a capital letter or digit ("in. of" does not split).
  return String(text ?? '').split(/(?<=\.)\s+(?=[A-Z0-9])/).filter(Boolean);
}

// First sentence(s) of each reason in a combined reasonText.
export function shortReason(reasonText) {
  const sentences = splitSentences(reasonText);
  const out = [];
  for (let i = 0; i < sentences.length; i++) {
    const match = PREFIXES.find((p) => p.prefix && sentences[i].startsWith(p.prefix));
    if (!match) continue;
    const n = SHORT_SENTENCES[match.code] ?? 1;
    out.push(...sentences.slice(i, i + n));
    i += n - 1;
  }
  return out.length ? out.join(' ') : sentences[0] ?? '';
}

// ---------------------------------------------------------------- summary
// Returns [{ label, value, note? }] for screen and report (SPEC §7.10).
export function summaryItems(summary, warnings = []) {
  const items = [
    { label: SUMMARY_LABELS.TOTAL_BILLED, value: formatCents(summary.totalBilledCents) },
    { label: SUMMARY_LABELS.ITEMS_WORTH_QUESTIONING, value: String(summary.itemsWorthQuestioning) },
    {
      label: SUMMARY_LABELS.REVIEW_AMOUNT,
      value: formatCents(summary.estimatedReviewAmountCents),
      note: summary.amountUnavailableRows > 0 ? fill(SUMMARY_LABELS.AMOUNT_UNAVAILABLE, { n: summary.amountUnavailableRows }) : null,
    },
  ];
  const ov = summary.contractualOverage;
  if (ov) {
    if (ov.overageCents == null) {
      items.push({ label: SUMMARY_LABELS.CONTRACTUAL_OVERAGE, value: '—', note: fill(P5.OVERAGE_NO_RATE, { n: formatQuantity(ov.excessUnits) }) });
    } else {
      items.push({ label: SUMMARY_LABELS.CONTRACTUAL_OVERAGE, value: formatCents(ov.overageCents) });
    }
  }
  if (warnings.some((w) => w.code === 'SEASON_MAY_BE_INCOMPLETE')) {
    items.push({ label: '', value: '', note: P5.SEASON_MAY_BE_INCOMPLETE });
  }
  return items;
}

// ---------------------------------------------------------------- contract description
const inches = (n) => `${formatInches(n)} in.`;

export function contractLines(contract, { radiusMiles, seasonComplete }) {
  const lines = [['Contract type', CONTRACT_TYPE_LABELS[contract.type]]];
  lines.push(['Plow trigger', inches(contract.plowTriggerInches)]);
  lines.push(['Walkway trigger', contract.walkwayTriggerInches == null ? P5.WALKWAY_SAME_AS_PLOW : inches(contract.walkwayTriggerInches)]);
  lines.push(['Station radius', `${radiusMiles} miles`]);
  if (contract.type === CONTRACT_TYPES.PER_PUSH || contract.type === CONTRACT_TYPES.PER_INCH_TIERS) {
    lines.push(['Extra pushes allowed per storm', String(contract.extraPushesAllowedPerStorm)]);
  }
  if (contract.type === CONTRACT_TYPES.PER_PUSH && contract.pricePerPushCents != null) lines.push(['Price per push', formatCents(contract.pricePerPushCents)]);
  if (contract.type === CONTRACT_TYPES.PER_EVENT && contract.pricePerEventCents != null) lines.push(['Price per event', formatCents(contract.pricePerEventCents)]);
  if (contract.type === CONTRACT_TYPES.PER_INCH_TIERS) {
    const tiers = (contract.tiers ?? []).map((t) => `${formatInches(t.minSnowInches)}–${t.maxSnowInchesExclusive == null ? '' : formatInches(t.maxSnowInchesExclusive)} in.: ${formatCents(t.chargePerPushCents)}`);
    lines.push(['Tiers', tiers.length ? tiers.join('; ') : P5.TIERS_NOT_VALID]);
  }
  if (contract.type === CONTRACT_TYPES.SEASONAL_ALLOWANCE) {
    lines.push(['Season', `${contract.seasonStart} to ${contract.seasonEnd}`]);
    lines.push(['Push allowance', formatQuantity(contract.pushAllowance)]);
    if (contract.overageRateCents != null) lines.push(['Overage rate', `${formatCents(contract.overageRateCents)} per push`]);
    lines.push(['Allowance counts walkway services too', contract.allowanceCountsWalkway ? 'Yes' : 'No']);
    lines.push(['I entered every billed push for this season', seasonComplete ? 'Yes' : 'No']);
  }
  if (contract.type === CONTRACT_TYPES.SEASONAL_UNLIMITED && contract.seasonalFeeCents != null) {
    lines.push(['Seasonal fee', formatCents(contract.seasonalFeeCents)]);
  }
  return lines;
}

// ---------------------------------------------------------------- report model
export function buildReportModel({
  results, summary, warnings = [], billedRows, contract, zip, radiusMiles, seasonComplete = false,
  stationsUsed = [], generatedDate, accessDate, demo = false, demoLabel = null, maxRows = REPORT_MAX_ROWS,
}) {
  const rows = results.slice(0, maxRows).map((r, i) => {
    const row = billedRows[i];
    return {
      date: row.date,
      service: row.serviceType,
      qty: formatQuantity(row.quantity),
      amount: formatCents(row.amountChargedCents),
      status: STATUS_LABELS[r.status],
      statusCode: r.status,
      reason: shortReason(r.reasonText),
      confidence: r.confidence ?? '',
    };
  });
  const truncated = results.length > maxRows;
  return {
    title: REPORT_TITLE,
    demoLabel: demo ? demoLabel : null,
    zipLine: `Property ZIP code: ${zip}`,
    centroidNote: 'We use a Census ZIP Code Tabulation Area centroid to find nearby stations. It may not be the exact property location.',
    contractLines: contractLines(contract, { radiusMiles, seasonComplete }),
    // No NOAA access line for demo data or for runs that needed no weather records.
    generatedLine: !demo && accessDate
      ? fill(P5.REPORT_GENERATED, { generated: generatedDate, access: accessDate })
      : fill(P5.REPORT_GENERATED_NO_WEATHER, { generated: generatedDate }),
    attribution: demo ? null : fill(ATTRIBUTION_TEMPLATE, { date: accessDate ?? generatedDate }),
    stationsHeading: stationsUsed.length ? fill(P5.REPORT_STATIONS, { n: stationsUsed.length }) : P5.REPORT_NO_STATIONS,
    stations: [...stationsUsed]
      .sort((a, b) => a.distanceMiles - b.distanceMiles || (a.id < b.id ? -1 : 1))
      .map((s) => `${s.id} ${s.name} (${s.distanceMiles.toFixed(1)} mi)`),
    summary: summaryItems(summary, warnings),
    rows,
    totalRows: results.length,
    truncationNote: truncated ? MESSAGES.REPORT_TRUNCATION.replace('first 18', `first ${maxRows}`) : null,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------- DOM rendering (browser only)
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

export function renderSummary(container, items) {
  const ul = el('ul', { class: 'summary-list' });
  for (const it of items) {
    const li = el('li');
    if (it.value) li.append(el('strong', {}, it.value));
    if (it.label) li.append(el('span', { class: 'summary-label' }, it.label));
    if (it.note) li.append(el('span', { class: 'summary-note' }, it.note));
    ul.append(li);
  }
  container.replaceChildren(ul);
}

export function renderReport(container, model) {
  const header = el('header', { class: 'report-header' },
    el('h2', { id: 'report-title' }, model.title),
    model.demoLabel ? el('p', { class: 'demo-label' }, model.demoLabel) : null,
    el('p', {}, el('strong', {}, model.zipLine), ` — ${model.centroidNote}`),
    el('p', { class: 'report-meta' }, model.generatedLine));

  const terms = el('dl', { class: 'report-terms' });
  for (const [k, v] of model.contractLines) terms.append(el('div', {}, el('dt', {}, k), el('dd', {}, v)));

  const summary = el('div', { class: 'report-summary' });
  renderSummary(summary, model.summary);

  const table = el('table', { class: 'report-table' });
  table.append(el('thead', {}, el('tr', {}, ...['Date', 'Service', 'Qty', 'Amount', 'Status', 'Reason', 'Confidence'].map((h) => el('th', { scope: 'col' }, h)))));
  const body = el('tbody');
  for (const r of model.rows) {
    body.append(el('tr', {},
      el('td', { class: 'nowrap' }, r.date), el('td', {}, r.service), el('td', { class: 'num' }, r.qty), el('td', { class: 'num' }, r.amount),
      el('td', { class: 'nowrap' }, el('span', { class: `status-badge status-${r.statusCode}` }, r.status)),
      el('td', {}, r.reason), el('td', {}, r.confidence)));
  }
  table.append(body);

  const stations = el('p', { class: 'report-stations' }, el('strong', {}, model.stationsHeading), model.stations.length ? ` ${model.stations.join('; ')}.` : null);

  // replaceChildren would turn null into the text "null", so skipped sections are filtered out.
  container.replaceChildren(...[
    header,
    el('div', { class: 'report-columns' }, terms, summary),
    table,
    model.truncationNote ? el('p', { class: 'report-truncation' }, model.truncationNote) : null,
    stations,
    model.attribution ? el('p', { class: 'report-attribution' }, model.attribution) : null,
    el('p', { class: 'report-disclaimer' }, model.disclaimer),
  ].filter(Boolean));
}
