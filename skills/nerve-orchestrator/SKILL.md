# Nerve Orchestrator Skill

**Version:** 1.0.0  
**Author:** Nerve Team  
**Description:** Enables JARVIS to command other OpenCLAW agents in the 16-agent system

---

## Overview

This skill provides orchestration capabilities for JARVIS (the Chief Strategy Officer) to command the other 15 agents in the OpenCLAW system. Instead of doing work directly, JARVIS uses this skill to delegate tasks to the most appropriate agent.

---

## Eligibility

**Required Agent:** JARVIS (or any agent acting as orchestrator)

**Required Configuration:**
- Agent registry must be initialized (`npm run init-agents`)
- Target agents must be registered and enabled
- Gateway connections must be configured

---

## Commands

### `orchestrator.command(agent, task, options)`

Commands another agent to perform a task.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | Yes | Target agent name (e.g., 'ATLAS', 'CODEX', 'SCRIBE') |
| `task` | string | Yes | Task description |
| `options.priority` | string | No | Priority level: 'low', 'normal', 'high', 'critical' (default: 'normal') |
| `options.deadline` | string | No | ISO 8601 deadline (e.g., '2026-03-11T12:00:00Z') |
| `options.model` | string | No | Override agent's default model |

#### Returns

```json
{
  "ok": true,
  "sessionKey": "atlas-20260310-001",
  "agent": "ATLAS",
  "status": "accepted",
  "estimatedCompletion": "2026-03-10T14:00:00Z"
}
```

#### Example Usage

```javascript
// Command ATLAS to research competitors
const result = await orchestrator.command('ATLAS', {
  task: 'Research top 5 competitors pricing. Include monthly/annual plans and enterprise pricing.',
  priority: 'high',
  deadline: '2026-03-11T12:00:00Z'
});

console.log(`Task assigned to ${result.agent}, session: ${result.sessionKey}`);
```

---

### `orchestrator.status(agent)`

Query a specific agent's current status.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | Yes | Agent name to query |

#### Returns

```json
{
  "agent": "ATLAS",
  "status": "busy",
  "department": "Research",
  "currentTask": "Researching competitor pricing",
  "progress": 0.65,
  "estimatedCompletion": "2026-03-10T14:00:00Z"
}
```

#### Example Usage

```javascript
const status = await orchestrator.status('ATLAS');
console.log(`${status.agent} is ${status.status}: ${status.currentTask}`);
```

---

### `orchestrator.status()`

Get status of all registered agents.

#### Returns

```json
{
  "agents": [
    {
      "name": "JARVIS",
      "status": "available",
      "department": "Executive"
    },
    {
      "name": "ATLAS",
      "status": "busy",
      "department": "Research",
      "currentTask": "Researching trends"
    },
    {
      "name": "CODEX",
      "status": "idle",
      "department": "Development"
    }
  ],
  "summary": {
    "total": 16,
    "available": 10,
    "busy": 4,
    "unavailable": 2
  }
}
```

---

### `orchestrator.route(task)`

Get the best agent for a given task (automatic task routing).

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | Task description |

#### Returns

```json
{
  "recommended": {
    "name": "ATLAS",
    "role": "Research Analyst",
    "confidence": 0.95
  },
  "alternatives": [
    {
      "name": "TRENDY",
      "role": "Trend Scout",
      "confidence": 0.70
    }
  ]
}
```

#### Example Usage

```javascript
const routing = await orchestrator.route('Research market trends for AI agents');
console.log(`Best agent: ${routing.recommended.name}`);

// Automatically command the recommended agent
await orchestrator.command(routing.recommended.name, {
  task: 'Research market trends for AI agents',
  priority: 'normal'
});
```

---

## Task Routing Table

The orchestrator automatically routes tasks to the best agent based on keywords:

