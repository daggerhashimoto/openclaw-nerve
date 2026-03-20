# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Highlights

**Workspace context now follows the owning top-level agent**. File browser state, Memory, Config, and Skills now switch with the selected top-level agent instead of leaking across agents, and dirty editor tabs now block cross-agent switches with an explicit save / discard / cancel choice (PR #123).

**Agent runtime flows got tighter**. Subagents can now choose whether they stay visible after one-shot runs, subagent deletion is more reliable, and the model catalog waits longer on cold starts so configured Codex and other models are more likely to appear in the spawn dialog (PR #119, PR #120, PR #124).

**Installer and mobile edge cases got another hardening pass**. Tailscale setup now supports distinct IP and Serve flows, wake word is disabled on mobile web, and the right sidebar can collapse narrower on smaller screens (PR #116, PR #118, PR #122).

### Added
- Tailscale IP and Tailscale Serve setup flows in the installer, with matching installer-step documentation (PR #116)
- An **After run** selector for one-shot subagents, with **Keep** and **Delete** cleanup options (PR #120)

### Changed
- Workspace scope is now derived from the owning top-level agent, including when viewing subagent sessions (PR #123)
- File browser tabs, selection state, drafts, Memory, Config, and Skills now persist per top-level agent instead of globally (PR #123)
- Cross-agent workspace switches now show **Save and switch**, **Discard and switch**, or **Cancel** when dirty editor tabs exist (PR #123)
- Model catalog fetches now allow a longer cold-start timeout before giving up, so configured Codex and other models appear more reliably in the spawn dialog (PR #124)
- Mobile web now disables wake word and points users to manual mic activation instead (PR #118)
- Right sidebar resizing now allows a narrower minimum width (PR #122)

### Fixed
- Subagent session deletion no longer fails on the Nerve side when the gateway closes a proxied WebSocket normally during delete flows (PR #119)
- Agent-scoped workspace switching no longer leaks same-path editor state, save toasts, watcher refreshes, or async file reads across top-level agents (PR #123)
- Tailscale origin handling is more robust during setup and follow-up gateway patching (PR #116)

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
