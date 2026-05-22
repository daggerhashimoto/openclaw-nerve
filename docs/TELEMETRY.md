# Telemetry

This is Nerve's public telemetry contract for the telemetry code currently implemented in the app.

## Quick controls

Telemetry is controlled only from server configuration.

```bash
# Disable all off-box telemetry
NERVE_TELEMETRY_MODE=off

# Other valid modes
NERVE_TELEMETRY_MODE=minimal
NERVE_TELEMETRY_MODE=detailed

# Local metadata and aggregate state directory
NERVE_TELEMETRY_DIR=<PROJECT_ROOT>/.nerve/telemetry
```

To disable telemetry completely:

1. Edit Nerve's `.env` file.
2. Set `NERVE_TELEMETRY_MODE=off`.
3. Restart Nerve.

Fresh installs confirmed by `install.sh` or `npm run setup` default to `minimal`. For non-interactive source setup, pass `--fresh-install` when you want brand-new install defaults. Legacy upgrades stay `off` until explicitly configured. The first-run notice is informational only, not a consent toggle.

## Effective mode resolution

Nerve resolves the effective telemetry mode in this order:

1. If `NERVE_TELEMETRY_MODE` is set to `off`, `minimal`, or `detailed`, that exact value wins.
2. If `NERVE_TELEMETRY_MODE` is set to any other non-empty value, Nerve fails closed to `off`.
3. Otherwise, if Nerve has a trusted `fresh_install` bootstrap marker written by `install.sh` or `npm run setup`, the effective mode is `minimal`.
4. Otherwise, the effective mode is `off`.

That means:

- valid explicit env config always overrides install defaults
- invalid explicit env config fails closed to `off`
- trusted fresh installs fall back to `minimal` only when the mode is unset
- anything else, including legacy upgrades without an explicit mode, fails safe to `off`

## Local files written by telemetry

By default, Nerve stores local telemetry metadata in `<PROJECT_ROOT>/.nerve/telemetry`.

| File | Purpose |
| --- | --- |
| `identity.json` | stable anonymous `instance_id` UUID |
| `install-method.json` | install provenance: `release`, `source`, or `unknown` |
| `bootstrap.json` | install bootstrap marker: `fresh_install` or `upgrade_legacy` |
| `phase1-state.json` | rolling 24 hour counters, feature booleans, hashed seen-session markers, and heartbeat bookkeeping |

The local store is used to compute trailing 24 hour snapshots. It does not store chat transcripts, prompt history, tool payloads, or other raw content for telemetry purposes.

## Telemetry modes

| Mode | What happens |
| --- | --- |
| `off` | Nothing is sent to the configured telemetry endpoints. |
| `minimal` | Phase 1 only: heartbeat snapshots and scrubbed server-side error reports are sent to the configured Phase 1 base URL, which defaults to `https://telemetry-nerve-zone.netlify.app`. |
| `detailed` | Includes all `minimal` telemetry plus the approved Phase 2 detailed events sent to the configured Phase 2 base URL. The current default is also `https://telemetry-nerve-zone.netlify.app`, so keep `detailed` off until `/v1/events` exists there. |

## Data that may never leave the box

Nerve's telemetry pipeline must never send:

- chat text
- prompts
- tool input payloads
- tool output payloads
- filenames
- filesystem paths
- repository names
- auth headers
- cookies
- environment variable values
- freeform request bodies
- user identifiers
- usernames
- email addresses
- raw exception context blobs that can contain any of the above

This applies to both Phase 1 and Phase 2.

## Domains and endpoints

### Phase 1

By default Nerve sends Phase 1 traffic to the current first-party Netlify deployment at `https://telemetry-nerve-zone.netlify.app`. Override this with `NERVE_TELEMETRY_PHASE1_BASE_URL` when needed.

- `https://telemetry-nerve-zone.netlify.app/v1/heartbeat`
- `https://telemetry-nerve-zone.netlify.app/v1/error`

