# Agent Markers

Nerve parses special markers in agent responses to render rich UI elements. These markers are stripped from the visible text and replaced with interactive components.

## TTS Markers — `[tts:...]`

Makes the agent's response play back as audio.

### Format

```
[tts: Text to be spoken aloud]
```

### How It Works

1. **User sends a voice message** → Nerve prepends `[voice] ` to the text
2. **Nerve appends a system hint** to the message telling the agent to include `[tts:...]` markers in its response
3. **Agent responds** with both readable text AND a `[tts:...]` marker
4. **Nerve extracts the marker**, strips it from visible text, and sends it to the TTS engine for audio playback
5. **Fallback**: If the agent forgets the marker but the user sent a voice message, Nerve auto-speaks the full response text

### Example

Agent response:
```
The weather in Istanbul is 22°C and sunny.

[tts: The weather in Istanbul is 22 degrees and sunny.]
```

Nerve displays: "The weather in Istanbul is 22°C and sunny."  
Nerve speaks: "The weather in Istanbul is 22 degrees and sunny."

### Rules for Agents

- Place `[tts:...]` at the **end** of the response
- The spoken text can differ from the written text (e.g., expand abbreviations, simplify formatting)
- Only the **first** `[tts:...]` marker is used for audio; all markers are stripped from display
- Never send **only** a TTS marker — the response must be readable as text too
- TTS markers are only expected when the user sends a voice message (indicated by `[voice]` prefix)

### Implementation

- **Injection**: `src/features/chat/operations/sendMessage.ts` — `applyVoiceTTSHint()` appends the system hint when `[voice] ` prefix is detected
- **Extraction**: `src/features/tts/useTTS.ts` — `extractTTSMarkers()` parses markers from response text
- **Fallback**: `src/contexts/ChatContext.tsx` — auto-speaks response if voice message had no `[tts:...]` marker

---

## Chart Markers — `[chart:{...}]`

Embeds interactive charts inline in the conversation.

### Format

```
[chart:{"type":"<type>","title":"<title>","data":{...}}]
```

The marker must contain valid JSON inside `[chart:{...}]`. The parser uses bracket-balanced scanning (not regex) to handle nested JSON correctly.

### Chart Types

| Type | Renderer | Data Required | Use Case |
|------|----------|--------------|----------|
| `tv` | TradingView Widget | `symbol` (no `data`) | Live financial tickers — stocks, crypto, forex, commodities |
| `line` | Lightweight Charts | `labels` + `values` or `series` | Custom time-series data |
| `area` | Lightweight Charts | `labels` + `values` or `series` | Custom time-series with gradient fill |
| `candle` | Lightweight Charts | `labels` + `candles` (OHLC) | Custom candlestick data |
| `bar` | Recharts | `labels` + `values` | Category comparisons |
| `pie` | Recharts | `labels` + `values` | Proportions |

### Examples

