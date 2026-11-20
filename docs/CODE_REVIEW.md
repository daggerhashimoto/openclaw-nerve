# Code review guide

Review Nerve as it exists today, not as an imaginary perfect architecture.

## First principle

Prefer consistency with the surrounding subsystem over introducing a brand-new pattern just because it looks cleaner in isolation. Nerve has strong structure, but it is still a living codebase with some mixed styles and a few rough edges. Good review reduces drift. It does not create more of it.

## Repo reality, right now

### TypeScript

- Every TypeScript project in `config/` is `strict`.
- Explicit `any` is almost gone: `server/lib/tts-config.ts` and one test file still use it, behind `eslint-disable` comments. Do not spread it. If you can tighten a touched area safely, do it.
- There is no `@ts-ignore`. `@ts-expect-error` appears only in a few tests, each with a reason. Keep it that way.

### Frontend structure

- The frontend is organized mostly by feature under `src/features/`.
- Shared layers live in `src/components/`, `src/contexts/`, `src/hooks/`, and `src/lib/`.
- Large UI surfaces are lazy-loaded: settings, the command palette, sessions, workspace, kanban, charts, the markdown renderer, and file editing.
- Cross-feature imports do exist. Keep them narrow, stable, and free of circular dependencies.
- [DESIGN.md](../DESIGN.md) is the source of truth for the UI: tokens, the pane state marker, the 28px row unit, motion, and sentence-case copy.

### React patterns worth preserving

- Functional components and hooks only.
- Stable callbacks and memoized derived values matter in hot paths like chat, sessions, file-browser, workspace switching, and kanban.
- Ref-synchronized state is used in a few places where callbacks need fresh values without constantly re-registering listeners.
- Optional or heavy panels are usually wrapped in `Suspense` and `PanelErrorBoundary`.

### Backend structure

- Backend routes live in `server/routes/` and are mounted from `server/app.ts`.
- Shared behavior lives in `server/lib/`, `server/services/`, and `server/middleware/`.
- Many write endpoints validate with Zod, either through `zValidator` (agent log, memories, TTS) or `schema.safeParse` (crons, gateway, kanban, sessions). Others still parse by hand. New write endpoints should validate input. When you touch an older route, tightening validation is a good upgrade if it stays low-risk.
- Rate limiting is per route, not global. Most API routes opt in with a preset from `server/middleware/rate-limit.ts`; the file browser, SSE, voice-phrase and usage-limit routes do not.
- File and state mutations that can race are usually protected with a mutex (`server/lib/mutex.ts`).
- `/api/events` is an SSE endpoint and must not be buffered or compressed. `/api/files/raw` is also excluded from compression.

### Security and config baseline

- Auth, origin handling, body limits, and WebSocket allowlists are part of the product surface, not optional polish.
- `HOST=0.0.0.0` without auth is intentionally blocked unless the explicit insecure override is set.
- New env vars should land in `.env.example` and `docs/CONFIGURATION.md` in the same PR.

## Review priorities

1. Correctness and regressions
2. Security and data exposure
3. Consistency with nearby patterns
4. Operability, tests, docs, and maintainability
5. Style polish

## Review checklist

### General

- [ ] The behavior change is intentional, and the PR description matches the diff.
- [ ] Commands, ports, env vars, and docs match the current repo behavior.
- [ ] New files live in the right area instead of creating a parallel structure.
- [ ] Naming follows nearby code more than abstract preference.
- [ ] Dead branches, debug noise, and commented-out code are not slipping in.

### Frontend

- [ ] Changes fit the current feature, context, and hook split used in that part of the app.
- [ ] Chat, sessions, file-browser, workspace, and kanban changes avoid obvious rerender or subscription churn.
- [ ] Timers, listeners, sockets, observers, and intervals clean up correctly.
- [ ] Heavy or optional UI stays lazy-loaded unless there is a clear reason to change that.
- [ ] UI changes follow DESIGN.md instead of adding one-off colors, spacing, or motion.
- [ ] Error states, loading states, and mobile behavior still make sense.
- [ ] Keyboard navigation and focus behavior are preserved for dialogs, drawers, and menus.

### Backend

- [ ] New route files are mounted in `server/app.ts`.
- [ ] Auth, CORS, body limits, and rate limiting are preserved or improved. A new route either uses a rate-limit preset or has a reason not to.
- [ ] Request bodies are validated or parsed narrowly, especially on write endpoints.
- [ ] Shared gateway helpers are reused instead of duplicating request logic.
- [ ] File writes remain atomic where concurrent access is possible.
- [ ] SSE and WebSocket behavior are not broken by buffering, compression, or auth changes.

### Tests

- [ ] New parsing, state, routing, or persistence logic has tests where the repo already tests similar code.
- [ ] Existing tests were updated when behavior changed.
- [ ] Assertions were not weakened just to get green.

### Docs and operations

- [ ] User-facing changes update README or docs when needed.
- [ ] New config or migration work updates `.env.example`, setup docs, and upgrade notes.
- [ ] Deployment, updater, or gateway-integration changes keep the docs honest.

## High-signal review comments

Good review comments in this repo are concrete:

- point to the exact mismatch
- explain the user or operator impact
- suggest the smallest fix that matches local patterns

Examples:

- "This route writes state but skips input validation, while nearby write routes parse JSON explicitly. Can we add a schema or a narrow parser here?"
- "This panel is now imported eagerly, which pulls file editor code into the initial bundle. Was that intentional?"
- "The doc says `npm run dev:server` uses `:3081`, but the script only does that when `PORT=3081` is set."

## Avoid this

- Enforcing absolutes the repo does not actually follow
- Requesting wide refactors in a focused bugfix PR
- Rejecting a change for not matching an architecture that is not present in the codebase
- Treating review as style theater while missing correctness or security issues
