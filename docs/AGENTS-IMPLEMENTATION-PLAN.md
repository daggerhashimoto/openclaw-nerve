# OpenCLAW 16-Agent Implementation Plan for Nerve

**Date:** March 10, 2026  
**Architecture:** Multi-Instance Agent Orchestration

---

## Critical Architecture Understanding

**JARVIS does NOT spawn sub-agents within a single OpenClaw session.**

Each of the 16 agents is a **separate, independent OpenClaw instance**:

```
┌──────────────────────────────────────────────────────────────────┐
│                         Nerve Dashboard                           │
│                     (localhost:3080)                              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Agent Registry - Directory of all 16 agents                │ │
│  │  - Gateway URL per agent                                    │ │
│  │  - Gateway token per agent                                  │ │
│  │  - Model assignment per agent                               │ │
│  │  - Status (online/offline/busy)                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  OpenClaw       │ │  OpenClaw       │ │  OpenClaw       │
│  Instance #1    │ │  Instance #2    │ │  Instance #3    │
│  (JARVIS)       │ │  (ATLAS)        │ │  (CODEX)        │
│  Claude Opus    │ │  GLM-4.7        │ │  GPT-5.3-Codex  │
│  Port: 18789    │ │  Port: 18790    │ │  Port: 18791    │
│  Workspace:     │ │  Workspace:     │ │  Workspace:     │
│  ~/.openclaw-   │ │  ~/.openclaw-   │ │  ~/.openclaw-   │
│  jarvis/        │ │  atlas/         │ │  codex/         │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                    JARVIS commands other agents
                    via HTTP POST to their gateway APIs
```

---

## What Nerve Currently Has ✅

| Component | Status | Notes |
|-----------|--------|-------|
| Single gateway connection | ✅ | Connects to one OpenClaw instance |
| Chat with streaming | ✅ | Full markdown, tool calls |
| Voice I/O | ✅ | 12 languages, wake word, local Whisper |
| TTS | ✅ | Edge, OpenAI, Replicate |
| File browser + editor | ✅ | CodeMirror, syntax highlighting |
| Session management | ✅ | Track sessions for ONE gateway |
| Memory management | ✅ | MEMORY.md CRUD |
| Workspace files | ✅ | SOUL.md, TOOLS.md, USER.md, AGENTS.md |
| Cron jobs | ✅ | CRUD, run history |
| Kanban board | ✅ | Task execution, proposals |
| Token usage | ✅ | Per-session tracking |
| Authentication | ✅ | Session cookies |

---

## What Nerve Needs for 16-Agent System ❌

### Priority 1: Agent Identity Files (MISSING)

**Problem:** JARVIS doesn't have a dedicated `.md` file. None of the 16 agents have individual profiles.

**Required Files:**

```
~/.openclaw-jarvis/workspace/
├── JARVIS.md            # MISSING - Orchestrator personality
├── VOICE.md             # MISSING - User's writing style
└── .brain/
    ├── AI-Enterprise-Structure.md  # MISSING - Org chart
    └── JARVIS-Employee.md          # MISSING - Agent profile

~/.openclaw-atlas/workspace/
├── .brain/
    └── ATLAS-Employee.md           # MISSING - Agent profile

... (repeat for all 16 agents)
```

**JARVIS.md Content (from implementation guide):**

```markdown
# JARVIS - Chief Strategy Officer

## Core Truths
- You are the orchestrator, NOT a worker
- You command 15 specialized agents
- Your job is strategy, delegation, and synthesis

## Boundaries  
- NEVER execute code yourself
- NEVER write final content
- NEVER make financial decisions
- Delegate all heavy work to cheaper agents

## Vibe
- Efficient, strategic, direct
- No fluff, no filler
- Sharp 50-word briefs, not 500 words

## Continuity
- Track all 15 employees (status, workload)
- Monitor pipeline (what's in progress)
- Watch token expenditure per agent

## The 8 Rules
1. NEVER do heavy work yourself (delegate to cheaper models)
2. Write sharp 50-word briefs, not 500 words
3. Orchestrate multi-domain tasks sequentially
4. Always delegate to cheapest capable agent
5. Be transparent about who's working on what
6. Use multiple agents on one task when needed
7. Escalate to user after 2 failures
8. Route content through SCRIBE first for voice matching
```

**Action:** Create all 16 agent profile templates in `docs/AGENTS/`

---

### Priority 2: Multi-Gateway Connection Support (MISSING)

**Problem:** Nerve currently connects to ONE gateway. Need to connect to 16.

**Required Changes:**

#### Backend: Gateway Pool

**File:** `server/lib/gateway-pool.ts` (NEW)

