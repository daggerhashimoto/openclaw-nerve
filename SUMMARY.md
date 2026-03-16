# Summary: What Nerve is Missing for 16-Agent Support

**Date:** March 10, 2026

---

## Critical Finding: JARVIS Has No .md File

**You were right.** JARVIS doesn't have a dedicated personality file.

**Created:**
- [`docs/AGENTS/JARVIS.md`](./docs/AGENTS/JARVIS.md) - Complete orchestrator personality with:
  - Core Truths (you're the orchestrator, not a worker)
  - Boundaries (never execute code, never write final content)
  - Vibe (efficient, strategic, direct)
  - Continuity (track employees, pipeline, costs)
  - The 8 Rules of orchestration
  - Command syntax for other agents

---

## Architecture Correction: 16 Independent OpenClaw Instances

**Key Understanding:** Each agent is NOT a sub-agent in one session. Each is a **separate OpenClaw instance**:

```
JARVIS → OpenClaw Instance #1 (Port 18789)
ATLAS  → OpenClaw Instance #2 (Port 18790)
CODEX  → OpenClaw Instance #3 (Port 18791)
... (13 more)
```

JARVIS **commands** other agents via HTTP POST to their gateway APIs.

---

## What's Missing (Prioritized)

### 🔴 CRITICAL - Create Now

1. **Agent Identity Files** ❌
   - Created: `docs/AGENTS/JARVIS.md`
   - Created: `docs/AGENTS/EMPLOYEE-TEMPLATES.md` (all 16 profiles)
   - Created: `docs/AGENTS/README.md`
   - **TODO:** Copy JARVIS.md to `~/.openclaw-jarvis/workspace/`
   - **TODO:** Create employee profiles for each agent in their `.brain/` directories

2. **Multi-Gateway Support** ❌
   - Nerve currently connects to ONE gateway
   - **TODO:** Extend `GatewayContext` to support multiple gateways
   - **TODO:** Create `server/lib/gateway-pool.ts` for connection management
   - **TODO:** Add agent registry API (`/api/agents/registry`)

3. **Cross-Agent Orchestration** ❌
   - JARVIS has no way to command other agents
   - **TODO:** Create `skills/nerve-orchestrator/` skill
   - **TODO:** Implement `orchestrator.command(agent, task)` function
   - **TODO:** Add cross-gateway authentication

### 🟡 HIGH - This Week

4. **Agent Status Dashboard** ❌
   - Current session list shows sessions, not 16 agents
   - **TODO:** Create `src/features/agent-dashboard/AgentStatusDashboard.tsx`
   - Show all 16 agents: status, current task, today's cost

5. **Per-Agent Cost Tracking** ❌
   - Token tracking is per-session, not per-agent
   - **TODO:** Extend `server/routes/tokens.ts` to include `agentName`
   - **TODO:** Add `/api/tokens/by-agent` endpoint

6. **Cron Job Templates** ❌
   - No pre-configured schedules for agents
   - **TODO:** Create `config/crons/` with templates for ATLAS, TRENDY, SCRIBE, SENTINEL, CODEX
   - **TODO:** Add "Install Default Crons" button to Workspace tab

### 🟢 MEDIUM - Next Week

7. **Agent Registry UI** ❌
   - **TODO:** Settings page to configure all 16 agents (gateway URL, token, model)
   - **TODO:** Agent status indicator (online/offline/busy)

8. **Pipeline Visualization** ❌
   - **TODO:** Show task flow: Research → Content → Review → Publish
   - **TODO:** Display which agent is at each stage

9. **Documentation** ⚠️
   - Created: `docs/AGENTS/README.md`
   - Created: `docs/AGENTS/JARVIS.md`
   - Created: `docs/AGENTS/EMPLOYEE-TEMPLATES.md`
   - **TODO:** `docs/AGENTS/ORCHESTRATION.md` - How JARVIS commands agents
   - **TODO:** `docs/AGENTS/CRON-SETUP.md` - Cron configuration guide
   - **TODO:** `docs/AGENTS/COST-OPTIMIZATION.md` - Model hierarchy

---

## Files Created Today

| File | Purpose |
|------|---------|
| `docs/AGENTS/README.md` | 16-agent system overview |
| `docs/AGENTS/JARVIS.md` | Orchestrator personality (4 sections, 8 rules) |
| `docs/AGENTS/EMPLOYEE-TEMPLATES.md` | All 16 agent profiles |
| `GAP-ANALYSIS.md` | Detailed gap analysis |
| `docs/AGENTS-IMPLEMENTATION-PLAN.md` | Implementation roadmap |
| `SUMMARY.md` | This file |

---

## Immediate Next Steps

1. **Test JARVIS.md** - Copy to your JARVIS workspace and test with OpenClaw
2. **Review agent profiles** - Ensure all 16 templates match your requirements
3. **Plan multi-gateway architecture** - Decide: separate processes vs. multi-profile
4. **Start coding** - Begin with agent registry API and gateway pool

---

## Questions to Answer

1. **Deployment model:** Are you running 16 separate OpenClaw processes, or do you want a single gateway with 16 agent profiles?

2. **Gateway configuration:** Do you already have multiple gateways running, or starting from scratch?

3. **Priority:** Which agent do you want to set up first after JARVIS? (recommend ATLAS for research)

---

## Contact

Join the [Nerve Discord](https://discord.gg/Sh9ZGtctva) for support and updates.
