/**
 * Orchestrator Logic
 *
 * Provides orchestration capabilities for JARVIS to command other agents.
 * Handles task routing, session management, and result aggregation.
 * @module
 */

import { getAgent, getAllAgents, type AgentConfig } from './agent-registry.js';
import { gatewayPool } from './gateway-pool.js';

/** Task priority levels */
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

/** Task routing result */
export interface TaskRoutingResult {
  /** Recommended agent for the task */
  agent: AgentConfig;
  /** Confidence score (0-1) */
  confidence: number;
  /** Alternative agents */
  alternatives: AgentConfig[];
}

/** Command request */
export interface CommandRequest {
  /** Target agent name */
  agentName: string;
  /** Task description */
  task: string;
  /** Task priority */
  priority: TaskPriority;
  /** Optional deadline (ISO 8601) */
  deadline?: string;
  /** Optional model override */
  model?: string;
}

/** Command response */
export interface CommandResponse {
  /** Whether the command was successful */
  ok: boolean;
  /** Session key for tracking */
  sessionKey?: string;
  /** Agent that accepted the task */
  agent?: string;
  /** Error message if failed */
  error?: string;
  /** Estimated completion time */
  estimatedCompletion?: string;
}

/**
 * Task routing table - maps task keywords to preferred agents
 */
const TASK_ROUTING_TABLE: Record<string, string[]> = {
  // Research tasks
  'research': ['ATLAS', 'TRENDY'],
  'analyze': ['ATLAS', 'ORACLE'],
  'market': ['ATLAS'],
  'competitor': ['ATLAS'],
  'trend': ['TRENDY'],
  'news': ['TRENDY'],
  'scan': ['TRENDY'],
  
  // Development tasks
  'code': ['CODEX'],
  'develop': ['CODEX'],
  'implement': ['CODEX'],
  'fix': ['CODEX', 'SENTINEL'],
  'bug': ['CODEX', 'SENTINEL'],
  'review': ['SENTINEL'],
  'security': ['SENTINEL'],
  'performance': ['SENTINEL'],
  'test': ['CODEX'],
  'refactor': ['CODEX'],
  
  // Content tasks
  'write': ['SCRIBE', 'WRITER'],
  'draft': ['SCRIBE'],
  'copy': ['SCRIBE'],
  'blog': ['SCRIBE', 'WRITER'],
  'article': ['SCRIBE', 'WRITER'],
  'edit': ['WRITER'],
  'polish': ['WRITER'],
  'design': ['PIXEL'],
  'image': ['PIXEL'],
  'visual': ['PIXEL'],
  'video': ['NOVA', 'VIBE', 'CLIP'],
  'animate': ['VIBE'],
  'clip': ['CLIP'],
  'highlight': ['CLIP'],
  
  // Sales tasks
  'outreach': ['SAGE'],
  'campaign': ['SAGE'],
  'prospect': ['SAGE'],
  'deal': ['CLOSER'],
  'close': ['CLOSER'],
  'negotiate': ['CLOSER'],
  'sales': ['SAGE', 'CLOSER'],
  
  // Strategy tasks
  'strategy': ['JARVIS', 'ORACLE'],
  'plan': ['JARVIS', 'ORACLE'],
  'decide': ['ORACLE'],
  'consult': ['ORACLE'],
};

/**
 * Route a task to the best agent based on keywords
 */
export function routeTask(taskDescription: string): TaskRoutingResult | null {
  const taskLower = taskDescription.toLowerCase();
  const scores: Map<string, number> = new Map();

  // Score each agent based on keyword matches
  for (const [keyword, agents] of Object.entries(TASK_ROUTING_TABLE)) {
    if (taskLower.includes(keyword)) {
      for (const agent of agents) {
        const currentScore = scores.get(agent) || 0;
        scores.set(agent, currentScore + 1);
      }
    }
  }

  if (scores.size === 0) {
    // No matching keywords, return null (caller should handle)
    return null;
  }

  // Sort agents by score
  const sorted = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1]);

  const bestAgentName = sorted[0][0];
  const bestAgentScore = sorted[0][1];

  // Get the agent config
  const agent = getAgentSync(bestAgentName);
  if (!agent) {
    return null;
  }

  // Get alternatives
  const alternatives: AgentConfig[] = [];
  for (let i = 1; i < Math.min(3, sorted.length); i++) {
    const alt = getAgentSync(sorted[i][0]);
    if (alt) alternatives.push(alt);
  }

  return {
    agent,
    confidence: Math.min(bestAgentScore / 3, 1), // Normalize confidence
    alternatives,
  };
}