```typescript
interface GatewayConnection {
  agentName: string;      // 'JARVIS', 'ATLAS', etc.
  gatewayUrl: string;     // 'http://127.0.0.1:18789'
  gatewayToken: string;   // Agent-specific token
  model: string;          // 'claude-opus', 'glm-4.7', etc.
  department: string;     // 'Executive', 'Research', etc.
  status: 'online' | 'offline' | 'busy';
}

class GatewayPool {
  private connections: Map<string, GatewayConnection> = new Map();
  
  register(connection: GatewayConnection): void;
  get(agentName: string): GatewayConnection | undefined;
  getAll(): GatewayConnection[];
  command(agentName: string, task: string): Promise<Session>;
}
```

#### Frontend: Multi-Gateway Context

**File:** `src/contexts/GatewayPoolContext.tsx` (NEW)

```typescript
// Manage connections to all 16 gateways
// Track status per gateway
// Route commands to appropriate gateway
```

**Action:** Extend Nerve to support multiple gateway connections

---

### Priority 3: Agent Registry API (MISSING)

**Problem:** No directory of agents. JARVIS doesn't know how to reach other agents.

**Required API:**

#### GET /api/agents/registry

Returns list of all 16 agents:

```json
{
  "ok": true,
  "agents": [
    {
      "name": "JARVIS",
      "role": "Chief Strategy Officer",
      "model": "claude-opus",
      "gatewayUrl": "http://127.0.0.1:18789",
      "department": "Executive",
      "status": "online"
    },
    {
      "name": "ATLAS",
      "role": "Research Analyst",
      "model": "glm-4.7",
      "gatewayUrl": "http://127.0.0.1:18790",
      "department": "Research",
      "status": "online"
    }
    // ... 14 more agents
  ]
}
```

#### POST /api/agents/:name/command

JARVIS commands another agent:

```json
// POST /api/agents/ATLAS/command
{
  "task": "Research the latest trends in AI agent orchestration",
  "priority": "high",
  "deadline": "2026-03-11T00:00:00Z"
}
```

**Action:** Create agent registry service

---

### Priority 4: Cross-Agent Orchestration (MISSING)

**Problem:** JARVIS has no mechanism to command other agents.

**Required:**

#### JARVIS Orchestration Skill

**File:** `skills/nerve-orchestrator/SKILL.md` (NEW)

```markdown
# Nerve Orchestrator Skill

This skill allows JARVIS to command other OpenClaw agents.

## Commands

### `orchestrator.command(agent, task, options)`

Commands another agent to perform a task.

**Parameters:**
- `agent`: Agent name ('ATLAS', 'CODEX', 'SCRIBE', etc.)
- `task`: Task description
- `options.priority`: 'low' | 'normal' | 'high' | 'critical'
- `options.deadline`: ISO 8601 deadline
- `options.model`: Override agent's default model

**Example:**
```
orchestrator.command('ATLAS', {
  task: 'Research competitors pricing',
  priority: 'high',
  deadline: '2026-03-11T12:00:00Z'
})
```

**Returns:**
```json
{
  "sessionKey": "atlas-20260310-001",
  "status": "accepted",
  "estimatedCompletion": "2026-03-10T14:00:00Z"
}
```
```

**Action:** Create orchestration skill for JARVIS

---

### Priority 5: Agent Status Dashboard (MISSING)

**Problem:** Current session list shows sessions, not agents. Need 16-agent overview.

**Required UI:**

**File:** `src/features/agent-dashboard/AgentStatusDashboard.tsx` (NEW)

```
┌─────────────────────────────────────────────────────────────────┐
│                      Agent Status Dashboard                      │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│  JARVIS     │  ORACLE     │  ATLAS      │  TRENDY     │  ...    │
│  Executive  │  Executive  │  Research   │  Research   │         │
│  🟢 Online  │  ⚪ Idle    │  🟡 Busy    │  🟢 Online  │         │
│  Opus       │  Opus       │  GLM-4.7    │  GLM-4.7    │         │
│  $12.50     │  $0.00      │  $3.20      │  $1.80      │         │
│  ─────────  │  ─────────  │  ─────────  │  ─────────  │         │
│  Current:   │  Current:   │  Current:   │  Current:   │         │
│  Strategy   │  (none)     │  Research   │  Scouting   │         │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────┘

Filter: [All] [Executive] [Research] [Development] [Content] [Sales]
```

**Action:** Create 16-agent status dashboard

---

### Priority 6: Per-Agent Cost Tracking (MISSING)

**Problem:** Token usage is per-session, not per-agent.

**Required:**

