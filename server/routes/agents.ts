/**
 * Agent Registry API Routes
 *
 * GET    /api/agents              - List all agents
 * GET    /api/agents/:name        - Get agent by name
 * POST   /api/agents              - Register new agent
 * PUT    /api/agents/:name        - Update agent config
 * DELETE /api/agents/:name        - Unregister agent
 * GET    /api/agents/:name/status - Get agent health status
 * GET    /api/agents/health       - Health check all agents
 * GET    /api/agents/departments  - List agents by department
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  getAllAgents,
  getAgent,
  registerAgent,
  updateAgent,
  unregisterAgent,
  checkAgentHealth,
  checkAllAgentsHealth,
  getAgentsByDepartment,
  initializeDefaultAgents,
  type AgentConfig,
  type AgentDepartment,
} from '../lib/agent-registry.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();

// Schema for agent registration
const agentSchema = z.object({
  name: z.string().min(1).max(50),
  role: z.string().min(1).max(100),
  department: z.enum(['Executive', 'Research', 'Development', 'Content', 'Sales']),
  model: z.string().min(1),
  gatewayUrl: z.string().url(),
  gatewayToken: z.string().optional(),
  schedule: z.string(),
  enabled: z.boolean().default(true),
  costInput: z.number().optional(),
  costOutput: z.number().optional(),
  description: z.string().optional(),
});

// Schema for agent update (partial)
const agentUpdateSchema = agentSchema.partial();

// Schema for command request
const commandSchema = z.object({
  task: z.string().min(1),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  deadline: z.string().datetime().optional(),
  model: z.string().optional(),
  sessionKey: z.string().optional(),
});

/**
 * GET /api/agents - List all registered agents
 */
app.get('/api/agents', rateLimitGeneral, async (c) => {
  try {
    const agents = await getAllAgents();
    return c.json({ ok: true, agents });
  } catch (err) {
    console.error('[agents] GET /api/agents error:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to list agents' }, 500);
  }
});

/**
 * GET /api/agents/health - Health check all agents
 */
app.get('/api/agents/health', rateLimitGeneral, async (c) => {
  try {
    const healthResults = await checkAllAgentsHealth();
    return c.json({ ok: true, health: healthResults });
  } catch (err) {
    console.error('[agents] GET /api/agents/health error:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to check agent health' }, 500);
  }
});

/**
 * GET /api/agents/departments - List agents grouped by department
 */
app.get('/api/agents/departments', rateLimitGeneral, async (c) => {
  try {
    const departments: AgentDepartment[] = ['Executive', 'Research', 'Development', 'Content', 'Sales'];
    const result: Record<string, AgentConfig[]> = {};

    for (const dept of departments) {
      result[dept] = await getAgentsByDepartment(dept);
    }

    return c.json({ ok: true, departments: result });
  } catch (err) {
    console.error('[agents] GET /api/agents/departments error:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to list departments' }, 500);
  }
});

/**
 * POST /api/agents/initialize - Initialize default agents
 */
app.post('/api/agents/initialize', rateLimitGeneral, async (c) => {
  try {
    await initializeDefaultAgents();
    const agents = await getAllAgents();
    return c.json({ ok: true, agents, message: 'Default agents initialized' });
  } catch (err) {
    console.error('[agents] POST /api/agents/initialize error:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to initialize agents' }, 500);
  }
});

/**
 * GET /api/agents/:name - Get agent by name
 */
app.get('/api/agents/:name', rateLimitGeneral, async (c) => {
  try {
    const name = c.req.param('name');
    if (!name) {
      return c.json({ ok: false, error: 'Agent name required' }, 400);
    }
    const agent = await getAgent(name);
    if (!agent) {
      return c.json({ ok: false, error: 'Agent not found' }, 404);
    }
    return c.json({ ok: true, agent });
  } catch (err) {
    console.error('[agents] GET /api/agents/:name error:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to get agent' }, 500);
  }
});

/**
 * GET /api/agents/:name/status - Get agent health status
 */
