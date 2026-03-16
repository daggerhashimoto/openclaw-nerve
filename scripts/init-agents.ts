#!/usr/bin/env node

/**
 * Agent Initialization Script
 *
 * Initializes the agent registry with default 16-agent configuration.
 * Run via: npm run init-agents
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_AGENTS_FILE = path.join(PROJECT_ROOT, 'config', 'agents.json');
const DATA_DIR = path.join(PROJECT_ROOT, 'server', 'data');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');

async function initializeAgents() {
  console.log('🔧 Initializing agent registry...\n');

  // Check if config file exists
  if (!fs.existsSync(DEFAULT_AGENTS_FILE)) {
    console.error(`❌ Default agents config not found: ${DEFAULT_AGENTS_FILE}`);
    process.exit(1);
  }

  // Read default agents
  const configData = JSON.parse(fs.readFileSync(DEFAULT_AGENTS_FILE, 'utf-8'));
  const defaultAgents = configData.agents || [];

  if (defaultAgents.length === 0) {
    console.error('❌ No agents found in config file');
    process.exit(1);
  }

  // Create data directory if needed
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`📁 Created data directory: ${DATA_DIR}`);
  }

  // Check if registry already exists
  if (fs.existsSync(AGENTS_FILE)) {
    const existingData = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'));
    if (existingData.agents && Object.keys(existingData.agents).length > 0) {
      console.log('⚠️  Agent registry already exists with agents.');
      console.log('   Delete server/data/agents.json to reinitialize.\n');
      console.log('Current agents:');
      for (const name of Object.keys(existingData.agents)) {
        console.log(`   - ${name}`);
      }
      return;
    }
  }

  // Create registry with default agents
  const registry = {
    agents: {} as Record<string, unknown>,
    updatedAt: Date.now(),
  };

  for (const agent of defaultAgents) {
    registry.agents[agent.name.toUpperCase()] = {
      ...agent,
      lastHealthCheck: 0,
      lastStatus: 'offline' as const,
    };
    console.log(`   ✓ Added ${agent.name} (${agent.department} - ${agent.model})`);
  }

  // Write registry
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(registry, null, 2));
  console.log(`\n✅ Agent registry initialized with ${defaultAgents.length} agents`);
  console.log(`   Registry file: ${AGENTS_FILE}\n`);

  console.log('📋 Agent Summary:');
  console.log('─────────────────────────────────────────────────────');

  const departments = ['Executive', 'Research', 'Development', 'Content', 'Sales'];
  for (const dept of departments) {
    const deptAgents = defaultAgents.filter((a: { department: string }) => a.department === dept);
    console.log(`\n${dept}:`);
    for (const agent of deptAgents) {
      console.log(`   - ${agent.role} (${agent.name}) - ${agent.model}`);
    }
  }

  console.log('\n─────────────────────────────────────────────────────');
  console.log('\n💡 Next steps:');
  console.log('   1. Start the Nerve server: npm run prod');
  console.log('   2. Visit http://localhost:3080');
  console.log('   3. Configure gateway tokens for each agent in Settings');
  console.log('   4. Start OpenClaw gateway instances for each agent\n');
}

// Run initialization
initializeAgents().catch((err) => {
  console.error('❌ Initialization failed:', err);
  process.exit(1);
});
