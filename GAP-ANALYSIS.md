# Nerve Gap Analysis vs OpenCLAW Implementation Guide

**Date:** March 10, 2026  
**Purpose:** Compare current Nerve implementation against the OpenCLAW 16-Agent System requirements from the implementation guide.

---

## Executive Summary

Nerve is currently a **single-agent dashboard** for OpenClaw, providing an excellent UI for chat, voice, file browsing, and monitoring. However, according to the OpenCLAW implementation guide, the full vision is a **16-agent system** with:

- **JARVIS** as the chief orchestrator (Claude Opus) - runs in its own OpenClaw instance
- **15 specialized agents** (ATLAS, TRENDY, CODEX, SENTINEL, SCRIBE, etc.) - **each runs in their own separate OpenClaw instance**
- Each agent with their own **personality files**, **model assignments**, **cron schedules**, and **workspace**
- **Mission Control dashboard** showing all agents' status, tasks, and costs

**Critical Architecture Correction:** JARVIS does NOT spawn sub-agents within a single session. Instead:
- Each of the 16 agents is a **separate OpenClaw instance** (separate `~/.openclaw` workspace or separate agent profiles)
- JARVIS **commands** these independent agents via the gateway API
- JARVIS uses `sessions_spawn` to create tasks for OTHER OpenClaw agents, not sub-agents

**Current State:** Nerve connects to ONE OpenClaw gateway. To support the 16-agent system, Nerve needs:
1. Multi-gateway connection support (or multi-agent profile switching)
2. Individual agent identity files (no JARVIS.md exists)
3. Agent roster with roles/models/schedules
4. Cross-agent orchestration layer (JARVIS commanding other agents)
5. Agent-specific dashboards and monitoring
6. Automated cron job templates for all 16 agents

---

## Current Nerve Capabilities ✅

### What's Already Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| **WebSocket gateway proxy** | ✅ Complete | Connects to OpenClaw gateway |
| **Chat with streaming** | ✅ Complete | Full markdown, tool calls, diff views |
| **Voice I/O** | ✅ Complete | 12 languages, wake word, local Whisper |
| **TTS** | ✅ Complete | Edge, OpenAI, Replicate providers |
| **File browser + editor** | ✅ Complete | CodeMirror with syntax highlighting |
| **Session management** | ✅ Complete | Sub-agent spawning with custom models |
| **Memory management** | ✅ Complete | MEMORY.md CRUD via REST API |
| **Workspace files** | ✅ Complete | SOUL.md, TOOLS.md, USER.md, AGENTS.md editing |
| **Cron jobs** | ✅ Complete | CRUD via REST API, run history |
| **Kanban board** | ✅ Complete | Task execution, proposals, review workflow |
| **Token usage tracking** | ✅ Complete | Cost display per session |
| **Skills browser** | ✅ Complete | View installed skills |
| **Inline charts** | ✅ Complete | TradingView, Lightweight Charts, Recharts |
| **TTS markers** | ✅ Complete | `[tts:...]` parsing from agent responses |
| **Authentication** | ✅ Complete | Session cookies, scrypt password hashing |
| **Auto-updater** | ✅ Complete | With rollback |

### Strong Foundations

Nerve has excellent infrastructure that can support the 16-agent system:
- **GatewayContext** can potentially connect to multiple gateways (needs extension)
- **SessionContext** already tracks multiple sessions - can be extended to track sessions across agents
- **GranularAgentState** tracks per-agent status (IDLE/THINKING/STREAMING/DONE/ERROR)
- **Workspace API** already supports SOUL.md, AGENTS.md, TOOLS.md, USER.md
- **Cron API** already supports scheduling
- **Kanban** already supports task assignment to agents
- **Agent Log** already captures cross-agent activity

**Key Insight:** Nerve currently connects to ONE OpenClaw gateway. The 16-agent system requires either:
1. **Multi-gateway support**: Nerve connects to 16 different gateway URLs (one per agent)
2. **Multi-profile OpenClaw**: Single gateway with 16 agent profiles, each with their own workspace
3. **Hybrid**: JARVIS gateway + agent routing (JARVIS commands other agents through its gateway)

---

## Missing Components ❌

### 1. **Agent Roster & Identity Files**

**What's Missing:**
- No individual `.md` files for each of the 16 agents
- No JARVIS.md (orchestrator personality)
- No ATLAS.md, TRENDY.md, CODEX.md, etc. (employee profiles)

