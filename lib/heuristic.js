'use strict';

// Ostatnia deska ratunku dla programów, których nie zna żadna reguła.
// Nie orzeka pewności — oznacza komendę jako podejrzaną, do obejrzenia przez człowieka.

const VERBS = {
  destroy: 3, delete: 3, del: 3, remove: 2, rm: 3, purge: 3, prune: 3,
  revoke: 3, drop: 3, wipe: 3, erase: 3, flush: 3, truncate: 3, expunge: 3,
  uninstall: 3, forget: 2, strip: 2, yank: 3, deprecate: 2, vacuum: 2,
  shutdown: 3, reboot: 3, poweroff: 3, halt: 3, kill: 2, reset: 2,
  overwrite: 3, format: 3, rollback: 2, downgrade: 2, terminate: 3,
};

const FLAGS = {
  '--force': 1, '-f': 1, '--purge': 2, '--prune': 2, '--delete': 3,
  '--all': 1, '--recursive': 1, '--recurse': 1, '-r': 1, '-R': 1,
  '--hard': 2, '--no-preserve-root': 3, '--expunge': 2, '--drop': 3,
  '--auto-approve': 2, '--yes': 0, '-y': 0, '--prefix': 1,
};

const RISKY_TARGETS = [
  { re: /^\/dev\//, weight: 3, key: 'device' },
  { re: /^\/(etc|boot|usr|var|System|Library)($|\/)/, weight: 2, key: 'system-path' },
  { re: /^~\/\.(ssh|aws|gnupg|kube|config)($|\/)/, weight: 2, key: 'credentials' },
  { re: /^(s3|gs|az):\/\//, weight: 2, key: 'remote-store' },
  { re: /:\//, weight: 1, key: 'remote-host' },
];

const PROD_HINT = /\b(prod|production|live|master|main)\b/;

// programy, dla których czasownik destrukcyjny jest normalną, odwracalną pracą
const BENIGN_CONTEXT = new Set([
  'grep', 'rg', 'ag', 'ack', 'sed', 'awk', 'echo', 'printf', 'cat', 'less',
  'man', 'help', 'jq', 'yq', 'sort', 'comm', 'diff', 'git', 'tsc', 'eslint',
]);

const PATHLIKE = /[/\\]|\.[a-z0-9]{1,4}$/i;

// rozbija token na człony, ale tylko gdy nie wygląda na ścieżkę ani nazwę pliku
function verbParts(tok) {
  if (PATHLIKE.test(tok)) return [];
  const parts = tok.toLowerCase().split(/[:._-]+/).filter((x) => x.length > 2);
  return parts.length > 1 ? parts : [];
}

function scan(ctx) {
  if (BENIGN_CONTEXT.has(ctx.name)) return null;

  const signals = [];
  let score = 0;

  for (let i = 1; i < ctx.argv.length; i++) {
    const tok = ctx.argv[i];
    const bare = tok.replace(/^--?/, '').split('=')[0].toLowerCase();

    if (!tok.startsWith('-') && VERBS[bare] !== undefined) {
      score += VERBS[bare];
      signals.push({ kind: 'verb', word: bare });
      continue;
    }
    if (!tok.startsWith('-')) {
      const part = verbParts(tok).find((x) => VERBS[x] !== undefined);
      if (part) {
        score += VERBS[part];
        signals.push({ kind: 'verb', word: part });
        continue;
      }
    }
    if (tok.startsWith('-')) {
      let w = FLAGS[tok] !== undefined ? FLAGS[tok] : VERBS[bare] !== undefined ? VERBS[bare] : null;
      if (w === null) {
        const stem = Object.keys(VERBS).find((v) => bare.startsWith(v + '-') || bare === v);
        if (stem) w = VERBS[stem];
      }
      if (w !== null) {
        score += w;
        if (w > 0) signals.push({ kind: 'flag', word: tok });
      }
      continue;
    }
    for (const t of RISKY_TARGETS) {
      if (t.re.test(tok)) {
        score += t.weight;
        signals.push({ kind: 'target', word: t.key });
        break;
      }
    }
  }

  // nazwa programu sama w sobie bywa czasownikiem: shutdown, reboot, lvremove, userdel
  const nameBare = ctx.name.toLowerCase();
  if (VERBS[nameBare] !== undefined) {
    score += VERBS[nameBare];
    signals.push({ kind: 'verb', word: nameBare });
  } else {
    const suffix = Object.keys(VERBS).find(
      (v) => v.length >= 3 && nameBare.length > v.length && nameBare.endsWith(v)
    );
    if (suffix) {
      score += VERBS[suffix];
      signals.push({ kind: 'verb', word: suffix });
    }
  }

  if (PROD_HINT.test(ctx.raw) && score > 0) {
    score += 1;
    signals.push({ kind: 'prod', word: 'prod' });
  }

  if (score < 2 || signals.length === 0) return null;

  const primary =
    signals.find((s) => s.kind === 'verb') ||
    signals.find((s) => s.kind === 'target') ||
    signals[0];

  return { score, signals, primary };
}

module.exports = { scan, VERBS };
