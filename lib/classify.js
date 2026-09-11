'use strict';

const { tokenize } = require('./tokenize');
const i18n = require('./i18n');
const rules = require('./rules');
const heuristic = require('./heuristic');

const L1 = 1;
const L2 = 2;
const L3 = 3;
const L4 = 4;

const DISPOSABLE = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)(dist|build|out|target|coverage)(\/|$)/,
  /(^|\/)\.(next|nuxt|turbo|parcel-cache|pytest_cache|mypy_cache|gradle)(\/|$)/,
  /(^|\/)__pycache__(\/|$)/,
  /(^|\/)\.venv(\/|$)/,
  /^\/tmp\//,
  /\.pyc$/,
  /\.log$/,
];

const OUTSIDE_PROJECT = [
  /^~($|\/)/,
  /^\$HOME($|\/)/,
  /^\/etc($|\/)/,
  /^\/usr($|\/)/,
  /^\/var($|\/)/,
  /^\/boot($|\/)/,
  /^\/dev($|\/)/,
  /^\/Library($|\/)/,
  /^\/System($|\/)/,
];

const NULL_SINKS = /^\/dev\/(null|zero|stdout|stderr|stdin|tty|urandom|random|fd\/\d+)$/;

const SECRETISH = /(^|\/)\.(env|npmrc|pypirc|netrc|aws|ssh|gnupg|kube|docker)(\/|$|\.)/;

function isFlag(a) {
  return a.startsWith('-');
}

function pickSub(argv, known) {
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('-')) continue;
    if (known.includes(a)) return { sub: a, at: i };
  }
  return { sub: null, at: -1 };
}

function positionals(argv) {
  return argv.slice(1).filter((a) => !isFlag(a));
}

function flagChars(argv) {
  const set = new Set();
  for (const a of argv.slice(1)) {
    if (/^-[A-Za-z]+$/.test(a)) {
      set.add(a);
      for (const ch of a.slice(1)) set.add(ch);
    }
    if (/^--/.test(a)) set.add(a.split('=')[0]);
  }
  return set;
}

function looksDisposable(p) {
  return DISPOSABLE.some((re) => re.test(p));
}

function looksOutsideProject(p) {
  if (NULL_SINKS.test(p)) return false;
  return OUTSIDE_PROJECT.some((re) => re.test(p));
}

function riskyVariable(cmd, target) {
  for (const v of cmd.variables) {
    if (!target.includes('$' + v.name) && !target.includes('${' + v.name)) continue;
    if (!v.hasDefault) return v.name;
    if (v.defaultValue === '' || v.defaultValue === '/') return v.name;
  }
  return null;
}

const SQL_DESTRUCTIVE = /\b(drop\s+(table|database|schema|index)|truncate\b|delete\s+from\b)/i;