**Required Structure (per OpenCLAW guide):**
```
~/.openclaw/workspace/
├── SOUL.md              # JARVIS personality (exists but not JARVIS-specific)
├── AGENTS.md            # Operating procedures (exists)
├── USER.md              # User profile (exists)
├── TOOLS.md             # Tool configurations (exists)
├── MEMORY.md            # Long-term memory (exists)
└── .brain/
    ├── AI-Enterprise-Structure.md  # Org chart & OS ❌ MISSING
    ├── JARVIS-Employee.md          # Chief Strategy Officer ❌ MISSING
    ├── ORACLE-Employee.md          # Strategic Consultant ❌ MISSING
    ├── ATLAS-Employee.md           # Research Analyst ❌ MISSING
    ├── TRENDY-Employee.md          # Trend Scout ❌ MISSING
    ├── CODEX-Employee.md           # Senior Developer ❌ MISSING
    ├── SENTINEL-Employee.md        # Code Health Monitor ❌ MISSING
    ├── SCRIBE-Employee.md          # Head Copywriter ❌ MISSING
    ├── WRITER-Employee.md          # Content Writer ❌ MISSING
    ├── PIXEL-Employee.md           # Product Designer ❌ MISSING
    ├── NOVA-Employee.md            # Video Production ❌ MISSING
    ├── VIBE-Employee.md            # Motion & UGC ❌ MISSING
    ├── CLIP-Employee.md            # Video Clipping ❌ MISSING
    ├── SAGE-Employee.md            # Outreach Strategist ❌ MISSING
    └── CLOSER-Employee.md          # Deal Closer ❌ MISSING
```

**Action Required:**
- Create 16 employee profile templates in `/home/gerald/nerve/docs/agents/`
- Each profile should include:
  - Role & department
  - Assigned model (Opus/Sonnet/GLM-4.7/Codex)
  - Personality & boundaries
  - Cron schedule (if applicable)
  - Tools & permissions
  - Cost center tracking

---

### 2. **JARVIS Orchestrator Configuration**

**What's Missing:**
- No dedicated JARVIS personality file with the 4 sections from the guide:
  1. **Core Truths** (You are the orchestrator, NOT a worker)
  2. **Boundaries** (Never execute code, never write final content, etc.)
  3. **Vibe** (Efficient, strategic, direct—no fluff)
  4. **Continuity** (Track employees, pipeline status, token expenditure)

**The 8 Key Rules for JARVIS (from guide):**
1. NEVER do heavy work yourself (delegate to cheaper models)
2. Write sharp 50-word briefs, not 500 words
3. Orchestrate multi-domain tasks sequentially
4. Always delegate to cheaper models when possible
5. Be transparent about who's working on what
6. Use multiple employees on one task when needed
7. Escalate to user after 2 failures
8. Route content through SCRIBE first for voice matching

**Action Required:**
- Create `JARVIS.md` with the full orchestrator personality
- Update `SOUL.md` to reference JARVIS specifically
- Configure JARVIS to use Claude Opus with strategic reasoning

---

### 3. **Model Hierarchy & Cost Optimization**

**What's Missing:**
- No pre-configured model assignments per agent
- No cost tracking per agent (only per session)
- No model fallback chain configuration

**Required Model Hierarchy (from guide):**

| Tier | Model | Cost (Input/Output) | Assigned Agents |
|------|-------|---------------------|-----------------|
| Premium | Claude Opus | $15/$75 per M tokens | JARVIS, ORACLE |
| Mid | Claude Sonnet | $3/$15 per M tokens | SENTINEL, SCRIBE, WRITER, PIXEL, SAGE, CLOSER, CLIP |
| Budget | GLM-4.7 (Synthetic) | $0.48/$1.50 per M tokens | ATLAS, TRENDY, SCRIBE (drafts) |
| Coding | GPT-5.3-Codex | $2/$8 per M tokens | CODEX |
| Video | Grok (xAI) | ~$20-30/month | NOVA |
| Image | Google Imagen | ~$10-20/month | PIXEL |
| Motion | Kling/Higgs | ~$10-20/month | VIBE |

**Action Required:**
- Add model configuration to each agent's profile
- Implement per-agent cost tracking in token usage API
- Add model fallback chain to `openclaw.json` configuration

---

### 4. **Automated Cron Job Templates**

**What's Missing:**
- No pre-configured cron schedules for the 16 agents
- Current cron system is manual (user must create each job)

**Required Cron Schedule (from guide):**

