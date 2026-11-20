# Troubleshooting

Common problems and fixes for Nerve.

---

## Setup and startup

### Server refuses to start: "HOST=0.0.0.0 with authentication disabled"

**Symptom:** The server exits with `Refusing to start: HOST=0.0.0.0 with authentication disabled.`

**Cause:** Binding to every interface without a password would expose all endpoints to the network.

**Fix:** Pick one:

- Run `npm run setup` and set a password (or accept the gateway token as the password).
- Bind locally: `HOST=127.0.0.1` in `.env`.
- Override with `NERVE_ALLOW_INSECURE=true` in `.env`. Not recommended.

### Setup leaves a remote gateway unconfigured

**Symptom:** Setup prints "The gateway at ... is on another machine, so setup did not change any OpenClaw config." (or the same for a tunnelled gateway, or "NERVE_GATEWAY_LOCATION=remote is set, ..."), followed by a list of steps. Afterwards the browser cannot connect, or connects with missing scopes.

**Cause:** Setup only patches a gateway that runs on the same machine. For any other gateway it prints what to change on the gateway host instead. A `GATEWAY_URL` on loopback also counts as remote when this machine runs no OpenClaw, as with an SSH tunnel or a container port.

**Fix:** On the gateway host, do what setup printed:

1. Add the listed origins to `gateway.controlUi.allowedOrigins` in `~/.openclaw/openclaw.json`.
2. Add `"cron"`, `"gateway"` and `"sessions_spawn"` to `gateway.tools.allow`.
3. Run `openclaw gateway restart`.
4. Start Nerve, open it in a browser, then run `openclaw devices list` and `openclaw devices approve <requestId>` for Nerve's request.

