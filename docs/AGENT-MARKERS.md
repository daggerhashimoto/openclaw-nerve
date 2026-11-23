# Agent markers

Nerve parses a few special markers in agent output and replaces them with richer UI. Markers are stripped from the visible text.

| Marker | Parsed by | Applies to |
|--------|-----------|------------|
| `[tts:...]` | Browser | Chat replies |
| `[chart:{...}]` | Browser | Chat replies |
| `[kanban:create]` / `[kanban:update]` | Server | Results of kanban task runs only |

The last three sections (math, Google Maps embeds, images) are not markers. They are ordinary markdown that Nerve renders specially, and they are listed here because an agent has to use the right syntax to get them.

---

## TTS markers

Makes the agent's response play back as audio.

### Format

```
[tts: Text to be spoken aloud]
```

The marker ends at the first `]`, so the spoken text cannot contain a `]`.

### How it works

1. The user sends a voice message. The client sends the transcript prefixed with `[voice] `.
2. When the outgoing text starts with `[voice] `, Nerve appends a system hint to the message it sends to the gateway. The hint tells the agent to include its full text reply plus a `[tts: ...]` marker at the end, and never to send only a marker. The chat bubble and loaded history hide both the prefix and the hint.
3. The agent replies with readable text and a `[tts:...]` marker.
4. Nerve strips all `[tts:...]` markers from the visible text, while the reply streams and when it is loaded from history. When a live reply finishes, the text of the first marker is sent to the TTS engine (`POST /api/tts`) and played.
5. Fallback: if the reply to a voice message has no marker, Nerve tries to speak a cleaned excerpt of the reply instead. It removes code, links, images and markdown formatting, requires some letters to remain, and cuts the text to 300 characters. Treat this as a safety net only and always include the marker.

### Example

Agent response:
```
The weather in Istanbul is 22°C and sunny.

[tts: The weather in Istanbul is 22 degrees and sunny.]
```

Nerve displays: "The weather in Istanbul is 22°C and sunny."
Nerve speaks: "The weather in Istanbul is 22 degrees and sunny."

### Rules for agents

- Place `[tts:...]` at the end of the response.
- The spoken text can differ from the written text (for example, expand abbreviations or simplify formatting).
- Only the first `[tts:...]` marker is spoken. All markers are stripped from the display.
- Keep the spoken text under 5000 characters. `/api/tts` rejects longer text and nothing plays.
- Never send only a TTS marker. The response must be readable as text too.
- Nerve asks for a marker only after a voice message, but a marker in any live reply is spoken. Playback needs the "Sound effects" setting turned on (Settings, Audio). Loading history strips markers and never plays them.

### Implementation

- **Voice prefix**: `src/features/chat/InputBar.tsx` sends the finished transcription with `onSend('[voice] ' + text)`.
- **Hint injection**: `src/features/chat/operations/sendMessage.ts`, `applyVoiceTTSHint()`, called from `sendChatMessage()`.
- **Extraction**: `src/features/tts/useTTS.ts`, `extractTTSMarkers()`, called while streaming and on final replies from `src/features/chat/operations/streamEventHandler.ts` and when loading history from `src/features/chat/operations/loadHistory.ts`.
- **Playback and fallback**: `src/hooks/useChatTTS.ts` (`handleFinalTTS()`, `buildVoiceFallbackText()`), wired up in `src/contexts/ChatContext.tsx`. `speak()` in `useTTS.ts` fetches the audio.

---

## Chart markers

Embeds interactive charts inline in the conversation.

### Format

```
[chart:{"type":"<type>","title":"<title>","data":{...}}]
```

The marker must start with `[chart:{` and contain valid JSON that ends with `}]`. The parser uses bracket-balanced scanning (not a regex), so nested JSON works and brackets inside strings are ignored.

### Chart types