| Agent | Schedule | Cron Expression | Purpose |
|-------|----------|-----------------|---------|
| CODEX | 11 PM nightly | `0 23 * * *` | Codebase review & feature building |
| ATLAS | Every hour | `0 * * * *` | Research reports |
| SCRIBE | Every 3 hours | `0 */3 * * *` | Content drafts from research |
| TRENDY | Every 2 hours | `0 */2 * * *` | Trend scouting |
| SENTINEL | Every 2 hours | `0 */2 * * *` | Health checks & bug monitoring |

**Action Required:**
- Create cron job templates in `/home/gerald/nerve/config/crons/`
- Add "Install Default Crons" button to Workspace → Crons tab
- Each template should include:
  - Agent name
  - Cron expression
  - Default task/prompt
  - Model assignment
  - Expected output location

---

### 5. **Multi-Agent Orchestration Layer**

**What's Missing:**
- No mechanism for JARVIS to command OTHER OpenClaw agents
- No cross-agent communication protocol
- No agent directory/service discovery

**Critical Architecture Clarification:**

```
┌─────────────────────────────────────────────────────────────────┐
│                        Nerve Dashboard                           │
│                    (localhost:3080)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  OpenClaw       │ │  OpenClaw       │ │  OpenClaw       │
│  Instance #1    │ │  Instance #2    │ │  Instance #3    │
│  (JARVIS)       │ │  (ATLAS)        │ │  (CODEX)        │
│  Claude Opus    │ │  GLM-4.7        │ │  GPT-5.3-Codex  │
│  :18789         │ │  :18790         │ │  :18791         │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                    JARVIS commands other agents
                    via their gateway APIs
```

**Required Orchestration Features:**
1. **Agent Directory**: List of all 16 agents with their gateway URLs/tokens
2. **Cross-Agent Commands**: JARVIS sends tasks to other agents' gateways
3. **Session Tracking**: Track sessions across multiple agent gateways
4. **Result Aggregation**: Collect outputs from multiple agents
5. **Escalation**: After 2 failures, escalate to human

**How JARVIS Commands Other Agents:**
```
JARVIS (Opus) → HTTP POST to ATLAS's gateway → ATLAS executes task
              → HTTP POST to CODEX's gateway → CODEX writes code
              → HTTP POST to SCRIBE's gateway → SCRIBE drafts content
```

**Action Required:**
- Create agent directory service (`/api/agents/registry`)
- Add cross-gateway command helpers for JARVIS
- Extend SessionContext to track multi-gateway sessions
- Implement agent-to-agent authentication (gateway tokens)

---

### 6. **Agent-Specific Dashboards**

**What's Missing:**
- Current dashboard shows all sessions but not organized by agent role
- No agent-specific views (e.g., "Research Dashboard" for ATLAS/TRENDY)
- No department-level aggregation (Development, Content, Sales, Research)

**Required Dashboards:**

| Dashboard | Agents | Metrics |
|-----------|--------|---------|
| **Executive** | JARVIS, ORACLE | Total cost, pipeline status, employee activity |
| **Research** | ATLAS, TRENDY | Reports generated, trends found, sources scanned |
| **Development** | CODEX, SENTINEL | Code changes, bugs found, health score |
| **Content** | SCRIBE, WRITER, PIXEL, NOVA, VIBE, CLIP | Drafts, posts scheduled, assets created |
| **Sales** | SAGE, CLOSER | Outreach sent, responses, deals closed |

