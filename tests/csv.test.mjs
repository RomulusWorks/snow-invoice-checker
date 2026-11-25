import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseBilledServicesCsv, parseCsvRecords, CSV_MESSAGES } from '../assets/js/csv.js';
import { decimalToCents, parseDecimal, isRealIsoDate, formatCents, centsToDecimalText } from '../assets/js/format.js';

const HEADER = 'date,service_type,quantity,amount_charged';
const csv = (...lines) => lines.join('\n');

test('SPEC 37: CSV missing header -> exact message, no rows returned (table unchanged)', () => {
  const r = parseBilledServicesCsv(csv('2025-12-07,plow,1,425.00', '2025-12-08,plow,1,425.00'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['The CSV is missing the required header row: date, service_type, quantity, amount_charged.']);
  assert.equal(r.rows, undefined);
});

test('SPEC 38: quoted field with comma and "" is parsed correctly', () => {
  assert.deepEqual(parseCsvRecords('a,"b, ""c""",d\n'), [['a', 'b, "c"', 'd']]);
  // In a full import, a quoted amount and a quoted service type are accepted.
  const r = parseBilledServicesCsv(csv(HEADER, '"2025-12-07","plow","1","1,0"'));
  assert.equal(r.ok, false, 'comma inside the amount is not a valid decimal');
  assert.deepEqual(r.errors, ['Row 1: amount_charged must be blank or a number greater than or equal to 0.']);
  const ok = parseBilledServicesCsv(csv(HEADER, '"2025-12-07","Plow","2","850.00"'));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.rows, [{ date: '2025-12-07', serviceType: 'plow', quantity: 2, amountChargedCents: 85000, sourceRowNumber: 1 }]);
});

test('SPEC 39: CSV row 3 date 12/7/25 -> "Row 3: date must be a real date in YYYY-MM-DD format."', () => {
  const r = parseBilledServicesCsv(csv(HEADER, '2025-12-07,plow,1,425.00', '2025-12-08,plow,1,425.00', '12/7/25,plow,1,425.00'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['Row 3: date must be a real date in YYYY-MM-DD format.']);
  assert.equal(r.rows, undefined, 'all-or-nothing: no partial rows');
});

test('sample CSV (SPEC §5.1) imports exactly', async () => {
  const text = await fs.readFile(new URL('../public/sample-billed-services.csv', import.meta.url), 'utf8');
  const r = parseBilledServicesCsv(text);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 8);
  assert.deepEqual(r.rows[3], { date: '2026-01-15', serviceType: 'plow', quantity: 2, amountChargedCents: 85000, sourceRowNumber: 4 });
  assert.equal(r.rows[1].serviceType, 'salt');
});

test('BOM, CRLF, case-insensitive trimmed header, blank amount, blank lines ignored', () => {
  const text = `﻿ Date , SERVICE_TYPE,Quantity,Amount_Charged\r\n2025-12-07,WALKWAY,1.5,\r\n\r\n,,,\r\n2025-12-08,other,1,0\r\n`;
  const r = parseBilledServicesCsv(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [
    { date: '2025-12-07', serviceType: 'walkway', quantity: 1.5, amountChargedCents: null, sourceRowNumber: 1 },
    { date: '2025-12-08', serviceType: 'other', quantity: 1, amountChargedCents: 0, sourceRowNumber: 4 },
  ]);
});

test('exact error messages for every §5.3 condition', () => {
  const cases = [
    ['', CSV_MESSAGES.NO_CONTENT],
    ['   \n  ', CSV_MESSAGES.NO_CONTENT],
    [HEADER, CSV_MESSAGES.NO_CONTENT],
    [csv(`${HEADER},notes`, '2025-12-07,plow,1,1,x'), 'The CSV contains an unexpected column. Use only: date, service_type, quantity, amount_charged.'],
    [csv(HEADER, '2025-12-07,plow,1,1,extra'), 'The CSV contains an unexpected column. Use only: date, service_type, quantity, amount_charged.'],
    [csv(HEADER, '2025-02-30,plow,1,1'), 'Row 1: date must be a real date in YYYY-MM-DD format.'],
    [csv(HEADER, '2025-12-07,mowing,1,1'), 'Row 1: service_type must be plow, salt, walkway, or other.'],
    [csv(HEADER, '2025-12-07,plow,0,1'), 'Row 1: quantity must be a number greater than 0.'],
    [csv(HEADER, '2025-12-07,plow,-1,1'), 'Row 1: quantity must be a number greater than 0.'],
    [csv(HEADER, '2025-12-07,plow,1,$425.00'), 'Row 1: amount_charged must be blank or a number greater than or equal to 0.'],
    [csv(HEADER, '2025-12-07,plow,1,-5'), 'Row 1: amount_charged must be blank or a number greater than or equal to 0.'],
    [csv(HEADER, '2025-12-07,,1,1'), 'Row 1: every column except amount_charged must have a value.'],
    [csv(HEADER, '2025-12-07,plow'), 'Row 1: every column except amount_charged must have a value.'],
    [csv(HEADER, '2025-12-07,plow,1,1', '2025-12-08,"plow,1,1'), 'The CSV has an unmatched quote or invalid quoted field. Check row 2 and try again.'],
    [csv(HEADER, '2025-12-07,pl"ow,1,1'), 'The CSV has an unmatched quote or invalid quoted field. Check row 1 and try again.'],
    [csv(HEADER, '2025-12-07,"plow"x,1,1'), 'The CSV has an unmatched quote or invalid quoted field. Check row 1 and try again.'],
  ];
  for (const [text, msg] of cases) {
    const r = parseBilledServicesCsv(text);
    assert.equal(r.ok, false, JSON.stringify(text));
    assert.equal(r.errors[0], msg, JSON.stringify(text));
  }
});

test('never silently fixes values: dates like 2025-1-5 and quantities like 1e2 are rejected', () => {
  assert.equal(parseBilledServicesCsv(csv(HEADER, '2025-1-5,plow,1,1')).ok, false);
  assert.equal(parseBilledServicesCsv(csv(HEADER, '2025-01-05,plow,1e2,1')).ok, false);
});

test('reports every invalid row, not only the first', () => {
  const r = parseBilledServicesCsv(csv(HEADER, 'x,plow,1,1', '2025-12-07,plow,1,1', '2025-12-08,snow,1,1'));
  assert.deepEqual(r.errors, ['Row 1: date must be a real date in YYYY-MM-DD format.', 'Row 3: service_type must be plow, salt, walkway, or other.']);
});

test('format helpers: exact decimal-to-cents, dates, currency', () => {
  assert.equal(decimalToCents('425.00'), 42500);
  assert.equal(decimalToCents('0.29'), 29);
  assert.equal(decimalToCents('1.005'), 101);
  assert.equal(decimalToCents('.5'), 50);
  assert.equal(decimalToCents('12'), 1200);
  for (const bad of ['', '$1', '-1', '1,000', '1e3', 'abc', ' . ']) assert.equal(decimalToCents(bad), null, bad);
  assert.equal(parseDecimal('2.5'), 2.5);
  assert.equal(parseDecimal('2.5.1'), null);
  assert.equal(isRealIsoDate('2024-02-29'), true);
  assert.equal(isRealIsoDate('2025-02-29'), false);
  assert.equal(formatCents(42500), '$425.00');
  assert.equal(formatCents(123456789), '$1,234,567.89');
  assert.equal(centsToDecimalText(42505), '425.05');
});
