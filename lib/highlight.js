'use strict';

const C = require('./color');

const DESTRUCTIVE_WORDS = /^(rm|drop|truncate|destroy|delete|clean|prune|flush|shred|unpublish|revoke)$/i;
const DESTRUCTIVE_FLAGS = /^(--force|--force-with-lease|--hard|--delete|--purge|--no-preserve-root|--auto-approve|-[a-zA-Z]*f[a-zA-Z]*)$/;
const SQL_KEYWORDS = /\b(DROP|TRUNCATE|DELETE|ALTER|CREATE|INSERT|UPDATE)\b/g;

function tokenizeForDisplay(s) {
  const tokens = [];
  let buf = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      buf += ch;
      if (ch === quote) {
        tokens.push(buf);
        buf = '';
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (buf) tokens.push(buf);
      buf = ch;
      quote = ch;
      continue;
    }
    if (ch === ' ') {
      if (buf) tokens.push(buf);
      tokens.push(' ');
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

function paintQuoted(tok, paint) {
  const inner = tok.slice(1, -1);
  if (!SQL_KEYWORDS.test(inner)) {
    SQL_KEYWORDS.lastIndex = 0;
    return C.dim(tok);
  }
  SQL_KEYWORDS.lastIndex = 0;
  const marked = inner.replace(SQL_KEYWORDS, (kw) =>
    /^(DROP|TRUNCATE|DELETE)$/i.test(kw) ? paint(C.bold(kw)) : kw
  );
  return C.dim(tok[0]) + marked + C.dim(tok[tok.length - 1]);
}

function highlight(command, level) {
  const paint = level === 1 ? C.danger : level === 2 ? C.warn : (s) => s;
  const tokens = tokenizeForDisplay(command);
  let sawProgram = false;
  let out = '';

  for (const tok of tokens) {
    if (tok === ' ') {
      out += ' ';
      continue;
    }
    if (tok[0] === '"' || tok[0] === "'") {
      out += paintQuoted(tok, paint);
      continue;
    }
    if (!sawProgram && !tok.startsWith('-')) {
      sawProgram = true;
      out += C.bold(tok);
      continue;
    }
    if (tok.startsWith('-')) {
      out += DESTRUCTIVE_FLAGS.test(tok) ? paint(C.bold(tok)) : C.dim(tok);
      continue;
    }
    if (DESTRUCTIVE_WORDS.test(tok)) {
      out += paint(C.bold(tok));
      continue;
    }
    if (tok.startsWith('$')) {
      out += C.accent(tok);
      continue;
    }
    if (/[/~.]/.test(tok)) {
      out += C.dim(tok);
      continue;
    }
    out += tok;
  }
  return out;
}

module.exports = { highlight };