/**
 * Synchronous agent lookup (helper for routing)
 */
function getAgentSync(name: string): AgentConfig | undefined {
  // This is a simplified version - in production, use proper caching
  const agents = getAllAgentsFromMemory();
  return agents.find(a => a.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get all agents from memory (cached)
 * Note: This is a simplified implementation
 */
function getAllAgentsFromMemory(): AgentConfig[] {
  // In production, this would use a proper cache layer
  // For now, return empty array - routing will fall back to manual selection
  return [];
}

/**
 * Command an agent to perform a task
 */
export async function commandAgent(request: CommandRequest): Promise<CommandResponse> {
  const { agentName, task, priority, deadline, model } = request;

  // Get agent configuration
  const agent = await getAgent(agentName);
  if (!agent) {
    return {
      ok: false,
      error: `Agent ${agentName} not found`,
    };
  }

  if (!agent.enabled) {
    return {
      ok: false,
      error: `Agent ${agentName} is disabled`,
    };
  }

  // Check if agent is available
  if (!gatewayPool.isAgentAvailable(agentName)) {
    return {
      ok: false,
      error: `Agent ${agentName} is not available (gateway unreachable)`,
    };
  }

  try {
    // Send command to agent's gateway
    const result = await gatewayPool.postJson<{
      sessionKey?: string;
      key?: string;
      status?: string;
    }>(agentName, '/sessions/spawn', {
      task,
      model: model || agent.model,
      priority,
      deadline,
    });

    return {
      ok: true,
      sessionKey: result.sessionKey || result.key,
      agent: agentName,
      estimatedCompletion: estimateCompletionTime(priority),
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to command agent: ${(err as Error).message}`,
    };
  }
}

/**
 * Estimate completion time based on priority
 */
function estimateCompletionTime(priority: TaskPriority): string {
  const now = new Date();
  let minutesToAdd = 60; // Default 1 hour

  switch (priority) {
    case 'critical': minutesToAdd = 15; break;
    case 'high': minutesToAdd = 30; break;
    case 'normal': minutesToAdd = 60; break;
    case 'low': minutesToAdd = 180; break;
  }

  now.setMinutes(now.getMinutes() + minutesToAdd);
  return now.toISOString();
}

/**
 * Get status of all agents
 */
export async function getAllAgentsStatus(): Promise<Array<{
  name: string;
  status: string;
  department: string;
  currentTask?: string;
}>> {
  const agents = await getAllAgents();
  const statuses: Array<{
    name: string;
    status: string;
    department: string;
    currentTask?: string;
  }> = [];

  for (const agent of agents) {
    const available = gatewayPool.isAgentAvailable(agent.name);
    statuses.push({
      name: agent.name,
      status: available ? 'available' : 'unavailable',
      department: agent.department,
    });
  }

  return statuses;
}

/**
 * Get the orchestrator skill definition for JARVIS
 */
export function getOrchestratorSkillDefinition(): string {
  return `
# Nerve Orchestrator Skill

This skill allows JARVIS to command other OpenCLAW agents.

## Commands

### orchestrator.command(agent, task, options)

Commands another agent to perform a task.

**Parameters:**
- agent: Agent name ('ATLAS', 'CODEX', 'SCRIBE', etc.)
- task: Task description
- options.priority: 'low' | 'normal' | 'high' | 'critical'
- options.deadline: ISO 8601 deadline
- options.model: Override agent's default model

**Example:**
\`\`\`
orchestrator.command('ATLAS', {
  task: 'Research competitors pricing',
  priority: 'high',
  deadline: '2026-03-11T12:00:00Z'
})
\`\`\`

**Returns:**
\`\`\`json
{
  "sessionKey": "atlas-20260310-001",
  "status": "accepted",
  "estimatedCompletion": "2026-03-10T14:00:00Z"
}
\`\`\`

### orchestrator.status(agent)

Query an agent's current status.

**Returns:**
\`\`\`json
{
  "agent": "ATLAS",
  "status": "busy",
  "currentTask": "Researching AI trends",
  "progress": 0.65
}
\`\`\`

### orchestrator.status()

Get status of all agents.

**Returns:**
\`\`\`json
{
  "agents": [
    { "name": "JARVIS", "status": "available", "department": "Executive" },
    { "name": "ATLAS", "status": "busy", "department": "Research" },
    ...
  ]
}
\`\`\`
`;
}
