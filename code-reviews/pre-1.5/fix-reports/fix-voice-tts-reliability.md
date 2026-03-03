# Fix Report: Voice/TTS Reliability

**Branch:** `fix/voice-tts-reliability`  
**Commit:** `bd056ba`  
**Fixes:** #9, #11, #12, #13 from MASTER-REVIEW-v3.md  
**Build:** ✅ Clean (`tsc -b && vite build && build:server`)

---

## Fix #9: Voice flag not reset on session switch

**File:** `src/hooks/useChatTTS.ts`  
**Change:** Added `lastMessageWasVoiceRef.current = false;` inside `resetPlayedSounds` callback.  
**Why:** The ref persisted across session switches, causing TTS fallback to fire incorrectly in new sessions when `resetPlayedSounds` was called on `chat_started`.  
**Lines changed:** +1

## Fix #11: Missing .ok check on TTS config load/save

**File:** `src/features/tts/useTTSConfig.ts`  
**Change:** Both fetch chains (load in `useEffect`, save in `saveConfig`) now check `r.ok` before calling `r.json()`. Non-OK responses throw `Error(\`TTS config request failed: ${r.status}\`)`.  
**Why:** Server errors returning non-JSON bodies caused opaque parse errors. JSON error bodies could silently overwrite config state.  
**Lines changed:** +8 / -2

## Fix #12: Missing credentials on TTS fetch

**File:** `src/features/tts/useTTS.ts`  
**Change:** Added `credentials: 'include'` to the `/api/tts` POST fetch options.  
**Why:** Sibling endpoint `/api/transcribe` already included credentials. Without it, cookie-based auth silently fails for TTS requests.  
**Lines changed:** +1

## Fix #13: Array index as React key in voice phrases

**File:** `src/features/settings/VoicePhrasesModal.tsx`  
**Change:** Introduced `PhraseItem` type (`{ id: string; value: string }`), a module-level counter (`phraseIdCounter`) for stable ID generation, and `toPhraseItems()` helper. Changed `PhraseList` props from `string[]` to `PhraseItem[]`. Updated all state, setters, and save logic to work with the new type. React key changed from `key={i}` to `key={phrase.id}`.  
**Why:** Using array index as key caused React to reuse wrong DOM nodes when deleting mid-list phrases, showing stale input values.  
**Lines changed:** +28 / -13

---

**Total diff:** 4 files, +37 / -15 lines. All changes are minimal and scoped to the described bugs.
