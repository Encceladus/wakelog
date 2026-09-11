'use strict';

const OPERATORS = ['&&', '||', ';;', ';', '|&', '|', '&', '\n'];

function isOperatorAt(src, i) {
  // the & in 2>&1, &>file or >&2 belongs to the redirect, it is not an operator
  if (src[i] === '&') {
    const prev = src[i - 1];
    const next = src[i + 1];
    if (prev === '>' || prev === '<') return null;
    if (next === '>' || /\d/.test(next || '')) return null;
  }
  for (const op of OPERATORS) {
    if (src.startsWith(op, i)) return op;
  }
  return null;
}

function splitSegments(src) {
  const segments = [];
  let buf = '';
  let i = 0;
  let quote = null;
  let depth = 0;

  const flush = () => {
    if (buf.trim()) segments.push(buf.trim());
    buf = '';
  };

  while (i < src.length) {
    const c = src[i];

    if (quote) {
      buf += c;
      if (c === '\\' && quote === '"' && i + 1 < src.length) {
        buf += src[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }

    if (c === '\\' && i + 1 < src.length) {
      buf += c + src[i + 1];
      i += 2;
      continue;
    }

    if (c === '#' && (buf === '' || /\s$/.test(buf))) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    if (c === "'" || c === '"') {
      quote = c;
      buf += c;
      i++;
      continue;
    }

    if (src.startsWith('$(', i)) {
      depth++;
      buf += '$(';
      i += 2;
      continue;
    }
    if (c === '(' ) { depth++; buf += c; i++; continue; }
    if (c === ')') { if (depth > 0) depth--; buf += c; i++; continue; }

    if (depth === 0) {
      const op = isOperatorAt(src, i);
      if (op) {
        flush();
        i += op.length;
        continue;
      }
    }

    buf += c;
    i++;
  }
  flush();
  return segments;
}

function splitWords(segment) {
  const words = [];
  let buf = '';
  let quote = null;
  let quoted = false;
  let i = 0;
  let depth = 0;

  const flush = () => {
    if (buf !== '') words.push({ raw: buf, quoted });
    buf = '';
    quoted = false;
  };

  while (i < segment.length) {
    const c = segment[i];

    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < segment.length) {
        buf += c + segment[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) { quote = null; i++; continue; }
      buf += c;
      i++;
      continue;
    }

    if (c === '\\' && i + 1 < segment.length) {
      buf += segment[i + 1];
      i += 2;
      continue;
    }

    if (c === "'" || c === '"') { quote = c; quoted = true; i++; continue; }

    if (segment.startsWith('$(', i)) { depth++; buf += '$('; i += 2; continue; }
    if (c === '(') { depth++; buf += c; i++; continue; }
    if (c === ')') { if (depth > 0) depth--; buf += c; i++; continue; }

    if (depth === 0 && /\s/.test(c)) { flush(); i++; continue; }

    buf += c;
    i++;
  }
  flush();
  return words;
}

const VAR_RE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?|\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-=+?])([^}]*)\}/g;

function scanVariables(raw) {
  const found = [];
  let m;
  const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-=+?])([^}]*)\}|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = re.exec(raw)) !== null) {
    if (m[1] !== undefined) {
      found.push({ name: m[1], hasDefault: true, defaultValue: m[3] });
    } else {
      found.push({ name: m[4] || m[5], hasDefault: false, defaultValue: null });
    }
  }
  return found;
}

function extractSubstitutions(raw) {
  const out = [];
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith('$(', i)) {
      let depth = 1;
      let j = i + 2;
      while (j < raw.length && depth > 0) {
        if (raw.startsWith('$(', j)) { depth++; j += 2; continue; }
        if (raw[j] === '(') { depth++; j++; continue; }
        if (raw[j] === ')') { depth--; j++; continue; }
        j++;
      }
      out.push(raw.slice(i + 2, j - 1));
      i = j;
      continue;
    }
    if (raw[i] === '`') {
      const end = raw.indexOf('`', i + 1);
      if (end === -1) break;
      out.push(raw.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    i++;
  }
  return out;
}

const REDIRECT_RE = /^\d*(>>|>|<<<|<<|<|&>)$/;

function parseSimple(segment) {
  const words = splitWords(segment);
  const argv = [];
  const redirects = [];
  const assignments = [];
  let sawCommand = false;

  for (let i = 0; i < words.length; i++) {
    const w = words[i].raw;

    const redirMatch = w.match(/^(\d*(?:>>|>|<<<|<<|<|&>))(.*)$/);
    if (redirMatch && REDIRECT_RE.test(redirMatch[1])) {
      const target = redirMatch[2] || (words[i + 1] ? words[++i].raw : '');
      redirects.push({ op: redirMatch[1], target });
      continue;
    }

    if (!sawCommand && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      assignments.push(w);
      continue;
    }

    sawCommand = true;
    argv.push(w);
  }

  return { argv, redirects, assignments, words };
}

function tokenize(command) {
  const results = [];
  const seen = new Set();

  function walk(src, nested) {
    for (const segment of splitSegments(src)) {
      const parsed = parseSimple(segment);
      if (parsed.argv.length === 0 && parsed.assignments.length === 0) continue;

      const raw = segment;
      const key = raw + '|' + nested;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          raw,
          argv: parsed.argv,
          redirects: parsed.redirects,
          assignments: parsed.assignments,
          nested,
          variables: scanVariables(raw),
        });
      }

      for (const w of [...parsed.argv, ...parsed.assignments]) {
        for (const sub of extractSubstitutions(w)) walk(sub, true);
      }
      for (const r of parsed.redirects) {
        for (const sub of extractSubstitutions(r.target)) walk(sub, true);
      }
    }
  }

  walk(command, false);
  return results;
}

module.exports = { tokenize, splitSegments, splitWords, scanVariables, extractSubstitutions };