app.get('/api/agents/:name/status', rateLimitGeneral, async (c) => {
  try {
    const name = c.req.param('name');
    if (!name) {
      return c.json({ ok: false, error: 'Agent name required' }, 400);
    }
    const agent = await getAgent(name);
    if (!agent) {
      return c.json({ ok: false, error: 'Agent not found' }, 404);
    }

    const health = await checkAgentHealth(agent);
    return c.json({ ok: true, health });
  } catch (err) {
    console.error('[agents] GET /api/agents/:name/status error:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to check agent status' }, 500);
  }
});

/**
 * POST /api/agents - Register a new agent
 */
app.post('/api/agents', rateLimitGeneral, zValidator('json', agentSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    // Check if agent already exists
    const existing = await getAgent(body.name);
    if (existing) {
      return c.json({ ok: false, error: 'Agent already exists' }, 409);
    }

    // Extract gateway port from URL
    const url = new URL(body.gatewayUrl);
    const gatewayPort = parseInt(url.port, 10) || 18789;

    const agent: AgentConfig = {
      ...body,
      gatewayPort,
      gatewayToken: body.gatewayToken || '',
    };

    await registerAgent(agent);
    return c.json({ ok: true, agent }, 201);
  } catch (err) {
    console.error('[agents] POST /api/agents error:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to register agent' }, 500);
  }
});

/**
 * PUT /api/agents/:name - Update an existing agent
 */
app.put('/api/agents/:name', rateLimitGeneral, zValidator('json', agentUpdateSchema), async (c) => {
  try {
    const name = c.req.param('name');
    if (!name) {
      return c.json({ ok: false, error: 'Agent name required' }, 400);
    }
    const updates = c.req.valid('json');

    const existing = await getAgent(name);
    if (!existing) {
      return c.json({ ok: false, error: 'Agent not found' }, 404);
    }

    await updateAgent(name, updates);
    const updated = await getAgent(name);
    return c.json({ ok: true, agent: updated });
  } catch (err) {
    console.error('[agents] PUT /api/agents/:name error:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to update agent' }, 500);
  }
});

/**
 * DELETE /api/agents/:name - Unregister an agent
 */
app.delete('/api/agents/:name', rateLimitGeneral, async (c) => {
  try {
    const name = c.req.param('name');
    if (!name) {
      return c.json({ ok: false, error: 'Agent name required' }, 400);
    }

    const existing = await getAgent(name);
    if (!existing) {
      return c.json({ ok: false, error: 'Agent not found' }, 404);
    }

    await unregisterAgent(name);
    return c.json({ ok: true, message: `Agent ${name} unregistered` });
  } catch (err) {
    console.error('[agents] DELETE /api/agents/:name error:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to unregister agent' }, 500);
  }
});

/**
 * POST /api/agents/:name/command - Command an agent (for JARVIS orchestration)
 * This endpoint creates a session on the target agent with the given task.
 */
app.post('/api/agents/:name/command', rateLimitGeneral, zValidator('json', commandSchema), async (c) => {
  try {
    const name = c.req.param('name');
    const body = c.req.valid('json');

    const agent = await getAgent(name);
    if (!agent) {
      return c.json({ ok: false, error: 'Agent not found' }, 404);
    }

    if (!agent.enabled) {
      return c.json({ ok: false, error: 'Agent is disabled' }, 400);
    }

    // Invoke the gateway to create a session with the task
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (agent.gatewayToken) {
      headers['Authorization'] = `Bearer ${agent.gatewayToken}`;
    }

    // Use the gateway's sessions_spawn or chat method to create a task
    const response = await fetch(`${agent.gatewayUrl}/sessions/spawn`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        task: body.task,
        model: body.model || agent.model,
        priority: body.priority,
        deadline: body.deadline,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gateway returned ${response.status}: ${text}`);
    }

    const result = await response.json() as { sessionKey?: string; key?: string };

    return c.json({
      ok: true,
      sessionKey: result.sessionKey || result.key,
      status: 'accepted',
      agent: agent.name,
      task: body.task,
      priority: body.priority,
    });
  } catch (err) {
    console.error('[agents] POST /api/agents/:name/command error:', (err as Error).message);
    return c.json({
      ok: false,
      error: 'Failed to command agent',
      details: (err as Error).message,
    }, 500);
  }
});

export default app;
