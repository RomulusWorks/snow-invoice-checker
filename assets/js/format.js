// Number, money and date formatting/parsing helpers. Money is integer cents throughout.

// Plain decimal: digits with optional fraction, e.g. "12", "12.5", ".5". No sign, exponent, "$" or commas.
const DECIMAL = /^(\d+(\.\d*)?|\.\d+)$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isPlainDecimal(text) {
  return typeof text === 'string' && DECIMAL.test(text.trim());
}

// "425.00" -> 42500. Exact string arithmetic (half-up at the third decimal). Returns null when
// the text is not a plain non-negative decimal.
export function decimalToCents(text) {
  if (!isPlainDecimal(text)) return null;
  const [intPart, fracPart = ''] = text.trim().split('.');
  const frac = (fracPart + '000').slice(0, 3);
  let cents = Number(intPart || '0') * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  return Number.isSafeInteger(cents) ? cents : null;
}

// Plain decimal -> finite number, or null.
export function parseDecimal(text) {
  if (!isPlainDecimal(text)) return null;
  const n = Number(text.trim());
  return Number.isFinite(n) ? n : null;
}

export function isRealIsoDate(text) {
  const m = typeof text === 'string' ? ISO_DATE.exec(text) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function formatCents(cents) {
  return cents == null ? '' : usd.format(cents / 100);
}

// Cents -> "425.00" for form fields (no currency sign).
export function centsToDecimalText(cents) {
  if (cents == null) return '';
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function formatInches(n) {
  return n == null ? '' : n.toFixed(1);
}

export function formatQuantity(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
