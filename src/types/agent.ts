/**
 * Agent type definitions for the 16-agent system.
 */

/** Agent department classifications */
export type AgentDepartment =
  | 'Executive'
  | 'Research'
  | 'Development'
  | 'Content'
  | 'Sales';

/** Agent connection status */
export type AgentConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error' | 'unknown';

/** Agent health status */
export type AgentHealthStatus = 'online' | 'offline' | 'busy' | 'idle';

/** Agent configuration */
export interface Agent {
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
  /** Gateway port */
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
  lastStatus?: AgentHealthStatus;
}

/** Agent health information */
export interface AgentHealth {
  name: string;
  status: AgentHealthStatus;
  gatewayReachable: boolean;
  lastCheck: number;
  error?: string;
}

/** Agent with connection status */
export interface AgentWithStatus extends Agent {
  connectionStatus: AgentConnectionStatus;
  health?: AgentHealth;
}

/** Agent registry API response */
export interface AgentRegistryResponse {
  ok: boolean;
  agents?: Agent[];
  error?: string;
}

/** Agent health API response */
export interface AgentHealthResponse {
  ok: boolean;
  health?: AgentHealth[];
  error?: string;
}

/** Agent command request */
export interface AgentCommandRequest {
  task: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  deadline?: string;
  model?: string;
}

/** Agent command response */
export interface AgentCommandResponse {
  ok: boolean;
  sessionKey?: string;
  status?: string;
  agent?: string;
  task?: string;
  error?: string;
}

/** Department summary for UI */
export interface DepartmentSummary {
  name: AgentDepartment;
  agents: Agent[];
  totalAgents: number;
  onlineAgents: number;
  totalCostToday?: number;
}