### Phase 2

Nerve uses `NERVE_TELEMETRY_PHASE2_BASE_URL` for approved Phase 2 detailed events. The current default is also `https://telemetry-nerve-zone.netlify.app`, so production `detailed` mode must stay off until that destination exposes:

- `https://telemetry-nerve-zone.netlify.app/v1/events`

Browser-originated telemetry never posts directly to the configured Phase 2 base URL. The browser sends tiny same-origin relay payloads to:

- `POST /api/telemetry/events`

Nerve validates those payloads locally, then forwards only the approved detailed event shape when the effective mode is `detailed`.

## Phase 1, minimal telemetry

### Phase 1 purpose

Phase 1 is the minimal telemetry contract. It answers install, version, feature-area, and coarse reliability questions without sending content.

### Phase 1 counters and booleans

Heartbeat snapshots contain exactly these counters:

| Field | Meaning in current code |
| --- | --- |
| `counts_24h.sessions_created` | increments when Nerve records `session_created`, currently on successful subagent spawn and on the first successful message sent into a previously unseen root session |
| `counts_24h.messages_sent` | increments when a `chat.send` request succeeds through the Nerve proxy |
| `counts_24h.tool_calls` | increments when a tool call completes, whether it finished successfully or failed before returning a result |

Heartbeat snapshots also contain exactly these feature booleans:

| Field | Flips to `true` when current code sees |
| --- | --- |
| `features_used_24h.chat` | a successful message submission or tool completion |
| `features_used_24h.sessions` | a session being created explicitly, opened from the UI, renamed, deleted, or implicitly recorded when the first successful message lands in a previously unseen root session |
| `features_used_24h.branches` | a top-level branch being created or a top-level workspace branch switch being recorded |
| `features_used_24h.kanban` | Kanban task creation and current Kanban mutation flows such as reorder, execute, approve, reject, or abort |
| `features_used_24h.settings` | current tracked settings write paths such as API keys, STT config, language or voice phrase updates |

For the exact per-boolean trigger inventory, including what does **not** currently count, see [Telemetry Feature Booleans](./TELEMETRY-FEATURE-BOOLEANS.md).

`active_24h` is `true` if any counter is non-zero or any feature boolean is `true` inside the trailing 24 hour window.

### Branch creation and branch switch semantics

Current code records branch telemetry with these semantics:

- `branch_created` is a local UI event emitted after a new top-level root agent is created and opened
- `branch_switched` is emitted when the workspace changes between different top-level roots, including creating and opening the first top-level root from an empty workspace
- switching between a root session and one of its own subagents does not emit `branch_switched`

`branch_created` only marks the Phase 1 `branches` boolean locally. `branch_switched` marks the `branches` boolean locally and becomes a Phase 2 detailed event only in `detailed` mode.

### Phase 1 heartbeat payload

Every Phase 1 heartbeat sent off box has this exact shape:

```json
{
  "schema_version": 1,
  "instance_id": "uuid",
  "app_version": "1.5.2",
  "install_method": "release",
  "reason": "daily",
  "sent_at": "2026-04-20T20:00:00.000Z",
  "window_start": "2026-04-19T20:00:00.000Z",
  "window_end": "2026-04-20T20:00:00.000Z",
  "active_24h": true,
  "counts_24h": {
    "sessions_created": 8,
    "messages_sent": 54,
    "tool_calls": 17
  },
  "features_used_24h": {
    "chat": true,
    "sessions": true,
    "branches": false,
    "kanban": true,
    "settings": false
  }
}
```

Field contract:

