# Troubleshooting

Common issues and solutions for Nerve.

---

## Authentication

### Login page won't accept password

**Symptom:** Entering the correct password returns "Invalid password".

**Causes:**
1. The password hash in `.env` doesn't match the password you're entering
2. You're trying the gateway token but `GATEWAY_TOKEN` isn't set in `.env`

**Fix:**
- Re-run `npm run setup` to set a new password
- Or set `NERVE_AUTH=true` with a valid `GATEWAY_TOKEN` — the gateway token works as a fallback password without needing a password hash

### Session expired / redirected to login

**Symptom:** You were logged in but got redirected to the login page.

**Cause:** The session cookie expired (default TTL: 30 days) or the `NERVE_SESSION_SECRET` changed (e.g., server restart without a persisted secret).

**Fix:**
- Log in again with your password
- If sessions don't survive restarts, ensure `NERVE_SESSION_SECRET` is set in `.env` (the setup wizard generates one). Without it, an ephemeral secret is created on each startup

### API returns 401 but auth is disabled

**Symptom:** API calls fail with "Authentication required" even though `NERVE_AUTH` isn't set.

**Cause:** Check that `NERVE_AUTH` isn't set to `true` somewhere unexpected (e.g., exported in your shell profile).

**Fix:**
```bash
# Check the env var
grep NERVE_AUTH .env
echo $NERVE_AUTH

# Explicitly disable
echo "NERVE_AUTH=false" >> .env
```

### WebSocket connects but immediately closes with 401

**Symptom:** Browser console shows WebSocket upgrade failed with 401.

**Cause:** When auth is enabled, WebSocket upgrade requests are also authenticated via the session cookie. If the cookie is missing or expired, the upgrade is rejected.

**Fix:** Refresh the page and log in again. The session cookie is sent automatically with WebSocket upgrade requests.

---

## Build Errors

### `tsc -b` fails with path alias errors

**Symptom:** `Cannot find module '@/...'` during TypeScript compilation.

**Cause:** The `@/` alias must be configured in both `tsconfig.json` (for editor) and the relevant project reference config.

**Fix:** Ensure the root `tsconfig.json` has:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

### `npm run build:server` produces nothing

**Symptom:** `server-dist/` is empty or `npm start` fails with "Cannot find module".

**Cause:** Server TypeScript is compiled separately via `tsc -p config/tsconfig.server.json`.

**Fix:**
```bash
npm run build:server   # Compiles server/ → server-dist/
npm start              # Then runs node server-dist/index.js
```

### Chunk size warnings during `vite build`

**Symptom:** Vite warns about chunks exceeding 500 kB.

**Cause:** Heavy dependencies (highlight.js, react-markdown) are bundled.

**Info:** This is expected. The build uses manual chunks to split: `react-vendor`, `markdown`, `ui-vendor`, `utils`. The warning limit is set to 600 kB in `vite.config.ts`. If a chunk exceeds this, check for accidental imports pulling in large libraries.

### Port already in use

**Symptom:** `Port 3080 is already in use. Is another instance running?`

**Fix:**
```bash
# Find what's using the port
lsof -i :3080
# Kill it, or use a different port:
PORT=3090 npm start
```

The server detects `EADDRINUSE` and exits with a clear error (see `server/index.ts`).

---

## Gateway Connection

### "Auth failed" in ConnectDialog

**Symptom:** Connection dialog shows "Auth failed: unknown" or similar.

**Causes:**
1. Wrong gateway token
2. Gateway not running
3. Token mismatch between Nerve server config and gateway

**Fix:**
- Verify the gateway is running: `openclaw gateway status`
- Check token: the server reads `GATEWAY_TOKEN` or `OPENCLAW_GATEWAY_TOKEN` env var
- For trusted official-gateway access, `/api/connect-defaults` advertises `serverSideAuth=true` and Nerve connects with an empty browser-side token
- For custom gateway URLs or untrusted access, enter the token manually in the connection dialog

### Connection drops and "SIGNAL LOST" banner

**Symptom:** Red reconnecting banner appears periodically.

**Cause:** WebSocket connection to gateway dropped. Nerve auto-reconnects with exponential backoff (1s base, 30s max, up to 50 attempts).

