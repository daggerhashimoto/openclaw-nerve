# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.5.3] - 2026-04-21

### Highlights

**Workspace context is much more usable inside chat.** Nerve can now add files and directories to chat, open rendered markdown documents in-app, and follow configurable workspace path links and aliases directly from messages or docs (PR #239, PR #248, PR #271, PR #273, PR #288).

**File browsing works better on real devices.** The file browser now supports in-app PDF viewing, moves compact actions into kebab menus, and handles touch long-press context menus more reliably on mobile (PR #254, PR #299, PR #303, PR #307).

**Session visibility got less confusing.** Spawned child sessions survive refreshes, channel sessions show up in the agent sidebar, root agent labels derive more reliably from identity, and orphaned agent sessions no longer disappear from the tree (PR #226, PR #236, PR #259, PR #297).

**Uploads and shell controls got cleaner.** The paperclip is now the primary upload flow, attachments use a canonical upload reference contract, and the command palette has clearer launchers and visibility toggles across desktop and mobile layouts (PR #229, PR #231, PR #291, PR #292, PR #293).

### Added
- In-app PDF viewing with file type checks in the file browser (PR #254)
- An in-app bead viewer with context-safe bead links (PR #275)
- Configurable workspace path links plus `CHAT_PATH_LINKS` alias mapping for chat references (PR #239, PR #288)
- File-tree actions to add individual files or whole directories to chat (PR #271, PR #273)
- A hidden-workspace-entries toggle for the workspace panel (PR #274)
- Support for adaptive thinking selection in the UI (PR #302)

### Changed
- The paperclip is now the primary upload entry point in chat (PR #231)
- Workspace markdown documents now render in a dedicated navigable document view instead of forcing raw file reads (PR #248)
- Compact file-browser actions now live behind kebab menus to reduce accidental taps and visual noise (PR #307)
- The command palette now has clearer launchers, mobile entry points, and visibility controls (PR #291, PR #292, PR #293)
- Built-in Kanban can now be disabled from settings while remaining enabled by default for existing installs (PR #242)
- The updater now surfaces a copy-paste command during update flows for easier manual recovery (PR #295)

### Fixed
- Spawned child sessions now remain visible after refresh instead of disappearing from the sidebar (PR #226)
- Uploaded user images now survive history reconciliation correctly (PR #220)
- The workspace watcher again refreshes config changes and restores workspace labels correctly (PR #261, PR #284)
- Local chat path link configuration now self-heals safer defaults, and inline workspace references replay correctly after follow-up renders (PR #267, PR #285)
- Session roots now derive stable labels from identity, keep inherited effort labels after reload, and continue showing channel and orphaned sessions in the sidebar (PR #236, PR #257, PR #259, PR #297)
- Kanban assigned execution now falls back to the full session list when needed instead of dropping valid targets (PR #287)
- Panel dividers stay interactive when the sidebar is collapsed, and resizable panel lint regressions are cleaned up (PR #281, PR #289)
- ArrowUp history recall, untrusted system event parsing, and nested edit diff rendering all behave correctly in chat again (PR #278, PR #280, PR #308)
- The server-side upload config endpoint is available again, and subagent lifecycle handling now lives on the server for more reliable spawn cleanup (PR #247, PR #265)
- Tailscale serve docs and examples now use valid command syntax again (PR #276, PR #277)

### Documentation
- Refreshed local setup wording in the README to better match current install expectations

## [1.5.2] - 2026-03-30

### Highlights

**Kanban execution now matches the real session tree.** Assigned tasks launch as real child sessions beneath the selected assignee root, task completion and failures report back to the parent root, and background root notifications no longer misfire while those updates land (PR #198).

**Remote and hybrid installs are less brittle.** Nerve now supports remote-gateway installation up front via `--gateway-url`, resolves gateway RPC origins from public config for remote workspace access, and explains missing cron capability with a clear remediation path instead of a dead-end warning (PR #181, PR #197, PR #200).

**Session and agent state are less misleading.** The model picker now reflects the active OpenClaw config, duplicate root-agent creation correctly registers suffixed agents in `openclaw.json`, direct-message sessions nest under the correct agent root, and the main root label stays canonical (PR #174, PR #185, PR #192, PR #196).

**Docs and setup guidance caught back up to reality.** AI setup docs landed, setup now prints the right deployment guide links, and stale operator docs were refreshed to match the current runtime and installer behavior (PR #179, PR #182, PR #191).

### Added
- Installer support for `--gateway-url` so Nerve can target a remote gateway from first boot (PR #181)
- AI agent setup docs and a raw install contract for agent-driven installs (PR #182)
- A dedicated `GET /api/kanban/tasks/:id` endpoint for direct Kanban task lookup by id (PR #176)
- An assignee picker for Kanban task forms so users no longer need to enter raw assignee values manually (PR #203)
- Support for custom board column keys via board config (PR #173)
- Shebang-based syntax highlighting for extensionless executable files (PR #190)

### Changed
- Setup now prints deployment guide links after configuration so operators can jump straight to the right topology docs (PR #179)
- Setup now ensures `sessions_spawn` is allowlisted alongside the other required gateway tools for Kanban execution on current OpenClaw builds (PR #159)
- Model selection now comes from the active OpenClaw config instead of Nerve-side fallback lists (PR #174)
- Chat input helper text now points users at the command palette more clearly (PR #175)

### Fixed
- Skills API parsing now falls back to structured stderr JSON output when tools emit machine-readable results there (PR #161)
- Sidebar session tree cleanup: only real roots are shown, direct-message sessions nest under their owning agent root, and `agent:main:main` always renders with a canonical label (PR #177, PR #185, PR #196)
- Session selection click targets are more forgiving thanks to a small hover delay that reduces accidental steals while moving through the tree (PR #187)
- Duplicate root-agent creation now registers the correct suffixed agent in `openclaw.json` so config, workspace, and session roots stay aligned (PR #192)
- Assigned Kanban tasks now launch as real child sessions, clean up orphaned child sessions on partial launch failures, and report completion back to the parent root that owns the work (PR #198)
- Background top-level root updates now set unread state correctly and only ping on terminal events (PR #198)
- Remote-workspace gateway RPC now derives its request origin from public config instead of hardcoded loopback values, fixing hybrid/cloud `origin not allowed` failures (PR #200)

### Documentation
- Added AI setup docs and refreshed stale repo docs so installation, deployment, configuration, and troubleshooting guidance line up with the current runtime (PR #182, PR #191)

## [1.5.1] - 2026-03-25

### Fixed
- Restored the browser websocket auth identity to `webchat-ui` so remote deployments do not trip the gateway's stricter Control UI device-identity requirement on non-secure page origins. This fixes the 1.5.0 login failure reported by users connecting to remote gateway endpoints from plain remote HTTP Nerve pages.

## [1.5.0] - 2026-03-25

### Highlights

**Workspace context now follows the owning top-level agent**. File browser state, Memory, Config, and Skills now switch with the selected top-level agent instead of leaking across agents, and dirty editor tabs now block cross-agent switches with an explicit save / discard / cancel choice (PR #123).

**Agent runtime flows got tighter**. Subagents can now choose whether they stay visible after one-shot runs, subagent deletion is more reliable, the model catalog waits longer on cold starts so configured Codex and other models are more likely to appear in the spawn dialog, and remote or sandboxed workspace access now falls back cleanly through the gateway when local filesystem access is unavailable (PR #119, PR #120, PR #124, PR #145).

**Voice and readability both moved forward**. Xiaomi MiMo joins as a first-class TTS provider, the new global font size control now reaches more of the UI, and small-screen inputs keep a fixed 16px size to avoid mobile auto-zoom regressions (PR #128, PR #129, PR #130).

**Installer, setup, and execution hardening all moved up a notch**. Tailscale setup now supports distinct IP and Serve flows, wake word is disabled on mobile web, setup defaults are stricter around device approval and can infer the agent name from local metadata, and kanban reruns now keep stable identifiers without stale completion state leaking across runs (PR #116, PR #118, PR #122, PR #141, PR #143, PR #151).

**Workspace navigation got smoother**. Markdown and chat workspace path references can now resolve and reveal files safely in the file browser, with follow-up fixes for missing-path semantics and refreshed open handlers (PR #148, PR #149).

### Added
- Tailscale IP and Tailscale Serve setup flows in the installer, with matching installer-step documentation (PR #116)
- An **After run** selector for one-shot subagents, with **Keep** and **Delete** cleanup options (PR #120)
- **Font size setting** in Appearance settings, adjustable from 10px to 24px via dropdown, stored in `localStorage`, and applied instantly via a CSS custom property (PR #128)
- **Xiaomi MiMo** as a first-class TTS provider, including API key plumbing, server-side synthesis support, and Audio settings controls for model, voice, and style (PR #129)
- **Gateway RPC fallback for remote and sandboxed workspace access**, including a sandboxed-workspace notice in the Memory panel when local filesystem access is unavailable (PR #145)
- **Safe workspace path resolve and reveal** from markdown and chat references into the file browser (PR #148)

### Changed
- Workspace scope is now derived from the owning top-level agent, including when viewing subagent sessions (PR #123)
- File browser tabs, selection state, drafts, Memory, Config, and Skills now persist per top-level agent instead of globally (PR #123)
- Cross-agent workspace switches now show **Save and switch**, **Discard and switch**, or **Cancel** when dirty editor tabs exist (PR #123)
- Model catalog fetches now allow a longer cold-start timeout before giving up, so configured Codex and other models appear more reliably in the spawn dialog (PR #124)
- Mobile web now disables wake word and points users to manual mic activation instead (PR #118)
- Right sidebar resizing now allows a narrower minimum width (PR #122)
- Cron list and dialog typography now fully follows the global font size system, with the remaining fixed pixel sizes converted to `rem` units (PR #130)
- Setup defaults now infer `AGENT_NAME` from local identity metadata when the value is not already explicitly set (PR #151)

### Fixed
- Subagent session deletion no longer fails on the Nerve side when the gateway closes a proxied WebSocket normally during delete flows (PR #119)
- Agent-scoped workspace switching no longer leaks same-path editor state, save toasts, watcher refreshes, or async file reads across top-level agents (PR #123)
- Tailscale origin handling is more robust during setup and follow-up gateway patching (PR #116)
- Small-screen text inputs now stay at 16px so mobile browsers do not auto-zoom the composer and settings controls after font size changes (PR #130)
- Older top-level agent chats stay visible in the sidebar instead of disappearing once they fall outside the recent-activity query window (PR #134)
- Kanban runtime data now lives under `${NERVE_DATA_DIR:-~/.nerve}/kanban`, and legacy installs automatically migrate data from old `server-dist/data/kanban` or `server/data/kanban` locations on first run (PR #135)
- Setup no longer attempts to approve malformed pending device request IDs, and gateway auth validation now uses a working token probe during defaults and check flows (PR #141)
- Kanban run completion now accepts stable child identifiers, ignores stale client `run` patches, stops stale pollers after reruns, and normalizes spawn session aliases consistently (PR #143)
- Remote and sandboxed workspace gateway fallback now authenticates correctly with device identity in real OpenShell-style deployments (PR #145)
- Workspace path resolve now returns `404` for safe missing targets, and markdown file-link handlers refresh when workspace path callbacks change (PR #149)

### Documentation
- Added a dedicated Tailscale guide for existing installs, linked from the docs index and configuration docs (PR #117)
- Refreshed the API, architecture, configuration, troubleshooting, and changelog docs to match agent-scoped workspace behavior and newer gateway and file APIs (PR #126)
- Rewrote the README around current positioning, capabilities, install flow, and embedded demo video, with follow-up formatting and video asset fixes (PR #136)

---

## [1.4.9] — 2026-03-18

### Highlights

**Multi-agent support expanded** — Nerve now supports multiple top-level agents, making multi-agent workflows less awkward and more flexible (PR #111).

**Installer and startup flow hardened** — setup and service startup are now more resilient around edge cases and failure paths (PR #115).

**UX got a broad polish pass** — cron runs, session surfacing, mobile responsiveness, and chat chrome all got tighter and more usable on real screens (PR #112, PR #113, PR #114).

### Added
- Custom workspace root support via `FILE_BROWSER_ROOT` (PR #92, thanks @jamesjmartin)
- Server-side token injection for trusted clients (PR #109, thanks @jamesjmartin)
- Support for multiple top-level agents (PR #111)

### Changed
- File browser now collapses responsively on mobile layouts (PR #96, thanks @jamesjmartin)
- Shell, responsive layout, and Kanban UX refined (PR #108)
- Cron runs, session surfacing, and general UX polished (PR #112)
- Mobile responsiveness and connect dialog behavior hardened (PR #113)
- Mobile chat header toggle added for smaller screens (PR #114)
- Installer edge cases and service startup paths hardened (PR #115)
- Composer actions aligned to the textarea baseline
- Docs refreshed for the current gateway auth flow

### Fixed
- Inotify exhaustion prevented, with better WebSocket reconnect and subagent visibility (PR #102, thanks @DerrickBarra)
- Invalid paths evicted from the file tree cache (PR #105, thanks @jamesjmartin)
- Session model transcript 404s avoided (PR #107, thanks @DerrickBarra)
- Gateway trust boundary and connection auto-connect behavior corrected
- Infinite reconnect loops on auth failure prevented
- `Ctrl+B` shortcut handling restored
- `install.sh` execute permission restored
- Connect dialog overflow fixed on smaller screens
- Markdown list markers restored in chat bubbles
- Operator messages now render right-aligned in chat while keeping message text left-aligned

---

## [1.4.8] — 2026-03-04

### Highlights

**Voice input overhauled** — Free voice input modes improved with better finalization, shortened wake/send chimes, and reduced mic delay from 800ms to 370ms to stop clipping the first word. English phrase fallback no longer bleeds into non-English sessions.

**Kanban skill bundled** — `nerve-kanban` skill now auto-installs during setup. Agents can use the kanban skill to manage the Nerve task board directly: create tasks, move columns, update status, all through natural conversation.

### Added
- Bundled `nerve-kanban` skill with auto-install during setup (PR #83)
- Improved free voice input modes and finalization (PR #80)

### Fixed
- File browser no longer overwrites dirty editor content when re-opening an already-open file (PR #85)
- Infinite scroll no longer stalls after loading older messages (PR #86)
- `groupToolMessages` and `mergeFinalMessages` no longer mutate shared React state objects (PR #86)
- Chat message sends use atomic state updates to prevent race conditions with streaming events (PR #86)
- Stale WebSocket `onclose` handlers no longer kill active connections during reconnect (PR #87)
- TTS voice flag resets on session switch, preventing phantom auto-speak in new sessions (PR #88)
- TTS config fetch/save now checks response status before parsing JSON (PR #88)
- TTS audio fetch includes credentials for cookie-based auth (PR #88)
- Voice phrase editor uses stable keys instead of array indices, fixing stale input values on delete (PR #88)
- ConfirmDialog Enter key no longer fires confirm when Cancel is focused (PR #89)
- Dockerfile and Makefile syntax highlighting works correctly in the file browser (PR #89)
- Theme switch no longer reloads the highlight.js stylesheet redundantly (PR #89)
- Updater rollback now completes before releasing the lock (PR #90)
- `.env` parser strips surrounding quotes from values (PR #90)
- Image compression rejects oversized output instead of silently exceeding the WebSocket payload limit (PR #90)
- Kanban drag-and-drop no longer crashes if a task is deleted by a concurrent refresh (PR #90)
- Duplicate task execution is rejected with 409 instead of spawning a second agent session (PR #90)
- Shortened wake and send voice chimes and reduced post-wake mic delay from 800ms to 370ms to prevent first-word clipping (PR #91)
- File browser wrapper has proper height constraint for vertical scroll (PR #84)
- Kanban config migration backfills missing fields (PR #82)
- English phrase fallback no longer merges into non-English sessions (PR #81)

---

## [1.4.7] — 2026-03-03

### Changed
- Added a **Live Transcription Preview** toggle in Audio settings so browser interim transcript rendering can be enabled/disabled per user (PR #78)
- Fresh defaults for local Whisper STT now use multilingual `base` across installer, server fallback, and fresh UI state (PR #78)
- Installer Whisper bootstrap now resolves and normalizes `WHISPER_MODEL` from `.env` (supports quotes/comments/aliases like `tiny`, `base`, `small` and `.en` variants) (PR #78)

### Fixed
- Edge TTS voice now auto-switches on language change and validates language-compatible voice overrides to prevent language/voice mismatch (PR #78)
- English custom `en-*` Edge voice overrides are preserved during auto-reconcile; server-side English override detection is now gender-aware (PR #78)
- Local Whisper model management now cancels stale model downloads and syncs active server model state on startup (PR #79)

---

## [1.4.6] — 2026-03-03

### Added
- Live interim transcription preview in chat input during voice recording (PR #75)
- OpenAI TTS voice options expanded to all 13 supported voices (PR #72)
- Voice interaction sounds upgraded from oscillator beeps to custom MP3 effects (PR #70)

### Changed
- System notifications in chat now render as collapsible strips (PR #69)
- Kanban task IDs and session labels are now human-readable (PR #67)

### Fixed
- Voice audio playback quality improvements (PR #74)
- Chat panel remains mounted during tab switches to avoid voice/session disruption (PR #71)
- Chat keydown handling now safely guards IME composition input (PR #68)

---

## [1.4.5] — 2026-03-01

### Added
- **Task board** with full kanban workflow: drag-and-drop, agent execution, proposals, SSE live updates, board configuration, and audit log (PR #61)
- **Gateway restart button** in the top bar for one-click gateway restarts (PR #49 by @jamesjmartin)
- **File browser operations**: rename, move, trash, and restore files from the workspace panel (PR #44)
- Deployment guides for three topology scenarios: localhost, LAN/tailnet, and public cloud (PR #60)
- Updater now resolves the latest published GitHub release instead of defaulting to master HEAD (PR #45)

### Fixed
- Server build (`build:server`) now included in `npm run build`; `npm run prod` runs both builds (PR #47 by @jamesjmartin)
- Memory collapse toggle: first click to expand no longer silently ignored due to key mismatch and nullish default (PR #62 by @jamesjmartin)
- Kanban board columns scroll vertically when tasks overflow viewport (PR #63)
- Switching TTS provider no longer sends the previous provider's model ID, which caused 400 errors

### Contributors
- **@jamesjmartin** -- build fix (#47), gateway restart button (#49), memory toggle fix (#62)

---

## [1.4.3] — 2026-02-27

### Added
- Update-available badge in status bar with server-side version check (PR #31)
- Cron UX rework: "When done" framing, auto-detected channels, context-aware placeholders (PR #32)
- WS proxy and SSE connections tagged with unique IDs for structured logging
- WS keepalive pings (30s) prevent silent connection drops during idle
- Connection close logs include duration and message counts
- Installer detects port conflicts before writing config (closes #38)

### Fixed
- Gateway token removed as login password, login-only scrypt hash (PR #33)
- Login rate limit tightened to 5 req/min (PR #33)
- Server refuses to start network-exposed without auth (PR #33)
- WS proxy path/port validation prevents proxying to arbitrary hosts (PR #33)
- TTS fallback now works for non-Latin scripts (PR #33)
- WS proxy challenge-nonce timing race causing failed device identity injection
- Config mutations via typed updateConfig() instead of unsafe direct writes
- ChatContext render loops from unmemoized hook return values
- AudioContext singleton prevents competing audio contexts during voice input
- STT sync race where recognition started before audio context was ready
- Gateway reconnect no longer killed by stale keepalive state
- Installer traps for cleanup, build rollback on failure
- Cron delivery-only failures show warning instead of error (PR #32)

### Changed
- ChatContext split into 4 composable hooks (useChatMessages, useChatStreaming, useChatRecovery, useChatTTS)
- Normalized config references across .env.example, README, and CONFIGURATION.md

---

## [1.4.0] — 2026-02-26

### Added
- **`nerve update` command** — git-based updater with automatic rollback. Supports `--dry-run`, `--version`, `--rollback`, `--no-restart`, and `--verbose` flags. See [docs/UPDATING.md](docs/UPDATING.md).
- Memory filenames are no longer restricted to `YYYY-MM-DD.md` format — any safe filename is accepted (PR #29).

### Fixed
- `git checkout` during updates now uses `--force` to handle dirty working trees.
- `/api/version` endpoint is now public (required for updater health checks with auth enabled).

---

## [1.3.0] — 2026-02-18

### Added
- Multilingual voice control across 12 languages: `en`, `zh`, `hi`, `es`, `fr`, `ar`, `bn`, `pt`, `ru`, `ja`, `de`, `tr`.
- Language and phrase APIs for runtime voice configuration:
  - `GET/PUT /api/language`
  - `GET /api/language/support`
  - `GET/PUT /api/transcribe/config`
  - `GET /api/voice-phrases`
  - `GET /api/voice-phrases/status`
  - `GET/PUT /api/voice-phrases/:lang`
- Event-driven realtime chat streaming pipeline (PR #16): direct WebSocket-driven chat updates, reduced transcript polling, and recovery-aware rendering.
- Mutex-protected env writer (`server/lib/env-file.ts`) to serialize `.env` updates.

### Changed
- Voice language is now explicit (auto-detect removed from UI flow).
- Default/fallback language behavior is English (`en`) for missing/invalid values.
- Primary env key is now `NERVE_LANGUAGE` (legacy `LANGUAGE` remains a read fallback).
- Wake phrase behavior is single-primary-phrase per language (custom phrase takes precedence).
- Settings categories are now `Connection`, `Audio`, and `Appearance`.
- Voice phrase overrides now persist as runtime state at `~/.nerve/voice-phrases.json` (configurable via `NERVE_VOICE_PHRASES_PATH`).
- Local STT default model is now multilingual `tiny`.
- Chat rendering now prefers event-first WebSocket updates instead of periodic full-history polling (PR #16).
- Setup/config flow now uses one bundled consent prompt for OpenClaw gateway config patches, including `gateway.tools.allow` updates for cron management (PR #15).
- UI is now fully responsive across desktop, tablet, and mobile with adaptive small-screen navigation and controls (PR #24).

### Fixed
- Unicode-safe stop/cancel matching for non-Latin scripts (removed brittle `\b` behavior).
- Reduced Latin stop-phrase false positives inside larger words.
- Wake phrase edits now apply immediately in-session (no page refresh required).
- Edge TTS SSML locale now derives from selected voice locale (not hardcoded `en-US`).
- Improved 4xx/5xx separation for language/transcribe config update failures.
- Improved voice-phrase modal reliability (load/save error handling and request-abort race handling).
- Accessibility: icon-only remove-phrase controls now include accessible labels.
- `ws-proxy` now enriches `PATH` before `openclaw` CLI calls, fixing restricted RPC methods under nvm/systemd environments (PR #12).
- Session and memory row actions are now reliably accessible on touch devices (no hover-only dependency) (PR #24).

### Documentation
- Updated API, architecture, configuration, troubleshooting, installer notes, and README to match multilingual voice behavior and runtime config.
- Removed internal planning notes from public docs.
