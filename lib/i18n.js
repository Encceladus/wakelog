'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const FALLBACK = 'en';

const PLURAL_RULES = {
  en: (n) => (n === 1 ? 0 : 1),
  pl: (n) => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (n === 1) return 0;
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 1;
    return 2;
  },
};

function available() {
  try {
    return fs
      .readdirSync(LOCALES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [FALLBACK];
  }
}

function load(code) {
  try {
    return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), 'utf8'));
  } catch {
    return null;
  }
}

// English is the default everywhere. Another language is opt-in through
// WAKELOG_LANG, never inferred from the system locale.
function detectLang() {
  const explicit = process.env.WAKELOG_LANG;
  return explicit ? explicit.slice(0, 2).toLowerCase() : FALLBACK;
}

const requested = detectLang();
const LANG = available().includes(requested) ? requested : FALLBACK;

const DICT = load(LANG) || load(FALLBACK) || { levels: {}, reasons: {}, ui: {} };
const BASE = LANG === FALLBACK ? DICT : load(FALLBACK) || DICT;

const pluralIndex = PLURAL_RULES[DICT.pluralRule] || PLURAL_RULES[FALLBACK];

function interpolate(template, params) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
    params && params[key] !== undefined ? String(params[key]) : whole
  );
}

function pick(section, key) {
  const local = DICT[section] && DICT[section][key];
  if (local !== undefined) return { value: local, native: true };
  const base = BASE[section] && BASE[section][key];
  return base !== undefined ? { value: base, native: false } : null;
}

function levelLabel(level) {
  const found = pick('levels', String(level));
  return found ? found.value : String(level);
}

function reason(key, params) {
  if (!key) return null;
  const found = pick('reasons', key);
  return found ? interpolate(found.value, params) : null;
}

function ui(key, arg) {
  const found = pick('ui', key);
  if (!found) return key;
  const { value, native } = found;
  if (Array.isArray(value)) {
    const rule = native ? pluralIndex : PLURAL_RULES[FALLBACK];
    const n = typeof arg === 'number' ? arg : 0;
    const idx = Math.min(rule(n), value.length - 1);
    return interpolate(value[idx], { n });
  }
  return interpolate(value, { n: arg });
}

module.exports = { LANG, levelLabel, reason, ui, available };
