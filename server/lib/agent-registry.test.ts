/**
 * Tests for Agent Registry Service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readRegistry,
  writeRegistry,
  registerAgent,
  getAgent,
  getAllAgents,
  updateAgent,
  unregisterAgent,
  initializeDefaultAgents,
  getAgentsByDepartment,
} from './agent-registry';

const testRegistry = {
  agents: {},
  updatedAt: Date.now(),
};

describe('Agent Registry', () => {
  beforeEach(async () => {
    // Clear registry before each test
    await writeRegistry(testRegistry);
  });

  afterEach(async () => {
    // Clean up after tests
    await writeRegistry(testRegistry);
  });

  describe('registerAgent', () => {
    it('should register a new agent', async () => {
      const agent = {
        name: 'TEST',
        role: 'Test Agent',
        department: 'Research' as const,
        model: 'test-model',
        gatewayUrl: 'http://127.0.0.1:19999',
        gatewayPort: 19999,
        gatewayToken: 'test-token',
        schedule: 'on-demand',
        enabled: true,
      };

      await registerAgent(agent);
      const retrieved = await getAgent('TEST');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('TEST');
      expect(retrieved?.role).toBe('Test Agent');
    });

    it('should store agent with uppercase key', async () => {
      const agent = {
        name: 'lowercase',
        role: 'Test',
        department: 'Research' as const,
        model: 'test',
        gatewayUrl: 'http://127.0.0.1:19999',
        gatewayPort: 19999,
        gatewayToken: '',
        schedule: 'on-demand',
        enabled: true,
      };

      await registerAgent(agent);
      const retrieved = await getAgent('LOWERCASE');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('lowercase');
    });
  });

  describe('getAgent', () => {
    it('should return undefined for non-existent agent', async () => {
      const agent = await getAgent('NONEXISTENT');
      expect(agent).toBeUndefined();
    });

    it('should find agent by case-insensitive name', async () => {
      const agent = {
        name: 'JARVIS',
        role: 'Chief Strategy Officer',
        department: 'Executive' as const,
        model: 'claude-opus',
        gatewayUrl: 'http://127.0.0.1:18789',
        gatewayPort: 18789,
        gatewayToken: '',
        schedule: 'on-demand',
        enabled: true,
      };

      await registerAgent(agent);

      expect(await getAgent('jarvis')).toBeDefined();
      expect(await getAgent('JARVIS')).toBeDefined();
      expect(await getAgent('Jarvis')).toBeDefined();
    });
  });

  describe('getAllAgents', () => {
    it('should return empty array when no agents registered', async () => {
      const agents = await getAllAgents();
      expect(agents).toEqual([]);
    });

    it('should return all enabled agents', async () => {
      await registerAgent({
        name: 'AGENT1',
        role: 'Test 1',
        department: 'Research' as const,
        model: 'test',
        gatewayUrl: 'http://127.0.0.1:19998',
        gatewayPort: 19998,
        gatewayToken: '',
        schedule: 'on-demand',
        enabled: true,
      });

      await registerAgent({
        name: 'AGENT2',
        role: 'Test 2',
        department: 'Development' as const,
        model: 'test',
        gatewayUrl: 'http://127.0.0.1:19999',
        gatewayPort: 19999,
        gatewayToken: '',
        schedule: 'on-demand',
        enabled: false,
      });

      const agents = await getAllAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('AGENT1');
    });
  });

  describe('updateAgent', () => {
    it('should update existing agent', async () => {
      const agent = {
        name: 'TEST',
        role: 'Original Role',
        department: 'Research' as const,
        model: 'original-model',
        gatewayUrl: 'http://127.0.0.1:19999',
        gatewayPort: 19999,
        gatewayToken: '',
        schedule: 'on-demand',
        enabled: true,
      };

      await registerAgent(agent);
      await updateAgent('TEST', { role: 'Updated Role' });

      const updated = await getAgent('TEST');
      expect(updated?.role).toBe('Updated Role');
      expect(updated?.model).toBe('original-model'); // Unchanged
    });

    it('should throw error for non-existent agent', async () => {
      await expect(updateAgent('NONEXISTENT', { role: 'Test' }))
        .rejects.toThrow('Agent NONEXISTENT not found');
    });
  });

  describe('unregisterAgent', () => {
    it('should remove agent from registry', async () => {
      const agent = {
        name: 'TEMP',
        role: 'Temporary',
        department: 'Research' as const,
        model: 'test',
        gatewayUrl: 'http://127.0.0.1:19999',
        gatewayPort: 19999,
        gatewayToken: '',
        schedule: 'on-demand',
        enabled: true,
      };

      await registerAgent(agent);
      await unregisterAgent('TEMP');

      const retrieved = await getAgent('TEMP');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('initializeDefaultAgents', () => {
    it('should initialize 15 default agents', async () => {
      await initializeDefaultAgents();
      const agents = await getAllAgents();

      expect(agents).toHaveLength(15);
      expect(agents.find(a => a.name === 'JARVIS')).toBeDefined();
      expect(agents.find(a => a.name === 'ATLAS')).toBeDefined();
      expect(agents.find(a => a.name === 'CODEX')).toBeDefined();
      expect(agents.find(a => a.name === 'SECURITY')).toBeDefined();
    });

    it('should not overwrite existing agents', async () => {
      // First initialize defaults
      await initializeDefaultAgents();
      
      // Then add a custom agent
      const customAgent = {
        name: 'CUSTOM',
        role: 'Custom Agent',
        department: 'Research' as const,
        model: 'custom-model',
        gatewayUrl: 'http://127.0.0.1:19999',
        gatewayPort: 19999,
        gatewayToken: '',
        schedule: 'on-demand',
        enabled: true,
      };
      await registerAgent(customAgent);

      const agents = await getAllAgents();
      const custom = await getAgent('CUSTOM');

      expect(custom).toBeDefined();
      expect(agents).toHaveLength(16); // 15 defaults + 1 custom
    });

    it('should initialize all department agents', async () => {
      await initializeDefaultAgents();
      const agents = await getAllAgents();

      // Executive
      expect(agents.find(a => a.department === 'Executive')).toBeDefined();
      
      // Research
      const researchAgents = agents.filter(a => a.department === 'Research');
      expect(researchAgents.length).toBe(2); // ATLAS, TRENDY
      
      // Development
      const devAgents = agents.filter(a => a.department === 'Development');
      expect(devAgents.length).toBe(3); // CODEX, SENTINEL, SECURITY
      
      // Content
      const contentAgents = agents.filter(a => a.department === 'Content');
      expect(contentAgents.length).toBe(6); // SCRIBE, WRITER, PIXEL, NOVA, VIBE, CLIP
      
      // Sales
      const salesAgents = agents.filter(a => a.department === 'Sales');
      expect(salesAgents.length).toBe(2); // SAGE, CLOSER
    });

    it('should have correct cost tiers for each agent', async () => {
      await initializeDefaultAgents();
      
      // Premium tier (Opus)
      const jarvis = await getAgent('JARVIS');
      expect(jarvis?.costInput).toBe(15);
      expect(jarvis?.costOutput).toBe(75);
      
      // Budget tier (GLM-4.7)
      const atlas = await getAgent('ATLAS');
      expect(atlas?.costInput).toBe(0.48);
      expect(atlas?.costOutput).toBe(1.50);
      
      // Coding tier (Codex)
      const codex = await getAgent('CODEX');
      expect(codex?.costInput).toBe(2);
      expect(codex?.costOutput).toBe(8);
      
      // Mid tier (Sonnet)
      const sentinel = await getAgent('SENTINEL');
      expect(sentinel?.costInput).toBe(3);
      expect(sentinel?.costOutput).toBe(15);
    });

    it('should have correct cron schedules', async () => {
      await initializeDefaultAgents();
      
      const atlas = await getAgent('ATLAS');
      expect(atlas?.schedule).toBe('0 * * * *'); // Hourly
      
      const trendy = await getAgent('TRENDY');
      expect(trendy?.schedule).toBe('0 */2 * * *'); // Bi-hourly
      
      const scribe = await getAgent('SCRIBE');
      expect(scribe?.schedule).toBe('0 */3 * * *'); // Tri-hourly
      
      const sentinel = await getAgent('SENTINEL');
      expect(sentinel?.schedule).toBe('0 */2 * * *'); // Bi-hourly
      
      const codex = await getAgent('CODEX');
      expect(codex?.schedule).toBe('0 23 * * *'); // Nightly at 11 PM
      
      const security = await getAgent('SECURITY');
      expect(security?.schedule).toBe('0 */4 * * *'); // Every 4 hours
      
      const jarvis = await getAgent('JARVIS');
      expect(jarvis?.schedule).toBe('on-demand');
    });
  });

  describe('getAgentsByDepartment', () => {
    it('should return agents filtered by department', async () => {
      await initializeDefaultAgents();
      
      const researchAgents = await getAgentsByDepartment('Research');
      expect(researchAgents.length).toBe(2);
      expect(researchAgents.every(a => a.department === 'Research')).toBe(true);
      
      const salesAgents = await getAgentsByDepartment('Sales');
      expect(salesAgents.length).toBe(2);
      expect(salesAgents.every(a => a.department === 'Sales')).toBe(true);
    });

    it('should return empty array for department with no agents', async () => {
      const agents = await getAgentsByDepartment('Research');
      expect(agents).toEqual([]);
    });
  });
});
