# OpenCLAW 16-Agent System

**The complete AI organization for running a startup with AI agents.**

Based on Vadim's system: 18-year-old solo founder running his entire SaaS with 16 AI agents on a single Mac Mini.

---

## Overview

This is not a single AI assistant. This is a **16-agent AI organization** where:

- **JARVIS** is the chief strategist and orchestrator (Claude Opus)
- **15 specialized agents** handle research, development, content, and sales
- Each agent is an **independent OpenClaw instance** with their own personality and model
- JARVIS **commands** other agents (not spawns - they're separate instances)
- Total cost: ~$340-500/month (optimized for cost-efficiency)

---

## The 16 Agents

### Executive (2 agents)

| Agent | Role | Model | Cost | Schedule |
|-------|------|-------|------|----------|
| **JARVIS** | Chief Strategy Officer | Claude Opus | $15/$75 per M tokens | Main session (always on) |
| **ORACLE** | Strategic Consultant | Claude Opus | $15/$75 per M tokens | On-demand |

### Research (2 agents)

| Agent | Role | Model | Cost | Schedule |
|-------|------|-------|------|----------|
| **ATLAS** | Research Analyst | GLM-4.7 | $0.48/$1.50 per M tokens | Every hour |
| **TRENDY** | Trend Scout | GLM-4.7 | $0.48/$1.50 per M tokens | Every 2 hours |

### Development (2 agents)

| Agent | Role | Model | Cost | Schedule |
|-------|------|-------|------|----------|
| **CODEX** | Senior Developer | GPT-5.3-Codex | $2/$8 per M tokens | 11 PM nightly |
| **SENTINEL** | Code Health Monitor | Claude Sonnet | $3/$15 per M tokens | Every 2 hours |

### Content (6 agents)

| Agent | Role | Model | Cost | Schedule |
|-------|------|-------|------|----------|
| **SCRIBE** | Head Copywriter | GLM-4.7 | $0.48/$1.50 per M tokens | Every 3 hours |
| **WRITER** | Content Writer | Claude Sonnet | $3/$15 per M tokens | On-demand |
| **PIXEL** | Product Designer | Claude Sonnet + Imagen | $3/$15 + image costs | On-demand |
| **NOVA** | Video Production | Grok (xAI) | ~$20-30/month | On-demand |
| **VIBE** | Motion & UGC | Kling AI | ~$10-20/month | On-demand |
| **CLIP** | Video Clipping | Claude Sonnet | $3/$15 per M tokens | On-demand |

### Sales (2 agents)

| Agent | Role | Model | Cost | Schedule |
|-------|------|-------|------|----------|
| **SAGE** | Outreach Strategist | Claude Sonnet | $3/$15 per M tokens | On-demand |
| **CLOSER** | Deal Closer | Claude Sonnet | $3/$15 per M tokens | On-demand |

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                      Nerve Dashboard                        │
│                  (localhost:3080)                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Agent Registry - All 16 agents with gateway URLs    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
                             │
    ┌────────────────────────┼────────────────────────┐
    │                        │                        │
    ▼                        ▼                        ▼
┌──────────┐          ┌──────────┐            ┌──────────┐
│ JARVIS   │          │ ATLAS    │            │ CODEX    │
│ Opus     │          │ GLM-4.7  │            │ Codex    │
│ :18789   │          │ :18790   │            │ :18792   │
│          │ command  │          │  command   │          │
│ Commands │─────────▶│ Executes │            │ Executes │
│ other    │          │ research │            │ coding   │
│ agents   │          │ tasks    │            │ tasks    │
└──────────┘          └──────────┘            └──────────┘
```

**Key Points:**

1. Each agent is a **separate OpenClaw instance** (separate process, port, workspace)
2. JARVIS **commands** other agents via HTTP POST to their gateway APIs
3. Nerve connects to all gateways and provides a unified dashboard
4. Agents communicate via the **Agent Registry** (directory service)

---

## How JARVIS Commands Other Agents

JARVIS uses the `orchestrator.command()` function:

```javascript
// JARVIS commands ATLAS to research
orchestrator.command('ATLAS', {
  task: 'Research competitors pricing',
  priority: 'high',
  deadline: '2026-03-11T12:00:00Z'
})

// Returns:
{
  sessionKey: "atlas-20260310-001",
  status: "accepted",
  estimatedCompletion: "2026-03-10T14:00:00Z"
}
```

---

## File Structure

Each agent has their own workspace:

```
~/.openclaw-jarvis/
├── workspace/
│   ├── SOUL.md
│   ├── JARVIS.md           # Orchestrator rules
│   ├── VOICE.md            # User's writing style
│   ├── AGENTS.md           # Agent directory
│   └── .brain/
│       ├── AI-Enterprise-Structure.md
│       └── JARVIS-Employee.md
├── openclaw.json           # Model: Claude Opus
└── credentials/
    └── anthropic-key.txt

~/.openclaw-atlas/
├── workspace/
│   ├── SOUL.md
│   └── .brain/
│       └── ATLAS-Employee.md
├── openclaw.json           # Model: GLM-4.7
└── credentials/
    └── synthetic-api-key.txt

... (repeat for all 16 agents)
```

---

## Automated Schedules

Agents run automatically on cron schedules:

| Agent | Schedule | Purpose |
|-------|----------|---------|
| ATLAS | Every hour | Research reports |
| TRENDY | Every 2 hours | Trend scouting |
| SCRIBE | Every 3 hours | Content drafts |
| SENTINEL | Every 2 hours | Code health checks |
| CODEX | 11 PM nightly | Feature development |

---

## Cost Optimization

The system is optimized for cost-efficiency:

1. **JARVIS (Opus)** only does strategy - delegates everything else
2. **Research (GLM-4.7)** is cheapest - handles bulk work
3. **CODEX (Codex)** is coding-optimized - mid-range cost
4. **Content (Sonnet)** balances quality and cost
5. **Total: ~$340-500/month** vs. $15,000+/month if all used Opus

---

## Getting Started

### Prerequisites

- 16 OpenClaw instances (or 1 instance with 16 agent profiles)
- API keys for: Anthropic, OpenAI, xAI, Google, Kling
- Nerve dashboard for monitoring

### Setup Steps

1. **Create agent workspaces** - One directory per agent
2. **Configure models** - Each agent's `openclaw.json` with correct model
3. **Set up gateways** - Each agent on unique port (18789-18804)
4. **Create employee profiles** - `.brain/[AGENT]-Employee.md` for each
5. **Configure JARVIS** - `JARVIS.md` with orchestrator rules
6. **Set up cron jobs** - Automated schedules for ATLAS, TRENDY, etc.
7. **Register in Nerve** - Add all agents to the registry
8. **Test orchestration** - JARVIS commands ATLAS, CODEX, etc.

### Quick Start (Single Machine)

```bash
# Start JARVIS gateway
openclaw-gateway --port 18789 --workspace ~/.openclaw-jarvis

# Start ATLAS gateway
openclaw-gateway --port 18790 --workspace ~/.openclaw-atlas

# Start CODEX gateway
openclaw-gateway --port 18792 --workspace ~/.openclaw-codex

# ... (repeat for all agents)

# Start Nerve
cd ~/nerve
npm run prod
```

---

## Documentation

| Document | Purpose |
|----------|---------|
| [JARVIS.md](./JARVIS.md) | Orchestrator personality and rules |
| [EMPLOYEE-TEMPLATES.md](./EMPLOYEE-TEMPLATES.md) | All 16 agent profiles |
| [ORCHESTRATION.md](./ORCHESTRATION.md) | How to command agents |
| [CRON-SETUP.md](./CRON-SETUP.md) | Automated schedule configuration |
| [COST-OPTIMIZATION.md](./COST-OPTIMIZATION.md) | Model hierarchy and cost tracking |

---

## Example Workflow

**User:** "Launch a new feature"

**JARVIS:** "I'll orchestrate this across multiple agents:"

```
1. ATLAS: Research market need (30 min, ~$0.25)
2. CODEX: Build the feature (tonight at 11 PM, ~$2.00)
3. SENTINEL: Review code quality (after CODEX, ~$0.50)
4. SCRIBE: Write announcement (3 hours, ~$1.20)
5. PIXEL: Create visuals (on-demand, ~$0.50 + image costs)
6. SAGE: Plan outreach (on-demand, ~$1.50)

Total estimated cost: ~$6.00
Timeline: 24 hours
```

---

## Nerve Dashboard

Nerve provides a unified view of all 16 agents:

- **Agent Status Dashboard** - See all agents (online/offline/busy)
- **Per-Agent Cost Tracking** - Token usage and cost per agent
- **Session Management** - View sessions across all gateways
- **Cron Job Calendar** - See scheduled agent activities
- **Kanban Board** - Task management with agent assignment
- **Agent Registry** - Directory of all agents with gateway URLs

---

## Troubleshooting

### Agent Not Responding

1. Check gateway is running: `curl http://localhost:PORT/health`
2. Verify API key is valid
3. Check agent's workspace files exist
4. Review agent's logs for errors

### JARVIS Can't Command Agent

1. Verify agent is registered in Agent Registry
2. Check gateway token is correct
3. Test direct gateway connection
4. Review orchestrator skill configuration

### High Costs

1. Check JARVIS is delegating (not doing work itself)
2. Verify research agents (GLM-4.7) are handling bulk work
3. Review token usage per agent in Nerve dashboard
4. Adjust cron schedules if needed

---

## Best Practices

1. **Always delegate** - JARVIS should never do work that cheaper agents can do
2. **Use cron jobs** - Let agents work automatically in the background
3. **Monitor costs** - Check Nerve dashboard daily for token usage
4. **Review outputs** - User should review before publishing (especially content)
5. **Iterate on prompts** - Refine agent instructions based on output quality

---

## License

MIT - Part of the Nerve project

---

## References

- OpenCLAW Implementation Guide (PDF)
- [Nerve Documentation](../README.md)
- [Architecture](../ARCHITECTURE.md)
