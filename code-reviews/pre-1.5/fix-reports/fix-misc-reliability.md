# Fix Report: Misc Reliability

**Branch:** `fix/misc-reliability`
**Date:** 2026-03-03
**Review:** MASTER-REVIEW-v3.md fixes #3, #6, #7, #10, #15

## Fixes Applied

### Fix #3: Updater lock released before rollback completes
**File:** `server/lib/updater/orchestrator.ts` (line 179)
**Change:** `return handleFailure(...)` → `return await handleFailure(...)`
**Impact:** Prevents `releaseLock()` in `finally` block from firing while `handleFailure` (which calls async `rollback`) is still running. One word addition.

### Fix #6: .env parser doesn't strip quotes
**File:** `scripts/lib/env-writer.ts` (lines 137-141)
**Change:** After extracting the value in `loadExistingEnv()`, strip matching surrounding single or double quotes before storing.
**Impact:** `KEY="value"` now correctly loads as `value` instead of `"value"`. Prevents silent auth failures when .env files use quoted values.

### Fix #7: Image compression silently accepts oversized output
**File:** `src/features/chat/image-compress.ts` (lines 50-80)
**Change:** After quality 0.4 retry still exceeds `MAX_COMPRESSED_BYTES`, added dimension reduction (50% scale). If still oversized, reject with user-facing error instead of silently resolving.
**Impact:** Prevents oversized blobs from busting the 512KB WS payload limit. Users get a clear error.

### Fix #10: Non-null assertion crash on missing drag item
**File:** `src/features/kanban/hooks/useKanbanDragDrop.ts` (line 78)
**Change:** Removed `!` assertion on `destAll.find(...)`. Added null guard returning `prev` if task not found.
**Impact:** Prevents crash when task is deleted by concurrent poll during drag.

### Fix #15: Duplicate execution race on kanban tasks
**File:** `server/routes/kanban.ts` (execute handler, ~line 708)
**Change:** Before `store.executeTask()`, check if task status is already `in-progress`. Return 409 if duplicate.
**Impact:** Prevents double-click spawning two agent sessions for the same task.

## Build Verification

- **Client build (`npm run build`):** Pass (vite 7.3.1, 2917 modules)
- **Server build (`npm run build:server`):** Pass

## Diff Summary

```
5 files changed, 42 insertions(+), 12 deletions(-)
```
