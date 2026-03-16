/**
 * Agent Registry Service
 *
 * Manages the directory of all 16 OpenCLAW agents. Each agent is an independent
 * OpenClaw instance with its own gateway URL, token, model assignment, and department.
 *
 * Persistence: server/data/agents.json
 * @module
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, writeJSON } from './files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');

/** Agent department classifications */
export type AgentDepartment =
  | 'Executive'
  | 'Research'
  | 'Development'
  | 'Content'
  | 'Sales';

/** Agent status */
export type AgentStatus = 'online' | 'offline' | 'busy' | 'idle';

/** Agent configuration */
export interface AgentConfig {
  /** Agent name (e.g., 'JARVIS', 'ATLAS', 'CODEX') */
  name: string;
  /** Agent role/title (e.g., 'Chief Strategy Officer', 'Research Analyst') */
  role: string;
  /** Department assignment */
  department: AgentDepartment;
  /** Model identifier (e.g., 'claude-opus', 'glm-4.7', 'gpt-5.3-codex') */
  model: string;
  /** Gateway URL (e.g., 'http://127.0.0.1:18789') */
  gatewayUrl: string;
  /** Gateway authentication token */
  gatewayToken: string;
  /** Gateway port (derived from gatewayUrl, stored for convenience) */
  gatewayPort: number;
  /** Cron schedule (e.g., '0 * * * *' or 'on-demand') */
  schedule: string;
  /** Whether the agent is enabled */
  enabled: boolean;
  /** Cost per million tokens (input) */
  costInput?: number;
  /** Cost per million tokens (output) */
  costOutput?: number;
  /** Agent description/purpose */
  description?: string;
  /** Last health check timestamp */
  lastHealthCheck?: number;
  /** Last known status */
  lastStatus?: AgentStatus;
}

/** Agent health status */
export interface AgentHealth {
  name: string;
  status: AgentStatus;
  gatewayReachable: boolean;
  lastCheck: number;
  error?: string;
}

/** Registry data structure */
interface AgentRegistryData {
  agents: Record<string, AgentConfig>;
  updatedAt: number;
}

/** Default empty registry */
const EMPTY_REGISTRY: AgentRegistryData = {
  agents: {},
  updatedAt: Date.now(),
};

/**
 * Mutex for agent registry file operations.
 * Prevents concurrent reads/writes.
 */
let registryLock = Promise.resolve();

/**
 * Read the agent registry from disk.
 */
export async function readRegistry(): Promise<AgentRegistryData> {
  const lockPromise = registryLock;
  registryLock = registryLock.then(async () => {
    // Lock acquired, do work here if needed
  });
  
  await lockPromise;
  return await readJSON<AgentRegistryData>(AGENTS_FILE, EMPTY_REGISTRY);
}

/**
 * Write the agent registry to disk.
 */
export async function writeRegistry(data: AgentRegistryData): Promise<void> {
  await registryLock;
  registryLock = (async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await writeJSON(AGENTS_FILE, { ...data, updatedAt: Date.now() });
  })();
  await registryLock;
}

/**
 * Get all registered agents.
 */
export async function getAllAgents(): Promise<AgentConfig[]> {
  const registry = await readRegistry();
  return Object.values(registry.agents).filter(agent => agent.enabled);
}

/**
 * Get an agent by name.
 */
export async function getAgent(name: string): Promise<AgentConfig | undefined> {
  const registry = await readRegistry();
  return registry.agents[name.toUpperCase()];
}

/**
 * Register a new agent.
 */
export async function registerAgent(agent: AgentConfig): Promise<void> {
  const registry = await readRegistry();
  registry.agents[agent.name.toUpperCase()] = agent;
  await writeRegistry(registry);
}

/**
 * Update an existing agent's configuration.
 */
export async function updateAgent(name: string, updates: Partial<AgentConfig>): Promise<void> {
  const registry = await readRegistry();
  const existing = registry.agents[name.toUpperCase()];
  if (!existing) {
    throw new Error(`Agent ${name} not found`);
  }
  registry.agents[name.toUpperCase()] = { ...existing, ...updates };
  await writeRegistry(registry);
}

/**
 * Unregister an agent.
 */
export async function unregisterAgent(name: string): Promise<void> {
  const registry = await readRegistry();
  delete registry.agents[name.toUpperCase()];
  await writeRegistry(registry);
}

/**
 * Get agents by department.
 */
export async function getAgentsByDepartment(department: AgentDepartment): Promise<AgentConfig[]> {
  const agents = await getAllAgents();
  return agents.filter(agent => agent.department === department);
}