**Diagnosis:**
```bash
# Check gateway health
curl http://127.0.0.1:18789/health

# Check Nerve health (includes gateway probe)
curl http://127.0.0.1:3080/health
# Returns: { "status": "ok", "uptime": ..., "gateway": "ok"|"unreachable" }
```

**Fix:**
- If gateway is unreachable, restart it: `openclaw gateway restart`
- If persistent, check firewall rules or network configuration
- If a stale manual token is saved in `localStorage`, clear `oc-config` and reload before reconnecting

### Auto-connect doesn't work

**Symptom:** ConnectDialog appears even though the gateway is running.

**Cause:** The frontend fetches `/api/connect-defaults` on mount, but auto-connect only happens when:
- `serverSideAuth=true`
- the saved gateway URL is empty or matches the server's official gateway URL
- the initial connect attempt succeeds

**Fix:**
- If you want the managed path, clear stale browser config (`localStorage.oc-config`) and reload
- If you are using a custom gateway URL, manual token entry is expected
- If you are remote but authenticated and using the official gateway URL, the dialog should not be required after stale config is cleared

---

## WebSocket Proxy

### WebSocket connects but no events arrive

**Symptom:** UI shows "connected" but sessions/messages don't update.

**Cause:** The WS proxy (`server/lib/ws-proxy.ts`) might not be injecting device identity correctly, so the gateway doesn't grant `operator.read`/`operator.write` scopes.

**Diagnosis:**
- Check server logs for `[ws-proxy] Injected device identity: ...`
- If missing, the device identity file may be corrupted

**Fix:**
```bash
# Remove and regenerate device identity
rm ~/.nerve/device-identity.json
# Restart Nerve — a new keypair will be generated
```

### "Target not allowed" WebSocket error

**Symptom:** Browser console shows WebSocket close code 1008 with "Target not allowed".

**Cause:** The gateway URL hostname is not in the `WS_ALLOWED_HOSTS` allowlist (configured in `server/lib/config.ts`).

**Fix:** By default, only `127.0.0.1`, `localhost`, and `::1` are allowed. To add a custom host:
```bash
WS_ALLOWED_HOSTS=mygateway.local npm start
```

### "device token mismatch" on WebSocket connect

**Symptom:** Server logs show `[ws-proxy] Gateway closed: code=1008, reason=unauthorized: device token mismatch`.

**Causes:**
1. **Stale browser config.** The browser may still have an old manually-entered token saved in `localStorage` (`oc-config`), often from an older build or a custom gateway connection.
2. **Token mismatch across config files.** OpenClaw 2026.2.19 has a known bug where `openclaw onboard` writes different tokens to the systemd service file and `openclaw.json`. The gateway uses the systemd env var; Nerve reads from `.env`.

**Fix (stale browser config):**
Clear site data or remove `localStorage.oc-config`, then reload so the official managed gateway path can reconnect with an empty token.

**Fix (token mismatch):**
Re-run the setup wizard — it reads the real token from the systemd service file and aligns everything:
```bash
npm run setup
```

If you need to check manually:
```bash
# The gateway's actual token (source of truth)
grep OPENCLAW_GATEWAY_TOKEN ~/.config/systemd/user/openclaw-gateway.service

# These must all match:
grep gateway.auth.token ~/.openclaw/openclaw.json     # CLI config
grep GATEWAY_TOKEN .env                                 # Nerve config
```

### "Missing scope" errors after connecting

**Symptom:** Chat sends but responses fail with "missing scope" or tool calls are rejected.

**Cause:** The gateway didn't grant `operator.read`/`operator.write` scopes. This happens when:
1. The device hasn't been approved yet (first connection)
2. The device was rejected or the gateway was reset

**Fix:** Re-run `npm run setup` — it bootstraps device scopes automatically. If that doesn't work:
```bash
# Check pending devices
openclaw devices list

# Approve the Nerve device
openclaw devices approve <requestId>
```

After approval, reconnect from the browser (refresh the page or click reconnect).

### Messages buffered indefinitely

**Symptom:** Messages sent immediately after connecting are lost.

