# Mac work reporter

A small push-only reporter that sends Nerve a structured note when a coding session ends on
another machine — typically a Mac running Claude Code or OpenCode.

It answers "what did that machine do today?" without polling the Mac, running an agent turn per
edit, or pulling a transcript across the network.

- **Push only.** The Mac opens the connection; Nerve never reaches back.
- **Small.** One report per session end, a few hundred bytes.
- **Checkable.** What the session *claims* and what the reporter *observed* are separate fields.
- **Private.** Prompts, transcript bodies, diffs and secrets are never sent.

---

## What a report contains

| Field | Example | Source |
|---|---|---|
| `workstream` | `nerve`, `after-hours-net`, `swarm` | longest configured path match |
| `repo.path` / `branch` / `commit` / `commitSubject` | `/Users/shaun/nerve`, `master`, `5edad4f` | `git` |
| `repo.dirty` / `changedFiles` | `true`, `2` | `git status --porcelain` |
| `repo.ahead` / `behind` / `upstream` | `1`, `0`, `origin/master` | `git rev-list --left-right --count` |
| `agent.kind` / `sessionId` | `claude-code`, `abc` | the hook payload |
| `outcome.summary` | "Rebased the attention branch and pushed" | last assistant message, truncated to 600 chars |
| `outcome.status` | `completed` / `partial` / `blocked` / `aborted` | default `completed` |
| `observed[]` | `{ kind: "commit", text: "5edad4f …" }` | the reporter itself |
| `links.pr` | a PR URL | optional flag |

`outcome` is **reported**: the session said so. `observed` is **verified**: the reporter read it
from git or was told by an explicit flag. The digest labels them differently and never merges
them.

### What is never sent

- User or system prompts, and any part of the transcript except the last assistant text
- Diffs, file contents, tool output
- Environment variables or credentials — the reporter also redacts token-shaped strings
  (`ghp_…`, `sk-…`, `xoxb-…`, `AKIA…`, bearer tokens, private keys) before sending

The last assistant message can still describe the work in the session's own words. That is the
point of the summary; if a summary must not leave the machine, run `report` with an explicit
`--summary` instead of the hook.

---

## Server setup (once)

On the Nerve host:

```bash
openssl rand -hex 32
```

Add the value to `.env` and restart Nerve:

```bash
NERVE_REPORTER_TOKEN=<the value>
```

Without it, `POST /api/work/reports` answers `503` and stores nothing. Reports live in
`~/.openclaw/nerve/work-reports/` as one JSONL file per UTC day, plus a `.ids` index that makes a
retry idempotent. Override with `NERVE_WORK_REPORTS_DIR`.

Send the token to whoever runs the Mac over a private channel. Do not commit it.

---

## Install on the Mac

One command, over Tailscale:

```bash
curl -fsSL http://100.76.99.21:3080/install/mac-reporter.sh \
  | NERVE_REPORTER_TOKEN=<token> bash -s -- \
      --server http://100.76.99.21:3080 \
      --workstream nerve="$HOME/nerve" \
      --workstream after-hours-net="$HOME/after-hours-net"
```

`--workstream` is repeatable and maps a repo path to a workstream name. A repo outside every
configured path is reported under its directory name, so an unmapped repository still shows up.

Other flags:

| Flag | Effect |
|---|---|
| `--token-file <path>` | read the token from a file instead of the environment |
| `--no-hooks` | do not touch `~/.claude/settings.json` |
| `--no-agent` | do not install the 15-minute launch agent that flushes the queue |
| `--uninstall` | remove the reporter, its hook entry and the launch agent |
| `--keep-queue` | with `--uninstall`, keep unsent reports |

The installer is idempotent: it replaces its own files, adds the Claude Code hook only if it is
not already there, preserves every other setting in `settings.json`, and reloads the launch
agent. It writes only to:

- `~/.nerve/reporter/` — config (0600), CLI, queue, logs
- `~/.claude/settings.json` — one `SessionEnd` hook entry
- `~/Library/LaunchAgents/com.nerve.reporter.plist` — macOS only

### Verify the first report

```bash
~/.nerve/reporter/bin/nerve-report.mjs status
~/.nerve/reporter/bin/nerve-report.mjs ping
~/.nerve/reporter/bin/nerve-report.mjs report --summary "Reporter smoke test" --workstream test
~/.nerve/reporter/bin/nerve-report.mjs digest --since 1h
```