| Field | Type | Values |
| --- | --- | --- |
| `schema_version` | number | always `1` |
| `instance_id` | string | stable anonymous UUID generated locally |
| `app_version` | string | Nerve app version |
| `install_method` | string | `release`, `source`, or `unknown` |
| `reason` | string | `first_seen`, `daily`, or `version_change` |
| `sent_at` | string | ISO timestamp |
| `window_start` | string | ISO timestamp for the trailing 24 hour window start |
| `window_end` | string | ISO timestamp for the trailing 24 hour window end |
| `active_24h` | boolean | derived from the counters and booleans below |
| `counts_24h` | object | exact keys: `sessions_created`, `messages_sent`, `tool_calls` |
| `features_used_24h` | object | exact keys: `chat`, `sessions`, `branches`, `kanban`, `settings` |

### Crash and error reporting in `minimal`

`minimal` includes server-side crash and error reporting.

Important limits:

- it is server-side only, there is no frontend crash-reporting payload in the current implementation
- it is allowlisted, not blocklisted
- it is best effort, asynchronous, and non-blocking
- if sending fails, Nerve swallows the failure and continues normal operation

The only fields that leave the box for a Phase 1 error report are:

```json
{
  "schema_version": 1,
  "instance_id": "uuid",
  "app_version": "1.5.2",
  "install_method": "release",
  "error_kind": "server_exception",
  "error_code": "E_SESSION_LOAD_FAILED",
  "surface": "api",
  "fingerprint": "sha256:...",
  "occurred_at": "2026-04-21T00:00:00.000Z"
}
```

Field contract:

| Field | Type | Values |
| --- | --- | --- |
| `schema_version` | number | always `1` |
| `instance_id` | string | stable anonymous UUID |
| `app_version` | string | Nerve app version |
| `install_method` | string | `release`, `source`, or `unknown` |
| `error_kind` | string | `server_exception` or `non_error_throwable` |
| `error_code` | string | uppercase safe code, or `UNKNOWN` if absent or unsafe |
| `surface` | string | current server error handler uses `api` or `page`; omitted or invalid values normalize to `server` |
| `fingerprint` | string | SHA-256 fingerprint derived from error kind, error code, surface, and safe error name |
| `occurred_at` | string | ISO timestamp |

Scrubbed and allowlisted means the payload does **not** include:

- error message text
- stack traces
- request bodies
- headers
- cookies
- env values
- file paths
- repository names
- any arbitrary serialized error metadata

## Phase 2, detailed telemetry

### Activation rule

Phase 2 is active only when `NERVE_TELEMETRY_MODE=detailed`.

`minimal` never sends Phase 2 product events.

### Browser relay contract

Current browser relay payloads accepted by Nerve are:

```json
{ "event": "session_opened" }
{ "event": "branch_created" }
{ "event": "branch_switched", "properties": { "success": true } }
```

Unknown event names and unknown properties are rejected.

Current behavior:

- `session_opened` only marks the `sessions` Phase 1 feature boolean
- `branch_created` only marks the `branches` Phase 1 feature boolean
- `branch_switched` marks the `branches` Phase 1 feature boolean and is forwarded as a Phase 2 event only in `detailed` mode

### Phase 2 event allowlist

The only Phase 2 event names currently allowed are:

- `session_created`
- `message_submitted`
- `tool_call_completed`
- `branch_switched`
- `kanban_task_created`

All forwarded Phase 2 payloads share these top-level fields:

- `schema_version`
- `event`
- `instance_id`
- `app_version`
- `install_method`
- `sent_at`
- `properties`

Exact event property contract:

| Event | Exact `properties` fields in current code |
| --- | --- |
| `session_created` | `surface`, `feature_area` |
| `message_submitted` | `surface`, `feature_area` |
| `tool_call_completed` | `surface`, `feature_area`, `tool_name`, `success`, `duration_bucket` |
| `branch_switched` | `surface`, `feature_area`, `success` |
| `kanban_task_created` | `surface`, `feature_area`, `success` |

Current emitted shapes:

```json
{
  "schema_version": 1,
  "event": "session_created",
  "instance_id": "uuid",
  "app_version": "1.5.2",
  "install_method": "source",
  "sent_at": "2026-04-21T00:05:01.000Z",
  "properties": {
    "surface": "sessions",
    "feature_area": "sessions"
  }
}
```

