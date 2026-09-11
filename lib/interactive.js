'use strict';

const C = require('./color');

const ESC = '\u001b';
const KEY = {
  up: [`${ESC}[A`, `${ESC}OA`, 'k'],
  down: [`${ESC}[B`, `${ESC}OB`, 'j'],
  enter: ['\r', '\n'],
  back: [ESC, 'q', '\u0003', '\u0004'],
};

function match(seq, list) {
  return list.includes(seq);
}

function hide() {
  process.stdout.write(`${ESC}[?25l`);
}
function show() {
  process.stdout.write(`${ESC}[?25h`);
}
function clearLines(n) {
  if (n > 0) process.stdout.write(`${ESC}[${n}A${ESC}[0J`);
}

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.WAKELOG_NO_TTY);
}

/**
 * items: [{ label, hint, group }]
 * onSelect(index) -> string | null   (body to display; null means nothing to show)
 */
function select(items, { title, footer, backHint, onSelect }) {
  return new Promise((resolve) => {
    let cursor = 0;
    let drawn = 0;
    let viewing = false;

    const lines = () => {
      const out = [];
      if (title) out.push('  ' + C.bold(title));
      let lastGroup = null;
      items.forEach((it, i) => {
        if (it.group !== lastGroup) {
          out.push('');
          out.push('  ' + C.dim(it.group));
          lastGroup = it.group;
        }
        const active = i === cursor;
        const mark = active ? C.accent('›') : ' ';
        const label = active ? C.bold(it.label) : it.label;
        const hint = it.hint ? '  ' + C.dimmer(it.hint) : '';
        out.push(`  ${mark} ${label}${hint}`);
      });
      out.push('');
      out.push('  ' + C.dimmer(footer));
      return out;
    };

    const draw = () => {
      clearLines(drawn);
      const l = lines();
      process.stdout.write(l.join('\n') + '\n');
      drawn = l.length;
    };

    const finish = (value) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      show();
      resolve(value);
    };

    const onData = (seq) => {
      if (viewing) {
        viewing = false;
        drawn = 0;
        process.stdout.write(`${ESC}[2J${ESC}[H`);
        draw();
        return;
      }
      if (match(seq, KEY.up)) {
        cursor = (cursor - 1 + items.length) % items.length;
        draw();
        return;
      }
      if (match(seq, KEY.down)) {
        cursor = (cursor + 1) % items.length;
        draw();
        return;
      }
      if (match(seq, KEY.enter)) {
        const body = onSelect(cursor);
        if (body) {
          process.stdout.write(`${ESC}[2J${ESC}[H`);
          process.stdout.write(body + '\n');
          process.stdout.write('  ' + C.dimmer(backHint) + '\n');
          viewing = true;
        }
        return;
      }
      if (match(seq, KEY.back)) {
        clearLines(drawn);
        finish(null);
      }
    };

    hide();
    draw();
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.on('exit', show);
  });
}

module.exports = { select, isInteractive };