| Type | Renderer | Data required | Use case |
|------|----------|---------------|----------|
| `tv` | TradingView widget | `symbol` (non-empty string), no `data`; optional `interval` | Live financial tickers: stocks, crypto, forex, commodities |
| `line` | Lightweight Charts | `data.labels` plus `data.values`, or `data.series` | Custom series |
| `area` | Lightweight Charts | `data.labels` plus `data.values`, or `data.series` | Custom series with a translucent fill |
| `candle` | Lightweight Charts | `data.labels` plus `data.candles` (`open`, `high`, `low`, `close` per label) | Custom candlestick data |
| `bar` | Recharts | `data.labels` plus `data.values`, or `data.series` for grouped bars | Category comparisons |
| `pie` | Recharts | `data.labels` plus `data.values` | Proportions |

`series` is an array of `{"name": "...", "values": [...]}`. Labels pair with values by position. A `pie` chart with `series` instead of `values` uses the first series. A `candle` chart with no `candles` builds approximate candles from `values`.

### Examples

**TradingView live ticker** (no data needed, pulls live market data):
```
[chart:{"type":"tv","symbol":"TVC:GOLD","interval":"W","title":"Gold weekly"}]
```

**Line chart with custom data:**
```
[chart:{"type":"line","title":"Monthly Revenue","data":{"labels":["Jan","Feb","Mar","Apr"],"values":[4200,5800,4900,7100]}}]
```

**Multi-series line chart:**
```
[chart:{"type":"line","title":"Growth","data":{"labels":["Q1","Q2","Q3","Q4"],"series":[{"name":"Users","values":[100,250,480,720]},{"name":"Revenue","values":[10,35,90,180]}]}}]
```

**Candlestick chart with OHLC data:**
```
[chart:{"type":"candle","title":"BTC Weekly","data":{"labels":["W1","W2","W3"],"candles":[{"open":42000,"high":44000,"low":41000,"close":43500},{"open":43500,"high":45000,"low":42500,"close":44800},{"open":44800,"high":46000,"low":43000,"close":43200}]}}]
```

**Bar chart:**
```
[chart:{"type":"bar","title":"Revenue by Region","data":{"labels":["US","EU","Asia"],"values":[5200,3800,2900]}}]
```

**Pie chart:**
```
[chart:{"type":"pie","title":"Market Share","data":{"labels":["Chrome","Safari","Firefox"],"values":[65,20,15]}}]
```

### Validation

- The JSON must parse, and `type` must be one of the six types above.
- `tv` needs a non-empty string `symbol`. Every other type needs a `data` object whose `labels` is an array and which has at least one of `values`, `series` or `candles`. Whichever of these is present must be an array. The items inside are not checked.
- A marker that is complete but fails parsing or validation is removed from the text and no chart is drawn. A `[chart:` with no balanced closing `}]` is left in the text as written.
- Several chart markers in one reply are all rendered, below the message text.

### TradingView symbols

| Asset | Symbol |
|-------|--------|
| Gold | `TVC:GOLD` |
| Silver | `TVC:SILVER` |
| Bitcoin | `BITSTAMP:BTCUSD` |
| Ethereum | `BITSTAMP:ETHUSD` |
| Apple | `NASDAQ:AAPL` |
| Tesla | `NYSE:TSLA` |
| EUR/USD | `FX:EURUSD` |
| S&P 500 | `SP:SPX` |
| US Dollar Index | `TVC:DXY` |
| Uranium | `NYMEX:UX1!` |

**Intervals:** `1` (1 minute), `5`, `15`, `60`, `D` (daily), `W` (weekly), `M` (monthly). The value is passed to TradingView unchanged. Default: `W`.

The widget loads TradingView's embed script in the browser, so the browser needs access to `s3.tradingview.com`. Nerve's content security policy already allows it.

### Rules for agents

