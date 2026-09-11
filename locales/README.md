# Translations

One JSON file per language, named by its two-letter code. Adding a language means dropping a file here — no code changes.

## Adding one

1. Copy `en.json` to `<code>.json`.
2. Translate the values. Leave the keys alone.
3. Set `pluralRule` to a rule implemented in `lib/i18n.js` (`en` = 2 forms, `pl` = 3). If your language needs a different rule, add it there.
4. Run `npm test` — it checks every file against `en.json` for shape and stray keys.

## Rules

- `reasons` values may contain `${name}`, filled in from the command itself.
- `ui` values may contain `{n}`. Where a count varies the wording, use an array with one entry per plural form, ordered to match your `pluralRule`.
- Missing keys fall back to English individually, so a partial translation is fine and ships without breaking anything.

`WAKELOG_LANG=<code>` forces a language; otherwise it follows the system locale and falls back to English.