`status` shows the config path, server and queue depth. `ping` proves the server accepts the
token. `report` sends one now. `digest` reads back what the server holds.

On the server, the same report is visible in the day file:

```bash
tail -n 1 ~/.openclaw/nerve/work-reports/$(date -u +%F).jsonl
```

---

## Claude Code hook

The installer adds this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "~/.nerve/reporter/bin/nerve-report.mjs hook claude" } ] }
    ]
  }
}
```

Claude Code passes the hook payload on stdin. The reporter uses `cwd` for git metadata, the
`session_id` for correlation, and reads only `assistant` entries from the transcript to build the
summary.

If the settings file already had a `SessionEnd` hook, it is kept and the reporter is appended as a
second group. If the file is not valid JSON, the installer refuses to touch it and prints what to
add by hand.

## OpenCode

OpenCode has no hook format the reporter can assume across versions. Call the CLI at session end
from whatever wrapper or plugin the session already uses:

```bash
~/.nerve/reporter/bin/nerve-report.mjs report \
  --agent opencode \
  --summary "<one or two lines: what finished, what is verified, what is next>" \
  --status completed
```

Add `--observed "test|ok|vitest 3337 passed"` (or `build|ok|npm run build`) when the session
actually ran it. `--observed` takes `kind|ok|fail|text`; the kind is one of `test`, `build`,
`lint`, `commit`, `push`, `pr`, `merge`, `other`.

## Queue behaviour

When the server or the network is down, the report is written to `~/.nerve/reporter/queue/` and
retried on the next hook, the next `report`, or the launch agent's 15-minute `flush`. Each report
carries a UUID, so a retry that arrives after a timeout is stored once.

A `401` (wrong token), `503` (no token on the server) or `400` (bad shape) is **not** queued: it
exits with code 2 and says what to fix. Queueing those would hide a configuration error forever.

---

## Daily brief

`digest` prints a markdown block for a PM brief:

```bash
~/.nerve/reporter/bin/nerve-report.mjs digest --since 24h
```

```
### Work reported by other machines (since 2026-11-27T09:00:00.000Z)

2 report(s) · 2 workstream(s) · 1 with uncommitted work
Observed: 4 test run(s) (4 passed, 0 failed), 1 build(s), 2 commit(s), 1 push(es)
- 2026-11-27 17:42 · nerve · nerve@master 5edad4f (dirty) · completed — Finished the flow renderer
- 2026-11-27 16:10 · after-hours-net · ahn@main abc1234 · partial — Re-cut the first batch

_Summaries are agent-reported; commits, dirty state and test counts above are reporter-observed._
```

`--json` returns the raw summary instead. The digest needs a reporter config on the machine that
runs it; on the Nerve host, point it at `http://127.0.0.1:3080` with the same token.

An OpenClaw automation can run it before composing the brief:

```bash
~/.nerve/reporter/bin/nerve-report.mjs digest --since 24h
```

and paste the block under a "Mac work" heading, leaving the reported/observed distinction intact.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ping` returns 401 | token mismatch | compare `NERVE_REPORTER_TOKEN` on the server with the Mac config; re-run the installer |
| `ping` returns 503 | server has no token | add `NERVE_REPORTER_TOKEN` to `.env`, restart Nerve |
| `queued (server unreachable)` | Tailscale down, wrong host, or Nerve not running | `tailscale status`, then `curl -fsS <server>/health` |
| Hook never fires | Claude Code settings not loaded, or hook removed | check `~/.claude/settings.json`, then run the hook command by hand with a payload on stdin |
| `no config at …` | installer skipped or `HOME` mismatch | re-run the installer; `NERVE_REPORTER_HOME` overrides the location |
| Reports arrive twice | same `id` after a timeout | the server dedupes; two entries mean two different ids (two sessions) |

Logs: `~/.nerve/reporter/logs/reporter.log` (and `launchd.err.log` on macOS).

---

## Security notes

- The reporter token is a write-only credential for this endpoint. Treat it like an API key;
  rotate by changing `NERVE_REPORTER_TOKEN` on the server and re-running the installer.
- The endpoint is reachable wherever Nerve is reachable. Over Tailscale that is the tailnet; if
  Nerve is public, put it behind the same protections as the rest of the app.
- The installer and CLI are served unauthenticated because they contain no secrets. They are
  static files from the repository, not generated per install.
- The Mac stores its token in `~/.nerve/reporter/config.json` with mode `0600`.
