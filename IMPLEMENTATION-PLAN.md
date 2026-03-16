# Nerve 16-Agent Implementation Plan

**Version:** 1.0  
**Date:** March 10, 2026  
**Goal:** Transform Nerve from single-agent dashboard to 16-agent orchestration platform

---

## Executive Summary

**Current State:** Nerve connects to ONE OpenClaw gateway and provides UI for chat, voice, files, sessions, and monitoring.

**Target State:** Nerve connects to 16 independent OpenClaw instances (one per agent), provides unified dashboard for all agents, enables JARVIS to command other agents, and tracks per-agent costs and status.

**Architecture Decision:** Multi-profile approach (single gateway, multiple agent workspaces) for simplicity, with multi-gateway support as future enhancement.

---

## Phase 1: Foundation - Agent Registry & Configuration (Days 1-3)

### 1.1 Backend: Agent Registry Service

**Files to Create:**
- `server/lib/agent-registry.ts` - Agent directory service
- `server/routes/agents.ts` - REST API for agent management
- `server/types.ts` - Add agent-related types

**Features:**
- Register/unregister agents
- Query agent by name
- List all agents with status
- Store agent configuration (gateway URL, token, model, department)
- Persist to `server/data/agents.json`

**API Endpoints:**
```
GET    /api/agents              - List all agents
GET    /api/agents/:name        - Get agent by name
POST   /api/agents              - Register new agent
PUT    /api/agents/:name        - Update agent config
DELETE /api/agents/:name        - Unregister agent
GET    /api/agents/:name/status - Get agent health status
POST   /api/agents/:name/command - Command an agent (JARVIS only)
```

### 1.2 Backend: Gateway Connection Pool

**Files to Create:**
- `server/lib/gateway-pool.ts` - Multi-gateway connection management
- `server/lib/gateway-client.ts` - Extend existing for multi-gateway

**Features:**
- Maintain connections to multiple gateways
- Health checking per gateway
- Automatic reconnection
- Request routing to correct gateway
- Connection pooling for efficiency

### 1.3 Frontend: Agent Registry Context

**Files to Create:**
- `src/contexts/AgentRegistryContext.tsx` - Agent state management
- `src/types/agent.ts` - Agent type definitions

**Features:**
- Load agent registry on mount
- Poll agent status every 30 seconds
- Expose agent list to all components
- Filter agents by department

### 1.4 Configuration: Default Agent Roster

**Files to Create:**
- `config/agents.json` - Default 16-agent configuration
- `scripts/init-agents.ts` - Initialize agent registry

**Features:**
- Pre-configured 16 agents with correct models
- Default gateway ports (18789-18804)
- Department assignments
- Cron schedule templates

---

## Phase 2: Orchestration - JARVIS Command Layer (Days 4-6)

### 2.1 Backend: Cross-Agent Command API

**Files to Create:**
- `server/routes/agent-command.ts` - Command routing
- `server/lib/orchestrator.ts` - Orchestration logic

**Features:**
- JARVIS authentication (verify gateway token)
- Task validation and routing
- Session creation on target agent
- Progress tracking
- Result aggregation

### 2.2 Skill: Nerve Orchestrator

**Files to Create:**
- `skills/nerve-orchestrator/SKILL.md` - Skill documentation
- `skills/nerve-orchestrator/orchestrator.ts` - Implementation
- `skills/nerve-orchestrator/task-router.ts` - Task routing logic

**Features:**
- `orchestrator.command(agent, task, options)` - Command another agent
- `orchestrator.status(agent)` - Query agent status
- `orchestrator.status()` - Get all agents status
- Task routing table (task type → preferred agent)
- Retry logic with fallback agents

### 2.3 Frontend: Command Interface

**Files to Create:**
- `src/features/orchestrator/CommandPanel.tsx` - JARVIS command UI
- `src/features/orchestrator/TaskQueue.tsx` - Task queue display
- `src/features/orchestrator/useAgentCommand.ts` - Command hook

**Features:**
- Command dialog for JARVIS
- Task queue with progress indicators
- Result display from multiple agents
- Agent selection helper

---

## Phase 3: Dashboard - 16-Agent Status View (Days 7-9)

### 3.1 Frontend: Agent Status Dashboard

**Files to Create:**
- `src/features/agent-dashboard/AgentStatusDashboard.tsx` - Main dashboard
- `src/features/agent-dashboard/AgentCard.tsx` - Individual agent card
- `src/features/agent-dashboard/DepartmentFilter.tsx` - Department filter
- `src/features/agent-dashboard/AgentStatusBadge.tsx` - Status indicator

**Features:**
- Grid view of all 16 agents
- Status indicators (online/offline/busy/idle)
- Current task display
- Today's cost per agent
- Department filtering
- Click to view agent details

### 3.2 Backend: Per-Agent Token Tracking

**Files to Modify:**
- `server/routes/tokens.ts` - Add agent name to tracking
- `server/lib/usage-tracker.ts` - Track per-agent usage

