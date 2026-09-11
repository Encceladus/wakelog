'use strict';

function depth() {
  if (process.env.NO_COLOR) return 0;
  if (process.env.FORCE_COLOR) return Number(process.env.FORCE_COLOR) || 3;
  if (!process.stdout.isTTY) return 0;
  const term = process.env.TERM || '';
  if (term === 'dumb') return 0;
  const ct = (process.env.COLORTERM || '').toLowerCase();
  if (ct === 'truecolor' || ct === '24bit') return 3;
  if (/-256(color)?$/.test(term)) return 2;
  return 1;
}

const DEPTH = depth();

const PALETTE = {
  danger: { 3: [217, 106, 106], 2: 174, 1: 31 },
  warn: { 3: [201, 156, 92], 2: 179, 1: 33 },
  ok: { 3: [126, 163, 122], 2: 108, 1: 32 },
  accent: { 3: [130, 160, 190], 2: 110, 1: 36 },
  faint: { 3: [122, 122, 118], 2: 244, 1: 90 },
  fainter: { 3: [92, 92, 88], 2: 240, 1: 90 },
};

function wrap(name, s) {
  if (DEPTH === 0) return s;
  const spec = PALETTE[name];
  if (!spec) return s;
  if (DEPTH >= 3) {
    const [r, g, b] = spec[3];
    return `\u001b[38;2;${r};${g};${b}m${s}\u001b[39m`;
  }
  if (DEPTH === 2) return `\u001b[38;5;${spec[2]}m${s}\u001b[39m`;
  return `\u001b[${spec[1]}m${s}\u001b[39m`;
}

const bold = (s) => (DEPTH === 0 ? s : `\u001b[1m${s}\u001b[22m`);
const dim = (s) => (DEPTH === 0 ? s : wrap('faint', s));
const dimmer = (s) => (DEPTH === 0 ? s : wrap('fainter', s));

function stripAnsi(s) {
  return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function visibleLength(s) {
  return stripAnsi(s).length;
}

module.exports = {
  DEPTH,
  bold,
  dim,
  dimmer,
  danger: (s) => wrap('danger', s),
  warn: (s) => wrap('warn', s),
  ok: (s) => wrap('ok', s),
  accent: (s) => wrap('accent', s),
  stripAnsi,
  visibleLength,
};