- Put each chart marker on its own line.
- The marker text is stripped from the visible message, so add context before or after it.
- Keep labels short (they need to fit on chart axes).
- For real financial instruments, prefer `tv` (live data, interactive, no manual data needed).
- For custom or computed data, use `line`, `area`, `candle`, `bar` or `pie`.
- 3 to 12 data points is the sweet spot for readability.

### How agents learn about charts

Unlike TTS markers, chart markers are not injected by Nerve at runtime.

Agents only use `[chart:{...}]` markers when that syntax is already present in their own instructions or workspace context, for example in `TOOLS.md`, `AGENTS.md`, or another prompt source you manage.

### Implementation

- **Parser and validation**: `src/features/charts/extractCharts.ts`, `extractChartMarkers()` (bracket-balanced extraction) and `isValidChartData()`.
- **Router**: `src/features/charts/InlineChart.tsx` dispatches to the renderer by type. It is lazy-loaded from `src/features/chat/MessageBubble.tsx`, and it renders `bar` and `pie` itself with Recharts.
- **TradingView**: `src/features/charts/TradingViewWidget.tsx` injects TradingView's official embed script.
- **Lightweight Charts**: `src/features/charts/LightweightChart.tsx` renders `line`, `area` and `candle`.

---

## Kanban markers

Lets agents propose task changes on the kanban board. The server parses the markers from the result of a kanban task run, turns them into proposals, and strips them from the result stored on the task.

These markers work only in kanban task results. In an ordinary chat session they are not parsed or stripped and show up as plain text.

### Format

**Create a task:**

```
[kanban:create]{"title":"Fix login timeout bug","priority":"high","description":"Users report 504 errors after 30s"}[/kanban:create]
```

**Update an existing task:**

```
[kanban:update]{"id":"fix-login-timeout-bug","status":"done","result":"Fixed the timeout by increasing the keepalive"}[/kanban:update]
```

The closing tag must repeat the opening type. The payload must be a single JSON object.

### Limits and what is skipped

- At most 5 valid markers are used per result. Further ones are ignored.
- Each JSON payload is limited to 2048 bytes (UTF-8, after trimming). Larger markers are skipped.
- A marker is silently skipped if its JSON is malformed, is not an object, has no non-empty string `title` (create), or has no non-empty string `id` (update).
- A valid marker can still fail when the proposal is created. The proposal is dropped, with a warning in the server log, if `status` is not a built-in status or a status key of the board, or if `assignee` is invalid.
- Markers are stripped from the stored result only when at least one marker was valid. In that case every marker is removed, including skipped ones. If no marker is valid, the text is left unchanged.
- Values are not otherwise checked against the limits of the REST API (title length, label count and so on). Stay within the documented values.

### Create payload fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | Yes | Task title |
| `description` | `string` | No | Task description |
| `status` | `string` | No | `backlog`, `todo`, `in-progress`, `review`, `done`, `cancelled`, or a column key of the board. Defaults to the board's default status |
| `priority` | `string` | No | `critical`, `high`, `normal`, `low`. Defaults to the board's default priority |
| `assignee` | `string` | No | `"operator"` or `"agent:<agent id>"`. `agent:main` is rejected |
| `labels` | `string[]` | No | Tags |
| `model` | `string` | No | Model for execution |
| `thinking` | `string` | No | `off`, `low`, `medium`, `high` |
| `dueAt` | `number` | No | Due date (epoch ms) |
| `estimateMin` | `number` | No | Estimated minutes |

### Update payload fields

Only the fields below are applied. Any other field in an update payload is ignored.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Task ID to update |
| `title` | `string` | No | New title |
| `description` | `string` | No | New description |
| `status` | `string` | No | New status |
| `priority` | `string` | No | New priority |
| `assignee` | `string` | No | New assignee |
| `labels` | `string[]` | No | Replaces the labels |
| `result` | `string` | No | Result text |

Task IDs are slugs made from the title: lowercase, non-alphanumeric runs become `-`, at most 30 characters, with `-2`, `-3` and so on added when a slug is taken (for example `fix-login-timeout-bug`). They are not UUIDs.

