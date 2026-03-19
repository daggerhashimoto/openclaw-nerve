import path from 'node:path';
import { config } from './config.js';

export interface AgentWorkspace {
  agentId: string;
  workspaceRoot: string;
  memoryPath: string;
  memoryDir: string;
}

const AGENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export class InvalidAgentIdError extends Error {
  constructor(agentId: string) {
    super(`Invalid agent id: ${agentId}`);
    this.name = 'InvalidAgentIdError';
  }
}

export function normalizeAgentId(agentId?: string): string {
  const normalized = (agentId || '').trim();
  if (!normalized) return 'main';
  if (normalized === 'main') return 'main';
  if (!AGENT_ID_PATTERN.test(normalized)) {
    throw new InvalidAgentIdError(normalized);
  }
  return normalized;
}

export function resolveAgentWorkspace(agentId?: string): AgentWorkspace {
  const normalizedAgentId = normalizeAgentId(agentId);

  if (normalizedAgentId === 'main') {
    const workspaceRoot = path.dirname(config.memoryPath);
    return {
      agentId: 'main',
      workspaceRoot,
      memoryPath: config.memoryPath,
      memoryDir: config.memoryDir || path.join(workspaceRoot, 'memory'),
    };
  }

  const workspaceRoot = path.join(config.home, '.openclaw', `workspace-${normalizedAgentId}`);
  return {
    agentId: normalizedAgentId,
    workspaceRoot,
    memoryPath: path.join(workspaceRoot, 'MEMORY.md'),
    memoryDir: path.join(workspaceRoot, 'memory'),
  };
}