/**
 * Check an agent's health by pinging its gateway.
 */
export async function checkAgentHealth(agent: AgentConfig): Promise<AgentHealth> {
  const now = Date.now();
  try {
    const response = await fetch(`${agent.gatewayUrl}/health`, {
      signal: AbortSignal.timeout(3000),
      headers: agent.gatewayToken
        ? { 'Authorization': `Bearer ${agent.gatewayToken}` }
        : {},
    });

    if (response.ok) {
      // Update agent's last health check
      await updateAgent(agent.name, {
        lastHealthCheck: now,
        lastStatus: 'idle',
      });

      return {
        name: agent.name,
        status: 'idle',
        gatewayReachable: true,
        lastCheck: now,
      };
    } else {
      const error = `Gateway returned ${response.status}`;
      await updateAgent(agent.name, {
        lastHealthCheck: now,
        lastStatus: 'offline',
      });

      return {
        name: agent.name,
        status: 'offline',
        gatewayReachable: false,
        lastCheck: now,
        error,
      };
    }
  } catch (err) {
    const error = (err as Error).message;
    await updateAgent(agent.name, {
      lastHealthCheck: now,
      lastStatus: 'offline',
    });

    return {
      name: agent.name,
      status: 'offline',
      gatewayReachable: false,
      lastCheck: now,
      error,
    };
  }
}

/**
 * Check health of all agents.
 */
export async function checkAllAgentsHealth(): Promise<AgentHealth[]> {
  const agents = await getAllAgents();
  return Promise.all(agents.map(checkAgentHealth));
}

/**
 * Get agent status (cached from last health check).
 */
export async function getAgentStatus(name: string): Promise<AgentStatus> {
  const agent = await getAgent(name);
  if (!agent) return 'offline';

  // If last health check was within 5 minutes, return cached status
  if (agent.lastHealthCheck && Date.now() - agent.lastHealthCheck < 5 * 60 * 1000) {
    return agent.lastStatus || 'offline';
  }

  // Otherwise, do a fresh health check
  const health = await checkAgentHealth(agent);
  return health.status;
}

/**
 * Initialize the registry with default 16 agents.
 */
