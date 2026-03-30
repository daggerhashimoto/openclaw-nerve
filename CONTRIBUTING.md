# Contributing to Nerve

Thanks for wanting to help! This guide covers everything you need to start contributing.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Adding a Feature](#adding-a-feature)
- [Testing](#testing)
- [Linting](#linting)
- [Commit Conventions](#commit-conventions)
- [Pull Request Process](#pull-request-process)
- [License](#license)

## Development Setup

### Prerequisites

- **Node.js ≥ 22** — check with `node --version`
- **npm** (bundled with Node)
- A running [OpenClaw](https://github.com/openclaw/openclaw) gateway

### Steps

1. **Fork and clone** the repository:
   ```bash
   git clone https://github.com/<your-username>/openclaw-nerve.git
   cd openclaw-nerve
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   npm run setup
   ```
   The interactive wizard auto-detects your gateway token and writes `.env`. Alternatively, copy `.env.example` to `.env` and fill in values manually.

4. **Start development servers** (two terminals):
   ```bash
   # Terminal 1 — Vite frontend with HMR
   npm run dev

   # Terminal 2 — Backend with file watching on a separate port
   PORT=3081 npm run dev:server
   ```

5. Open **http://localhost:3080**. In this split setup, Vite proxies API and WebSocket traffic to the backend on `:3081`.

   `npm run dev:server` does not default to `:3081` on its own. Without `PORT=3081`, the backend uses its normal default of `:3080`.

## Project Structure

```
openclaw-nerve/
├── src/                        # Frontend (React + TypeScript)
│   ├── features/               # Product surfaces and feature-local helpers
│   │   ├── activity/           # Agent log and event log panels
│   │   ├── auth/               # Login gate and auth flows
│   │   ├── charts/             # Inline chart extraction and renderers
│   │   ├── chat/               # Chat UI, message loading, streaming operations
│   │   ├── command-palette/    # ⌘K command palette
│   │   ├── connect/            # Gateway connect dialog
│   │   ├── dashboard/          # Token usage and memory list views
│   │   ├── file-browser/       # Workspace tree, tabs, editors
│   │   ├── kanban/             # Task board, proposals, execution views
│   │   ├── markdown/           # Markdown and tool output rendering
│   │   ├── memory/             # Memory editing dialogs and hooks
│   │   ├── sessions/           # Session list, tree helpers, spawn flows
│   │   ├── settings/           # Settings drawer and audio controls
│   │   ├── tts/                # Text-to-speech playback/config
│   │   ├── voice/              # Push-to-talk, wake word, audio feedback
│   │   └── workspace/          # Workspace-scoped panels and state
│   ├── components/             # Shared UI building blocks
│   ├── contexts/               # Gateway, session, chat, and settings contexts
│   ├── hooks/                  # Cross-cutting hooks used across features
│   ├── lib/                    # Shared frontend utilities
│   ├── App.tsx                 # Main layout and panel composition
│   └── main.tsx                # Frontend entry point
├── server/                     # Backend (Hono + TypeScript)
│   ├── routes/                 # API routes, mounted from server/app.ts
│   │   ├── auth.ts
│   │   ├── gateway.ts
│   │   ├── sessions.ts
│   │   ├── workspace.ts
│   │   ├── files.ts
│   │   ├── file-browser.ts
│   │   ├── kanban.ts
│   │   ├── crons.ts
│   │   ├── memories.ts
│   │   ├── tts.ts
│   │   ├── transcribe.ts
│   │   └── ...plus route tests beside many handlers
│   ├── services/               # Whisper, TTS, and related backend services
│   ├── lib/                    # Config, gateway helpers, cache, file watchers, mutexes
│   ├── middleware/             # Auth, security headers, cache, limits
│   ├── app.ts                  # Hono app assembly
│   └── index.ts                # HTTP/HTTPS server startup
├── bin/                        # CLI/update entrypoints
├── config/                     # TypeScript build configs
├── docs/                       # User and operator docs
├── public/                     # Static assets
├── scripts/                    # Setup wizard and utilities
├── vite.config.ts              # Vite config
├── vitest.config.ts            # Vitest config
└── eslint.config.js            # ESLint flat config
```

### Key conventions

- **Feature modules** usually live in `src/features/<name>/`. Keep new UI work inside the closest existing feature instead of inventing a parallel structure.
- **`@/` import alias** maps to `src/`.
- **Tests are usually nearby** the code they cover, especially for hooks, routes, and utilities.
- **Cross-feature imports exist**, but keep them narrow and intentional. Reuse small helpers, avoid circular dependencies, and do not spread one-off shortcuts across the app.
- **Server routes** live in `server/routes/` and are mounted in `server/app.ts`. Shared logic belongs in `server/lib/`, `server/services/`, or `server/middleware/`.

## Adding a Feature

### Frontend

1. Create a directory in `src/features/<your-feature>/`.
2. Add your components, hooks, and types inside.
3. Export the public API from an `index.ts` barrel file.
4. Wire it into the app (usually via `App.tsx` or an existing panel component).
5. Write tests alongside your source files.

### Backend

1. Create a route file in `server/routes/<your-feature>.ts`.
2. If you need business logic, add a service in `server/services/`.
3. Register the route in `server/app.ts`.
4. Add tests (co-located, e.g. `server/routes/<your-feature>.test.ts`).

### Both

- Update types in `src/types.ts` if you're adding new WebSocket or API message shapes.
- If your feature needs new environment variables, add them to `.env.example` and document them in `docs/CONFIGURATION.md`.

## Testing

Tests use [Vitest](https://vitest.dev) with jsdom for React component testing and [Testing Library](https://testing-library.com/docs/react-testing-library/intro) for assertions.

```bash
npm test                  # Watch mode (re-runs on save)
npm test -- --run         # Single run (CI-friendly)
npm run test:coverage     # With V8 coverage report (text + HTML + lcov)
```

### Guidelines

- Co-locate tests with source: `useVoiceInput.ts` → `useVoiceInput.test.ts`.
- Use `@testing-library/react` for component tests, plain Vitest for logic.
- Test setup lives in `src/test/setup.ts` (imports `@testing-library/jest-dom`).
- Coverage excludes config files, type declarations, and test files themselves.

## Linting

ESLint 9 with flat config. TypeScript-ESLint + React Hooks + React Refresh rules.

```bash
npm run lint
```

Key rules:
- **`react-hooks/exhaustive-deps: warn`** — keep dependency arrays honest.
- **TypeScript strict mode** throughout.
- Ignores `dist/` and `server-dist/`.

Fix issues before committing. Your PR will fail CI if lint doesn't pass.

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`

**Scope** (optional): the feature or area — `chat`, `tts`, `voice`, `server`, `sessions`, `workspace`, etc.

**Examples:**
```
feat(chat): add image lightbox for inline images
fix(tts): handle empty audio response from Edge TTS
docs: update configuration guide with new env vars
refactor(server): extract TTS cache into service module
test(voice): add wake-word persistence tests
```

## Pull Request Process

1. **Open an issue first** for non-trivial changes. Discuss the approach before writing code.
2. **Create a branch from `master`**: `git checkout -b feat/my-feature`, then open your PR back into `master`.
3. **Use branches even if you have GitHub Write access**. `master` is protected, so direct pushes there are not the normal workflow.
4. **Keep PRs focused** — one feature or fix per PR.
5. **Ensure all checks pass** before requesting review:
   ```bash
   npm run lint
   npm run build
   npm run build:server
   npm test -- --run
   ```
6. **Fill out the PR template** — describe what, why, and how.
7. **Include tests** for new features. Bug fixes should include a regression test when feasible.
8. **Screenshots welcome** for UI changes.
9. A maintainer may push small fixes to your PR branch when GitHub allows it, but fork permissions can vary.
10. A maintainer will review, possibly request changes, and merge.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
