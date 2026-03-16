# Multi-Agent Dashboard Guide

**Version:** 1.0  
**Date:** March 10, 2026

---

## Overview

Nerve now supports **multiple agents** simultaneously. You can switch between agents, view all agents' status, and manage your 16-agent organization from a single dashboard.

---

## What's New

### 1. Agent Selector (Top Bar)

**Location:** Top-left corner, next to NERVE logo

**Features:**
- Dropdown selector showing all enabled agents
- Current agent displayed with Brain icon
- Status indicator (green = connected, gray = offline)
- Quick access to first 5 agents
- "View all X agents..." link for full list

**Usage:**
1. Click the agent selector button
2. Choose an agent from the dropdown
3. The UI switches to that agent's context

### 2. Agents Dashboard Button

**Location:** Top bar, right side

**Features:**
- Shows connected/total agents count (e.g., "5/14")
- Opens full agent status dashboard
- Real-time status updates

**Usage:**
1. Click the "Agents" button
2. View all agents in a grid
3. Filter by department
4. Click an agent for details

### 3. Agent Status Dashboard

**Location:** Dropdown panel (click "Agents" button)

**Features:**
- Grid view of all agents
- Department filtering (All, Executive, Research, etc.)
- Status indicators per agent
- Cost information
- Model assignments
- Schedule display

---

## Agent Selector

### Components

The agent selector consists of two components:

#### 1. `AgentSelector` Component

```typescript
import { AgentSelector } from '@/components/AgentSelector';

<AgentSelector
  currentAgent={currentAgent}
  onAgentChange={setCurrentAgent}
  compact={false}
/>
```

**Props:**
- `currentAgent`: Currently selected agent name
- `onAgentChange`: Callback when agent changes
- `compact`: Optional, use compact styling

#### 2. `MultiAgentTopBar` Component

```typescript
import { MultiAgentTopBar } from '@/components/MultiAgentTopBar';

<MultiAgentTopBar
  onSettings={openSettings}
  agentLogEntries={agentLogEntries}
  tokenData={tokenData}
  logGlow={logGlow}
  eventEntries={eventEntries}
  eventsVisible={eventsVisible}
  logVisible={logVisible}
  mobilePanelButtonsVisible={isCompactLayout}
  sessionsPanel={compactSessionsPanel}
  workspacePanel={compactWorkspacePanel}
  viewMode={viewMode}
  onViewModeChange={setViewMode}
  currentAgent={currentAgent}
  onAgentChange={setCurrentAgent}
/>
```

**New Props:**
- `currentAgent`: Currently active agent
- `onAgentChange`: Callback to change agent

---

## Switching Agents

### Method 1: Agent Selector (Quick)

1. Click agent selector in top-left
2. Choose agent from dropdown
3. UI updates immediately

### Method 2: Agents Dashboard (Browse)

1. Click "Agents" button in top-right
2. Browse all agents in grid
3. Click agent card for details
4. Use department filters

### Method 3: Keyboard (Future)

Planned: `Cmd+K` → "Switch Agent" → Type agent name

---

## Agent Status Indicators

| Indicator | Meaning |
|-----------|---------|
| 🟢 Green dot | Connected and ready |
| 🟡 Yellow dot | Connecting |
| 🔴 Red dot | Error/disconnected |
| ⚫ Gray dot | Offline |

---

## Department Filters

The Agents Dashboard supports filtering by department:

| Department | Agents |
|------------|--------|
| Executive | JARVIS, ORACLE |
| Research | ATLAS, TRENDY |
| Development | CODEX, SENTINEL |
| Content | SCRIBE, WRITER, PIXEL, NOVA, VIBE, CLIP |
| Sales | SAGE, CLOSER |

**Usage:**
1. Open Agents dashboard
2. Click department button
3. View filtered agents

---

## Current Agent Context

The current agent affects:

1. **Chat Sessions**: New chats are with selected agent
2. **Session List**: Shows sessions for selected agent
3. **Agent Log**: Shows activity for selected agent
4. **Token Usage**: Can filter by selected agent

---

## Multi-Agent Sessions

### Viewing Sessions by Agent

The session list now shows which agent each session belongs to:

```
Session Name              Agent        Status
─────────────────────────────────────────────
Research competitors      ATLAS        ✅ Done
Implement dark mode       CODEX        🟡 Thinking
Write blog post           SCRIBE       ⚪ Idle
```

