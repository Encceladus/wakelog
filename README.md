# wakelog

[![test](https://github.com/Encceladus/wakelog/actions/workflows/test.yml/badge.svg)](https://github.com/Encceladus/wakelog/actions/workflows/test.yml)

After an agent session, shows what it did **irreversibly** — and folds everything git can undo into a single line.

```
  wakelog  ·  3h 48m  ·  42 commands
  ────────────────────────────────────────────────────────────────────────

  irreversible                                                           5

  ● 10:40  psql $DATABASE_URL -c "DROP TABLE sessions_old"
           irreversible change to data or schema

  ● 11:50  git push --force origin refactor/api
           overwrites history on the remote

  ● 12:06  echo "Host bastion" >> ~/.ssh/config
           writes outside the project directory

  ● 12:23  terraform apply tf.plan
           infrastructure changed

  ● 12:39  git clean -fdx
           also removes ignored files, e.g. .env

  reversible at someone else's cost                                      2

  ○ 10:35  psql $DATABASE_URL -c "ALTER TABLE sessi···D COLUMN v2 boolean"
           database operation

  ○ 11:23  kubectl apply -f k8s/staging.yaml
           cluster state changed

  ────────────────────────────────────────────────────────────────────────
  35 skipped   25 reads and builds · 10 changes in git
```

A chronological log runs 200 lines and nobody reads it. Here the sort key is **reversibility, not time**: anything git will restore collapses into one line, and your attention goes where nothing can be undone.

## Install

```
npx wakelog install
```

Adds two hooks to `~/.claude/settings.json` — with a backup, leaving other tools' entries untouched. No config, no account, no API key. Runs offline: classification is deterministic and no model is involved.

Then run `/hooks` in Claude Code to reload.

## How it works

| Hook | Role |
| --- | --- |
| `PostToolUse` (matcher `Bash`) | appends the command to a session log |
| `SessionEnd` | classifies the log and prints the report |

`Stop` is deliberately avoided (it fires after every response) and so is `PreToolUse` (it can block a session). `SessionEnd` cannot break anything — the worst a buggy version does is print no report.

The report is written to `/dev/tty` rather than stdout, because some hook runners capture stdout and the report would never reach the screen. Set `WAKELOG_NO_TTY=1` to force plain stdout (useful when piping the report somewhere).

Session logs live in `~/.local/state/wakelog/` and are deleted once the report is printed. Reports go to `reports/` inside it. Neither is a file you edit.

## Levels

1. **Irreversible** — `push --force`, `git clean -fdx`, `DROP TABLE`, `terraform apply`, package publish, writes outside the project, data sent out
2. **Reversible at someone else's cost** — plain `push`, service restart, global install, `sudo`
3. **Reversible locally** — anything git restores
4. **No effect** — reads, builds, tests

Levels 3 and 4 collapse into a counter. You only ever see 1 and 2.

Three cross-cutting rules:

- An unresolvable variable in a destructive position (`rm -rf "$DIR"`) is always level 1. No guessing.
- The default is level 3. Escalation happens on a match, never the other way around.
- A compound command takes the highest level among its parts — hence a real tokenizer, not a regex.

## Other commands

```
wakelog list                       # past reports and sessions still open
wakelog last                       # the most recent report
wakelog show 3                     # a past report by number
wakelog show acme-api              # a past report by repo name
wakelog show 1a2b3c4d              # an open session, rendered live
wakelog explain "git clean -fdx"   # classify a single command
wakelog uninstall
```

Reports are named after the repo and branch they came from, so concurrent sessions stay apart. The last 30 are kept in `~/.local/state/wakelog/reports/`; session logs left behind by sessions that never ended are cleared after 36 hours.

## Language

English by default. Polish via `WAKELOG_LANG=pl`, or automatically when your locale starts with `pl`. Adding a language means one dictionary in `lib/i18n.js`.

## What v0 does not do

- **No "out of scope" detection.** Without a scope file there is nothing to compare declared intent against, and guessing from the prompt would produce false alarms.
- **No policy generation.** The report is read-only.
- **No pre-execution explanations.** That is a separate mode, on `PreToolUse`.
- **No transcript parsing** — it relies only on documented hook input, so it does not break on updates.

## The metric that matters right now

Run an agent on a real repo, let it make a mess, exit. If the report only tells you things `git status` gives you for free, the classification is too shallow. Every command you wanted to see that landed in level 3 is a missing rule in `lib/classify.js` — pull requests welcome.

## Note

The Claude Code hooks API is evolving. Check the current schema before changing anything:
https://docs.claude.com/en/docs/claude-code/hooks

Polish README: [README.pl.md](README.pl.md)

MIT.