**Files to Create:**
- `server/routes/tokens-by-agent.ts` - Aggregated endpoint

**Features:**
- Add `agentName` field to token entries
- Aggregate by agent name
- `/api/tokens/by-agent` endpoint
- Daily/weekly/monthly aggregation

### 3.3 Frontend: Per-Agent Cost Display

**Files to Modify:**
- `src/features/dashboard/TokenUsage.tsx` - Add agent breakdown

**Files to Create:**
- `src/features/agent-dashboard/AgentCostChart.tsx` - Cost visualization

**Features:**
- Cost breakdown by agent
- Cost trend over time
- Budget alerts
- Department cost totals

---

## Phase 4: Automation - Cron Job Templates (Days 10-11)

### 4.1 Cron Templates

**Files to Create:**
- `config/crons/atlas-hourly.json`
- `config/crons/trendy-bihourly.json`
- `config/crons/scribe-trihourly.json`
- `config/crons/sentinel-bihourly.json`
- `config/crons/codex-nightly.json`

**Template Schema:**
```json
{
  "agent": "ATLAS",
  "name": "Hourly Research Report",
  "schedule": "0 * * * *",
  "task": "Generate research report on [topic]",
  "model": "glm-4.7",
  "outputFile": ".brain/research/hourly-{{timestamp}}.md",
  "enabled": true
}
```

### 4.2 Frontend: Cron Template Installer

**Files to Modify:**
- `src/features/workspace/tabs/CronsTab.tsx` - Add template installer

**Files to Create:**
- `src/features/workspace/tabs/CronTemplates.tsx` - Template browser
- `src/features/workspace/tabs/InstallCronDialog.tsx` - Installation dialog

**Features:**
- Browse available templates
- Install with one click
- Customize before installing
- Show installed templates

---

## Phase 5: Polish - Enhanced Features (Days 12-14)

### 5.1 Pipeline Visualization

**Files to Create:**
- `src/features/kanban/PipelineView.tsx` - Pipeline visualization
- `src/features/kanban/usePipeline.ts` - Pipeline state hook

**Features:**
- Visual pipeline: Research → Content → Review → Publish
- Show which agent is at each stage
- Task progress indicators
- Bottleneck detection

### 5.2 Agent Details Panel

**Files to Create:**
- `src/features/agent-dashboard/AgentDetailsPanel.tsx` - Agent details
- `src/features/agent-dashboard/AgentSessions.tsx` - Agent's sessions
- `src/features/agent-dashboard/AgentLogs.tsx` - Agent activity log

**Features:**
- Full agent profile display
- Agent's session history
- Agent's activity log
- Agent's cost history
- Quick actions (command, view sessions, etc.)

### 5.3 Calendar View

**Files to Create:**
- `src/features/calendar/CronCalendar.tsx` - Cron job calendar
- `src/features/calendar/PostCalendar.tsx` - Content calendar

**Features:**
- Monthly/weekly/daily views
- Cron job schedule visualization
- Content publishing schedule
- Agent workload calendar

---

## Phase 6: Testing & Documentation (Days 15-16)

### 6.1 Testing

**Files to Create:**
- `server/lib/agent-registry.test.ts`
- `server/lib/gateway-pool.test.ts`
- `server/routes/agents.test.ts`
- `src/contexts/AgentRegistryContext.test.tsx`
- `src/features/agent-dashboard/AgentStatusDashboard.test.tsx`

**Test Coverage:**
- Agent registration/unregistration
- Gateway health checking
- Cross-agent commands
- Token tracking per agent
- UI component rendering
- End-to-end orchestration flow

### 6.2 Documentation

**Files to Create:**
- `docs/AGENTS/ORCHESTRATION.md` - How to command agents
- `docs/AGENTS/CRON-SETUP.md` - Cron configuration guide
- `docs/AGENTS/COST-OPTIMIZATION.md` - Cost tracking guide
- `docs/AGENTS/DEPLOYMENT.md` - Deployment guide
- `docs/AGENTS/TROUBLESHOOTING.md` - Troubleshooting guide

**Files to Update:**
- `README.md` - Add 16-agent section
- `docs/ARCHITECTURE.md` - Update with multi-agent architecture
- `docs/API.md` - Add new API endpoints

---

## File Manifest

### New Files (Backend)

```
server/
├── lib/
│   ├── agent-registry.ts          # Agent directory service
│   ├── agent-registry.test.ts     # Tests
│   ├── gateway-pool.ts            # Multi-gateway connections
│   ├── gateway-pool.test.ts       # Tests
│   └── orchestrator.ts            # Orchestration logic
├── routes/
│   ├── agents.ts                  # Agent registry API
│   ├── agents.test.ts             # Tests
│   ├── agent-command.ts           # Cross-agent commands
│   ├── agent-command.test.ts      # Tests
│   └── tokens-by-agent.ts         # Per-agent token aggregation
└── data/
    └── agents.json                # Agent registry persistence
```

### New Files (Frontend)

