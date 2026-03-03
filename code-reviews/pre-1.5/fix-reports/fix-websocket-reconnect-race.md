# Fix #5: WebSocket reconnect race kills active connection

**Branch:** `fix/websocket-reconnect-race`
**File:** `src/hooks/useWebSocket.ts`
**Commit:** `fix: prevent stale WebSocket onclose from killing active connection`

## Problem

When `doConnect` is called while a socket is already open, it closes the old socket and creates a new one. The old socket's `onclose` fires asynchronously, sees `intentionalDisconnectRef = false`, and schedules a reconnect timer. That timer fires, calls `doConnect` again, killing the newly-active connection. This creates cascading disconnections.

## Fix

Added a connection generation counter (`connectionGenRef`) as a `useRef(0)`.

1. **`connectionGenRef`** declared alongside other refs (line 76)
2. **`doConnect`** increments the counter at entry and captures the value in a local `gen` variable (line 118)
3. **`onclose`** checks if `gen !== connectionGenRef.current` before running any reconnect logic. If stale (a newer `doConnect` has already fired), it returns immediately (line 231)

This ensures that when a new connection supersedes an old one, the old socket's `onclose` handler is a no-op for reconnection purposes.

## Changes

- +6 lines, -1 line (whitespace normalization)
- No behavioral changes outside the race condition fix
- No new dependencies

## Verification

- `npm run build` passes (no TS errors in `useWebSocket.ts`)
- Change is purely additive: existing reconnect behavior is untouched for non-racing scenarios