**Info:** The proxy buffers up to 100 messages (1 MB) while the upstream gateway connection opens. If the buffer overflows, the client is disconnected with "Too many pending messages". This is a safety limit — reduce message burst rate.

---

## TTS Issues

### No audio plays

**Symptom:** TTS is enabled but no sound on responses.

**Diagnosis tree:**
1. **Sound enabled?** Check Settings → Audio → Sound toggle is on
2. **TTS provider configured?** Check Settings → Audio → TTS Provider
3. **API key present?**
   - OpenAI: requires `OPENAI_API_KEY` env var
   - Replicate: requires `REPLICATE_API_TOKEN` env var
   - Edge: no key needed (free)
4. **Server-side check:**
   ```bash
   curl -X POST http://127.0.0.1:3080/api/tts \
     -H "Content-Type: application/json" \
     -d '{"text": "hello", "provider": "edge"}'
   ```
   Should return audio/mpeg binary.

**Provider auto-fallback:** If no explicit provider is selected, the server tries: OpenAI (if key) → Replicate (if key) → Edge (always available).

### TTS plays old/wrong responses

**Symptom:** Audio doesn't match the displayed message.

**Cause:** TTS cache serving stale entries. The cache is an LRU with TTL expiry (configurable via `config.ttsCacheTtlMs`), 100 MB memory budget.

**Fix:** Restart the Nerve server to clear the in-memory TTS cache.

### Edge TTS fails silently

**Symptom:** Edge TTS selected but no audio. No error in UI.

**Cause:** Edge TTS uses Microsoft's speech service WebSocket. The Sec-MS-GEC token generation or the WebSocket connection may fail.

**Diagnosis:** Check server logs for `[edge-tts]` errors.

**Fix:** Edge TTS has no API key dependency, but requires outbound WebSocket access to `speech.platform.bing.com`. Ensure your network allows this.

---

## Voice Input / Wake Word

### Microphone not working

**Symptom:** Voice input button does nothing or permission denied.

**Cause:** Microphone requires a **secure context** (HTTPS or localhost).

**Fix:**
- If accessing via `http://127.0.0.1:3080` — should work (localhost is secure)
- If accessing remotely, use HTTPS:
  ```bash
  # Generate self-signed cert
  mkdir -p certs
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout certs/key.pem -out certs/cert.pem -days 365 \
    -subj "/CN=localhost"
  # Nerve auto-detects certs and starts HTTPS on port 3443
  ```

### Whisper transcription fails

**Symptom:** Voice input records but transcription returns error.

**Causes:**
- **Local STT** (default): The whisper model hasn't been downloaded yet, or `ffmpeg` is missing
- **OpenAI STT**: `OPENAI_API_KEY` not set

**Fix (local STT):**
- Models auto-download on first use. Check server logs for download progress or errors
- Ensure `ffmpeg` is installed (the installer handles this): `ffmpeg -version`
- Check model file exists: `ls ~/.nerve/models/ggml-tiny.bin`

**Fix (OpenAI STT):**
- Set `STT_PROVIDER=openai` and `OPENAI_API_KEY` in `.env`

**Both providers:**
- Max file size: 12 MB
- Accepted formats: `audio/webm`, `audio/mp3`, `audio/mpeg`, `audio/mp4`, `audio/m4a`, `audio/wav`, `audio/ogg`, `audio/flac`

### Non-English transcription is inaccurate

**Symptom:** STT works, but non-English speech is mis-transcribed or stop/cancel commands are unreliable.

**Causes:**
- Language is set incorrectly
- Local model is `tiny` (fast, but less accurate for conversational non-English)
- English-only model (`*.en`) selected for non-English speech

**Fix:**
1. Set language explicitly in **Settings → Audio → Language** (no auto-detect mode)
2. For local STT, switch model from `tiny` to `base`
3. Ensure `WHISPER_MODEL` is multilingual (`tiny`, `base`, `small`) for non-English usage
4. Persist language in `.env` as `NERVE_LANGUAGE=<code>` (legacy `LANGUAGE` is still read, but deprecated)

### Voice phrase changes don't persist

**Symptom:** Custom stop/cancel/wake phrases disappear after refresh or restart.