function classifySimple(cmd) {
  const argv = cmd.argv;
  if (argv.length === 0) return null;

  const name = argv[0].split('/').pop();
  const sub = argv[1] && !isFlag(argv[1]) ? argv[1] : null;
  const flags = flagChars(argv);
  const pos = positionals(argv);
  const rawLower = cmd.raw.toLowerCase();

  const hit = (level, reason, tag, params) => ({ level, reason, tag, params });

  if (['npx', 'bunx', 'uvx', 'pnpx'].includes(name) && argv.length > 1) {
    const rest = argv.slice(1).filter((a) => !['-y', '--yes', '-q', '--quiet'].includes(a));
    if (rest.length) {
      const inner = classifySimple({ ...cmd, argv: rest });
      if (inner) return inner;
    }
  }

  if ((name === 'yarn' || name === 'pnpm') && argv[1] === 'dlx' && argv.length > 2) {
    const inner = classifySimple({ ...cmd, argv: argv.slice(2) });
    if (inner) return inner;
  }

  if (name === 'sudo' || name === 'doas') {
    const inner = { ...cmd, argv: argv.slice(1) };
    const innerRes = classifySimple(inner);
    if (innerRes && innerRes.level <= L2) return innerRes;
    return hit(L2, 'sudo', 'sudo');
  }

  if (name === 'rm') {
    for (const p of pos) {
      const bad = riskyVariable(cmd, p);
      if (bad) return hit(L1, 'rm-var', 'rm-var', { name: bad });
    }
    if (pos.some(looksOutsideProject)) return hit(L1, 'rm-outside', 'rm-outside');
    if (pos.some((p) => p === '/' || p === '/*')) return hit(L1, 'rm-root', 'rm-root');
    if (pos.every(looksDisposable) && pos.length > 0) return hit(L4, 'rm-artifacts', 'rm-artifacts');
    if (flags.has('r') || flags.has('R') || flags.has('--recursive')) return hit(L1, 'rm-rec', 'rm-rec');
    return hit(L1, 'rm', 'rm');
  }

  if (name === 'shred' || name === 'srm') return hit(L1, 'shred', 'shred');

  if (name === 'mv' || name === 'cp') {
    if (pos.some(looksOutsideProject)) return hit(L1, 'fs-outside', 'fs-outside');
    return hit(L3, null, 'fs');
  }

  if (name === 'git') {
    if (sub === 'push') {
      if (flags.has('--force') || flags.has('-f') || flags.has('--force-with-lease')) {
        return hit(L1, 'push-force', 'push-force');
      }
      if (flags.has('--delete') || flags.has('-d')) return hit(L1, 'push-delete', 'push-delete');
      return hit(L2, 'push', 'push');
    }
    if (sub === 'clean') {
      if (flags.has('x') || flags.has('X')) return hit(L1, 'clean-x', 'clean-x');
      return hit(L1, 'clean', 'clean');
    }
    if (sub === 'reset' && flags.has('--hard')) return hit(L3, null, 'reset-hard');
    if (sub === 'tag' && (flags.has('d') || flags.has('--delete'))) return hit(L2, 'tag-delete', 'tag-delete');
    if (sub === 'branch' && (flags.has('D') || flags.has('--delete'))) return hit(L3, null, 'branch-delete');
    if (sub === 'lfs' && argv[2] === 'prune') return hit(L1, 'git-prune', 'git-prune');
    if (sub === 'gc' && /--prune(=now)?/.test(cmd.raw)) return hit(L1, 'git-prune', 'git-prune');
    if (sub === 'reflog' && argv[2] === 'expire') return hit(L1, 'git-prune', 'git-prune');
    if (sub === 'stash' && (argv[2] === 'drop' || argv[2] === 'clear')) return hit(L1, 'git-stash-drop', 'git-stash-drop');
    if (sub === 'worktree' && argv[2] === 'remove') return hit(L2, 'git-worktree', 'git-worktree');
    if (sub === 'filter-branch' || rawLower.includes('filter-repo')) {
      return hit(L1, 'filter', 'filter');
    }
    if (['status', 'log', 'diff', 'show', 'branch', 'remote', 'rev-parse', 'ls-files', 'blame',
         'fetch', 'ls-remote', 'cat-file', 'rev-list', 'shortlog', 'describe', 'grep',
         'whatchanged', 'count-objects', 'check-ignore', 'symbolic-ref'].includes(sub)) {
      return hit(L4, null, 'git-read');
    }
    return hit(L3, null, 'git');
  }

  if (['psql', 'mysql', 'mariadb', 'sqlite3', 'mongosh', 'mongo', 'redis-cli', 'clickhouse-client', 'duckdb', 'cqlsh'].includes(name)) {
    if (SQL_DESTRUCTIVE.test(cmd.raw)) return hit(L1, 'sql-destructive', 'sql-destructive');
    if (name === 'redis-cli' && /\bflushall|flushdb\b/i.test(cmd.raw)) return hit(L1, 'redis-flush', 'redis-flush');
    const READ_ONLY = /^\s*(select|show|explain|describe|desc|with)\b/i;
    const quoted = cmd.raw.match(/["']([^"']+)["']/);
    if (quoted && READ_ONLY.test(quoted[1])) return hit(L4, null, 'db-read');
    if (/\b(GET|EXISTS|TTL|KEYS|SCAN|INFO|LRANGE|HGET)\b/.test(cmd.raw)) return hit(L4, null, 'db-read');
    if (!quoted && !/-c\b|--eval|-e\b|-q\b/.test(cmd.raw)) return hit(L4, null, 'db-read');
    return hit(L2, 'db', 'db');
  }

  if (SQL_DESTRUCTIVE.test(cmd.raw) && /\b(psql|mysql|sqlite3|prisma|alembic|knex|sequelize)\b/i.test(cmd.raw)) {
    return hit(L1, 'sql-destructive', 'sql-destructive');
  }

  if (name === 'terraform' || name === 'tofu' || name === 'terragrunt') {
    const TF = ['destroy', 'apply', 'plan', 'state', 'import', 'taint', 'untaint',
      'init', 'validate', 'fmt', 'show', 'output', 'refresh', 'workspace'];
    const { sub: t, at } = pickSub(argv, TF);
    const next = argv[at + 1];
    if (t === 'destroy') return hit(L1, 'tf-destroy', 'tf-destroy');
    if (t === 'apply' || t === 'refresh') return hit(L1, 'tf-apply', 'tf-apply');
    if (t === 'state' && ['rm', 'mv', 'replace-provider', 'push'].includes(next)) {
      return hit(L1, 'tf-state', 'tf-state');
    }
    if (t === 'import' || t === 'taint' || t === 'untaint') return hit(L2, 'tf-state-write', 'tf-state-write');
    if (['plan', 'init', 'validate', 'fmt', 'show', 'output'].includes(t)) return hit(L4, null, 'tf-read');
    return hit(L3, null, 'tf');
  }

  if (name === 'kubectl' || name === 'oc') {
    const K8S = ['get', 'describe', 'logs', 'delete', 'apply', 'scale', 'patch', 'set',
      'rollout', 'create', 'edit', 'replace', 'drain', 'cordon', 'uncordon', 'exec', 'top'];
    const { sub: k, at } = pickSub(argv, K8S);
    if (k === 'delete' || k === 'drain') return hit(L1, 'k8s-delete', 'k8s-delete');
    if (k === 'rollout') {
      const verb = argv[at + 1];
      if (verb === 'status' || verb === 'history') return hit(L4, null, 'k8s-read');
      return hit(L2, 'k8s-write', 'k8s-write');
    }
    if (['apply', 'scale', 'patch', 'set', 'create', 'edit', 'replace', 'cordon'].includes(k)) {
      return hit(L2, 'k8s-write', 'k8s-write');
    }
    if (['get', 'describe', 'logs', 'top', 'exec'].includes(k) || !k) return hit(L4, null, 'k8s-read');
    return hit(L3, null, 'k8s');
  }

  if (name === 'docker' || name === 'podman') {
    const D = ['volume', 'system', 'image', 'container', 'compose', 'rm', 'rmi', 'stop',
      'kill', 'restart', 'ps', 'logs', 'build', 'run', 'exec', 'pull', 'push'];
    const { sub: d, at } = pickSub(argv, D);
    const next = argv[at + 1];
    if (d === 'system' && (next === 'reset' || next === 'prune')) return hit(L1, 'docker-prune', 'docker-prune');
    if (d === 'volume' && next === 'rm') return hit(L1, 'docker-volume', 'docker-volume');
    if ((d === 'system' || d === 'image' || d === 'container') && next === 'prune') {
      return hit(L1, 'docker-prune', 'docker-prune');
    }
    if (['rm', 'rmi', 'stop', 'kill', 'restart'].includes(d)) return hit(L2, 'docker-write', 'docker-write');
    if (d === 'push') return hit(L2, 'cloud-write', 'docker-push');
    if (['ps', 'logs', 'build', 'run', 'exec', 'pull', 'compose', 'image', 'container'].includes(d) || !d) {
      return hit(L4, null, 'docker');
    }
    return hit(L3, null, 'docker');
  }

  if (['npm', 'yarn', 'pnpm', 'bun', 'deno'].includes(name)) {
    const SAFE = ['install', 'i', 'ci', 'add', 'test', 'run', 'run-script', 'exec', 'start',
      'build', 'lint', 'ls', 'list', 'view', 'info', 'audit', 'outdated', 'why', 'link', 'init'];
    if (sub === 'publish') return hit(L1, 'publish', 'publish');
    if (sub === 'unpublish' || sub === 'deprecate') return hit(L1, 'unpublish', 'unpublish');
    if (sub === 'dist-tag' || sub === 'owner' || sub === 'access' || sub === 'token') {
      return hit(L1, 'registry-change', 'registry-change');
    }
    if (flags.has('-g') || flags.has('--global')) return hit(L2, 'global-install', 'global-install');
    if (sub && SAFE.includes(sub)) return hit(L4, null, 'pkg');
    return hit(L3, null, 'pkg');
  }

  if ((name === 'pip' || name === 'pip3') && sub === 'install' && (flags.has('--user') || !cmd.raw.includes('-r '))) {
    return hit(L4, null, 'pkg');
  }
  if (name === 'twine' && sub === 'upload') return hit(L1, 'publish', 'publish');
  if (name === 'cargo') {
    if (sub === 'publish') return hit(L1, 'publish', 'publish');
    if (sub === 'yank') return hit(L1, 'registry-change', 'registry-change');
    if (['build', 'test', 'check', 'run', 'fmt', 'clippy', 'tree', 'doc'].includes(sub)) {
      return hit(L4, null, 'build');
    }
    return hit(L3, null, 'cargo');
  }
  if (name === 'dotnet' && cmd.raw.includes('nuget push')) return hit(L1, 'publish', 'publish');

  if (name === 'gh' || name === 'glab') {
    const GH = ['release', 'pr', 'mr', 'repo', 'issue', 'api', 'cache', 'secret', 'variable',
      'run', 'workflow', 'gist', 'auth', 'browse', 'search', 'status', 'label', 'ssh-key'];
    const { sub: g, at } = pickSub(argv, GH);
    const next = argv[at + 1];
    if (g === 'api') {
      const m = cmd.raw.match(/-X\s*([A-Z]+)/);
      const verb = m ? m[1] : 'GET';
      if (verb === 'DELETE') return hit(L1, 'repo-delete', 'gh-api-delete');
      if (['POST', 'PUT', 'PATCH'].includes(verb)) return hit(L2, 'gh-api-write', 'gh-api-write');
      return hit(L4, null, 'gh-read');
    }
    if (next === 'delete' || next === 'archive' || next === 'rename') {
      return hit(L1, g === 'repo' ? 'repo-delete' : 'gh-delete', 'gh-delete');
    }
    if (g === 'release' && next === 'create') return hit(L1, 'release', 'release');
    if ((g === 'pr' || g === 'mr') && next === 'merge') return hit(L2, 'gh-merge', 'gh-merge');
    if (g === 'secret' || g === 'variable' || g === 'ssh-key') return hit(L2, 'gh-secret', 'gh-secret');
    if (g === 'run' || g === 'workflow') return hit(L2, 'ci-trigger', 'ci-trigger');
    if (['status', 'search', 'browse', 'auth', 'label'].includes(g) || !g) return hit(L4, null, 'gh-read');
    if (['view', 'list', 'status', 'diff', 'checks'].includes(next)) return hit(L4, null, 'gh-read');
    return hit(L3, null, 'gh');
  }

  if (name === 'aws' || name === 'gcloud' || name === 'az') {
    if (/\b(rm|delete|remove|destroy)\b/.test(cmd.raw)) return hit(L1, 'cloud-delete', 'cloud-delete');
    if (/\b(cp|sync|upload|put)\b/.test(cmd.raw)) return hit(L2, 'cloud-write', 'cloud-write');
    return hit(L4, null, 'cloud');
  }

  if (name === 'curl' || name === 'wget' || name === 'http' || name === 'httpie') {
    const upload = /(^|\s)(-X\s*(POST|PUT|PATCH|DELETE)|--data|-d\b|--upload-file|-T\b|--form|-F\b)/i.test(cmd.raw);
    if (upload) {
      if (SECRETISH.test(cmd.raw) || /token|secret|password|api[_-]?key/i.test(cmd.raw)) {
        return hit(L1, 'exfil', 'exfil');
      }
      return hit(L1, 'upload', 'upload');
    }
    return hit(L4, null, 'fetch');
  }

  if (['systemctl', 'service', 'launchctl', 'supervisorctl', 'pm2'].includes(name)) {
    if (['isolate', 'mask', 'set-default', 'emergency', 'rescue'].includes(sub)) {
      return hit(L1, 'system-config', 'system-config');
    }
    if (['restart', 'stop', 'start', 'reload', 'disable', 'enable', 'kill', 'unmask'].includes(sub)) {
      return hit(L2, 'service', 'service');
    }
    if (['status', 'list-units', 'show', 'cat', 'is-active', 'is-enabled', 'logs'].includes(sub) || !sub) {
      return hit(L4, null, 'service-read');
    }
    return hit(L3, null, 'service');
  }

  if (['cd', 'pushd', 'popd', 'export', 'source', '.', 'true', 'false', 'sleep',
       'type', 'command', 'alias', 'unalias', 'history', 'time'].includes(name)) {
    return hit(L4, null, 'shell-builtin');
  }

  if (['cat', 'ls', 'grep', 'rg', 'find', 'head', 'tail', 'wc', 'which', 'pwd', 'echo', 'stat', 'file', 'diff', 'tree', 'jq', 'sort', 'uniq', 'awk', 'sed', 'date', 'env', 'ps', 'top', 'df', 'du'].includes(name)) {
    if (name === 'sed' && (flags.has('i') || flags.has('--in-place'))) return hit(L3, null, 'edit');
    return hit(L4, null, 'read');
  }

  if (['make', 'cargo', 'go', 'tsc', 'jest', 'pytest', 'vitest', 'eslint', 'prettier', 'ruff', 'black', 'mvn', 'gradle'].includes(name)) {
    return hit(L4, null, 'build');
  }

  if (['tee', 'touch', 'mkdir', 'chmod', 'chown', 'ln'].includes(name)) {
    if (pos.some(looksOutsideProject)) return hit(L1, 'fs-outside', 'fs-outside');
    return hit(L3, null, 'fs');
  }

  if (['tar', 'unzip', 'unrar', '7z'].includes(name)) {
    const idx = argv.findIndex((a) => a === '-C' || a === '-d');
    const dest = idx >= 0 ? argv[idx + 1] : null;
    if (dest && (looksOutsideProject(dest) || dest === '/')) {
      return hit(L1, 'fs-outside', 'fs-outside');
    }
    return hit(L3, null, 'archive');
  }

  const fromTable = rules.lookup({ name, argv, flags, raw: cmd.raw });
  if (fromTable) return fromTable;

  const quotedArg = cmd.raw.match(/["']([^"']{4,})["']/);
  if (quotedArg && /\b(DROP\s+(TABLE|DATABASE|SCHEMA|WAREHOUSE|KEYSPACE)|TRUNCATE\s+TABLE|DELETE\s+FROM)\s+\S/i.test(quotedArg[1])) {
    return hit(L1, 'sql-destructive', 'sql-destructive');
  }

  const guess = heuristic.scan({ name, argv, raw: cmd.raw });
  if (guess) {
    return {
      level: L1,
      suspect: true,
      reason: guess.primary.kind === 'target' ? 'heuristic-target' : 'heuristic-verb',
      tag: 'heuristic',
      params: { word: guess.primary.word },
    };
  }

  return hit(L3, null, 'unknown');
}

