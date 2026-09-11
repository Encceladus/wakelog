'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const cli = path.join(__dirname, '..', 'bin', 'cli.js');

function explain(command, env) {
  return execFileSync('node', [cli, 'explain', command], {
    encoding: 'utf8',
    env: { ...process.env, WAKELOG_LANG: '', LANG: '', LC_ALL: '', ...env },
  });
}

const en = explain('git clean -fdx', {});
assert.ok(en.includes('irreversible'), 'English is the default');
assert.ok(en.includes('ignored files'), 'English reason');

const pl = explain('git clean -fdx', { WAKELOG_LANG: 'pl' });
assert.ok(pl.includes('nieodwracalne'), 'WAKELOG_LANG=pl switches');
assert.ok(pl.includes('ignorowane'), 'Polish reason');

const ignoresLocale = explain('git clean -fdx', { LANG: 'pl_PL.UTF-8' });
assert.ok(ignoresLocale.includes('irreversible'), 'system locale does not switch the language');

const fallback = explain('git clean -fdx', { WAKELOG_LANG: 'de' });
assert.ok(fallback.includes('irreversible'), 'unknown language falls back to English');

const withVar = explain('rm -rf "$OUT"', {});
assert.ok(withVar.includes('$OUT'), 'parameter interpolated into the reason');

console.log('\n5/5 passed (i18n)');

const fs = require('fs');
const localesDir = path.join(__dirname, '..', 'locales');
const files = fs.readdirSync(localesDir).filter((f) => f.endsWith('.json'));
const base = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));

for (const f of files) {
  const dict = JSON.parse(fs.readFileSync(path.join(localesDir, f), 'utf8'));
  assert.ok(dict.pluralRule, `${f}: missing pluralRule`);
  for (const section of ['levels', 'reasons', 'ui']) {
    for (const key of Object.keys(base[section])) {
      if (dict[section][key] === undefined) continue;
      const a = base[section][key];
      const b = dict[section][key];
      assert.strictEqual(
        Array.isArray(a), Array.isArray(b),
        `${f}: ${section}.${key} has a different shape than en.json`
      );
    }
  }
  const extra = Object.keys(dict.reasons).filter((k) => base.reasons[k] === undefined);
  assert.deepStrictEqual(extra, [], `${f}: keys not present in en.json: ${extra.join(', ')}`);
}

const { available } = require('../lib/i18n');
assert.ok(available().includes('en') && available().includes('pl'), 'locale discovery');

console.log(`${files.length} locale file(s) consistent with en.json`);