export async function initializeDefaultAgents(): Promise<void> {
  const registry = await readRegistry();

  // Don't overwrite existing agents
  if (Object.keys(registry.agents).length > 0) {
    console.log('[agent-registry] Registry already has agents, skipping initialization');
    return;
  }

  const defaultAgents: AgentConfig[] = [
    // Executive
    {
      name: 'JARVIS',
      role: 'Chief Strategy Officer',
      department: 'Executive',
      model: 'claude-opus',
      gatewayUrl: 'http://127.0.0.1:18789',
      gatewayPort: 18789,
      gatewayToken: '',
      schedule: 'on-demand',
      enabled: true,
      costInput: 15,
      costOutput: 75,
      description: 'Chief Strategy Officer and orchestrator of the 16-agent system',
    },
    {
      name: 'ORACLE',
      role: 'Strategic Consultant',
      department: 'Executive',
      model: 'claude-opus',
      gatewayUrl: 'http://127.0.0.1:18790',
      gatewayPort: 18790,
      gatewayToken: '',
      schedule: 'on-demand',
      enabled: true,
      costInput: 15,
      costOutput: 75,
      description: 'Strategic consultant for second opinions and complex analysis',
    },
    // Research
    {
      name: 'ATLAS',
      role: 'Research Analyst',
      department: 'Research',
      model: 'glm-4.7',
      gatewayUrl: 'http://127.0.0.1:18791',
      gatewayPort: 18791,
      gatewayToken: '',
      schedule: '0 * * * *',
      enabled: true,
      costInput: 0.48,
      costOutput: 1.50,
      description: 'Research analyst for market research and competitor analysis',
    },
    {
      name: 'TRENDY',
      role: 'Trend Scout',
      department: 'Research',
      model: 'glm-4.7',
      gatewayUrl: 'http://127.0.0.1:18792',
      gatewayPort: 18792,
      gatewayToken: '',
      schedule: '0 */2 * * *',
      enabled: true,
      costInput: 0.48,
      costOutput: 1.50,
      description: 'Trend scout for social media and news monitoring',
    },
    // Development
    {
      name: 'CODEX',
      role: 'Senior Developer',
      department: 'Development',
      model: 'gpt-5.3-codex',
      gatewayUrl: 'http://127.0.0.1:18793',
      gatewayPort: 18793,
      gatewayToken: '',
      schedule: '0 23 * * *',
      enabled: true,
      costInput: 2,
      costOutput: 8,
      description: 'Senior developer for feature development and bug fixes',
    },
    {
      name: 'SENTINEL',
      role: 'Code Health Monitor',
      department: 'Development',
      model: 'claude-sonnet',
      gatewayUrl: 'http://127.0.0.1:18794',
      gatewayPort: 18794,
      gatewayToken: '',
      schedule: '0 */2 * * *',
      enabled: true,
      costInput: 3,
      costOutput: 15,
      description: 'Code health monitor for quality, security, and performance',
    },
    // Content
    {
      name: 'SCRIBE',
      role: 'Head Copywriter',
      department: 'Content',
      model: 'glm-4.7',
      gatewayUrl: 'http://127.0.0.1:18795',
      gatewayPort: 18795,
      gatewayToken: '',
      schedule: '0 */3 * * *',
      enabled: true,
      costInput: 0.48,
      costOutput: 1.50,
      description: 'Head copywriter for voice-matched content drafting',
    },
    {
      name: 'WRITER',
      role: 'Content Writer',
      department: 'Content',
      model: 'claude-sonnet',
      gatewayUrl: 'http://127.0.0.1:18796',
      gatewayPort: 18796,
      gatewayToken: '',
      schedule: 'on-demand',
      enabled: true,
      costInput: 3,
      costOutput: 15,
      description: 'Content writer for polishing and finalizing drafts',
    },
    {
      name: 'PIXEL',
      role: 'Product Designer',
      department: 'Content',
      model: 'claude-sonnet',
      gatewayUrl: 'http://127.0.0.1:18797',
      gatewayPort: 18797,
      gatewayToken: '',
      schedule: 'on-demand',
      enabled: true,
      costInput: 3,
      costOutput: 15,
      description: 'Product designer for UI/UX and visual assets',
    },
    {
      name: 'NOVA',
      role: 'Video Production',
      department: 'Content',
      model: 'grok',
      gatewayUrl: 'http://127.0.0.1:18798',
      gatewayPort: 18798,
      gatewayToken: '',
      schedule: 'on-demand',
      enabled: true,
      costInput: 5,
      costOutput: 10,
      description: 'Video production for long-form content and demos',
    },
    {
      name: 'VIBE',
      role: 'Motion & UGC Creator',
      department: 'Content',
      model: 'kling',
      gatewayUrl: 'http://127.0.0.1:18799',
      gatewayPort: 18799,
      gatewayToken: '',
      schedule: 'on-demand',
      enabled: true,
      costInput: 3,
      costOutput: 6,
      description: 'Motion graphics and user-generated content style videos',
    },
    {
      name: 'CLIP',
      role: 'Video Clipping Specialist',
      department: 'Content',
      model: 'claude-sonnet',
      gatewayUrl: 'http://127.0.0.1:18800',
      gatewayPort: 18800,
      gatewayToken: '',
      schedule: 'on-demand',
      enabled: true,
      costInput: 3,
      costOutput: 15,
      description: 'Video clipping specialist for extracting highlights',
    },
    // Sales
    {
      name: 'SAGE',
      role: 'Outreach Strategist',
      department: 'Sales',
      model: 'claude-sonnet',
      gatewayUrl: 'http://127.0.0.1:18801',
      gatewayPort: 18801,
      gatewayToken: '',
      schedule: 'on-demand',
      enabled: true,
      costInput: 3,
      costOutput: 15,
      description: 'Outreach strategist for campaign planning and prospecting',
    },
    {
      name: 'CLOSER',
      role: 'Deal Closer',
      department: 'Sales',
      model: 'claude-sonnet',
      gatewayUrl: 'http://127.0.0.1:18802',
      gatewayPort: 18802,
      gatewayToken: '',
      schedule: 'on-demand',
      enabled: true,
      costInput: 3,
      costOutput: 15,
      description: 'Deal closer for sales calls and negotiations',
    },
    {
      name: 'SECURITY',
      role: 'Security Reviewer',
      department: 'Development',
      model: 'claude-sonnet',
      gatewayUrl: 'http://127.0.0.1:18803',
      gatewayPort: 18803,
      gatewayToken: '',
      schedule: '0 */4 * * *',
      enabled: true,
      costInput: 3,
      costOutput: 15,
      description: 'Security reviewer for vulnerability scanning, dependency audits, and OWASP compliance',
    },
  ];

  for (const agent of defaultAgents) {
    registry.agents[agent.name.toUpperCase()] = agent;
  }

  await writeRegistry(registry);
  console.log('[agent-registry] Initialized 15 default agents');
}