function classifyRedirects(cmd) {
  for (const r of cmd.redirects) {
    if (!r.target) continue;
    if (looksOutsideProject(r.target)) {
      return { level: L1, reason: 'redirect-outside', tag: 'redirect-outside' };
    }
    if (SECRETISH.test(r.target)) {
      return { level: L1, reason: 'redirect-secret', tag: 'redirect-secret' };
    }
  }
  return null;
}

function pipedToShell(command) {
  return /\|\s*(sudo\s+)?(bash|sh|zsh|python3?|node|perl|ruby)\b/.test(command);
}

function classify(command) {
  const parts = tokenize(command);
  if (parts.length === 0) {
    return { level: L4, reasons: [], parts: [], command };
  }

  const findings = [];

  for (const cmd of parts) {
    const res = classifySimple(cmd);
    if (res) findings.push({ ...res, raw: cmd.raw, nested: cmd.nested });
    const red = classifyRedirects(cmd);
    if (red) findings.push({ ...red, raw: cmd.raw, nested: cmd.nested });
  }

  if (pipedToShell(command) && /\b(curl|wget)\b/.test(command)) {
    findings.push({
      level: L1,
      reason: 'curl-pipe-sh',
      tag: 'curl-pipe-sh',
      raw: command,
      nested: false,
    });
  }

  const level = findings.reduce((min, f) => Math.min(min, f.level), L4);
  const atLevel = findings.filter((f) => f.level === level);
  const suspect = atLevel.length > 0 && atLevel.every((f) => f.suspect);
  const reasons = findings
    .filter((f) => f.level === level && f.reason)
    .map((f) => i18n.reason(f.reason, f.params))
    .filter(Boolean);

  return {
    command,
    level,
    suspect,
    reasons: [...new Set(reasons)],
    tags: [...new Set(findings.filter((f) => f.level === level).map((f) => f.tag))],
    parts: findings,
  };
}

const LEVEL_LABELS = { 1: i18n.levelLabel(1), 2: i18n.levelLabel(2), 3: i18n.levelLabel(3), 4: i18n.levelLabel(4) };

module.exports = { classify, classifySimple, LEVEL_LABELS };