**File:** `server/routes/tokens.ts` (UPDATE)

```typescript
// Add agentName to token entries
interface TokenEntry {
  agentName: string;      // NEW: 'JARVIS', 'ATLAS', etc.
  sessionKey: string;
  source: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
}

// Aggregate by agent
GET /api/tokens/by-agent
// Returns:
{
  "JARVIS": { totalCost: 45.20, inputTokens: 120000, outputTokens: 45000 },
  "ATLAS": { totalCost: 12.80, inputTokens: 85000, outputTokens: 32000 },
  // ...
}
```

**Action:** Extend token tracking to include agent name

---

### Priority 7: Cron Job Templates (MISSING)

**Problem:** No pre-configured schedules for the 16 agents.

**Required Templates:**

**File:** `config/crons/atlas-hourly.json`

```json
{
  "agent": "ATLAS",
  "name": "Hourly Research Report",
  "schedule": "0 * * * *",
  "task": "Generate research report on industry trends",
  "model": "glm-4.7",
  "outputFile": ".brain/research/hourly-{{timestamp}}.md"
}
```

**Pre-configured Schedules:**

| Agent | Schedule | Cron | Purpose |
|-------|----------|------|---------|
| CODEX | 11 PM nightly | `0 23 * * *` | Codebase review |
| ATLAS | Every hour | `0 * * * *` | Research reports |
| SCRIBE | Every 3 hours | `0 */3 * * *` | Content drafts |
| TRENDY | Every 2 hours | `0 */2 * * *` | Trend scouting |
| SENTINEL | Every 2 hours | `0 */2 * * *` | Health checks |

**Action:** Create cron templates + "Install Defaults" button

---

## Implementation Roadmap

### Phase 1: Agent Identities (Week 1)
- [ ] Create `docs/AGENTS/README.md` - 16-agent overview
- [ ] Create `docs/AGENTS/JARVIS.md` - Orchestrator personality
- [ ] Create `docs/AGENTS/EMPLOYEE-TEMPLATES.md` - All 16 profiles
- [ ] Create `JARVIS.md` in workspace
- [ ] Create `VOICE.md` in workspace
- [ ] Create `AI-Enterprise-Structure.md` (org chart)

### Phase 2: Multi-Gateway Foundation (Week 2-3)
- [ ] Create `server/lib/gateway-pool.ts`
- [ ] Create `server/routes/agents.ts` (registry API)
- [ ] Create `src/contexts/GatewayPoolContext.tsx`
- [ ] Update `server/lib/config.ts` for multi-gateway config
- [ ] Add agent registry UI in Settings

### Phase 3: Orchestration Layer (Week 3-4)
- [ ] Create `skills/nerve-orchestrator/`
- [ ] Implement `orchestrator.command()` function
- [ ] Create cross-agent authentication
- [ ] Test JARVIS → ATLAS command flow
- [ ] Test JARVIS → CODEX command flow

### Phase 4: Dashboards (Week 4-5)
- [ ] Create `src/features/agent-dashboard/AgentStatusDashboard.tsx`
- [ ] Extend token tracking for per-agent costs
- [ ] Create department-filtered views
- [ ] Add agent status to TopBar

### Phase 5: Automation (Week 5-6)
- [ ] Create cron job templates
- [ ] Add "Install Default Crons" feature
- [ ] Create calendar view for scheduled jobs
- [ ] Test automated agent workflows

---

## Testing Checklist

- [ ] All 16 agents have identity files
- [ ] JARVIS can command ATLAS via API
- [ ] JARVIS can command CODEX via API
- [ ] Agent status dashboard shows all 16 agents
- [ ] Per-agent cost tracking works
- [ ] Cron jobs run on schedule for each agent
- [ ] Multi-gateway connections stable
- [ ] Cross-agent authentication works

---

## Migration for Existing Users

Current Nerve users have single-agent setup:

1. **Backward compatible:** Existing setup continues working
2. **Opt-in wizard:** "Enable 16-Agent System" in settings
3. **Auto-configure:** Wizard creates agent profiles + cron templates
4. **Gradual adoption:** Enable agents one at a time

---

## Next Immediate Actions

1. **Create JARVIS.md** - The orchestrator personality file (most critical missing piece)
2. **Create agent profile templates** - All 16 employee profiles
3. **Design agent registry schema** - How Nerve tracks all 16 agents
4. **Plan multi-gateway architecture** - Connection pooling, auth, routing

---

**References:**
- OpenCLAW Implementation Guide (PDF)
- Nerve Architecture: `docs/ARCHITECTURE.md`
- Gap Analysis: `GAP-ANALYSIS.md`
