/**
 * Gateway Connection Pool
 *
 * Manages connections to multiple OpenClaw gateway instances (one per agent).
 * Provides connection pooling, health checking, and request routing.
 * @module
 */

import type { AgentConfig } from './agent-registry.js';
import { getAllAgents, getAgent } from './agent-registry.js';

/** Connection state for a single gateway */
interface GatewayConnection {
  agent: AgentConfig;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastHealthCheck: number;
  healthCheckError?: string;
  retryCount: number;
  nextRetryAt?: number;
}

/** Gateway pool configuration */
interface GatewayPoolConfig {
  /** Health check interval in milliseconds (default: 30s) */
  healthCheckInterval: number;
  /** Connection timeout in milliseconds (default: 5s) */
  connectionTimeout: number;
  /** Max retry attempts before marking as disconnected (default: 3) */
  maxRetries: number;
  /** Retry backoff multiplier (default: 2) */
  retryBackoff: number;
}

const DEFAULT_CONFIG: GatewayPoolConfig = {
  healthCheckInterval: 30_000,
  connectionTimeout: 5_000,
  maxRetries: 3,
  retryBackoff: 2,
};

/**
 * Gateway Connection Pool
 *
 * Maintains connections to all registered agent gateways,
 * performs health checks, and routes requests to the correct gateway.
 */
export class GatewayPool {
  private connections: Map<string, GatewayConnection> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private config: GatewayPoolConfig;
  private running: boolean = false;