```json
{
  "schema_version": 1,
  "event": "tool_call_completed",
  "instance_id": "uuid",
  "app_version": "1.5.2",
  "install_method": "source",
  "sent_at": "2026-04-21T00:05:02.000Z",
  "properties": {
    "surface": "chat",
    "feature_area": "chat",
    "tool_name": "web",
    "success": true,
    "duration_bucket": "1_5s"
  }
}
```

```json
{
  "schema_version": 1,
  "event": "branch_switched",
  "instance_id": "uuid",
  "app_version": "1.5.2",
  "install_method": "source",
  "sent_at": "2026-04-21T00:05:00.000Z",
  "properties": {
    "surface": "workspace",
    "feature_area": "workspace",
    "success": true
  }
}
```

### Phase 2 enums and buckets

`surface` and `feature_area` are bounded to Nerve-owned taxonomy values:

- `chat`
- `sessions`
- `kanban`
- `workspace`
- `settings`

`tool_name` is coerced into one of these coarse families:

- `read`
- `write`
- `edit`
- `exec`
- `browser`
- `web`
- `message`
- `memory`
- `image`
- `video`
- `pdf`
- `session_ops`
- `other`

Raw tool names do not leave the box. Unknown tools are coerced to `other`.

`duration_bucket` is always one of:

- `lt_1s`
- `1_5s`
- `5_30s`
- `gt_30s`

### Detailed event ownership and current triggers

| Event | Owner | Current trigger |
| --- | --- | --- |
| `session_created` | server | successful subagent spawn, or first successful message into a previously unseen root session |
| `message_submitted` | server | successful `chat.send` through the Nerve proxy |
| `tool_call_completed` | server | tool result arrival or run failure before a pending tool returns |
| `branch_switched` | browser via Nerve relay | switch to a different top-level root, including creating and opening the first top-level root from an empty workspace |
| `kanban_task_created` | server | successful Kanban task creation |

## Fresh installs, upgrades, and the first-run notice

### Fresh installs

Fresh installs created by `install.sh` or `npm run setup` stamp Nerve as `fresh_install`. Current setup flows also default new installs to `NERVE_TELEMETRY_MODE=minimal` when no explicit mode is present.

If the effective mode is `minimal` and the bootstrap marker is `fresh_install`, `/api/server-info` exposes `showFreshInstallNotice: true` and the UI shows the first-run telemetry notice.

That notice:

- says the fresh install is using minimal telemetry
- links to the build-matched public telemetry document served by the running Nerve instance
- explains that disabling telemetry means setting `NERVE_TELEMETRY_MODE=off` in `.env` and restarting Nerve
- is informational only

Dismissing it only hides the banner locally in browser storage for that disclosed install. It does not change server configuration or telemetry mode.

### Legacy upgrades

When an older install reaches telemetry-capable code without an explicit telemetry mode, Nerve writes an `upgrade_legacy` bootstrap marker and keeps the effective mode `off` until you configure it explicitly.

Nerve does not silently enable telemetry for legacy upgrades.

## Retention policy

Current public retention targets are:

These are service-side retention targets for Nerve-operated telemetry backends. The app does not enforce remote retention from the client side.

### Phase 1

- raw heartbeats: 30 to 90 days
- raw errors: 30 days
- daily rollups derived from heartbeats: 12 months or longer

### Phase 2

- raw accepted relay payloads: 30 days
- detailed analytics events in the analytics backend: 90 days
- aggregate dashboards or rollups derived from them: 12 months or longer

## Reliability guarantees

Telemetry is designed to stay out of the way of normal Nerve use.

Current implementation guarantees:

- no startup blocking on telemetry services
- no request blocking on telemetry delivery
- best-effort async sends only
- transport failures are swallowed
- no user-facing error noise for telemetry transport outages