**Cause:** Phrase overrides are stored on disk at `~/.nerve/voice-phrases.json` (or `NERVE_VOICE_PHRASES_PATH` if set). Write failures usually come from path/permission issues.

**Fix:**
- Verify file location and permissions:
  ```bash
  ls -l ~/.nerve/voice-phrases.json
  ```
- If using a custom path, ensure `NERVE_VOICE_PHRASES_PATH` points to a writable location
- Re-save phrases via Settings and watch server logs for `/api/voice-phrases` errors

### Wake word doesn't trigger

**Symptom:** Wake word toggle is on but voice detection never activates.

**Cause:** Wake word state is managed collaboratively — the InputBar component reports wake word state to SettingsContext via `handleWakeWordState(enabled, toggleFn)`.

**Fix:**
- Ensure microphone permissions are granted
- Try toggling wake word off and on via Settings or Cmd+K command palette
- Check browser console for speech recognition errors

---

## Memory Editing

### Memory changes don't appear

**Symptom:** Added/deleted memories don't reflect in the UI.

**Cause:** Memory operations go through the gateway tool invocation (`memory_store`/`memory_delete`), then the file watcher detects changes and broadcasts an SSE event.

**Diagnosis:**
1. Check POST/DELETE to `/api/memories` returns `{ ok: true }`
2. Check server logs for `[file-watcher]` events
3. Check SSE stream: `curl -N http://127.0.0.1:3080/api/events`

**Fix:**
- If the gateway tool call fails, check gateway connectivity
- If file watcher isn't firing, the memory file path may be wrong — check `config.memoryPath`
- Manual refresh: click the refresh button in the Memory tab, or use Cmd+K → "Refresh Memory"

### Memory file path is wrong

**Symptom:** Memories show as empty even though MEMORY.md exists.

**Cause:** The server resolves memory path from config (`config.memoryPath`). The workspace path is the parent of the memory path.

**Fix:** Check and set the correct path:
```bash
# In .env
MEMORY_PATH=/path/to/.openclaw/workspace/MEMORY.md
```

---

## Session Management

### Sessions don't appear in sidebar

**Symptom:** Session list is empty or only shows one recent root session.

**Cause:** Sessions are fetched via gateway RPC `sessions.list` with `activeMinutes: 120` filter.

**Fix:**
- Sessions inactive for >2 hours won't appear — this is by design
- Check gateway connectivity (sessions come from the gateway, not local state)
- Force refresh: click refresh button or Cmd+K → "Refresh Sessions"

### Sub-agent spawn times out

**Symptom:** "Timed out waiting for subagent to spawn" error.

**Cause:** Spawning uses a polling approach — sends a `[spawn-subagent]` chat message to the selected root session, then polls `sessions.list` every 2s for up to 30s waiting for a new subagent session to appear.

**Fix:**
- The selected root agent must be running and able to process the spawn request
- Check that the selected root session isn't busy with another task
- Check gateway logs for spawn errors

### Session status stuck on "THINKING"

**Symptom:** Session shows thinking/spinning indefinitely.

**Cause:** The agent state machine transitions THINKING → STREAMING → DONE → IDLE. If a lifecycle event was missed, the status can get stuck.

**Fix:**
- Use the abort button (or Ctrl+C when generating) to reset the state
- The DONE → IDLE auto-transition happens after 3 seconds (see `doneTimeoutsRef` in SessionContext)
- Force refresh sessions to re-sync from gateway

---

## Model Switching

### Model dropdown doesn't show available models

**Symptom:** Model selector is empty or shows only the current model.

**Cause:** Models are fetched via `GET /api/gateway/models`. Nerve first runs `openclaw models list --json` for configured / allowlisted models, waits up to 15 seconds for cold starts, and falls back to `openclaw models list --all --json` if needed. If those CLI calls fail or return nothing, the dropdown can stay sparse.

**Fix:**
- Wait a moment after a cold start, then reopen the spawn dialog or refresh the page
- Ensure the `openclaw` binary is in PATH (the server searches multiple locations — see `lib/openclaw-bin.ts`)
- Set `OPENCLAW_BIN` env var to the explicit path
- Check server logs for model list errors or timeouts
- If you use an allowlist, verify the expected Codex or other models are configured there

