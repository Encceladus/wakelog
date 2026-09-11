'use strict';

const { classify, LEVEL_LABELS } = require('./classify');
const i18n = require('./i18n');
const C = require('./color');
const { highlight } = require('./highlight');

const WIDTH = Math.min(Math.max((process.stdout.columns || 76) - 4, 52), 76);
const GUTTER = '  ';
const MARK_W = 9;

function fmtDuration(ms) {
  if (!ms || ms < 60000) return null;
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function squash(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function elide(s, max) {
  const flat = squash(s);
  if (flat.length <= max) return flat;
  const tail = Math.min(20, Math.floor((max - 1) / 2));
  const head = max - 1 - tail;
  return flat.slice(0, head) + '\u2026' + flat.slice(flat.length - tail);
}

function wrapText(text, max) {
  const words = squash(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > max) {
      lines.push(line);
      line = w;
    } else {
      line = line ? line + ' ' + w : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function proportionBar(buckets, total, width) {
  if (total === 0) return C.dim('\u2500'.repeat(width));
  const counts = [
    buckets[1].length + buckets.suspect.length,
    buckets[2].length,
    buckets[3].length + buckets[4].length,
  ];
  const widths = counts.map((n) => Math.round((n / total) * width));
  let drift = width - widths.reduce((a, b) => a + b, 0);
  for (let i = widths.length - 1; i >= 0 && drift !== 0; i--) {
    if (widths[i] === 0 && drift < 0) continue;
    widths[i] += drift > 0 ? 1 : -1;
    drift += drift > 0 ? -1 : 1;
  }
  return (
    C.danger('\u2588'.repeat(Math.max(0, widths[0]))) +
    C.warn('\u2593'.repeat(Math.max(0, widths[1]))) +
    C.dimmer('\u2591'.repeat(Math.max(0, widths[2])))
  );
}

function timeline(scored, width) {
  const stamped = scored.filter((s) => s.entry.at);
  if (stamped.length < 2) return null;
  const times = stamped.map((s) => new Date(s.entry.at).getTime());
  const start = Math.min(...times);
  const end = Math.max(...times);
  if (end - start < 60000) return null;

  const inner = width - 14;
  if (inner < 12) return null;

  const slots = new Array(inner).fill(0);
  for (const s of stamped) {
    if (s.result.level > 2) continue;
    const t = new Date(s.entry.at).getTime();
    const pos = Math.min(inner - 1, Math.round(((t - start) / (end - start)) * (inner - 1)));
    slots[pos] = Math.min(slots[pos] || 9, s.result.level);
  }

  if (!slots.some((v) => v === 1 || v === 2)) return null;

  const track = slots
    .map((v) => (v === 1 ? C.danger('\u25cf') : v === 2 ? C.warn('\u25cb') : C.dimmer('\u2500')))
    .join('');

  return C.dim(fmtTime(start)) + ' ' + C.dimmer('\u251c') + track + C.dimmer('\u2524') + ' ' + C.dim(fmtTime(end));
}

function buildReport(entries) {
  const scored = entries.map((e) => ({ entry: e, result: classify(e.command) }));
  const buckets = { 1: [], suspect: [], 2: [], 3: [], 4: [] };
  for (const s of scored) {
    if (s.result.level === 1 && s.result.suspect) buckets.suspect.push(s);
    else buckets[s.result.level].push(s);
  }
  return { scored, buckets };
}

function render(entries, meta = {}) {
  const { scored, buckets } = buildReport(entries);
  const out = [];
  const push = (s) => out.push(s === '' ? '' : GUTTER + s);

  const total = scored.length;
  const attention = buckets[1].length + buckets.suspect.length + buckets[2].length;
  const times = entries.map((e) => e.at).filter(Boolean).sort();
  const duration =
    times.length >= 2 ? fmtDuration(new Date(times[times.length - 1]) - new Date(times[0])) : null;

  const head =
    C.bold('wakelog') +
    C.dimmer('  \u00b7  ') +
    [duration, i18n.ui('commands', total)].filter(Boolean).join(C.dimmer('  \u00b7  '));

  push('');
  push(head);
  push(proportionBar(buckets, total, WIDTH));
  push('');

  const section = (level, mark, paint, labelOverride) => {
    const items = buckets[level];
    if (items.length === 0) return;

    const label = labelOverride || LEVEL_LABELS[level];
    const count = String(items.length);
    const pad = Math.max(1, WIDTH - label.length - count.length);
    push(paint(label) + C.dimmer('\u00b7'.repeat(pad - 1)) + ' ' + paint(C.bold(count)));
    push('');

    for (const { entry, result } of items) {
      const time = entry.at ? fmtTime(entry.at) : '     ';
      const cmd = highlight(elide(entry.command, WIDTH - MARK_W), level === 'suspect' ? 1 : level);
      push(paint(mark) + ' ' + C.dim(time) + '  ' + cmd);
      if (result.reasons[0]) {
        for (const line of wrapText(result.reasons[0], WIDTH - MARK_W)) {
          push(' '.repeat(MARK_W) + C.dim(line));
        }
      }
      push('');
    }
  };

  section(1, '\u25cf', C.danger);
  section('suspect', '\u25d0', C.danger, i18n.ui('suspectLabel'));
  section(2, '\u25cb', C.warn);

  if (attention === 0) {
    push(C.ok('\u2713') + ' ' + C.dim(i18n.ui('clean')));
    push('');
  }

  const strip = timeline(scored, WIDTH);
  if (out[out.length - 1] !== '') push('');
  if (strip) {
    push(strip);
  } else {
    push(C.dimmer('\u2500'.repeat(WIDTH)));
  }

  const rest = buckets[3].length + buckets[4].length;
  const parts = [];
  if (buckets[4].length) parts.push(i18n.ui('reads', buckets[4].length));
  if (buckets[3].length) parts.push(i18n.ui('gitChanges', buckets[3].length));
  if (rest > 0) {
    push(C.dim(i18n.ui('skipped', rest)) + C.dimmer('   ' + parts.join(' \u00b7 ')));
  }

  if (meta.gitDirty) push(C.dim(i18n.ui('uncommitted', meta.gitDirty)));

  push('');
  return out.join('\n');
}

module.exports = { render, buildReport };