**Action Required:**
- Add "Department" field to agent profiles
- Create department-filtered session views
- Add agent-specific metrics to TokenUsage component
- Implement "Agent Status Dashboard" showing all 16 agents (active/idle, current task, today's cost)

---

### 7. **Voice Matching for SCRIBE**

**What's Missing:**
- No voice reference file for SCRIBE agent
- No automatic routing through SCRIBE for content tasks

**Required (from guide):**
- `VOICE.md` file containing user's writing style examples
- SCRIBE reads VOICE.md before drafting content
- Content pipeline: Research → SCRIBE draft → WRITER polish → User review

**Action Required:**
- Create `VOICE.md` template in workspace files
- Add voice matching hint to SCRIBE's agent profile
- Implement content routing rule (all content tasks → SCRIBE first)

---

### 8. **Mission Control Dashboard Features**

**What's Partially Implemented:**
The guide mentions Vadim's Mission Control dashboard with:
- ✅ Agent status dashboard (Nerve has session list with status)
- ❌ Credit usage tracking per agent (Nerve has per-session, not per-agent)
- ✅ Memory file browser/editor (Nerve has this)
- ⚠️ Task queue with pipeline status (Nerve has Kanban but no pipeline view)
- ⚠️ Cron job calendar (Nerve has cron list but no calendar view)
- ❌ Post calendar for social media scheduling (not implemented)

**Action Required:**
- Add per-agent cost aggregation (group sessions by agent name)
- Implement pipeline visualization (show task flow: Research → Content → Review)
- Add calendar view for cron jobs and scheduled posts
- Create social media post calendar (integrate with content agents)

---

### 9. **API Key Management for Multiple Providers**

**What's Partial:**
- ✅ OpenAI API key support (TTS/Whisper)
- ✅ Replicate API key support (TTS)
- ❌ Anthropic API key (Claude models) - handled by OpenClaw, not Nerve
- ❌ xAI API key (Grok for NOVA)
- ❌ Google Imagen API key (for PIXEL)
- ❌ Kling AI API key (for VIBE)
- ❌ X/Twitter API key (for TRENDY)
- ✅ Brave Search (handled by OpenClaw)
- ✅ Firecrawl (handled by OpenClaw)

**Action Required:**
- Extend API keys management UI to support all providers
- Add provider-specific key validation
- Store keys in `~/.openclaw/credentials/` (OpenClaw structure)

---

### 10. **Documentation & Onboarding**

**What's Missing:**
- No guide for setting up the 16-agent system
- No agent profile templates
- No cron job templates
- No orchestration examples

**Action Required:**
- Create `docs/AGENTS/` directory with:
  - `README.md` - Overview of the 16-agent system
  - `JARVIS.md` - Orchestrator setup guide
  - `EMPLOYEE-TEMPLATES.md` - Templates for all 16 agents
  - `CRON-SETUP.md` - How to configure automated schedules
  - `ORCHESTRATION.md` - How JARVIS should delegate tasks
  - `COST-OPTIMIZATION.md` - Model hierarchy and cost tracking

---

## Implementation Priority

### Phase 1: Foundation (Week 1-2)
1. ⚠️ **CREATE**: Agent profile templates (16 `.md` files)
2. ⚠️ **CREATE**: JARVIS.md orchestrator personality file
3. ⚠️ **CREATE**: VOICE.md template
4. ⚠️ **CREATE**: AI-Enterprise-Structure.md (org chart)
5. ⚠️ **CREATE**: Agent registry schema (`/api/agents/registry`)
6. ⚠️ **CREATE**: Documentation (`docs/AGENTS/README.md`)

### Phase 2: Multi-Gateway Architecture (Week 2-3)
7. ❌ **NEW**: Multi-gateway connection support in GatewayContext
8. ❌ **NEW**: Agent registry service (directory of 16 agents)
9. ❌ **NEW**: Cross-gateway authentication (token management)
10. ⚠️ Add model assignments to agent profiles
11. ⚠️ Create cron job templates
12. ⚠️ Add "Install Default Crons" feature to Workspace tab

### Phase 3: Orchestration (Week 3-4)
13. ❌ **NEW**: Cross-agent command API (`POST /api/agents/:id/command`)
14. ❌ **NEW**: JARVIS orchestration skill (`nerve-orchestrator`)
15. ❌ **NEW**: Task routing table (task type → preferred agent)
16. ❌ Extend SessionContext for multi-gateway sessions
17. ❌ Add pipeline visualization

### Phase 4: Dashboards (Week 4-5)
18. ❌ Create agent status dashboard (16 agents grid)
19. ❌ Add per-agent cost tracking (across gateways)
20. ❌ Implement department views
21. ❌ Add calendar view for crons/posts

### Phase 5: Polish (Week 5-6)
22. ❌ Add voice matching for SCRIBE
23. ❌ Create post calendar for social media
24. ❌ Add onboarding wizard for 16-agent setup
25. ❌ Write comprehensive documentation

---

## File Structure Recommendations

### New Files to Create

```
/home/gerald/nerve/
├── docs/
│   └── AGENTS/
│       ├── README.md                 # 16-agent system overview
│       ├── JARVIS.md                 # Orchestrator setup
│       ├── EMPLOYEE-TEMPLATES.md     # All 16 agent profiles
│       ├── CRON-SETUP.md             # Cron configuration guide
│       ├── ORCHESTRATION.md          # Task delegation patterns
│       └── COST-OPTIMIZATION.md      # Model hierarchy & tracking
│
├── config/
│   └── crons/                        # Cron job templates
│       ├── atlas-hourly.json
│       ├── trendy-bihourly.json
│       ├── scribe-trihourly.json
│       ├── sentinel-bihourly.json
│       └── codex-nightly.json
│
└── skills/
    └── nerve-orchestrator/           # NEW: Orchestration skill
        ├── SKILL.md
        ├── orchestrator.ts
        └── task-router.ts
```

### Workspace Files to Add/Update

```
~/.openclaw/workspace/
├── SOUL.md              # Update to reference JARVIS specifically
├── JARVIS.md            # NEW: Orchestrator personality (4 sections, 8 rules)
├── VOICE.md             # NEW: User's writing style reference
├── AGENTS.md            # Update with 16-agent roster
└── .brain/
    ├── AI-Enterprise-Structure.md  # NEW: Org chart & operating system
    └── [NAME]-Employee.md          # NEW: 16 employee profiles
```

---

## Specific Code Changes Required

### 1. Frontend: Agent Status Dashboard

**File:** `src/features/dashboard/AgentStatusDashboard.tsx` (NEW)

```tsx
// Show all 16 agents in a grid
// Each card shows: name, role, status, current task, today's cost
// Filter by department
```

### 2. Backend: Per-Agent Cost Tracking

**File:** `server/routes/tokens.ts` (UPDATE)

```ts
// Add agentName field to token entries
// Aggregate by agent name in addition to session
```

### 3. Frontend: Pipeline Visualization

**File:** `src/features/kanban/PipelineView.tsx` (NEW)

```tsx
// Show task flow: Research → Content → Review → Done
// Each stage shows which agent is working on it
```

### 4. Backend: Cron Templates

**File:** `server/routes/crons.ts` (UPDATE)

```ts
// Add GET /api/crons/templates endpoint
// Add POST /api/crons/install-template
```

### 5. Skill: Orchestration Helper

**File:** `skills/nerve-orchestrator/orchestrator.ts` (NEW)

```ts
// Helper for JARVIS to spawn sub-agents
// Task routing logic
// Result aggregation
```

---

## Testing Checklist

- [ ] All 16 agent profiles load correctly
- [ ] JARVIS can spawn sub-agents via orchestration skill
- [ ] Cron jobs run on schedule and create sessions
- [ ] Per-agent cost tracking shows correct aggregation
- [ ] Agent status dashboard shows all 16 agents
- [ ] Pipeline visualization shows task flow
- [ ] Voice matching works for SCRIBE agent
- [ ] Department filters work correctly
- [ ] Calendar view shows cron schedule
- [ ] API keys for all providers can be configured

---

## Migration Path for Existing Users

Current Nerve users have a single-agent setup. Migration should:

1. **Backward compatible**: Existing single-agent continues to work
2. **Opt-in multi-agent**: "Enable 16-Agent System" wizard in settings
3. **Auto-configure**: Wizard creates all agent profiles and cron templates
4. **Gradual adoption**: User can enable agents one at a time

---

## Conclusion

Nerve has **excellent infrastructure** for the 16-agent vision:
- ✅ Session management with parent-child relationships
- ✅ Granular agent state tracking
- ✅ Workspace file editing (SOUL, TOOLS, AGENTS, etc.)
- ✅ Cron job management
- ✅ Kanban board with task execution
- ✅ Token usage tracking

**What's needed:**
1. Agent identity files (16 employee profiles + JARVIS.md)
2. Pre-configured cron templates
3. Orchestration layer for JARVIS
4. Agent-specific dashboards
5. Per-agent cost tracking
6. Documentation and onboarding

**Estimated effort:** 4-6 weeks for full implementation  
**Priority:** Start with Phase 1 (agent profiles and documentation)

---

## Next Steps

1. **Create agent profile templates** (docs/AGENTS/EMPLOYEE-TEMPLATES.md)
2. **Create JARVIS.md** orchestrator personality
3. **Create cron job templates** (config/crons/)
4. **Build nerve-orchestrator skill**
5. **Implement agent status dashboard**
6. **Add per-agent cost tracking**
7. **Write comprehensive documentation**

---

**References:**
- OpenCLAW Implementation Guide: `/home/gerald/Documents/openclaw_implementation_guide.pdf`
- Nerve Architecture: `/home/gerald/nerve/docs/ARCHITECTURE.md`
- Nerve README: `/home/gerald/nerve/README.md`
