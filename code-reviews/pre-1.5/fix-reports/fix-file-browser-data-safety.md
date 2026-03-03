# Fix Report: File browser overwrites dirty content on re-open

**Fix #:** 1
**Branch:** `fix/file-browser-data-safety`
**File:** `src/features/file-browser/hooks/useOpenFiles.ts`
**Review:** `code-reviews/pre-1.5/MASTER-REVIEW-v3.md`

## Problem

When a user clicks an already-open file in the file tree, `openFile` fetches fresh content from disk and overwrites the editor state, including any unsaved (dirty) edits.

The root cause: the early-return check (`if (existing) return prev`) was inside a `setOpenFiles` state updater callback. This correctly prevented adding a duplicate tab, but execution continued past the updater to the fetch + second `setOpenFiles` call that replaced `content` and `savedContent`, clobbering dirty edits.

## Fix

Added an early guard before the fetch path using `openFilesRef` (the existing ref that always holds current `openFiles` state):

```typescript
if (openFilesRef.current.some(f => f.path === filePath)) {
  setActiveTab(filePath);
  return;
}
```

The existing check inside the `setOpenFiles` updater is preserved as a safety net for concurrent calls.

## Changes

- **+6 lines** added to `openFile` in `useOpenFiles.ts` (guard + comment)
- No other files modified
- No behavioral changes for new file opens
- No refactoring beyond fix scope

## Verification

- `npx vite build` passes (client compilation clean)
- Pre-existing TS errors in `VoicePhrasesModal.tsx` and `useWebSocket.ts` are unrelated (present on master)