| Keywords | Recommended Agent | Department |
|----------|------------------|------------|
| research, analyze, market, competitor | ATLAS | Research |
| trend, news, scan, social | TRENDY | Research |
| code, develop, implement, fix, bug | CODEX | Development |
| review, security, performance, test | SENTINEL | Development |
| write, draft, copy, blog, article | SCRIBE | Content |
| edit, polish, finalize | WRITER | Content |
| design, image, visual, ui, ux | PIXEL | Content |
| video, production, demo | NOVA | Content |
| animate, motion, short-form | VIBE | Content |
| clip, highlight, extract | CLIP | Content |
| outreach, campaign, prospect | SAGE | Sales |
| deal, close, negotiate, sales | CLOSER | Sales |
| strategy, plan, decide, consult | ORACLE | Executive |

---

## Best Practices

### 1. Use Automatic Routing When Unsure

```javascript
// Let the orchestrator choose the best agent
const routing = await orchestrator.route('Analyze competitor pricing');
await orchestrator.command(routing.recommended.name, {
  task: 'Analyze competitor pricing',
  priority: 'high'
});
```

### 2. Set Appropriate Priorities

- `critical`: Urgent tasks needing immediate attention (15 min ETA)
- `high`: Important tasks (30 min ETA)
- `normal`: Standard tasks (1 hour ETA)
- `low`: Background tasks (3 hours ETA)

### 3. Chain Commands for Complex Workflows

```javascript
// Multi-agent workflow
async function launchFeature() {
  // 1. Research
  const research = await orchestrator.command('ATLAS', {
    task: 'Research market need for dark mode',
    priority: 'high'
  });
  
  // 2. Develop
  const dev = await orchestrator.command('CODEX', {
    task: 'Implement dark mode feature',
    priority: 'normal',
    deadline: new Date(Date.now() + 24*60*60*1000).toISOString()
  });
  
  // 3. Review
  const review = await orchestrator.command('SENTINEL', {
    task: 'Review dark mode code quality',
    priority: 'high'
  });
  
  // 4. Content
  const content = await orchestrator.command('SCRIBE', {
    task: 'Write dark mode announcement',
    priority: 'normal'
  });
  
  return { research, dev, review, content };
}
```

### 4. Monitor Agent Status

```javascript
// Check all agents before assigning critical task
const status = await orchestrator.status();
const availableAgents = status.agents.filter(a => a.status === 'available');

if (availableAgents.length === 0) {
  console.warn('No agents available - consider escalating to user');
}
```

---

## Error Handling

```javascript
try {
  const result = await orchestrator.command('ATLAS', {
    task: 'Research competitors',
    priority: 'high'
  });
  
  if (!result.ok) {
    console.error(`Command failed: ${result.error}`);
    
    // Try alternative agent
    const routing = await orchestrator.route('Research competitors');
    if (routing.alternatives.length > 0) {
      return await orchestrator.command(routing.alternatives[0].name, {
        task: 'Research competitors',
        priority: 'high'
      });
    }
  }
  
  return result;
} catch (err) {
  console.error(`Orchestration error: ${err.message}`);
  // Escalate to user after 2 failures
  return { ok: false, error: 'Failed after 2 attempts - user intervention required' };
}
```

---

## Troubleshooting

### Agent Not Found

**Error:** `Agent ATLAS not found`

**Solution:**
1. Run `npm run init-agents` to initialize the registry
2. Check agent is enabled in Settings → Agents
3. Verify agent name spelling

### Agent Unavailable

**Error:** `Agent ATLAS is not available (gateway unreachable)`

**Solution:**
1. Check the agent's gateway is running
2. Verify gateway URL and port in agent configuration
3. Check network connectivity

### Command Fails

**Error:** `Failed to command agent: Gateway returned 500`

**Solution:**
1. Check agent's gateway logs for errors
2. Verify task description is valid
3. Try with lower priority or different model

---

## API Reference

For detailed API documentation, see:
- `GET /api/agents` - List all agents
- `GET /api/agents/health` - Health check all agents
- `POST /api/agents/:name/command` - Command an agent

---

## License

MIT - Part of the Nerve project
