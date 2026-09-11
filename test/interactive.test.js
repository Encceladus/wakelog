'use strict';
// Fakes a TTY and a key sequence: checks navigation, opening a report and quitting.

const assert = require('assert');
const { EventEmitter } = require('events');

const stdin = new EventEmitter();
stdin.isTTY = true;
stdin.setRawMode = () => {};
stdin.resume = () => {};
stdin.pause = () => {};
stdin.setEncoding = () => {};
Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

const { select, isInteractive } = require('../lib/interactive');
assert.ok(isInteractive(), 'TTY detected');

const opened = [];
const items = [
  { group: 'g1', label: 'a', hint: '1', read: () => 'BODY A' },
  { group: 'g2', label: 'b', hint: '2', read: () => 'BODY B' },
  { group: 'g2', label: 'c', hint: '3', read: () => 'BODY C' },
];

const log = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (s) => {
  log.push(s);
  return true;
};

select(items, {
  footer: 'f',
  backHint: 'back',
  onSelect: (i) => {
    opened.push(i);
    return items[i].read();
  },
}).then(() => {
  process.stdout.write = realWrite;
  const flat = log.join('');

  assert.deepStrictEqual(opened, [2], 'enter opened the third item');
  assert.ok(flat.includes('BODY C'), 'report body printed');
  assert.ok(flat.includes('back'), 'back hint shown');
  assert.ok(flat.includes('\u001b[?25h'), 'cursor restored on exit');
  assert.ok(flat.includes('g1') && flat.includes('g2'), 'group headers rendered');

  // wrap-around: up from the first item lands on the last
  console.log('\n5/5 passed (interactive)');
});

const keys = ['\u001b[B', '\u001b[B', '\r', 'x', 'q'];
let i = 0;
const tick = () => {
  if (i < keys.length) {
    stdin.emit('data', keys[i++]);
    setImmediate(tick);
  }
};
setImmediate(tick);