If setup guessed wrong, override it: `NERVE_GATEWAY_LOCATION=remote npm run setup` for a tunnel on a machine that also runs OpenClaw, or `NERVE_GATEWAY_LOCATION=local npm run setup` for a DNS alias of this machine. See [Configuration](CONFIGURATION.md#gateway-config-changes).

### Settings disappeared after re-running setup

**Symptom:** After `npm run setup`, values you added to `.env` by hand are gone, for example `MIMO_API_KEY`, `NERVE_PUBLIC_ORIGIN`, `TRUSTED_PROXIES`, `NERVE_LANGUAGE` or `NERVE_UPLOAD_*`.

**Cause:** Setup rewrites `.env` with only the keys it manages.

**Fix:** Copy the missing lines back from `.env.backup` (or the dated `.env.backup.YYYY-MM-DD`), then restart Nerve.

### Port already in use

**Symptom:** `Port 3080 is already in use. Is another instance running?`

**Fix:**

```bash
# Find what is using the port
lsof -i :3080
# Stop it, or use another port:
PORT=3090 npm start
```

---

## Authentication

### Login page rejects the password

**Symptom:** The login page shows "Invalid password".

**Causes:**

1. The password does not match `NERVE_PASSWORD_HASH`.
2. You entered the gateway token, but a password hash is set. The gateway token works as the password only while `NERVE_PASSWORD_HASH` is empty.
3. Neither a password hash nor `GATEWAY_TOKEN` is set. The server logs `NERVE_AUTH is enabled but no password or gateway token is configured.` at startup.

**Fix:**

- Re-run `npm run setup` to set a new password.
- Or remove `NERVE_PASSWORD_HASH` from `.env`, keep `NERVE_AUTH=true` and a valid `GATEWAY_TOKEN`, restart, and sign in with the gateway token.

### Login page says "Unable to connect to server"

**Symptom:** After a few sign-in attempts, the login page shows "Unable to connect to server" even though Nerve is running.

**Cause:** Login is limited to 5 requests per minute per client. The rate-limit reply is plain text, which the login page reports as a connection failure.

**Fix:** Wait a minute, then sign in again.

### Session expired or redirected to login

**Symptom:** You were signed in, then got the login page again.

**Cause:** The session cookie expired (30 days by default, `NERVE_SESSION_TTL`), or `NERVE_SESSION_SECRET` changed. Without a secret in `.env`, the server generates a new one at every start, which signs everyone out.

**Fix:**

- Sign in again.
- If sessions do not survive restarts, set `NERVE_SESSION_SECRET` in `.env` (setup generates one).

### API returns 401 but auth seems disabled

**Symptom:** API calls fail with `Authentication required` although `.env` does not enable auth.

**Cause:** `NERVE_AUTH=true` is set in the environment the server runs in, for example exported in your shell profile. Process environment variables win over `.env`.

**Fix:**

```bash
# Check both places
grep NERVE_AUTH .env
echo "$NERVE_AUTH"

# Remove the shell export, then restart Nerve from that shell
unset NERVE_AUTH
```

### WebSocket upgrade fails with 401

**Symptom:** The browser console shows the `/ws` upgrade failing with 401.

**Cause:** With auth on, WebSocket upgrades need the session cookie. If it is missing or expired, the upgrade is refused.

**Fix:** Reload the page and sign in again. The browser sends the cookie with the upgrade automatically.

---

## Gateway connection

### "Auth failed: protocol mismatch"

**Symptom:** The connect dialog shows `Auth failed: protocol mismatch`, or the server logs `[gateway-rpc] Gateway connect rejected: protocol mismatch`.

**Cause:** Nerve and the gateway do not share a connect protocol version. Nerve negotiates protocol v4 only, which current OpenClaw gateways require. Nerve 1.5.3 and earlier fail against current gateways this way, and current Nerve fails the same way against a gateway too old for v4. (The text after `Auth failed:` is the gateway's own message.)

**Fix:** Upgrade whichever side is older: Nerve with `npm run update`, or OpenClaw on the gateway host.

### "Auth failed" in the connect dialog

**Symptom:** The "Connect to your OpenClaw gateway" dialog shows `Auth failed: <reason>`. `Auth failed: unknown` means the gateway gave no reason.

**Causes:**

1. Wrong gateway token
2. Gateway not running
3. The token in Nerve's `.env` differs from the gateway's

**Fix:**

- Check the gateway is running: `openclaw gateway status`
- The server uses `GATEWAY_TOKEN`, falling back to `OPENCLAW_GATEWAY_TOKEN`.
- For trusted clients (loopback, or signed in with auth on) on the official gateway URL, `/api/connect-defaults` returns `serverSideAuth: true`; the dialog hides the token field and Nerve injects the token itself.
- For a custom gateway URL or an untrusted client, enter the token in the dialog's "Gateway token" field.

### "Signal lost. Reconnecting." notice

**Symptom:** A small notice under the top bar reads "Signal lost. Reconnecting." (later "Signal lost. Reconnecting, attempt N.").

**Cause:** The WebSocket to the gateway dropped. Nerve reconnects automatically, waiting 1 second at first and up to 30 seconds between attempts.

**Diagnosis:**

```bash
# Gateway health
curl http://127.0.0.1:18789/health

# Nerve health (includes a gateway probe; no login needed)
curl http://127.0.0.1:3080/health
# {"status":"ok","uptime":...,"gateway":"ok"}   or "gateway":"unreachable"
```

**Fix:**

- If the gateway is unreachable, restart it: `openclaw gateway restart`
- If it keeps happening, check firewall rules and the network path.
- If a stale manual token is saved in the browser, remove `localStorage` key `oc-config` (or clear site data) and reload.

### Auto-connect does not happen

**Symptom:** The connect dialog appears although the gateway is running.

**Cause:** On load, the browser fetches `/api/connect-defaults` and auto-connects only when:

- `serverSideAuth` is `true` (the client is trusted and a gateway token is configured)
- the saved gateway URL is empty or matches the server's gateway URL
- that first connection succeeds

**Fix:**

- For the managed path, clear the stale browser config (`localStorage` key `oc-config`) and reload.
- With a custom gateway URL, entering the token is expected.
- From another machine with auth off, the client is not trusted, so the dialog asks for the token. Enable auth to get server-side injection after sign-in.

### Gateway does not connect from a new hostname

**Symptom:** Opening Nerve through a new hostname, IP or port (a reverse proxy, a tailnet name, the HTTPS port) loads the page, but the gateway never connects. The `/ws` upgrade fails with 403 `Origin not allowed`.

**Cause:** WebSocket upgrades and CORS accept only localhost origins and those in `ALLOWED_ORIGINS`.

**Fix:** Add the exact browser origin to `.env`, plus the WebSocket form to the CSP, then restart:

```bash
ALLOWED_ORIGINS=https://nerve.example.com
CSP_CONNECT_EXTRA=https://nerve.example.com wss://nerve.example.com
```

Setup writes these for its Tailscale, Network and Custom access modes, but not for a reverse-proxy domain. In Network mode it also leaves out the `https://<ip>:<SSL_PORT>` origin when you enable HTTPS, so add that one by hand.

---

## WebSocket proxy

### WebSocket connects but no events arrive

**Symptom:** The UI shows connected, but sessions and messages do not update.

**Cause:** The gateway did not grant `operator.read` and `operator.write`, usually because Nerve's device identity is not paired.

**Diagnosis:** Check the server log for `[ws-proxy] Injected device identity: ...`, and for a `Device rejected (...)` line, which means the proxy fell back to a connection without device identity.

**Fix:** Pair the device again: re-run `npm run setup` on the gateway machine, or approve it with `openclaw devices list` and `openclaw devices approve <requestId>`. If `~/.nerve/device-identity.json` is corrupted, delete it and restart Nerve; the new identity also needs pairing.

### "Target not allowed" WebSocket error

**Symptom:** The browser console shows the WebSocket closing with code 1008 and reason `Target not allowed`.

**Cause:** The gateway URL's hostname is not in `WS_ALLOWED_HOSTS`, or its scheme is not `ws:` or `wss:`.

**Fix:** Only `localhost`, `127.0.0.1` and `::1` are allowed by default. Add the gateway host to `.env` and restart:

```bash
WS_ALLOWED_HOSTS=mygateway.local
```

### Crons, Kanban runs or workspace panels fail with `origin not allowed`

**Symptom:** Chat works, but the Crons tab, Kanban runs, sub-agent spawns, or remote workspace panels (Files, Config, Skills) fail with `origin not allowed`. The server log shows `[gateway-rpc] Gateway connect rejected: origin not allowed`.

**Cause:** Those features use the server's own WebSocket to the gateway. It sends `NERVE_PUBLIC_ORIGIN` as its `Origin`, or else the first non-loopback `ALLOWED_ORIGINS` entry, or else `http://127.0.0.1:<PORT>`. The gateway must allow that origin.

**Fix:** Set the exact browser origin in `.env` and allow the same origin on the gateway:

```bash
NERVE_PUBLIC_ORIGIN=https://nerve.example.com
```

Add `https://nerve.example.com` to `gateway.controlUi.allowedOrigins`, then restart Nerve and the gateway.

### "device token mismatch" on connect

**Symptom:** The server log shows `[ws-proxy:<id>] Gateway closed: code=1008, reason=unauthorized: device token mismatch`.

**Causes:**

1. **Stale browser config.** The browser still holds an old manually entered token in `localStorage` (`oc-config`).
2. **Token mismatch between config files.** `openclaw onboard` can write different tokens to the systemd unit and `openclaw.json`. The gateway uses the systemd value; Nerve reads `.env`.

**Fix (stale browser config):** Clear site data or remove `localStorage` key `oc-config`, then reload so the managed path reconnects with an empty token.

**Fix (token mismatch):** Re-run setup on the gateway machine. It reads the systemd token first:

```bash
npm run setup
```

To compare by hand:

```bash
# The token the gateway process uses (systemd installs)
grep OPENCLAW_GATEWAY_TOKEN ~/.config/systemd/user/openclaw-gateway.service /etc/systemd/system/openclaw-gateway.service 2>/dev/null

# gateway.auth.token in the OpenClaw config (look for the "token" under "auth")
grep -n '"token"' ~/.openclaw/openclaw.json

# Nerve's copy
grep '^GATEWAY_TOKEN=' .env
```

### Missing-scope errors after connecting

**Symptom:** Chat sends, but replies or tool calls fail with a missing-scope error.

**Cause:** The gateway did not grant `operator.read` and `operator.write`, because Nerve's device is not approved yet or was rejected after a gateway reset.

**Fix:** For a gateway on this machine, re-run `npm run setup`; it repairs device scopes and pre-pairs Nerve. Otherwise, on the gateway host:

```bash
openclaw devices list
openclaw devices approve <requestId>
```

Then reload the page.

### Crons tab shows an error

**Symptom:** The Crons tab shows a red error note instead of the job list, or a job's run fails.

**Cause:** Cron jobs are managed through the gateway's `cron.*` RPC methods over the server's own gateway connection. The note shows that connection's error:

| Error | Meaning and fix |
|-------|-----------------|
| `origin not allowed` | See [the `origin not allowed` entry](#crons-kanban-runs-or-workspace-panels-fail-with-origin-not-allowed) |
| `Gateway connection not ready` | `GATEWAY_TOKEN` is not set; Nerve's server cannot connect |
| `Gateway RPC timeout after 10000ms calling cron.list` | The gateway is unreachable or slow; check `curl http://127.0.0.1:3080/health` |
| `unknown method: ...` | The gateway does not offer the cron RPC methods; upgrade OpenClaw |
| A pairing or scope error | Approve Nerve's device (see above) |

**Run now** on an isolated agent-turn job starts it through the gateway's `sessions_spawn` HTTP tool instead. If that fails with a gateway tool error (for example `Gateway tool invoke failed: ...`), add `sessions_spawn` to `gateway.tools.allow` on the gateway and restart it. On the gateway machine, re-running `npm run setup` adds it.

The server log has the details under `[crons]` and `[gateway-rpc]`.

### "Too many pending messages"

**Symptom:** The browser is disconnected with close code 1008 and reason `Too many pending messages` right after connecting.

**Cause:** While the gateway connection opens, the proxy buffers at most 100 messages or 1 MB from the browser. A larger burst closes the connection.

**Fix:** Reconnect. If it repeats, look for something sending many messages at connect time.

---

## TTS

### No audio plays

**Symptom:** Replies are not spoken.

**Check in order:**

1. **Sound on?** Settings, Audio, **Sound effects** must be on. It is off by default and also controls spoken replies. (**UI sound volume** affects only the interface chimes, not TTS.)
2. **Provider:** Settings, Audio, **TTS provider**.
3. **API key present?**
   - OpenAI: `OPENAI_API_KEY`
   - Replicate: `REPLICATE_API_TOKEN`
   - Xiaomi MiMo: `MIMO_API_KEY`
   - Edge: no key needed
4. **Server-side check** (with auth off, or add your session cookie):

   ```bash
   curl -X POST http://127.0.0.1:3080/api/tts \
     -H "Content-Type: application/json" \
     -d '{"text": "hello", "provider": "edge"}' \
     --output tts-test.mp3
   ```

   A playable `tts-test.mp3` means the server side works.

**Automatic provider:** a request without a provider uses OpenAI if its key is set, then Replicate if its key is set, then Edge. The browser always sends its selected provider. Xiaomi MiMo is used only when selected.

### Same text keeps the old voice

**Symptom:** After changing the voice, a reply you already heard plays in the old voice.

**Cause:** TTS audio is cached in memory (1 hour by default, `TTS_CACHE_TTL_MS`). For Edge, Replicate and Xiaomi, the voice configured on the server is not part of the cache key, so identical text returns the cached audio.

**Fix:** Restart Nerve to clear the cache, or wait for the entry to expire.

### Edge TTS fails silently

**Symptom:** Edge is selected but nothing plays and the UI shows no error.

**Cause:** Edge TTS uses Microsoft's speech service over WebSocket. Token generation or the connection can fail.

**Diagnosis:** Check the server log for `[edge-tts]` errors.

**Fix:** Edge TTS needs no key but needs outbound WebSocket access to `speech.platform.bing.com`. Make sure your network allows it.

---

## Voice input and wake word

### Microphone not working

**Symptom:** The voice input button does nothing, or the browser denies permission.

**Cause:** The microphone needs a **secure context**: HTTPS, or `localhost`.

**Fix:**

- `http://127.0.0.1:3080` and `http://localhost:3080` work.
- For remote access, use HTTPS:

  ```bash
  mkdir -p certs
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout certs/key.pem -out certs/cert.pem -days 365 \
    -subj "/CN=localhost"
  # Restart Nerve; it starts HTTPS on SSL_PORT (default 3443)
  ```

### Transcription fails

**Symptom:** Voice input records, but transcription returns an error.

**Causes and fixes:**

- **Local STT:** `Speech model not found at <path>. Re-run the installer or set STT_PROVIDER=openai with an OPENAI_API_KEY.` The model file is missing. Pick the model in Settings, Audio, **STT model** to download it, or re-run the installer. Check with `ls ~/.nerve/models/` (the default `base` model is `ggml-base.bin`).
- **Local STT:** `ffmpeg not found. ...` Install `ffmpeg` (`apt install ffmpeg` or `brew install ffmpeg`).
- **OpenAI STT:** set `STT_PROVIDER=openai` and `OPENAI_API_KEY` in `.env`.

**Both providers:**

- Maximum upload: 12 MB
- Accepted types: `audio/webm`, `audio/mp3`, `audio/mpeg`, `audio/mp4`, `audio/m4a`, `audio/wav`, `audio/x-wav`, `audio/ogg`, `audio/flac`, `audio/x-flac`

### Non-English transcription is inaccurate

**Symptom:** STT works, but non-English speech is transcribed badly, or stop and cancel phrases are unreliable.

**Causes:**

- The language is set wrong.
- A small local model is selected.
- An English-only model (`*.en`) is selected for non-English speech.

**Fix:**

1. Set the language in Settings, Audio, **Language**. There is no auto-detect mode.
2. For local STT, use `base` or `small` instead of `tiny`.
3. Use a multilingual model (`tiny`, `base`, `small`).
4. The language is saved as `NERVE_LANGUAGE` in `.env` (legacy `LANGUAGE` is still read but deprecated).

### Voice phrase changes do not persist

**Symptom:** Custom stop, cancel or wake phrases disappear after a reload or restart.

**Cause:** Phrase overrides are saved at `~/.nerve/voice-phrases.json` (or `NERVE_VOICE_PHRASES_PATH`). Write failures usually come from the path or permissions.

**Fix:**

- Check the file:

  ```bash
  ls -l ~/.nerve/voice-phrases.json
  ```

- With a custom path, make sure `NERVE_VOICE_PHRASES_PATH` points somewhere writable.
- Save the phrases again in Settings, Audio, **Voice phrases** and watch the server log for `/api/voice-phrases` errors.

### Wake word does not trigger

**Symptom:** Wake word is on, but saying it does nothing.

**Cause:** Wake word detection uses the browser's speech recognition, which needs microphone permission and browser support.

**Fix:**

- Grant microphone permission.
- Toggle it off and on in Settings, Audio, **Wake word**, or with "Toggle Wake Word" in the command palette (Cmd+K).
- Check the browser console for speech recognition errors.

---

## Memory

### Memory changes do not appear

**Symptom:** Added or deleted memories do not show in the Memory tab.

**Cause:** Nerve edits `MEMORY.md` (or the daily file) directly, through gateway RPC when the workspace is remote. Adding a memory also stores it in the gateway's memory index through the `memory_store` tool, on a best-effort basis. The file watcher then notifies the UI over the `/api/events` stream.

**Diagnosis:**

1. Check that the `POST` or `DELETE` to `/api/memories` returned `{ "ok": true, ... }`.
2. Check the server log for `[memories]` and `[file-watcher]` lines.
3. Watch the event stream: `curl -N http://127.0.0.1:3080/api/events` (add your session cookie with auth on).

**Fix:**

- If the watcher does not fire, the memory path may be wrong (see below).
- Refresh by hand with the Memory tab's refresh button or "Refresh Memory" in the command palette (Cmd+K).

### Memory file path is wrong

**Symptom:** The Memory tab is empty although `MEMORY.md` exists.

**Cause:** The main agent's memory file is `MEMORY_PATH` (default `~/.openclaw/workspace/MEMORY.md`), and its directory is the main workspace. Other agents use the workspaces in the OpenClaw config.

**Fix:** Point `MEMORY_PATH` at the right file in `.env` and restart:

```bash
MEMORY_PATH=/path/to/.openclaw/workspace/MEMORY.md
```

---

## Uploads

### "Failed to import browser uploads."

**Symptom:** Attaching files in the composer fails with "Failed to import browser uploads."

**Cause:** All files picked at once go to the server in one request, which is capped at about 13 MB.

**Fix:** Attach fewer or smaller files at a time. Non-image files are also capped at `NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB` (4 MB by default), with their own error message.

### "Resolved attachment path is outside the workspace root."

**Symptom:** Every browser upload fails with this message.

**Cause:** `NERVE_UPLOAD_STAGING_TEMP_DIR` points outside the main workspace root (the directory of `MEMORY_PATH`, or `FILE_BROWSER_ROOT`).

**Fix:** Move the staging directory inside the workspace, or remove the variable to use `<workspace>/.temp/nerve-uploads`.

---

## Sessions

### Sessions missing from the sidebar

**Symptom:** The session list is empty, clearly incomplete, or older top-level chats are missing.

**Expected since 1.5.0:** older top-level chats stay in the sidebar; they no longer drop out after a period of inactivity.

**Likely causes:**

- Gateway connection or auth problems stopped the list from refreshing.
- The browser shows stale state after a reconnect or upgrade.
- A session fetch failed and has not recovered yet.

**Fix:**

- Check the gateway connection first; sessions come from the gateway.
- Refresh with the refresh button or "Refresh Sessions" in the command palette (Cmd+K).
- Reload the page after upgrades or repeated reconnects.
- If it persists, check the browser console and server log for session-list or WebSocket errors.

### "Timed out waiting for the new subagent session to appear"

**Symptom:** Spawning a sub-agent fails with this error.

**Cause:** Nerve first asks the gateway to create the child session directly (`sessions.create` and `sessions.send`). On gateways that do not support that, it asks the parent root agent to spawn the child and waits up to 60 seconds for the new session to appear. This error means the parent did not spawn it in time.

**Fix:**

- Make sure the parent root agent exists, is healthy, and is not busy with another task.
- Check the gateway log for `sessions.create`, `sessions.send` or spawn failures.
- Refresh sessions and retry once the gateway connection is stable.

### Kanban task cannot start or attach to a worker

**Symptom:** Running a Kanban task fails, or the task enters `in-progress` but no worker session links up, the task never reaches `review`, or the parent root never gets the completion update.

**Cause:** Kanban has two execution paths:

- **Assigned tasks** create a child session under the assignee's root through gateway RPC (`sessions.create`, then `sessions.send`). If that root does not exist, the run fails with `Parent agent session not found: <session key>`.
- **Unassigned or `operator` tasks** use the gateway's `sessions_spawn` HTTP tool, which must be in `gateway.tools.allow`. On macOS this path is disabled and the run fails with `Kanban automation on macOS requires assigning the task to a live worker agent root (not @main).`

Runs that never finish end with `Run timed out (polling limit reached)`.

**Fix:**

- For assigned tasks, make sure the assignee's root session exists and is healthy.
- For unassigned tasks, check that `sessions_spawn` is allowed on the gateway.
- On macOS, assign the task to a live worker root before running it.
- If the worker never appears, check the gateway connection, the `origin not allowed` entry above, and recent session events.

### Session stays busy

**Symptom:** A session keeps showing as working long after the reply finished.

**Cause:** Session status moves from `THINKING` to `STREAMING` to `DONE`, then back to `IDLE` 3 seconds later. A missed lifecycle event can leave it stuck.

**Fix:**

- Use the stop button, or Ctrl+C while a reply is generating, to abort.
- Refresh sessions to resync from the gateway.

---

## Model switching

### Model dropdown is empty or short

**Symptom:** The model selector is empty or lists only the current model.

**Cause:** `GET /api/gateway/models` reads the models from the OpenClaw config: `agents.defaults.model.primary`, `agents.defaults.model.fallbacks` and the `agents.defaults.models` allowlist. It reports `Could not read OpenClaw config.` or `No models configured in OpenClaw config.` when it finds none.

**Fix:**

- Configure the models in OpenClaw.
- Make sure Nerve can read the config file (`~/.openclaw/openclaw.json`, or `OPENCLAW_CONFIG_PATH`).
- Check the server log for `[gateway/models]` errors.
- Reopen the dialog or reload the page after fixing the config.

### Model change does not take effect

**Symptom:** You switched models, but replies still come from the old one.

**Cause:** Model and thinking changes go through the WebSocket RPC `sessions.patch`. Model changes fall back to `POST /api/gateway/session-patch` when that fails; thinking changes have no fallback.

- The HTTP fallback returns **501** for a thinking-only change.
- It returns **409** (`No active root session available. Provide sessionKey explicitly.`) when it cannot find a session and none was given.

**Fix:**

- For model changes, check that the fallback returned `{ "ok": true }`.
- For thinking changes, retry once the WebSocket has reconnected.
- On a 409, pass `sessionKey` or make sure a root session exists.
- Some models may not be available for the current session type.

---

## Rate limiting

### "Too many requests" errors

**Symptom:** The API returns 429 with `Too many requests. Please try again later.`

**Cause:** Per-client, per-path limits per minute: 5 for login, 3 for gateway restart, 10 for TTS, 30 for transcription, and 60 for most other API routes.

**Fix:**

- Wait for the window to pass (see the `Retry-After` and `X-RateLimit-Reset` headers).
- Behind a reverse proxy on another host, add its IP to `TRUSTED_PROXIES` so clients are told apart by `X-Forwarded-For`; otherwise they all share the proxy's limit.

---

## HTTPS

### Certificate errors

**Symptom:** The browser warns about the certificate or refuses to connect on port 3443.

**Fix:** Self-signed certificates always warn once; accept the warning in the browser. To create one:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem -days 365 \
  -subj "/CN=localhost"
```

Nerve starts HTTPS on `SSL_PORT` (default 3443) when `certs/cert.pem` and `certs/key.pem` exist. Restart after adding them.

### SSE not working over HTTPS

**Symptom:** Live updates (memory changes, token usage) do not arrive over HTTPS.

**Cause:** The HTTPS server streams `text/event-stream` responses instead of buffering them, and compression skips `/api/events`.

**Fix:** This should work without changes. If it does not, check:

- the response content type is `text/event-stream`
- no reverse proxy in between buffers the response

---

## Build and development

### `tsc -b` fails with path alias errors

**Symptom:** `Cannot find module '@/...'` during the TypeScript build.

**Cause:** The `@/` alias is defined in the root `tsconfig.json` and in `config/tsconfig.app.json`.

**Fix:** Make sure the root `tsconfig.json` still has:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

### `npm start` fails with "Cannot find module"

**Symptom:** `server-dist/` is empty or missing, and `npm start` fails.

**Cause:** The server is compiled separately from the frontend.

**Fix:**

```bash
npm run build:server   # compiles server/ to server-dist/
npm start              # runs node server-dist/index.js
```

`npm run build` builds both.

### Chunk size warnings during `vite build`

**Symptom:** Vite warns about large chunks.

**Info:** The build splits vendor code into chunks (`react-vendor`, `markdown`, `charts-vendor`, `lightweight-charts`, `editor-vendor`, `ui-vendor`, `utils`) and warns above 600 kB (`chunkSizeWarningLimit` in `vite.config.ts`). A new warning usually means an import pulled in a large library.

### `npm run dev` proxy errors

**Symptom:** API requests fail with 502 in development.

**Cause:** Vite proxies `/api` and `/ws` to `http://localhost:${PORT}`, with `PORT` defaulting to `3081` in `vite.config.ts`. If no backend listens there, every proxied request fails. `npm run dev:server` uses `PORT` from `.env` (usually 3080) unless you set it.

**Fix:** Run both, with the backend on 3081:

```bash
# Terminal 1
PORT=3081 npm run dev:server   # backend on 3081

# Terminal 2
npm run dev                    # frontend on 3080, proxies to 3081
```

### Tests fail with "Cannot find module"

**Symptom:** Vitest cannot resolve `@/` imports.

**Fix:** `vitest.config.ts` needs the same alias:

```ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
  },
},
```

It also excludes compiled output and worktrees from test discovery:

```ts
test: {
  exclude: ['node_modules/**', 'server-dist/**', '.worktrees/**'],
}
```

---

## Update and rollback

See [UPDATING.md](UPDATING.md) for the full updater reference.

### "No published release or semver tags found" (exit 20)

**Symptom:** `npm run update` fails while resolving the version.

**Cause:** The updater could not find a published GitHub release or a `vX.Y.Z` tag, often because git cannot reach `origin`.

**Fix:**

```bash
git remote -v              # check origin
git fetch --tags origin    # fetch tags
git tag -l 'v*'            # confirm tags exist locally
```

### "Another update is already running" (exit 80)

**Symptom:** The updater refuses to start: `Another update is already running (PID <pid>)`.

**Cause:** The lock file `~/.nerve/updater/update.lock` names a process that is still alive. A lock left by a dead process is removed automatically.

**Fix:**

```bash
cat ~/.nerve/updater/update.lock   # shows the PID
ps -p <pid>                         # is it still running?
```

Wait for that update to finish, or stop it. Remove the lock by hand only if the PID belongs to an unrelated process.

### Health check fails after update (exit 60)

**Symptom:** The update builds and restarts, but the health check fails or reports the wrong version.

**Cause:** The old server process kept the port, or the service has not fully restarted.

**Fix:** Restart the service and check the version:

```bash
# Linux (systemd)
sudo systemctl restart nerve.service

# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nerve.server

curl http://127.0.0.1:3080/api/version
```

### Rollback failed (exit 70)

**Symptom:** Both the update and the automatic rollback failed.

**Fix:** Recover by hand:

```bash
cat ~/.nerve/updater/last-good.json       # note the "ref"
git checkout --force <ref>
npm install && npm run build
# then restart the service as above
```

---

## Known limitations

None currently tracked.
