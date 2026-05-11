# Repository Guidelines

## Project Structure & Module Organization
Nerve follows a split-stack architecture with a React frontend and a Hono-based Node.js backend.

- **Frontend (`.\src`)**: A React 19 SPA organized into feature modules (`.\src\features`). State is managed via specialized contexts: `GatewayContext` (WebSocket/RPC), `SessionContext` (agent lifecycle), and `ChatContext` (streaming/TTS).
- **Backend (`.\server`)**: A Hono server acting as a WebSocket proxy to the OpenClaw gateway, while providing REST APIs for file operations, TTS, and event streaming (SSE).
- **Tooling (`.\bin`, `.\scripts`)**: CLI tools for setup and automated updates.

## Build, Test, and Development Commands
- **Install dependencies**: `npm install`
- **Initial setup**: `npm run setup`
- **Frontend development**: `npm run dev` (defaults to port 3080)
- **Backend development**: `PORT=3081 npm run dev:server` (use a different port to avoid Vite collision)
- **Full build**: `npm run build`
- **Run tests**: `npm test`
- **Linting**: `npm run lint`

## Coding Style & Naming Conventions
- **Language**: Strict TypeScript across the stack.
- **Linting**: ESLint is enforced, specifically requiring exhaustive dependencies for React hooks.
- **Organization**: New features should be placed in `.\src\features\<name>` with internal `components/`, `hooks/`, and `operations/`.
- **UI**: Components use **Tailwind CSS v4** and **shadcn/ui** primitives.

## Testing Guidelines
- **Framework**: Vitest.
- **Location**: Frontend tests reside alongside components or in `.\src\test`. Backend tests use `.test.ts` suffix in `.\server`.
- **Execution**: Run `npm test` for the full suite or `npx vitest <file>` for a specific test.

## Commit & Pull Request Guidelines
- **Commit Messages**: Follow the `<type>(<scope>): <description>` pattern (e.g., `feat(ui): add command palette`, `fix(chat): resolve streaming gap`).
- **Common Scopes**: `ui`, `chat`, `sessions`, `file-browser`, `server`, `setup`.
- **Workflow**: Develop on feature branches and submit PRs to the `next` branch for testing before they land in `master`.
