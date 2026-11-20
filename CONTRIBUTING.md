# Contributing to Nerve

Thanks for helping. This guide gets you from a clone to a merged pull request.

## Table of contents

- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Adding a feature](#adding-a-feature)
- [Testing](#testing)
- [Linting](#linting)
- [Commit conventions](#commit-conventions)
- [Pull request process](#pull-request-process)
- [License](#license)

## Development setup

### Prerequisites

- **Node.js 22 or later** (`package.json` engines; CI and `.nvmrc` use 22). Check with `node --version`.
- **npm** (bundled with Node).
- A running [OpenClaw](https://github.com/openclaw/openclaw) gateway. Nerve speaks gateway connect protocol v4, which current OpenClaw releases require.

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

3. **Configure the environment:**
   ```bash
   npm run setup
   ```
   The interactive wizard detects your gateway and writes `.env`. You can also copy `.env.example` to `.env` and fill it in by hand. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

4. **Start the dev servers** in two terminals:
   ```bash
   # Terminal 1: Vite frontend with HMR on :3080
   npm run dev

   # Terminal 2: backend with file watching on :3081
   PORT=3081 npm run dev:server
   ```

5. Open **http://localhost:3080**. Vite proxies `/api` and `/ws` to the backend on `:3081`.

   `npm run dev:server` does not pick `:3081` on its own. Without `PORT=3081` the backend uses its normal default, `:3080`, and clashes with Vite.

### npm scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Vite dev server (frontend) |
| `npm run dev:server` | Backend with `tsx watch` |
| `npm run build` | Type-check, build the frontend to `dist/`, then run `build:server` |
| `npm run build:server` | Compile the server to `server-dist/` and the updater CLI to `bin-dist/` |
| `npm start` | Run the built server (`node server-dist/index.js`) |
| `npm run prod` | `build`, then start |
| `npm run start:server` | Run the server from source with `tsx`, no watch |
| `npm run preview` | Vite preview of the built frontend |
| `npm run setup` | Interactive setup wizard |
| `npm run update` | Built-in updater (see [docs/UPDATING.md](docs/UPDATING.md)) |
| `npm test` | Vitest (watch mode in a terminal) |
| `npm run test:coverage` | Vitest with V8 coverage |
| `npm run lint` | ESLint |

## Project structure

```
openclaw-nerve/
├── src/                    # Frontend (React 19 + TypeScript + Tailwind CSS v4)
│   ├── features/           # One directory per product surface:
│   │                       #   activity, auth, beads, charts, chat, command-palette,
│   │                       #   connect, dashboard, file-browser, kanban, markdown,
│   │                       #   memory, sessions, settings, tts, voice, workspace
│   ├── components/         # App chrome and shared UI (ui/ holds primitives)
│   ├── contexts/           # Gateway, Settings, Session and Chat contexts
│   ├── hooks/              # Cross-cutting hooks (WebSocket, chat parts, SSE, shortcuts)
│   ├── lib/                # Themes, fonts, formatting, sanitising, constants
│   ├── test/               # Vitest setup and a mock gateway
│   ├── types.ts            # Shared client types
│   ├── App.tsx             # Layout and wiring
│   └── main.tsx            # Entry point
├── server/                 # Backend (Hono + TypeScript)
│   ├── routes/             # API routes, mounted in server/app.ts
│   ├── lib/                # Config, gateway clients, WS proxy, kanban store, file helpers
│   ├── services/           # TTS and speech-to-text providers, Claude Code usage
│   ├── middleware/         # Auth, security headers, cache headers, rate limits, errors
│   ├── app.ts              # Hono app assembly
│   └── index.ts            # HTTP/HTTPS server startup
├── scripts/                # Setup wizard (setup.ts) and its helpers
├── bin/                    # Updater CLI entry point
├── config/                 # TypeScript project configs
├── public/                 # Static assets (fonts, sounds, highlight themes)
├── skills/                 # Agent skill shipped with Nerve (nerve-kanban)
├── docs/                   # User, operator and contributor docs
├── install.sh              # One-command installer
├── DESIGN.md               # UI design system (source of truth for UI work)
├── vite.config.ts
├── vitest.config.ts
└── eslint.config.js
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes each part in more detail.

### Key conventions

- **Feature modules** live in `src/features/<name>/`. Put new UI work in the closest existing feature instead of starting a parallel structure.
- **UI work follows [DESIGN.md](DESIGN.md)**: colours, type, the pane state marker, the 28px row unit, motion and copy rules. Reuse its tokens and components instead of adding one-off styles.
- **`@/` import alias** maps to `src/`.
- **Tests sit next to the code** they cover (`foo.ts` and `foo.test.ts`).
- **Cross-feature imports** exist; keep them narrow and free of cycles.
- **Server routes** live in `server/routes/` and are mounted in `server/app.ts`. Shared logic goes in `server/lib/`, provider clients in `server/services/`, request handling in `server/middleware/`.

## Adding a feature

### Frontend

1. Add to an existing `src/features/<name>/` directory, or create one if the surface is new.
2. Keep components, hooks, types and pure logic together; put React-free logic in plain modules so it is easy to test.
3. Export the public pieces from an `index.ts` barrel if the feature has one.
4. Wire it into the app, usually through `App.tsx` or an existing panel. Lazy-load heavy or optional panels.
5. Write tests alongside the source.

### Backend

1. Add a route file in `server/routes/<name>.ts`, or extend the closest existing one.
2. Validate request bodies (Zod is the usual choice) and, as most routes do, add a rate-limit preset from `server/middleware/rate-limit.ts`.
3. Put shared logic in `server/lib/` and external provider clients in `server/services/`.
4. Mount the route in `server/app.ts`.
5. Add tests next to it, for example `server/routes/<name>.test.ts`.

### Both

- Update `src/types.ts` when you add WebSocket or API message shapes the client uses.
- New environment variables go in `.env.example` and [docs/CONFIGURATION.md](docs/CONFIGURATION.md) in the same PR.
- New or changed endpoints go in [docs/API.md](docs/API.md).

## Testing

Tests use [Vitest](https://vitest.dev) with jsdom, and [Testing Library](https://testing-library.com/docs/react-testing-library/intro) for components.

```bash
npm test                  # watch mode, re-runs on save
npm test -- --run         # single run, as CI does
npm run test:coverage     # V8 coverage report (text, HTML, lcov)
```

- Co-locate tests with the source: `useVoiceInput.ts` and `useVoiceInput.test.ts`.
- Use `@testing-library/react` for components and plain Vitest for logic.
- Setup lives in `src/test/setup.ts` (it imports `@testing-library/jest-dom`).
- Coverage excludes config files, type declarations, test files and `src/test/`.

## Linting

ESLint 9 with a flat config (`eslint.config.js`): `@eslint/js` and `typescript-eslint` recommended rules, React Hooks and React Refresh.

```bash
npm run lint
```

- `react-hooks/exhaustive-deps` is a warning: keep dependency arrays honest.
- Type checking is separate: every TypeScript project in `config/` is `strict`, and `npm run build` runs `tsc -b`.
- `dist/`, `server-dist/` and `.worktrees/` are ignored.

CI fails if lint fails, so fix issues before you push.

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
```

**Types:** the history uses `feat`, `fix`, `docs`, `test` and `chore`. Other Conventional Commits types such as `refactor` or `perf` are fine when they fit.

**Scope** (optional): the area you touched, such as `chat`, `sessions`, `file-browser`, `kanban`, `crons`, `setup`, `installer`, `audio`.

Write the description in lower case and say what changes for the user. Examples from the history:

```
feat(sessions): pin sessions to the top of the sidebar
fix(chat): keep the typed draft when voice input records or sends
fix(setup): treat a tunneled or containerised gateway as remote
test(kanban): drive the run poller with simulated timers
```

Pull requests are usually squash-merged, so the PR title becomes the commit subject (GitHub appends the PR number). Use the same format for the title.

## Pull request process

1. **Open an issue first** for non-trivial changes, so the approach can be discussed before you write code.
2. **Branch from `master`** (`git checkout -b feat/my-feature`) and open the PR against `master`. `master` is protected, so maintainers use branches too.
3. **Keep PRs focused**: one feature or fix per PR.
4. **Run the CI checks locally** before asking for review:
   ```bash
   npm run lint
   npm run build          # also runs build:server
   npm test -- --run
   ```
5. **Fill out the PR template**: what, why and how.
6. **Include tests** for new features. Bug fixes should add a regression test when feasible.
7. **Show UI changes** with a screenshot or short recording, and check them against [DESIGN.md](DESIGN.md).
8. A maintainer reviews (see [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md) for what reviewers look for), may ask for changes or push small fixes to your branch (when your fork allows it), and merges.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
