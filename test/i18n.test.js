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
assert.ok(en.includes('irreversible'), 'domyślnie angielski');
assert.ok(en.includes('ignored files'), 'angielski powód');

const pl = explain('git clean -fdx', { WAKELOG_LANG: 'pl' });
assert.ok(pl.includes('nieodwracalne'), 'WAKELOG_LANG=pl przełącza');
assert.ok(pl.includes('ignorowane'), 'polski powód');

const auto = explain('git clean -fdx', { LANG: 'pl_PL.UTF-8' });
assert.ok(auto.includes('nieodwracalne'), 'locale systemu wykryte');

const fallback = explain('git clean -fdx', { WAKELOG_LANG: 'de' });
assert.ok(fallback.includes('irreversible'), 'nieznany język spada na angielski');

const withVar = explain('rm -rf "$OUT"', {});
assert.ok(withVar.includes('$OUT'), 'parametr wstawiony w powód');

console.log('\n5/5 przeszło (i18n)');

const fs = require('fs');
const localesDir = path.join(__dirname, '..', 'locales');
const files = fs.readdirSync(localesDir).filter((f) => f.endsWith('.json'));
const base = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));

for (const f of files) {
  const dict = JSON.parse(fs.readFileSync(path.join(localesDir, f), 'utf8'));
  assert.ok(dict.pluralRule, `${f}: brak pluralRule`);
  for (const section of ['levels', 'reasons', 'ui']) {
    for (const key of Object.keys(base[section])) {
      if (dict[section][key] === undefined) continue;
      const a = base[section][key];
      const b = dict[section][key];
      assert.strictEqual(
        Array.isArray(a), Array.isArray(b),
        `${f}: ${section}.${key} ma inny kształt niż w en.json`
      );
    }
  }
  const extra = Object.keys(dict.reasons).filter((k) => base.reasons[k] === undefined);
  assert.deepStrictEqual(extra, [], `${f}: klucze spoza en.json: ${extra.join(', ')}`);
}

const { available } = require('../lib/i18n');
assert.ok(available().includes('en') && available().includes('pl'), 'wykrywanie locale');

console.log(`${files.length} ${files.length === 1 ? 'słownik' : 'słowniki'} spójne z en.json`);