### Spawning Sub-Agents

When you spawn a sub-agent, you can choose which agent to spawn:

1. Click "Sessions" → "Spawn Agent"
2. Select target agent
3. Enter task
4. Agent executes task

---

## Token Usage by Agent

### View All Agents' Costs

1. Click "Usage" button in top bar
2. See total cost across all agents
3. Breakdown by agent (new feature)

### Per-Agent Token API

```bash
# All agents
curl http://localhost:3080/api/tokens/by-agent

# Specific agent
curl http://localhost:3080/api/tokens/by-agent/ATLAS
```

**Response:**
```json
{
  "ok": true,
  "agents": [
    {
      "agent": "JARVIS",
      "department": "Executive",
      "totalCost": 45.20,
      "totalInput": 120000,
      "totalOutput": 45000,
      "sessionCount": 15
    }
  ],
  "totals": {
    "totalCost": 125.50
  }
}
```

---

## Agent Details Panel

Click an agent card to see:

- **Status**: Connection state
- **Role**: Agent's job title
- **Department**: Organizational unit
- **Model**: AI model assignment
- **Gateway**: URL and port
- **Schedule**: Cron schedule or "on-demand"
- **Pricing**: Input/output costs
- **Health**: Last health check status
- **Description**: Agent's purpose

---

## Best Practices

### 1. Use JARVIS for Orchestration

Keep JARVIS as your primary agent. Let JARVIS command other agents via the orchestrator skill.

### 2. Switch Context for Focused Work

- Research tasks → Switch to ATLAS
- Coding tasks → Switch to CODEX
- Content tasks → Switch to SCRIBE

### 3. Monitor All Agents

Regularly check the Agents dashboard to:
- See which agents are busy
- Monitor costs per agent
- Check health status

### 4. Use Department Filters

When you have many agents, filter by department to find the right one quickly.

---

## Troubleshooting

### Agent Shows as Offline

**Problem:** Agent selector shows gray dot

**Solutions:**
1. Check agent's gateway is running
2. Verify gateway URL/port
3. Check gateway token
4. Restart agent's gateway process

### Can't Switch Agents

**Problem:** Agent selector doesn't change

**Solutions:**
1. Refresh the page
2. Check agent registry: `curl http://localhost:3080/api/agents`
3. Initialize agents: `npm run init-agents`

### Agent Count Shows 0/0

**Problem:** "Agents" button shows "0/0"

**Solutions:**
1. Run `npm run init-agents`
2. Check agent registry file exists
3. Restart Nerve server

---

## API Reference

### GET /api/agents

List all registered agents.

**Response:**
```json
{
  "ok": true,
  "agents": [
    {
      "name": "JARVIS",
      "role": "Chief Strategy Officer",
      "department": "Executive",
      "model": "claude-opus",
      "gatewayUrl": "http://127.0.0.1:18789",
      "enabled": true
    }
  ]
}
```

### GET /api/agents/health

Health check all agents.

**Response:**
```json
{
  "ok": true,
  "health": [
    {
      "name": "JARVIS",
      "status": "idle",
      "gatewayReachable": true,
      "lastCheck": 1710086400000
    }
  ]
}
```

---

## Migration from Single-Agent

If you're upgrading from single-agent Nerve:

1. **No data loss**: Existing sessions preserved
2. **Backward compatible**: Works with single gateway
3. **Opt-in**: Use agent selector to enable multi-agent
4. **Gradual**: Add agents one at a time

### Steps

1. Run `npm run init-agents`
2. Start Nerve: `npm run prod`
3. Open agent selector
4. Select your existing agent (usually "Agent" or "JARVIS")
5. Continue working normally

---

## Future Enhancements

Planned features:

- [ ] Agent-to-agent messaging
- [ ] Cross-agent task routing
- [ ] Department-level cost totals
- [ ] Agent workload balancing
- [ ] Automatic agent selection based on task
- [ ] Keyboard shortcuts for agent switching
- [ ] Agent favorites/pinned agents
- [ ] Recent agents list

---

## See Also

- [`docs/AGENTS/README.md`](./docs/AGENTS/README.md) - 16-agent system overview
- [`docs/AGENTS/JARVIS.md`](./docs/AGENTS/JARVIS.md) - JARVIS orchestrator guide
- [`PHASES-2-5-COMPLETE.md`](./PHASES-2-5-COMPLETE.md) - Implementation details
