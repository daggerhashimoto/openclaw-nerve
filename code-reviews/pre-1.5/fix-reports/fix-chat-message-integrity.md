# Fix Report: Chat Message Integrity

**Branch:** `fix/chat-message-integrity`
**Fixes:** #2, #4, #8, #18 from MASTER-REVIEW-v3.md
**Files changed:** 4 (23 insertions, 17 deletions)

## Fix #2: Infinite scroll race condition

**File:** `src/features/chat/ChatPanel.tsx`

**Problem:** IntersectionObserver useEffect depended on `messages.length`, causing teardown/recreate on every message change. After `loadMore()` prepends messages, the new observer fires immediately while `isLoadingMore.current` is still true from the previous cycle.

**Fix:**
- Added `loadMoreRef` and `hasMoreRef` refs, kept in sync via dedicated effects
- Observer callback reads from refs instead of closure-captured values
- Removed `messages.length` from the observer useEffect dependency array
- Added `!loadMoreRef.current || !hasMoreRef.current` guard inside observer callback

Observer is now stable across message changes. No teardown/recreate churn.

## Fix #4: groupToolMessages mutates input array

**File:** `src/features/chat/operations/loadHistory.ts`

**Problem:** `msg.images = [...]` in `groupToolMessages()` directly mutates objects shared by React state, violating React's immutability contract.

**Fix:** Instead of mutating `msg` and then pushing it, we now push a spread copy with the new images. Non-image messages still push the original reference (no unnecessary copies).

## Fix #8: handleSend read-then-write race

**File:** `src/contexts/ChatContext.tsx` + `src/hooks/useChatMessages.ts`

**Problem:** `getAllMessages()` then `setAllMessages([...msgs, userMsg])` is non-atomic. A streaming event arriving between the read and write (especially after `await sendChatMessage`) overwrites intervening state updates.

**Fix:**
- Extended `setAllMessages` to accept a functional updater: `(prev: ChatMsg[]) => ChatMsg[]`
- Converted all read-then-write patterns in `handleSend` to functional updaters:
  - Optimistic insert: `setAllMessages(prev => [...prev, userMsg])`
  - Confirm: `setAllMessages(prev => prev.map(confirmMsg))`
  - Fail: `setAllMessages(prev => prev.map(failMsg))`
  - Error bubble: `setAllMessages(prev => [...prev, errMsgBubble])`

The ref-based `setAllMessages` now atomically reads and writes in one call.

## Fix #18: mergeFinalMessages mutates incoming objects

**File:** `src/hooks/useChatMessages.ts`

**Problem:** `msg.msgId = generateMsgId()` in `mergeFinalMessages()` directly mutates objects from the incoming array, which may be shared by other React state references.

**Fix:** Replaced mutation with conditional shallow copy. Objects that already have a `msgId` are pushed as-is (zero-cost). Only missing-ID objects get a copy.

## Build Verification

- `vite build`: Clean (0 errors)
- `tsc --noEmit`: No type errors in changed files
