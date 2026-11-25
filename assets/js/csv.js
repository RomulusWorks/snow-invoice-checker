// CSV import of billed services (SPEC §5). All-or-nothing: rows are returned only when the
// whole file validates. Errors use the exact SPEC §5.3 copy.
import { SERVICE_TYPES } from './constants.js';
import { isRealIsoDate, parseDecimal, decimalToCents } from './format.js';

export const CSV_HEADER = ['date', 'service_type', 'quantity', 'amount_charged'];

export const CSV_MESSAGES = Object.freeze({
  NO_CONTENT: 'Paste CSV text or choose a CSV file to import.',
  MISSING_HEADER: 'The CSV is missing the required header row: date, service_type, quantity, amount_charged.',
  UNEXPECTED_COLUMN: 'The CSV contains an unexpected column. Use only: date, service_type, quantity, amount_charged.',
  INVALID_DATE: 'Row {n}: date must be a real date in YYYY-MM-DD format.',
  INVALID_SERVICE_TYPE: 'Row {n}: service_type must be plow, salt, walkway, or other.',
  INVALID_QUANTITY: 'Row {n}: quantity must be a number greater than 0.',
  INVALID_AMOUNT: 'Row {n}: amount_charged must be blank or a number greater than or equal to 0.',
  PARTIALLY_BLANK: 'Row {n}: every column except amount_charged must have a value.',
  BAD_QUOTING: 'The CSV has an unmatched quote or invalid quoted field. Check row {n} and try again.',
});

export const rowMessage = (key, n) => CSV_MESSAGES[key].replace('{n}', String(n));

class QuoteError extends Error {
  constructor(recordIndex) {
    super('bad quoting');
    this.recordIndex = recordIndex;
  }
}

// RFC 4180 tokenizer. Returns an array of records (arrays of cell strings). Accepts CRLF or LF
// and an optional UTF-8 BOM. Throws QuoteError(recordIndex) on an unmatched or invalid quote.
export function parseCsvRecords(text) {
  const s = text.replace(/^﻿/, '');
  const records = [];
  let record = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  let cellWasQuoted = false;
  const endCell = () => { record.push(cell); cell = ''; cellWasQuoted = false; };
  const endRecord = () => { endCell(); records.push(record); record = []; };
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false;
        i++;
        // After a closing quote only a delimiter, line break or end of input is valid.
        if (i < s.length && s[i] !== ',' && s[i] !== '\n' && s[i] !== '\r') throw new QuoteError(records.length);
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (cell !== '' || cellWasQuoted) throw new QuoteError(records.length); // quote inside an unquoted cell
      inQuotes = true;
      cellWasQuoted = true;
      i++;
    } else if (ch === ',') {
      endCell();
      i++;
    } else if (ch === '\r' && s[i + 1] === '\n') {
      endRecord();
      i += 2;
    } else if (ch === '\n' || ch === '\r') {
      endRecord();
      i++;
    } else {
      cell += ch;
      i++;
    }
  }
  if (inQuotes) throw new QuoteError(records.length);
  if (cell !== '' || record.length > 0 || cellWasQuoted) endRecord();
  return records;
}

const isBlankRecord = (r) => r.every((c) => c.trim() === '');

function classifyHeader(cells) {
  const names = cells.map((c) => c.trim().toLowerCase());
  if (names.length === CSV_HEADER.length && names.every((n, i) => n === CSV_HEADER[i])) return 'OK';
  const known = names.filter((n) => CSV_HEADER.includes(n)).length;
  if (known >= 2) return 'UNEXPECTED_COLUMN';
  return 'MISSING_HEADER';
}

// Returns { ok: true, rows } or { ok: false, errors: [message, ...] }.
// rows: { date, serviceType, quantity, amountChargedCents, sourceRowNumber } where
// sourceRowNumber 1 = first data row after the header.
export function parseBilledServicesCsv(text) {
  if (typeof text !== 'string' || text.replace(/^﻿/, '').trim() === '') {
    return { ok: false, errors: [CSV_MESSAGES.NO_CONTENT] };
  }
  let records;
  try {
    records = parseCsvRecords(text);
  } catch (err) {
    if (err instanceof QuoteError) {
      // Record 0 is the header, so the record index is the data row number (min 1).
      return { ok: false, errors: [rowMessage('BAD_QUOTING', Math.max(1, err.recordIndex))] };
    }
    throw err;
  }
  // Leading blank lines before the header are ignored.
  let h = 0;
  while (h < records.length && isBlankRecord(records[h])) h++;
  if (h === records.length) return { ok: false, errors: [CSV_MESSAGES.NO_CONTENT] };
  const headerKind = classifyHeader(records[h]);
  if (headerKind !== 'OK') return { ok: false, errors: [CSV_MESSAGES[headerKind]] };

  const errors = [];
  const rows = [];
  records.slice(h + 1).forEach((rec, idx) => {
    const n = idx + 1;
    if (isBlankRecord(rec)) return; // fully blank lines ignored
    if (rec.length > CSV_HEADER.length) {
      errors.push(CSV_MESSAGES.UNEXPECTED_COLUMN);
      return;
    }
    const [dateRaw = '', typeRaw = '', qtyRaw = '', amountRaw = ''] = rec.map((c) => c.trim());
    if (dateRaw === '' || typeRaw === '' || qtyRaw === '') {
      errors.push(rowMessage('PARTIALLY_BLANK', n));
      return;
    }
    const rowErrors = [];
    if (!isRealIsoDate(dateRaw)) rowErrors.push(rowMessage('INVALID_DATE', n));
    const serviceType = typeRaw.toLowerCase();
    if (!SERVICE_TYPES.includes(serviceType)) rowErrors.push(rowMessage('INVALID_SERVICE_TYPE', n));
    const quantity = parseDecimal(qtyRaw);
    if (quantity === null || !(quantity > 0)) rowErrors.push(rowMessage('INVALID_QUANTITY', n));
    const amountChargedCents = amountRaw === '' ? null : decimalToCents(amountRaw);
    if (amountRaw !== '' && amountChargedCents === null) rowErrors.push(rowMessage('INVALID_AMOUNT', n));
    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    rows.push({ date: dateRaw, serviceType, quantity, amountChargedCents, sourceRowNumber: n });
  });
  const unique = [...new Set(errors)];
  if (unique.length) return { ok: false, errors: unique };
  if (rows.length === 0) return { ok: false, errors: [CSV_MESSAGES.NO_CONTENT] };
  return { ok: true, rows };
}
