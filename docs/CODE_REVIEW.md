# Code Review Guide

Standards, patterns, and review checklist for the Nerve codebase.

---

## Coding Standards

### TypeScript

- **Strict mode** enabled across all tsconfig project references
- **Explicit types** on all public interfaces, context values, and hook returns
- **Discriminated unions** for message types (`GatewayEvent | GatewayRequest | GatewayResponse` via `type` field)
- **Typed event payloads** — `AgentEventPayload`, `ChatEventPayload`, `CronEventPayload` instead of `any`
- **Zod validation** on all API request bodies (server-side)
- **No `any`** — use `unknown` with type narrowing

### React

- **Functional components only** — no class components
- **`useCallback` / `useMemo`** on all callbacks and derived values passed to children or used in dependency arrays
- **`React.memo`** is not used broadly; instead, stable references via `useMemo`/`useCallback` prevent unnecessary re-renders
- **Ref-based state access** in callbacks that shouldn't trigger re-registration (e.g., `currentSessionRef`, `isGeneratingRef`, `soundEnabledRef`)
- **ESLint annotations** when intentionally breaking rules: `// eslint-disable-next-line react-hooks/set-state-in-effect -- valid: <reason>`

### Naming

- **Files:** PascalCase for components (`ChatPanel.tsx`), camelCase for hooks/utils (`useWebSocket.ts`, `helpers.ts`)
- **Contexts:** `<Name>Context` with `<Name>Provider` and `use<Name>` hook co-located in same file
- **Feature directories:** kebab-case (`command-palette/`)
- **Types:** PascalCase interfaces/types, `I` prefix NOT used

---

## Architectural Patterns

### 1. Feature-Based Directory Structure

```
src/features/
  chat/
    ChatPanel.tsx          # Main component
    components/            # Sub-components
    operations/            # Pure business logic (no React)
    types.ts               # Feature-specific types
    utils.ts               # Feature utilities
  sessions/
  workspace/
  settings/
  tts/
  voice/
  ...
```

Each feature is self-contained. Cross-feature imports go through context providers, not direct imports.

### 2. Context Provider Pattern

Every context follows the same structure:

```tsx
const MyContext = createContext<MyContextValue | null>(null);

export function MyProvider({ children }: { children: ReactNode }) {
  // State, effects, callbacks
  const value = useMemo<MyContextValue>(() => ({
    // All exposed values
  }), [/* dependencies */]);
  
  return <MyContext.Provider value={value}>{children}</MyContext.Provider>;
}

export function useMyContext() {
  const ctx = useContext(MyContext);
  if (!ctx) throw new Error('useMyContext must be used within MyProvider');
  return ctx;
}
```

Key characteristics:
- Context value is always `useMemo`-wrapped with explicit type annotation
- `null` default with runtime check in the hook
- Provider, context, and hook co-located in one file (ESLint `react-refresh/only-export-components` disabled with reason)

### 3. Ref-Synchronized State

For callbacks that need current state but shouldn't re-register:

```tsx
const currentSessionRef = useRef(currentSession);
useEffect(() => {
  currentSessionRef.current = currentSession;
}, [currentSession]);

// In callbacks: use currentSessionRef.current instead of currentSession
const handleSend = useCallback(async (text: string) => {
  await sendChatMessage({ sessionKey: currentSessionRef.current, ... });
}, [rpc]); // Note: currentSession NOT in deps
```

This pattern is used extensively in `ChatContext`, `SessionContext`, and `GatewayContext`.

### 4. Lazy Loading

Heavy components are code-split via `React.lazy`:

```tsx
const SettingsDrawer = lazy(() => import('@/features/settings/SettingsDrawer')
  .then(m => ({ default: m.SettingsDrawer })));
const CommandPalette = lazy(() => import('@/features/command-palette/CommandPalette')
  .then(m => ({ default: m.CommandPalette })));
const SessionList = lazy(() => import('@/features/sessions/SessionList')
  .then(m => ({ default: m.SessionList })));
const WorkspacePanel = lazy(() => import('@/features/workspace/WorkspacePanel')
  .then(m => ({ default: m.WorkspacePanel })));
```

Each wrapped in `<Suspense>` and `<PanelErrorBoundary>` for graceful degradation.

### 5. Operations Layer (Pure Logic Extraction)

`ChatContext` delegates to pure functions in `features/chat/operations/`:

```
operations/
  index.ts                  # Re-exports all operations
  loadHistory.ts            # loadChatHistory()
  sendMessage.ts            # buildUserMessage(), sendChatMessage()
  streamEventHandler.ts     # classifyStreamEvent(), extractStreamDelta(), etc.
```

This separates React state management from business logic, making operations testable without rendering.

### 6. Event Fan-Out (Pub/Sub)

`GatewayContext` implements a subscriber pattern:

```tsx
const subscribersRef = useRef<Set<EventHandler>>(new Set());

const subscribe = useCallback((handler: EventHandler) => {
  subscribersRef.current.add(handler);
  return () => { subscribersRef.current.delete(handler); };
}, []);

// In onEvent:
for (const handler of subscribersRef.current) {
  try { handler(msg); } catch (e) { console.error(e); }
}
```

Consumers (`SessionContext`, `ChatContext`) subscribe in `useEffect` and receive all gateway events.

### 7. Smart Session Diffing

`SessionContext.refreshSessions()` preserves object references for unchanged sessions:

```tsx
setSessions(prev => {
  const prevMap = new Map(prev.map(s => [getSessionKey(s), s]));
  let hasChanges = false;
  const merged = newSessions.map(newSession => {
    const existing = prevMap.get(key);
    if (!existing) { hasChanges = true; return newSession; }
    const changed = existing.state !== newSession.state || ...;
    if (changed) { hasChanges = true; return newSession; }
    return existing; // Preserve reference
  });
  return hasChanges ? merged : prev;
});
```

### 8. Server Route Pattern (Hono)

Each route file exports a Hono sub-app:

```tsx
const app = new Hono();
app.get('/api/something', rateLimitGeneral, async (c) => { ... });
export default app;
```

Routes are mounted in `app.ts` via `app.route('/', route)`.

### 9. Gateway Tool Invocation

Server routes that need gateway interaction use the shared client:

```tsx
import { invokeGatewayTool } from '../lib/gateway-client.js';

const result = await invokeGatewayTool('cron', { action: 'list' });
```

### 10. Mutex-Protected File I/O

File operations that need atomicity use the mutex:

```tsx
import { createMutex } from '../lib/mutex.js';
const withLock = createMutex();

await withLock(async () => {
  const data = await readJSON(file, []);
  data.push(entry);
  await writeJSON(file, data);
});
```

### 11. Cached Fetch with Deduplication

Expensive operations use `createCachedFetch` which deduplicates in-flight requests:

```tsx
const fetchLimits = createCachedFetch(
  () => expensiveApiCall(),
  5 * 60 * 1000, // 5 min TTL
  { isValid: (result) => result.available }
);
```

---

## Server-Side Patterns

### Security

- **Authentication:** Session-cookie auth via `middleware/auth.ts`. When enabled, all `/api/*` routes (except auth/health) require a valid HMAC-SHA256 signed cookie. WebSocket upgrades checked in `ws-proxy.ts`
- **Session tokens:** Stateless signed cookies (`HttpOnly`, `SameSite=Strict`). Password hashing via scrypt. Gateway token accepted as fallback password
- **CORS:** Strict origin allowlist — only localhost variants and explicitly configured origins
- **Token exposure:** Managed gateway auth uses server-side token injection. `/api/connect-defaults` returns `token: null` and trust metadata instead of the raw gateway token
- **Device identity:** Ed25519 keypair for gateway WS auth (`~/.nerve/device-identity.json`). Required for operator scopes on OpenClaw 2026.2.19+
- **File serving:** MIME-type allowlist + directory traversal prevention + allowed prefix check
- **Body limits:** Configurable per-route (general API vs transcribe uploads)
- **Rate limiting:** Per-IP sliding window with separate limits for expensive operations
- **Credentials:** Browser connection config persists in `localStorage` as `oc-config`. Official managed gateway flows can keep the token empty; custom manual tokens may persist until cleared
- **Input validation:** Zod schemas on all POST/PUT request bodies

### Graceful Shutdown

`server/index.ts` handles SIGTERM/SIGINT:
1. Stop file watchers
2. Close all WebSocket connections
3. Close HTTP + HTTPS servers
4. Force exit after 5s drain timeout

### Dual HTTP/HTTPS

Server runs on both HTTP (port 3080) and HTTPS (port 3443). HTTPS auto-enables if `certs/cert.pem` + `certs/key.pem` exist. HTTPS is required for:
- Microphone access (secure context)
- WSS proxy (encrypted WebSocket)

The HTTPS server manually converts Node.js `req`/`res` to `fetch` `Request`/`Response` for Hono compatibility, with special handling for SSE streaming.

---

## Review Checklist

### All PRs

- [ ] TypeScript strict — no `any`, no `@ts-ignore`
- [ ] All new API endpoints have rate limiting middleware
- [ ] All POST/PUT bodies validated with Zod
- [ ] New state in contexts is `useMemo`/`useCallback`-wrapped
- [ ] No secrets in client-side code or localStorage
- [ ] Error boundaries around lazy-loaded or side-panel components
- [ ] Tests for new utilities/hooks (at minimum)

### Frontend PRs

- [ ] New components follow feature directory structure
- [ ] Heavy components are lazy-loaded if not needed at initial render
- [ ] Callbacks use `useCallback` if passed as props or in dependency arrays
- [ ] State-setting in effects has ESLint annotation with justification
- [ ] No direct cross-feature imports (use contexts)
- [ ] Cleanup functions in `useEffect` for subscriptions/timers/RAF
- [ ] Keyboard shortcuts registered via `useKeyboardShortcuts`

### Backend PRs

- [ ] Routes export a Hono sub-app, mounted in `app.ts`
- [ ] File I/O wrapped in mutex when read-modify-write
- [ ] Gateway calls use `invokeGatewayTool()` from shared client
- [ ] Expensive fetches wrapped in `createCachedFetch`
- [ ] SSE-aware: don't break compression exclusion for `/api/events`
- [ ] CORS: new endpoints automatically covered by global middleware
- [ ] Security: file serving paths validated against allowlist

### Performance

- [ ] No unnecessary re-renders (check with React DevTools Profiler)
- [ ] Session list uses smart diffing (preserves references)
- [ ] Streaming updates use `requestAnimationFrame` batching
- [ ] Large data (history) uses infinite scroll, not full render
- [ ] Activity sparkline and polling respect `document.visibilityState`

### Accessibility

- [ ] Skip-to-content link present (`<a href="#main-chat" class="sr-only">`)
- [ ] Dialogs have proper focus management
- [ ] Keyboard navigation works for all interactive elements
- [ ] Color contrast meets WCAG AA (themes should preserve this)
