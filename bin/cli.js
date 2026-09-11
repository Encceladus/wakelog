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
  const out = render(entries, { gitDirty: gitDirty(cwd) });

  process.stdout.write('\n' + out + '\n');

  try {
    const saved = path.join(STATE_DIR, 'last-session.txt');
    fs.writeFileSync(saved, out.replace(/\u001b\[[0-9;]*m/g, ''));
    fs.unlinkSync(file);
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

function cmdLast() {
  const saved = path.join(STATE_DIR, 'last-session.txt');
  if (!fs.existsSync(saved)) {
    console.log(i18n.ui('noReport'));
    process.exit(0);
  }
  process.stdout.write(fs.readFileSync(saved, 'utf8'));
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
    console.log('  wakelog uninstall          ' + i18n.ui('helpUninstall'));
    process.exit(0);
}
