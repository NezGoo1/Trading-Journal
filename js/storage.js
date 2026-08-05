/* ============================================================
   storage.js — persistence + small utilities
   All data lives in localStorage on the user's device.
   ============================================================ */

const Store = (() => {
  const TRADES_KEY = 'tj_trades_v1';
  const SETTINGS_KEY = 'tj_settings_v1';

  const defaultSettings = {
    currency: 'USD',
    startingBalance: 10000,
  };

  function _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('Read failed', key, e);
      return fallback;
    }
  }

  function _write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Write failed', key, e);
      return false;
    }
  }

  function getTrades() {
    const t = _read(TRADES_KEY, []);
    return Array.isArray(t) ? t : [];
  }

  function saveTrades(trades) {
    return _write(TRADES_KEY, trades);
  }

  function upsertTrade(trade) {
    const trades = getTrades();
    if (trade.id) {
      const idx = trades.findIndex((t) => t.id === trade.id);
      if (idx >= 0) {
        trades[idx] = trade;
      } else {
        trades.push(trade);
      }
    } else {
      trade.id = genId();
      trades.push(trade);
    }
    saveTrades(trades);
    return trade;
  }

  function deleteTrade(id) {
    const trades = getTrades().filter((t) => t.id !== id);
    saveTrades(trades);
  }

  function getSettings() {
    return Object.assign({}, defaultSettings, _read(SETTINGS_KEY, {}));
  }

  function saveSettings(patch) {
    const next = Object.assign({}, getSettings(), patch);
    _write(SETTINGS_KEY, next);
    return next;
  }

  function replaceAll(trades, settings) {
    if (Array.isArray(trades)) saveTrades(trades);
    if (settings) _write(SETTINGS_KEY, Object.assign({}, defaultSettings, settings));
  }

  function clearAll() {
    localStorage.removeItem(TRADES_KEY);
  }

  function genId() {
    return 'tr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return {
    getTrades, saveTrades, upsertTrade, deleteTrade,
    getSettings, saveSettings, replaceAll, clearAll, genId,
  };
})();

/* -------------------- Formatting helpers -------------------- */
const Fmt = (() => {
  function currencySymbol(code) {
    const map = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'C$', AUD: 'A$', INR: '₹', CHF: 'Fr', CNY: '¥' };
    return map[code] || (code ? code + ' ' : '$');
  }

  function money(n, opts = {}) {
    const s = Store.getSettings();
    const sym = currencySymbol(s.currency);
    const val = Number(n) || 0;
    const abs = Math.abs(val);
    const decimals = opts.decimals != null ? opts.decimals : (abs >= 1000 ? 0 : 2);
    const str = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const sign = val < 0 ? '-' : (opts.signed && val > 0 ? '+' : '');
    return `${sign}${sym}${str}`;
  }

  function compactMoney(n) {
    const s = Store.getSettings();
    const sym = currencySymbol(s.currency);
    const val = Number(n) || 0;
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '+';
    let body;
    if (abs >= 1000) body = (abs / 1000).toFixed(abs >= 10000 ? 0 : 1) + 'k';
    else body = Math.round(abs).toString();
    if (val === 0) return sym + '0';
    return `${sign}${sym}${body}`;
  }

  function pct(n, decimals = 1) {
    const v = Number(n) || 0;
    return v.toFixed(decimals) + '%';
  }

  function num(n, decimals = 2) {
    return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  return { money, compactMoney, pct, num, currencySymbol };
})();

/* -------------------- Date helpers (local-time safe) -------------------- */
const DateUtil = (() => {
  // Store dates as 'YYYY-MM-DD'. Parse into a local Date at noon to avoid TZ rollover.
  function parse(ymd) {
    if (!ymd) return null;
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  function toYMD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function today() { return toYMD(new Date()); }
  function monthName(monthIdx) {
    return ['January','February','March','April','May','June','July','August','September','October','November','December'][monthIdx];
  }
  function shortMonth(monthIdx) {
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][monthIdx];
  }
  function prettyDate(ymd) {
    const d = parse(ymd);
    if (!d) return '';
    return `${shortMonth(d.getMonth())} ${d.getDate()}, ${d.getFullYear()}`;
  }
  function weekdayShort(dateOrYmd) {
    const d = typeof dateOrYmd === 'string' ? parse(dateOrYmd) : dateOrYmd;
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  }
  return { parse, toYMD, today, monthName, shortMonth, prettyDate, weekdayShort };
})();