**TradingView live ticker** (no data needed — pulls live market data):
```
[chart:{"type":"tv","symbol":"TVC:GOLD","interval":"W","title":"Gold — Weekly"}]
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

### TradingView Symbols

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

**Intervals:** `1` (1min), `5`, `15`, `60`, `D` (daily), `W` (weekly), `M` (monthly). Default: `W`

### Rules for Agents

- Place chart markers on their own line for best rendering
- The marker text is stripped from the visible message — add context before/after
- Keep labels short (they need to fit on chart axes)
- For real financial instruments, prefer `tv` type (live data, interactive, no manual data needed)
- For custom/computed data, use `line`/`area`/`candle`/`bar`/`pie`
- 3–12 data points is the sweet spot for readability

### How Agents Learn About Charts

Unlike TTS markers (which use runtime prompt injection), chart markers are taught to agents via the **`TOOLS.md` workspace file**. Nerve's installer can inject chart documentation into `TOOLS.md` automatically (see PR #218).

Agents that have the chart syntax in their `TOOLS.md` will naturally include `[chart:{...}]` markers when data visualization is appropriate.

### Implementation

- **Parser**: `src/features/charts/extractCharts.ts` — bracket-balanced `[chart:{...}]` extraction with JSON validation
- **Router**: `src/features/charts/InlineChart.tsx` — dispatches to correct renderer by type
- **TradingView**: `src/features/charts/TradingViewWidget.tsx` — official script injection embed
- **Lightweight Charts**: `src/features/charts/LightweightChart.tsx` — line/area/candle with dark theme
- **Recharts**: Lazy-loaded for bar/pie (bundled in `InlineChart.tsx`)

---

## Kanban Markers -- `[kanban:create]` / `[kanban:update]`

Lets agents propose task changes on the kanban board. Markers are parsed from agent output, converted into proposals, and stripped from the displayed result.

### Format

**Create a task:**

```
[kanban:create]{"title":"Fix login timeout bug","priority":"high","description":"Users report 504 errors after 30s"}[/kanban:create]
```

**Update an existing task:**

```
[kanban:update]{"id":"a1b2c3d4-...","status":"done","result":"Fixed the timeout by increasing the keepalive"}[/kanban:update]
```

### Safety Limits

- **Max 5 markers** per message (additional markers are ignored)
- **Max 2 KB** per JSON payload (markers exceeding this are skipped)
- Malformed JSON or missing required fields are silently skipped

### Create Payload Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | Yes | Task title (1--500 chars) |
| `description` | `string` | No | Task description (max 10000 chars) |
| `status` | `string` | No | Initial status (defaults to board config) |
| `priority` | `string` | No | `critical`, `high`, `normal`, `low` |
| `assignee` | `string` | No | `"operator"` or `"agent:<label>"` |
| `labels` | `string[]` | No | Tags (max 50 items) |
| `model` | `string` | No | Model for execution |
| `thinking` | `string` | No | `off`, `low`, `medium`, `high` |
| `dueAt` | `number` | No | Due date (epoch ms) |
| `estimateMin` | `number` | No | Estimated minutes |

### Update Payload Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Task ID to update |
| `title` | `string` | No | New title |
| `description` | `string` | No | New description |
| `status` | `string` | No | New status |
| `priority` | `string` | No | New priority |
| `assignee` | `string` | No | New assignee |
| `labels` | `string[]` | No | Replace labels |
| `result` | `string` | No | Result text (max 50000 chars) |

### How It Works

1. Agent includes `[kanban:create]` or `[kanban:update]` markers in its response
2. When the agent session completes, the backend's poller (or `POST /api/kanban/tasks/:id/complete`) parses the markers
3. Each valid marker creates a **proposal** in the kanban store
4. Markers are stripped from the result text stored on the task
5. The proposal appears in the frontend's proposal inbox
6. The operator approves or rejects the proposal

When `proposalPolicy` is `"auto"`, step 6 is skipped -- proposals are applied immediately.

### Example

An agent working on a task might output:

```
I've completed the auth refactoring. I also noticed two related issues.

[kanban:create]{"title":"Add rate limiting to login endpoint","priority":"high","labels":["security"]}[/kanban:create]
[kanban:create]{"title":"Update auth documentation","priority":"low","labels":["docs"]}[/kanban:create]
```

The result stored on the task: "I've completed the auth refactoring. I also noticed two related issues."

Two proposals are created in the inbox for the operator to review.

### Implementation

- **Parser**: `server/lib/parseMarkers.ts` -- regex-based extraction with JSON validation
- **Integration**: `server/routes/kanban.ts` -- `pollSessionCompletion()` and `POST .../complete` handler
- **Frontend**: Proposals are displayed in the kanban board's proposal inbox

---

## Marker Processing Pipeline

When an agent response arrives, markers are processed in this order:

1. **TTS extraction** — `[tts:...]` markers are extracted and queued for audio playback
2. **Chart extraction** — `[chart:{...}]` markers are extracted and attached to the message object
3. **Image extraction** — Inline image references are extracted
4. **Markdown rendering** — Remaining text is rendered as markdown with syntax highlighting
5. **Tool result rendering** — Tool call sentinels are converted to collapsible `<details>` elements

The cleaned text (with all markers stripped) is what the user sees. Charts render as interactive components below the message text.
