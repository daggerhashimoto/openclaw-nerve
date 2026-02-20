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

   # Terminal 2 — Backend with file watching
   npm run dev:server
   ```

5. Open **http://localhost:3080**. The frontend proxies API requests to the backend on `:3081`.

## Project Structure

```
nerve/
├── src/                        # Frontend (React + TypeScript)
│   ├── features/               # Feature modules (co-located)
│   │   ├── auth/               # Login page, auth gate, session hook
│   │   ├── chat/               # Chat panel, messages, input, search
│   │   ├── voice/              # Push-to-talk, wake word, audio feedback
│   │   ├── tts/                # Text-to-speech playback
│   │   ├── sessions/           # Session list, tree, spawn dialog
│   │   ├── workspace/          # Tabbed panel: memory, crons, skills, config
│   │   ├── file-browser/       # Workspace file browser with tabbed editor
│   │   ├── settings/           # Settings drawer (appearance, audio, connection)
│   │   ├── command-palette/    # ⌘K command palette
│   │   ├── markdown/           # Markdown renderer, code block actions
│   │   ├── charts/             # Inline chart extraction and rendering
│   │   ├── memory/             # Memory editor, add/delete dialogs
│   │   ├── activity/           # Agent log, event log
│   │   ├── dashboard/          # Token usage, memory list, limits
│   │   └── connect/            # Connect dialog (gateway setup)
│   ├── components/             # Shared UI components
│   │   ├── ui/                 # Primitives (button, input, dialog, etc.)
│   │   └── skeletons/          # Loading skeletons
│   ├── contexts/               # React contexts (Chat, Session, Gateway, Settings)
│   ├── hooks/                  # Shared hooks (WebSocket, SSE, keyboard, etc.)
│   ├── lib/                    # Utilities (formatting, themes, sanitize, etc.)
│   ├── types.ts                # Shared type definitions
│   └── test/                   # Test setup
├── server/                     # Backend (Hono + TypeScript)
│   ├── routes/                 # API route handlers
│   ├── services/               # TTS engines, Whisper, usage tracking
│   ├── lib/                    # Utilities (config, WS proxy, file watcher, etc.)
│   ├── middleware/             # Auth, rate limiting, security headers, caching
│   └── app.ts                  # Hono app assembly
├── config/                     # TypeScript configs for server build
├── scripts/                    # Setup wizard and utilities
├── docs/                       # Documentation
├── vitest.config.ts            # Test configuration
├── eslint.config.js            # Lint configuration
└── vite.config.ts              # Vite build configuration
```

### Key conventions

- **Feature modules** live in `src/features/<name>/`. Each feature owns its components, hooks, types, and tests.
- **`@/` import alias** maps to `src/` — use it for cross-feature imports.
- **Tests are co-located** with source files: `foo.ts` → `foo.test.ts`.
- **Server routes** are thin handlers that delegate to `services/` and `lib/`.

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
2. **Branch from `master`**: `git checkout -b feat/my-feature`.
3. **Keep PRs focused** — one feature or fix per PR.
4. **Ensure all checks pass** before requesting review:
   ```bash
   npm run lint
   npm run build
   npm run build:server
   npm test -- --run
   ```
5. **Fill out the PR template** — describe what, why, and how.
6. **Include tests** for new features. Bug fixes should include a regression test when feasible.
7. **Screenshots welcome** for UI changes.
8. A maintainer will review, possibly request changes, and merge.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
