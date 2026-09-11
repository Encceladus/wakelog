#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { classify, LEVEL_LABELS } = require('../lib/classify');
const { render } = require('../lib/report');
const i18n = require('../lib/i18n');

const STATE_DIR = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
  'wakelog'
);

// SessionEnd bywa uruchamiany z przechwyconym stdout — wtedy raport nigdzie nie dociera.
// Terminal jest dziedziczony, więc /dev/tty omija przechwycenie.
function writeToTerminal(text) {
  if (process.env.WAKELOG_NO_TTY) {
    process.stdout.write(text);
    return;
  }
  try {
    const fd = fs.openSync('/dev/tty', 'w');
    fs.writeSync(fd, text);
    fs.closeSync(fd);
  } catch {
    process.stdout.write(text);
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseHookInput() {
  const raw = readStdin().trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function sessionFile(id) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const safe = String(id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(STATE_DIR, `${safe || 'unknown'}.jsonl`);
}

function cmdLog() {
  const input = parseHookInput();
  const toolName = input.tool_name || input.toolName;
  if (toolName && toolName !== 'Bash') process.exit(0);

  const command =
    (input.tool_input && (input.tool_input.command || input.tool_input.cmd)) ||
    (input.toolInput && input.toolInput.command);
  if (!command) process.exit(0);

  const entry = {
    command,
    at: new Date().toISOString(),
    cwd: input.cwd || process.cwd(),
  };

  try {
    fs.appendFileSync(sessionFile(input.session_id || input.sessionId), JSON.stringify(entry) + '\n');
  } catch {
    // hook nigdy nie przerywa sesji
  }
  process.exit(0);
}

function gitInfo(cwd) {
  const run = (args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  const root = run(['rev-parse', '--show-toplevel']);
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    repo: root ? path.basename(root) : path.basename(cwd || '') || null,
    branch: branch && branch !== 'HEAD' ? branch : null,
  };
}

function slug(s) {
  return String(s || 'session').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40);
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

const REPORTS_DIR = path.join(STATE_DIR, 'reports');
const KEEP_REPORTS = 30;

function listReports() {
  try {
    return fs
      .readdirSync(REPORTS_DIR)
      .filter((f) => f.endsWith('.txt'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function pruneReports() {
  const all = listReports();
  for (const f of all.slice(KEEP_REPORTS)) {
    try {
      fs.unlinkSync(path.join(REPORTS_DIR, f));
    } catch {}
  }
}

// logi sesji, które nigdy nie doczekały się SessionEnd
function pruneOrphans() {
  const cutoff = Date.now() - 36 * 3600 * 1000;
  try {
    for (const f of fs.readdirSync(STATE_DIR)) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(STATE_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch {}
}

function gitDirty(cwd) {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const n = out.split('\n').filter(Boolean).length;
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

function loadEntries(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function cmdReport() {
  const input = parseHookInput();
  const file = sessionFile(input.session_id || input.sessionId);
  const entries = loadEntries(file);
  if (entries.length === 0) process.exit(0);

  const cwd = entries[entries.length - 1].cwd || process.cwd();
  const info = gitInfo(cwd);
  const out = render(entries, { gitDirty: gitDirty(cwd), ...info });

  writeToTerminal('\n' + out + '\n');

  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const when = entries[entries.length - 1].at ? new Date(entries[entries.length - 1].at) : new Date();
    const label = [slug(info.repo), info.branch ? slug(info.branch) : null].filter(Boolean).join('_');
    const name = `${stamp(when)}_${label || 'session'}.txt`;
    fs.writeFileSync(path.join(REPORTS_DIR, name), out.replace(/\u001b\[[0-9;]*m/g, ''));
    fs.unlinkSync(file);
    pruneReports();
    pruneOrphans();
  } catch {
    // brak podsumowania jest akceptowalny, zawieszenie sesji nie
  }
  process.exit(0);
}

function cmdExplain(argv) {
  const command = argv.join(' ');
  if (!command) {
    console.error(i18n.ui('usageExplain'));
    process.exit(1);
  }
  const r = classify(command);
  console.log(`${command}`);
  console.log(`${i18n.ui('level')} ${r.level} — ${LEVEL_LABELS[r.level]}`);
  if (r.reasons.length) console.log(r.reasons.map((x) => '  ' + x).join('\n'));
  if (r.tags.length) console.log('  ' + i18n.ui('tags') + ' ' + r.tags.join(', '));
  process.exit(0);
}

function prettyName(f) {
  const m = f.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})_(.*)\.txt$/);
  if (!m) return { when: f, label: '' };
  return { when: `${m[3]}.${m[2]} ${m[4]}:${m[5]}`, label: m[6].replace(/_/g, ' · ') };
}

function cmdLast() {
  const all = listReports();
  const legacy = path.join(STATE_DIR, 'last-session.txt');
  if (all.length === 0) {
    if (fs.existsSync(legacy)) {
      process.stdout.write(fs.readFileSync(legacy, 'utf8'));
      process.exit(0);
    }
    console.log(i18n.ui('noReport'));
    process.exit(0);
  }
  process.stdout.write(fs.readFileSync(path.join(REPORTS_DIR, all[0]), 'utf8'));
  process.exit(0);
}

function cmdList() {
  const all = listReports();
  const open = [];
  try {
    for (const f of fs.readdirSync(STATE_DIR)) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(STATE_DIR, f);
      const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
      if (!lines.length) continue;
      const last = JSON.parse(lines[lines.length - 1]);
      const info = gitInfo(last.cwd || '.');
      open.push({ id: f.replace(/\.jsonl$/, ''), n: lines.length, info, at: last.at });
    }
  } catch {}

  if (open.length) {
    console.log(i18n.ui('openSessions'));
    for (const o of open) {
      const label = [o.info.repo, o.info.branch].filter(Boolean).join(' · ');
      console.log(`  ${o.id.slice(0, 8)}  ${String(o.n).padStart(3)} cmd  ${label}`);
    }
    console.log('');
  }

  if (all.length === 0) {
    console.log(i18n.ui('noReport'));
    process.exit(0);
  }
  console.log(i18n.ui('pastReports'));
  all.forEach((f, i) => {
    const { when, label } = prettyName(f);
    console.log(`  ${String(i + 1).padStart(2)}  ${when}  ${label}`);
  });
  process.exit(0);
}

function cmdShow(argv) {
  const all = listReports();
  const key = argv[0];
  if (!key) {
    console.error(i18n.ui('usageShow'));
    process.exit(1);
  }
  // identyfikator otwartej sesji — renderuj na żywo, nie ruszając stanu
  if (!/^\d+$/.test(key)) {
    let live = null;
    try {
      live = fs.readdirSync(STATE_DIR).find((f) => f.endsWith('.jsonl') && f.startsWith(key));
    } catch {}
    if (live) {
      const entries = loadEntries(path.join(STATE_DIR, live));
      if (entries.length) {
        const cwd = entries[entries.length - 1].cwd || process.cwd();
        process.stdout.write('\n' + render(entries, { gitDirty: gitDirty(cwd), ...gitInfo(cwd) }) + '\n');
        process.exit(0);
      }
    }
  }

  let file = null;
  if (/^\d+$/.test(key)) file = all[Number(key) - 1];
  else file = all.find((f) => f.toLowerCase().includes(key.toLowerCase()));
  if (!file) {
    console.log(i18n.ui('noReport'));
    process.exit(0);
  }
  process.stdout.write(fs.readFileSync(path.join(REPORTS_DIR, file), 'utf8'));
  process.exit(0);
}

function mergeHook(settings, event, command) {
  settings.hooks = settings.hooks || {};
  settings.hooks[event] = settings.hooks[event] || [];
  const already = JSON.stringify(settings.hooks[event]).includes('wakelog');
  if (already) return false;
  const block = { hooks: [{ type: 'command', command }] };
  if (event === 'PostToolUse') block.matcher = 'Bash';
  settings.hooks[event].push(block);
  return true;
}

function cmdInstall() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const self = path.resolve(__dirname, 'cli.js');
  let settings = {};

  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    try {
      settings = JSON.parse(raw);
    } catch {
      console.error(i18n.ui('parseFail', settingsPath));
      process.exit(1);
    }
    fs.writeFileSync(settingsPath + '.bak.wakelog', raw);
  } else {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  }

  const a = mergeHook(settings, 'PostToolUse', `node "${self}" log # wakelog`);
  const b = mergeHook(settings, 'SessionEnd', `node "${self}" report # wakelog`);

  if (!a && !b) {
    console.log(i18n.ui('already'));
    process.exit(0);
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(i18n.ui('installed', settingsPath));
  console.log(i18n.ui('reload'));
  process.exit(0);
}

function cmdUninstall() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) process.exit(0);
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  for (const event of ['PostToolUse', 'SessionEnd']) {
    if (!settings.hooks || !settings.hooks[event]) continue;
    settings.hooks[event] = settings.hooks[event].filter(
      (b) => !JSON.stringify(b).includes('wakelog')
    );
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(i18n.ui('uninstalled'));
  process.exit(0);
}

const [, , sub, ...rest] = process.argv;

switch (sub) {
  case 'log':
    cmdLog();
    break;
  case 'report':
    cmdReport();
    break;
  case 'explain':
    cmdExplain(rest);
    break;
  case 'last':
    cmdLast();
    break;
  case 'list':
  case 'ls':
    cmdList();
    break;
  case 'show':
    cmdShow(rest);
    break;
  case 'install':
    cmdInstall();
    break;
  case 'uninstall':
    cmdUninstall();
    break;
  default:
    console.log(i18n.ui('tagline') + '\n');
    console.log('  wakelog install            ' + i18n.ui('helpInstall'));
    console.log('  wakelog explain "<cmd>"    ' + i18n.ui('helpExplain'));
    console.log('  wakelog last               ' + i18n.ui('helpLast'));
    console.log('  wakelog list               ' + i18n.ui('helpList'));
    console.log('  wakelog show <nr|repo>     ' + i18n.ui('helpShow'));
    console.log('  wakelog uninstall          ' + i18n.ui('helpUninstall'));
    process.exit(0);
}