### How it works

1. A kanban run starts. The prompt Nerve sends contains the task title and description only. It does not mention markers and does not include the task ID, so an agent must learn the marker syntax (and any IDs) from its own instructions.
2. The agent includes `[kanban:create]` or `[kanban:update]` markers in its final message. Only the last assistant message of the run is read (for a message made of several parts, the first text part).
3. When the run finishes, the server's run poller reads that message. `POST /api/kanban/tasks/:id/complete` does the same for a `result` sent to it, unless the request carries an `error`.
4. Each valid marker creates a proposal in the kanban store.
5. The markers are stripped from the result text stored on the task.
6. The proposal appears in the Proposals pane of the kanban header.
7. The operator approves or rejects it.

When the board config `proposalPolicy` is `"auto"` (the default is `"confirm"`), step 7 is skipped and proposals are applied immediately. That means the task named by an update marker's `id` must already exist: if it does not, no proposal is stored, the server logs a warning, and the marker is still stripped from the result. With `"confirm"`, the same update is stored as a pending proposal and fails when the operator approves it.

### Example

An agent working on a task might output:

```
I've completed the auth refactoring. I also noticed two related issues.

[kanban:create]{"title":"Add rate limiting to login endpoint","priority":"high","labels":["security"]}[/kanban:create]
[kanban:create]{"title":"Update auth documentation","priority":"low","labels":["docs"]}[/kanban:create]
```

The result stored on the task: "I've completed the auth refactoring. I also noticed two related issues."

Two proposals are created for the operator to review.

### Implementation

- **Parser**: `server/lib/parseMarkers.ts`, `parseKanbanMarkers()` and `stripKanbanMarkers()` (regex extraction with JSON validation). `src/features/kanban/lib/parseMarkers.ts` is a copy that only its test uses; the server copy is the one that runs.
- **Integration**: `server/routes/kanban.ts`, `pollSessionCompletion()`, `pollFallbackSessionCompletion()` (the assignee-root launch path, the default on macOS) and the `POST /api/kanban/tasks/:id/complete` handler.
- **Proposals**: `server/lib/kanban-store.ts`, `createProposal()` (status and assignee checks, auto policy) and `approveProposal()`.
- **Frontend**: `src/features/kanban/ProposalInbox.tsx`, shown from `KanbanHeader.tsx`.

---

## Where markers are processed

**While a reply streams**, `extractStreamDelta()` in `src/features/chat/operations/streamEventHandler.ts` strips TTS and chart markers from the accumulated text. A marker appears as raw text until its closing `]` (or `}]`) has arrived. The live bubble uses a lighter markdown renderer than finished messages.

**For a finished reply and for history**, `processChatMessages()` in `src/features/chat/operations/loadHistory.ts` handles each message in this order:

1. TTS markers are stripped (`extractTTSMarkers`).
2. Chart markers are extracted and attached to the message (`extractCharts.ts`).
3. Image references are extracted (assistant messages only, see Images below).
4. The remaining text is rendered with `src/features/markdown/MarkdownRenderer.tsx`: GitHub-flavoured markdown, math, highlighted code and Google Maps embeds.

The visible text has no markers. Charts and extracted images are drawn below the message text. The speech for a live reply comes from the TTS text that `extractFinalMessage()` pulls out of the final event. Kanban markers are not part of this pipeline.

---

## Math

Math is plain markdown rendering with KaTeX, not a marker. Nothing is stripped.

### Format

| Delimiters | Kind |
|------------|------|
| `$...$` and `\(...\)` | Inline |
| `$$...$$` and `\[...\]` | Display |

### Rules for agents

