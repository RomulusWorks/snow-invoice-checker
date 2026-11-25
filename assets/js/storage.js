// Optional, opt-in local persistence (SPEC §4.6). Every storage call is in try/catch; the app
// works when storage is blocked. Only form inputs and billed rows are saved — never weather data.

export const STORAGE_KEY = 'snow-invoice-checker:v1';
const SCHEMA_VERSION = 1;

function defaultStore() {
  // Accessing window.localStorage itself can throw (e.g. blocked cookies / sandboxed frames).
  return globalThis.localStorage;
}

// getStore is injectable for tests.
export function createStorage(getStore = defaultStore) {
  function store() {
    const s = getStore();
    if (!s) throw new Error('localStorage unavailable');
    return s;
  }

  // Returns { status: 'none' | 'ok' | 'corrupt' | 'blocked', data? }.
  function load() {
    let raw;
    try {
      raw = store().getItem(STORAGE_KEY);
    } catch {
      return { status: 'blocked' };
    }
    if (raw === null || raw === undefined) return { status: 'none' };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== SCHEMA_VERSION || typeof parsed.form !== 'object' || parsed.form === null
        || !Array.isArray(parsed.rows) || !parsed.rows.every((r) => r && typeof r === 'object')) {
        throw new Error('unexpected shape');
      }
      return { status: 'ok', data: { form: parsed.form, rows: parsed.rows } };
    } catch {
      // Corrupt saved data is skipped and removed.
      try { store().removeItem(STORAGE_KEY); } catch { /* ignore */ }
      return { status: 'corrupt' };
    }
  }

  // Returns true when saved.
  function save({ form, rows }) {
    try {
      store().setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, form, rows }));
      return true;
    } catch {
      return false;
    }
  }

  // Returns true when cleared (or nothing to clear).
  function clear() {
    try {
      store().removeItem(STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  return { load, save, clear };
}