### Model change doesn't take effect

**Symptom:** Switched model in UI but responses still come from the old model.

**Cause:** Model/thinking changes go through `POST /api/gateway/session-patch`, which invokes the gateway's session patch API.

**Fix:**
- The change applies per-session — switching sessions will show that session's model
- Verify the patch succeeded: check for `{ ok: true }` response
- Some models may not be available for the current session type

---

## Rate Limiting

### "Too many requests" errors

**Symptom:** API returns 429 status.

**Cause:** Per-IP sliding window rate limiter. Different limits for:
- General API endpoints
- TTS synthesis (more restrictive)
- Transcription (more restrictive)

**Fix:**
- Wait for the rate limit window to reset (check `X-RateLimit-Reset` header)
- If behind a reverse proxy, ensure `X-Forwarded-For` is set correctly (the server only trusts forwarded headers from trusted proxy IPs)

---

## HTTPS / SSL

### Certificate errors

**Symptom:** Browser shows SSL warnings or refuses to connect on port 3443.

**Fix:** For development, generate a self-signed cert:
```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem -days 365 \
  -subj "/CN=localhost"
```

The server auto-detects cert files at `certs/cert.pem` and `certs/key.pem`. No configuration needed — if the files exist, HTTPS starts on `config.sslPort` (default 3443).

### SSE not working over HTTPS

**Symptom:** Real-time updates (memory changes, token updates) don't arrive over HTTPS.

**Cause:** The HTTPS server has special handling for SSE responses — it streams them instead of buffering (see `server/index.ts` SSE streaming fix).

**Fix:** This should work automatically. If it doesn't, check that:
- The response content-type includes `text/event-stream`
- No intermediate reverse proxy is buffering the response
- The compression middleware correctly skips `/api/events`

---

## Development

### `npm run dev` — proxy errors

**Symptom:** API requests fail with 502 during development.

**Cause:** Vite proxies `/api` and `/ws` to the backend server. If the backend isn't running, all proxied requests fail.

**Fix:** Run both servers:
```bash
# Terminal 1
npm run dev:server   # Backend on port 3081

# Terminal 2
npm run dev          # Frontend on port 3080 (proxies to 3081)
```

### Tests fail with "Cannot find module"

**Symptom:** Vitest can't resolve `@/` imports.

**Fix:** The test config (`vitest.config.ts`) must have the same path alias:
```ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
  },
},
```

Also ensure `server-dist/` is excluded from test discovery (it contains compiled `.test.js` duplicates):
```ts
test: {
  exclude: ['node_modules/**', 'server-dist/**'],
}
```

---

## Update & Rollback

See [docs/UPDATING.md](UPDATING.md) for the full updater reference.

### "No semver tags found on remote"

**Symptom:** `npm run update` fails at version resolution (exit 20).

**Cause:** No tags on the remote, or git can't reach origin.

**Fix:**
```bash
git remote -v              # Verify origin
git fetch --tags origin    # Pull tags
git tag -l                 # Confirm tags exist locally
```

### Update stuck or "Lock acquisition failure" (exit 80)

**Symptom:** Update refuses to start, says another update is running.

**Cause:** A previous update crashed without releasing the lock.

**Fix:**
```bash
cat ~/.nerve/updater/nerve-update.lock   # Shows the PID
ps -p <pid>                               # Check if alive
rm ~/.nerve/updater/nerve-update.lock     # Remove if stale
```

### Health check version mismatch (exit 60)

**Symptom:** Update completes build and restart, but health check says wrong version.

**Cause:** The old server process didn't release the port, or systemd hasn't fully restarted.

**Fix:**
```bash
systemctl restart nerve
curl http://127.0.0.1:3080/api/version   # Verify version
```

### Rollback failed (exit 70)

**Symptom:** Both update and automatic rollback failed. Critical state.

**Fix:** Manual recovery:
```bash
cat ~/.nerve/updater/last-good.json       # Get snapshot ref
git checkout --force <ref>
npm install && npm run build && npm run build:server
systemctl restart nerve
```

---

## Known Limitations

None currently tracked.