```
src/
├── types/
│   └── agent.ts                   # Agent type definitions
├── contexts/
│   ├── AgentRegistryContext.tsx   # Agent state management
│   └── AgentRegistryContext.test.tsx
├── features/
│   ├── agent-dashboard/
│   │   ├── AgentStatusDashboard.tsx
│   │   ├── AgentStatusDashboard.test.tsx
│   │   ├── AgentCard.tsx
│   │   ├── AgentStatusBadge.tsx
│   │   ├── DepartmentFilter.tsx
│   │   ├── AgentDetailsPanel.tsx
│   │   ├── AgentSessions.tsx
│   │   ├── AgentLogs.tsx
│   │   └── AgentCostChart.tsx
│   ├── orchestrator/
│   │   ├── CommandPanel.tsx
│   │   ├── TaskQueue.tsx
│   │   └── useAgentCommand.ts
│   ├── workspace/tabs/
│   │   ├── CronTemplates.tsx
│   │   └── InstallCronDialog.tsx
│   ├── kanban/
│   │   ├── PipelineView.tsx
│   │   └── usePipeline.ts
│   └── calendar/
│       ├── CronCalendar.tsx
│       └── PostCalendar.tsx
└── hooks/
    └── useAgentStatus.ts          # Agent status polling
```

### New Files (Skills)

```
skills/
└── nerve-orchestrator/
    ├── SKILL.md                   # Skill documentation
    ├── orchestrator.ts            # Implementation
    ├── task-router.ts             # Task routing
    └── package.json               # Skill dependencies
```

### New Files (Configuration)

```
config/
├── agents.json                    # Default 16-agent roster
└── crons/
    ├── atlas-hourly.json
    ├── trendy-bihourly.json
    ├── scribe-trihourly.json
    ├── sentinel-bihourly.json
    └── codex-nightly.json
```

### New Files (Scripts)

```
scripts/
└── init-agents.ts                 # Initialize agent registry
```

### New Files (Documentation)

```
docs/AGENTS/
├── ORCHESTRATION.md
├── CRON-SETUP.md
├── COST-OPTIMIZATION.md
├── DEPLOYMENT.md
└── TROUBLESHOOTING.md
```

---

## Implementation Order

### Week 1 (Days 1-7)
- [ ] Phase 1: Agent Registry & Configuration
- [ ] Phase 2: Orchestration Layer (partial)

### Week 2 (Days 8-14)
- [ ] Phase 2: Orchestration Layer (complete)
- [ ] Phase 3: Dashboard
- [ ] Phase 4: Automation

### Week 3 (Days 15-21)
- [ ] Phase 5: Polish
- [ ] Phase 6: Testing & Documentation

---

## Success Criteria

### Functional Requirements

- [ ] All 16 agents registered in agent registry
- [ ] JARVIS can command any other agent
- [ ] Agent status dashboard shows all 16 agents
- [ ] Per-agent cost tracking works correctly
- [ ] Cron templates install and run on schedule
- [ ] Pipeline visualization shows task flow
- [ ] All new API endpoints work correctly
- [ ] All new UI components render correctly

### Non-Functional Requirements

- [ ] 95%+ test coverage on new code
- [ ] No TypeScript errors
- [ ] No ESLint errors
- [ ] Documentation complete
- [ ] Performance: < 100ms API response time
- [ ] Gateway health check every 30 seconds
- [ ] Graceful handling of offline agents

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Gateway connection instability | Implement retry logic with exponential backoff |
| Agent registry corruption | Use atomic writes with backup |
| Cross-agent auth failures | Implement fallback authentication |
| Performance degradation | Lazy load agent data, cache aggressively |
| Breaking existing features | Feature flags, gradual rollout |

---

## Rollout Plan

### Stage 1: Internal Testing (Day 1-7)
- Implement Phase 1-2
- Test with mock agents
- Verify core functionality

### Stage 2: Alpha Testing (Day 8-14)
- Implement Phase 3-4
- Test with real OpenClaw instances
- Fix bugs

### Stage 3: Beta Testing (Day 15-21)
- Implement Phase 5-6
- User testing
- Documentation review

### Stage 4: Production Release (Day 22+)
- Enable for all users
- Monitor metrics
- Iterate based on feedback

---

## Metrics to Track

| Metric | Target |
|--------|--------|
| Agent registry load time | < 500ms |
| Gateway health check success rate | > 99% |
| Cross-agent command success rate | > 95% |
| Per-agent cost tracking accuracy | 100% |
| Dashboard render time | < 200ms |
| Test coverage | > 90% |

---

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| Node.js | >= 22 | Runtime |
| Hono | ^4.11.7 | Web framework |
| React | ^19.2.0 | UI framework |
| TypeScript | ~5.9.3 | Type safety |
| Vitest | ^4.0.18 | Testing |

---

## Next Steps

1. **Review this plan** - Ensure all requirements captured
2. **Start Phase 1** - Begin with agent registry service
3. **Iterate** - Build, test, refine for each phase
4. **Document** - Write docs as we build
5. **Test** - Comprehensive testing at each stage

---

**Approval:** Ready to begin implementation.