  constructor(config: Partial<GatewayPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the gateway pool (begin health checks)
   */
  async start(): Promise<void> {
    this.running = true;
    console.log('[gateway-pool] Starting gateway pool...');

    // Initial population of connections
    await this.refreshConnections();

    // Start health check loop
    this.startHealthChecks();
  }

  /**
   * Stop the gateway pool
   */
  stop(): void {
    this.running = false;
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    console.log('[gateway-pool] Stopped');
  }

  /**
   * Refresh the list of connections from the agent registry
   */
  private async refreshConnections(): Promise<void> {
    const agents = await getAllAgents();
    const agentNames = new Set(agents.map(a => a.name));

    // Add new agents
    for (const agent of agents) {
      if (!this.connections.has(agent.name)) {
        this.connections.set(agent.name, {
          agent,
          status: 'disconnected',
          lastHealthCheck: 0,
          retryCount: 0,
        });
        console.log(`[gateway-pool] Added agent: ${agent.name} (${agent.gatewayUrl})`);
      }
    }

    // Remove unregistered agents
    for (const name of this.connections.keys()) {
      if (!agentNames.has(name)) {
        this.connections.delete(name);
        console.log(`[gateway-pool] Removed agent: ${name}`);
      }
    }
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    const check = async () => {
      if (!this.running) return;

      await this.refreshConnections();

      const now = Date.now();
      const checks: Promise<void>[] = [];

      for (const [name, conn] of this.connections.entries()) {
        // Check if it's time for a health check
        const timeSinceLastCheck = now - conn.lastHealthCheck;
        const isDue = timeSinceLastCheck >= this.config.healthCheckInterval;

        // Check if retry is allowed
        const canRetry = !conn.nextRetryAt || now >= conn.nextRetryAt;

        if (isDue || canRetry) {
          checks.push(this.performHealthCheck(name));
        }
      }

      await Promise.all(checks);
    };

    // Run immediately
    check();

    // Then run on interval
    this.healthCheckTimer = setInterval(check, this.config.healthCheckInterval);
  }

  /**
   * Perform health check on a single gateway
   */
  private async performHealthCheck(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;

    const now = Date.now();
    conn.lastHealthCheck = now;
    conn.status = 'connecting';

    try {
      const headers: Record<string, string> = {};
      if (conn.agent.gatewayToken) {
        headers['Authorization'] = `Bearer ${conn.agent.gatewayToken}`;
      }

      const response = await fetch(`${conn.agent.gatewayUrl}/health`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.config.connectionTimeout),
      });

      if (response.ok) {
        conn.status = 'connected';
        conn.retryCount = 0;
        conn.nextRetryAt = undefined;
        conn.healthCheckError = undefined;
        console.log(`[gateway-pool] ${name} is healthy`);
      } else {
        throw new Error(`Gateway returned ${response.status}`);
      }
    } catch (err) {
      conn.status = 'error';
      conn.healthCheckError = (err as Error).message;
      conn.retryCount++;

      // Calculate next retry time with exponential backoff
      const backoffMs = this.config.connectionTimeout * Math.pow(this.config.retryBackoff, conn.retryCount);
      conn.nextRetryAt = now + backoffMs;

      if (conn.retryCount >= this.config.maxRetries) {
        conn.status = 'disconnected';
        console.warn(`[gateway-pool] ${name} disconnected after ${conn.retryCount} retries`);
      } else {
        console.warn(`[gateway-pool] ${name} health check failed (retry ${conn.retryCount}/${this.config.maxRetries}): ${(err as Error).message}`);
      }
    }
  }

  /**
   * Get connection status for an agent
   */
  getConnectionStatus(name: string): 'connected' | 'disconnected' | 'connecting' | 'error' | 'unknown' {
    const conn = this.connections.get(name);
    return conn?.status || 'unknown';
  }

  /**
   * Get all connection statuses
   */
  getAllConnectionStatuses(): Map<string, 'connected' | 'disconnected' | 'connecting' | 'error'> {
    const result = new Map<string, 'connected' | 'disconnected' | 'connecting' | 'error'>();
    for (const [name, conn] of this.connections.entries()) {
      result.set(name, conn.status);
    }
    return result;
  }

  /**
   * Get an agent's gateway URL
   */
  getGatewayUrl(name: string): string | undefined {
    return this.connections.get(name)?.agent.gatewayUrl;
  }

  /**
   * Get an agent's gateway token
   */
  getGatewayToken(name: string): string | undefined {
    return this.connections.get(name)?.agent.gatewayToken;
  }

  /**
   * Get an agent's configuration
   */
  async getAgentConfig(name: string): Promise<AgentConfig | undefined> {
    return await getAgent(name);
  }

  /**
   * Make a request to an agent's gateway
   */
  async request(
    agentName: string,
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const conn = this.connections.get(agentName);
    if (!conn) {
      throw new Error(`Agent ${agentName} not found in gateway pool`);
    }

    if (conn.status === 'disconnected') {
      throw new Error(`Agent ${agentName} is disconnected`);
    }

    const url = `${conn.agent.gatewayUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    };

    // Add gateway token if available
    if (conn.agent.gatewayToken) {
      headers['Authorization'] = `Bearer ${conn.agent.gatewayToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(this.config.connectionTimeout),
    });

    return response;
  }

  /**
   * POST JSON to an agent's gateway
   */
  async postJson<T = unknown>(
    agentName: string,
    path: string,
    data: unknown,
  ): Promise<T> {
    const response = await this.request(agentName, path, {
      method: 'POST',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gateway returned ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * GET JSON from an agent's gateway
   */
  async getJson<T = unknown>(
    agentName: string,
    path: string,
  ): Promise<T> {
    const response = await this.request(agentName, path, {
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gateway returned ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Check if an agent is available
   */
  isAgentAvailable(name: string): boolean {
    const conn = this.connections.get(name);
    return conn?.status === 'connected' || conn?.status === 'connecting';
  }

  /**
   * Get all available agents
   */
  getAvailableAgents(): string[] {
    const available: string[] = [];
    for (const [name, conn] of this.connections.entries()) {
      if (conn.status === 'connected' || conn.status === 'connecting') {
        available.push(name);
      }
    }
    return available;
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    total: number;
    connected: number;
    disconnected: number;
    error: number;
    connecting: number;
  } {
    let connected = 0, disconnected = 0, error = 0, connecting = 0;

    for (const conn of this.connections.values()) {
      switch (conn.status) {
        case 'connected': connected++; break;
        case 'disconnected': disconnected++; break;
        case 'error': error++; break;
        case 'connecting': connecting++; break;
      }
    }

    return {
      total: this.connections.size,
      connected,
      disconnected,
      error,
      connecting,
    };
  }
}

/**
 * Singleton gateway pool instance
 */
export const gatewayPool = new GatewayPool();
