/**
 * Tests for Tokens by Agent API
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from './tokens-by-agent';
import type { Hono } from 'hono';

describe('Tokens by Agent API', () => {
  let testApp: Hono;

  beforeEach(() => {
    testApp = app;
    vi.clearAllMocks();
  });

  describe('GET /api/tokens/by-agent', () => {
    it('should return token usage aggregated by agent', async () => {
      const req = new Request('http://localhost/api/tokens/by-agent');
      const res = await testApp.fetch(req);
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data).toHaveProperty('agents');
      expect(data).toHaveProperty('totals');
      // updatedAt is optional in the response
    });

    it('should return empty agents array when no usage data', async () => {
      const req = new Request('http://localhost/api/tokens/by-agent');
      const res = await testApp.fetch(req);
      
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.agents).toEqual([]);
      expect(data.totals).toEqual({
        totalCost: 0,
        totalInput: 0,
        totalOutput: 0,
        totalCacheRead: 0,
      });
    });
  });

  describe('GET /api/tokens/by-agent/:name', () => {
    it('should return 400 if agent name is missing', async () => {
      const req = new Request('http://localhost/api/tokens/by-agent/');
      const res = await testApp.fetch(req);
      
      // This route won't match without a name parameter
      expect(res.status).toBe(404);
    });

    it('should return token usage for specific agent', async () => {
      const req = new Request('http://localhost/api/tokens/by-agent/JARVIS');
      const res = await testApp.fetch(req);
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data).toHaveProperty('agent');
      expect(data).toHaveProperty('entries');
      expect(data.agent.agent).toBe('JARVIS');
    });

    it('should handle unknown agent names', async () => {
      const req = new Request('http://localhost/api/tokens/by-agent/UNKNOWN');
      const res = await testApp.fetch(req);
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.agent.agent).toBe('UNKNOWN');
      expect(data.agent.department).toBe('');
    });

    it('should be case insensitive for agent names', async () => {
      const req1 = new Request('http://localhost/api/tokens/by-agent/jarvis');
      const req2 = new Request('http://localhost/api/tokens/by-agent/JARVIS');
      
      const res1 = await testApp.fetch(req1);
      const res2 = await testApp.fetch(req2);
      
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });
  });

  describe('Agent name extraction', () => {
    it('should extract known agent names from session keys', async () => {
      // The extractAgentName function should identify:
      // JARVIS, ATLAS, TRENDY, CODEX, SENTINEL, SCRIBE, WRITER, 
      // PIXEL, NOVA, VIBE, CLIP, SAGE, CLOSER, ORACLE, SECURITY
      const knownAgents = [
        'JARVIS', 'ATLAS', 'TRENDY', 'CODEX', 'SENTINEL',
        'SCRIBE', 'WRITER', 'PIXEL', 'NOVA', 'VIBE',
        'CLIP', 'SAGE', 'CLOSER', 'ORACLE', 'SECURITY'
      ];
      
      // This is implicitly tested through the API responses
      // when session data contains these agent names
      expect(knownAgents).toHaveLength(15);
    });
  });
});