- A single `$` pair is math only when the opening `$` is followed by a non-space character and does not follow a letter or digit, and the closing `$` follows a non-space character and is not followed by a letter or digit. This keeps prose like "costs $5 and $10" or `$HOME/$USER` as text.
- For display math, put `$$` or `\[` alone on a line and end the block on the line that ends with `$$` or `\]`. A block that never closes stays plain text.
- Inside a paragraph, `\[...\]` is math only if it is padded with whitespace on both sides or contains a backslash or a caret. This keeps `\[1\]` as text.
- A fenced code block with the language `math` is shown as code, not typeset.
- KaTeX runs with `trust` off (no `\href` and similar commands), `maxSize` 100 and `maxExpand` 1000, which bound the size of an expression and macro expansion.
- Math is typeset in finished messages. The live streaming bubble shows the raw text until the reply completes.

### Implementation

- **Delimiters**: `src/features/markdown/remarkTexMath.ts`, a custom micromark extension (not `remark-math`).
- **Typesetting and options**: `src/features/markdown/MarkdownRenderer.tsx` (`rehype-katex` with `REHYPE_KATEX_OPTIONS`).

---

## Google Maps embeds

A Google Maps embed link is shown as an inline map. This is plain markdown rendering, not a marker.

### Format

```
[View map](https://www.google.com/maps/embed?pb=...)
```

Use the `src` URL of the iframe that Google Maps gives under Share, "Embed a map".

### Rules for agents

- The link must be the only content of its paragraph. A link inside a sentence is not embedded.
- The URL must be `https`, on the host `www.google.com`, with the path `/maps/embed` and a non-empty `pb` parameter.
- Ordinary Maps links (`/maps/place/...`, short links) stay normal clickable links, because Google does not allow them to be framed.
- The link text stays visible and the map appears below it. Maps are embedded in finished chat messages, not in the live streaming bubble.

### Implementation

- `src/features/markdown/MarkdownRenderer.tsx`, `getGoogleMapsEmbedUrl()`, enabled by the `embedGoogleMaps` prop that `MessageBubble.tsx` passes.
- The content security policy allows framing `https://www.google.com` (`server/middleware/security-headers.ts`).

---

## Images

An assistant message shows images from three text patterns, which Nerve extracts and strips from the text, and from images the gateway attaches to the reply.

### Format

```
![Chart of results](/tmp/results.png)

MEDIA: /tmp/results.png

https://example.com/results.png
```

- A markdown image `![alt](url)`.
- A line that starts with `MEDIA:` followed by a path or URL (the OpenClaw convention).
- A bare `http(s)` URL alone on its own line.

In all three the URL, ignoring any `?query`, must end in `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg` or `.avif`. The images are shown under the message text and open in a lightbox.

### Rules for agents

- A local path (starting with `/`, `./` or `~`) is loaded through `GET /api/files`, which only serves those image types from `/tmp`, `~/.openclaw` and the `MEMORY_DIR` directory. Use an absolute path in one of those places, and leave any `?query` off it. The extractor accepts `/tmp/results.png?v=1`, but `/api/files` takes the whole string as the file path, so the extension check fails and the image does not load (403).
- Other URLs are used as written. Nerve's content security policy allows images only from its own origin and from `data:` and `blob:` sources, so a remote image URL is extracted but the browser does not load it. Prefer local files.
- A markdown image whose URL has no image extension is not extracted, and assistant messages never render markdown images inline, so it shows nothing.
- Images that the agent delivers as a reply attachment (for example a generated image) need no syntax. The gateway puts an image block in the message with a path under `/api/chat/media/outgoing/`, and Nerve loads it through its `GET /api/chat-media` proxy, which passes only that path shape and only raster image types.

### Implementation

- `src/features/chat/extractImages.ts`, `extractImages()`, called from `loadHistory.ts` for assistant messages.
- `src/features/chat/operations/loadHistory.ts`, `gatewayMediaImage()` for gateway attachments.
- `server/routes/files.ts` (`/api/files`) and `server/routes/chat-media.ts` (`/api/chat-media`).
