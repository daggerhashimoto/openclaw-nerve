/**
 * Per-Agent Token Tracking API
 *
 * GET /api/tokens/by-agent - Get token usage aggregated by agent
 */

import { Hono } from 'hono';
import { readJSON } from '../lib/files.js';
import { config } from '../lib/config.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgent } from '../lib/agent-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const app = new Hono();

interface TokenEntry {
  sessionKey: string;
  source: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  timestamp: number;
  agentName?: string;
}

interface AgentTokenSummary {
  agent: string;
  department: string;
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  sessionCount: number;
  lastActivity: number;
}

/**
 * Extract agent name from session key
 * Session keys are typically formatted as: agentname-timestamp-sequence
 */
function extractAgentName(sessionKey: string): string {
  // Try to extract agent name from session key
  const parts = sessionKey.split('-');
  if (parts.length > 0) {
    const potentialName = parts[0].toUpperCase();
    // Common agent names
    const knownAgents = ['JARVIS', 'ATLAS', 'TRENDY', 'CODEX', 'SENTINEL', 'SCRIBE', 'WRITER', 'PIXEL', 'NOVA', 'VIBE', 'CLIP', 'SAGE', 'CLOSER', 'ORACLE'];
    if (knownAgents.includes(potentialName)) {
      return potentialName;
    }
  }
  return 'UNKNOWN';
}

/**
 * GET /api/tokens/by-agent - Get token usage by agent
 */
app.get('/api/tokens/by-agent', rateLimitGeneral, async (c) => {
  try {
    // Read token usage file
    const usageFile = config.usageFile;
    const usageData = await readJSON<{
      entries?: TokenEntry[];
      persistent?: {
        totalCost: number;
        totalInput: number;
        totalOutput: number;
        lastUpdated: string;
      };
      updatedAt?: number;
    }>(usageFile, { entries: [], updatedAt: Date.now() });

    const entries = usageData.entries || [];
    
    // Aggregate by agent
    const agentMap = new Map<string, AgentTokenSummary>();

    for (const entry of entries) {
      // Try to get agent name from entry, or extract from session key
      let agentName = entry.agentName || extractAgentName(entry.sessionKey);
      
      // Get agent info from registry
      const agent = await getAgent(agentName);
      const department = agent?.department || 'Unknown';

      const existing = agentMap.get(agentName) || {
        agent: agentName,
        department,
        totalCost: 0,
        totalInput: 0,
        totalOutput: 0,
        totalCacheRead: 0,
        sessionCount: 0,
        lastActivity: 0,
      };

      existing.totalCost += entry.cost || 0;
      existing.totalInput += entry.inputTokens || 0;
      existing.totalOutput += entry.outputTokens || 0;
      existing.totalCacheRead += entry.cacheReadTokens || 0;
      existing.sessionCount += 1;
      existing.lastActivity = Math.max(existing.lastActivity, entry.timestamp || 0);

      agentMap.set(agentName, existing);
    }

    // Convert map to array and sort by cost
    const agents = Array.from(agentMap.values())
      .sort((a, b) => b.totalCost - a.totalCost);

    // Calculate totals
    const totals = {
      totalCost: agents.reduce((sum, a) => sum + a.totalCost, 0),
      totalInput: agents.reduce((sum, a) => sum + a.totalInput, 0),
      totalOutput: agents.reduce((sum, a) => sum + a.totalOutput, 0),
      totalCacheRead: agents.reduce((sum, a) => sum + a.totalCacheRead, 0),
    };

    return c.json({
      ok: true,
      agents,
      totals,
      updatedAt: usageData.updatedAt,
    });
  } catch (err) {
    console.error('[tokens-by-agent] error:', (err as Error).message);
    return c.json({
      ok: false,
      error: 'Failed to get token usage by agent',
      details: (err as Error).message,
    }, 500);
  }
});

/**
 * GET /api/tokens/by-agent/:name - Get token usage for specific agent
 */
app.get('/api/tokens/by-agent/:name', rateLimitGeneral, async (c) => {
  try {
    const name = c.req.param('name');
    if (!name) {
      return c.json({ ok: false, error: 'Agent name required' }, 400);
    }

    // Read token usage file
    const usageFile = config.usageFile;
    const usageData = await readJSON<{
      entries?: TokenEntry[];
      updatedAt?: number;
    }>(usageFile, { entries: [], updatedAt: Date.now() });

    const entries = usageData.entries || [];
    
    // Filter entries for this agent
    const agentEntries = entries.filter(entry => {
      const entryAgent = entry.agentName || extractAgentName(entry.sessionKey);
      return entryAgent.toUpperCase() === name.toUpperCase();
    });

    // Calculate totals
    const summary: AgentTokenSummary = {
      agent: name,
      department: '',
      totalCost: 0,
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      sessionCount: agentEntries.length,
      lastActivity: 0,
    };

    for (const entry of agentEntries) {
      summary.totalCost += entry.cost || 0;
      summary.totalInput += entry.inputTokens || 0;
      summary.totalOutput += entry.outputTokens || 0;
      summary.totalCacheRead += entry.cacheReadTokens || 0;
      summary.lastActivity = Math.max(summary.lastActivity, entry.timestamp || 0);
    }

    // Get agent info from registry
    const agent = await getAgent(name);
    if (agent) {
      summary.department = agent.department;
    }

    return c.json({
      ok: true,
      agent: summary,
      entries: agentEntries.slice(-100), // Last 100 entries
      updatedAt: usageData.updatedAt,
    });
  } catch (err) {
    console.error('[tokens-by-agent/:name] error:', (err as Error).message);
    return c.json({
      ok: false,
      error: 'Failed to get token usage for agent',
      details: (err as Error).message,
    }, 500);
  }
});

export default app;
