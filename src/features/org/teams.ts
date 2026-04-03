/**
 * teams.ts — BMAD Team Configuration for Org Chart
 *
 * Defines the agent hierarchy, reporting lines, and team structure.
 * Images go in: /public/org/agents/<agent-id>.png
 *
 * Future: pull agents from OpenClaw sessions + admin panel.
 */

export interface Agent {
  id: string;
  name: string;
  role: string;
  emoji: string;
  team: string;
  teamName: string;
  level: number;
  workspacePath: string;
  reportsTo?: string;
  pronouns?: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  color: string;
  agents: Agent[];
}

// Najef (Founder/Owner) — top of chart, not an active agent
export const NAJEF: Agent = {
  id: 'najef',
  name: 'Najef',
  role: 'Founder & Owner',
  emoji: '👤',
  team: 'executive',
  teamName: 'Executive',
  level: 5,
  workspacePath: '',
};

// Neon (Executive OS)
export const NEON: Agent = {
  id: 'main',
  name: 'Neon',
  role: 'Executive OS',
  emoji: '👩‍💼',
  team: 'executive',
  teamName: 'Executive',
  level: 5,
  workspacePath: '/home/najef/.openclaw/agents/main/',
  reportsTo: 'najef',
  pronouns: 'she/her',
};

export const BMAD_TEAMS: Team[] = [
  {
    id: 'app-dev',
    name: 'App Dev Team',
    description: 'Building Command Center and internal tools',
    color: '#FF9500',
    agents: [
      {
        id: 'orion',
        name: 'Orion',
        role: 'App Dev Team Orchestrator',
        emoji: '👩‍🚀',
        team: 'app-dev',
        teamName: 'App Dev Team',
        level: 5,
        workspacePath: '/home/najef/.openclaw/agents/orion/',
        reportsTo: 'main',
        pronouns: 'she/her',
      },
      {
        id: 'sarah',
        name: 'Sarah',
        role: 'Requirements Analyst',
        emoji: '👩‍💻',
        team: 'app-dev',
        teamName: 'App Dev Team',
        level: 4,
        workspacePath: '/home/najef/.openclaw/agents/sarah/',
        reportsTo: 'orion',
        pronouns: 'she/her',
      },
      {
        id: 'david',
        name: 'David',
        role: 'Technical Architect',
        emoji: '👨‍💻',
        team: 'app-dev',
        teamName: 'App Dev Team',
        level: 5,
        workspacePath: '/home/najef/.openclaw/agents/david/',
        reportsTo: 'orion',
        pronouns: 'he/him',
      },
      {
        id: 'marcus',
        name: 'Marcus',
        role: 'Senior Developer',
        emoji: '👨‍💻',
        team: 'app-dev',
        teamName: 'App Dev Team',
        level: 4,
        workspacePath: '/home/najef/.openclaw/agents/marcus/',
        reportsTo: 'david',
        pronouns: 'he/him',
      },
      {
        id: 'emma',
        name: 'Emma',
        role: 'UI/UX Designer',
        emoji: '👩‍🎨',
        team: 'app-dev',
        teamName: 'App Dev Team',
        level: 3,
        workspacePath: '/home/najef/.openclaw/agents/emma/',
        reportsTo: 'david',
        pronouns: 'she/her',
      },
      {
        id: 'jordan',
        name: 'Jordan',
        role: 'QA Tester',
        emoji: '👨‍🔬',
        team: 'app-dev',
        teamName: 'App Dev Team',
        level: 3,
        workspacePath: '/home/najef/.openclaw/agents/jordan/',
        reportsTo: 'david',
        pronouns: 'he/him',
      },
      {
        id: 'alex',
        name: 'Alex',
        role: 'DevOps Engineer',
        emoji: '👨‍🔧',
        team: 'app-dev',
        teamName: 'App Dev Team',
        level: 4,
        workspacePath: '/home/najef/.openclaw/agents/alex/',
        reportsTo: 'david',
        pronouns: 'he/him',
      },
    ],
  },
  {
    id: 'article',
    name: 'Article Team',
    description: 'Content creation and research',
    color: '#8B5CF6',
    agents: [
      {
        id: 'gemini',
        name: 'Gemini',
        role: 'Article Team Orchestrator',
        emoji: '✨',
        team: 'article',
        teamName: 'Article Team',
        level: 5,
        workspacePath: '/home/najef/.openclaw/agents/gemini/',
        reportsTo: 'main',
        pronouns: 'she/her',
      },
      {
        id: 'susan',
        name: 'Susan',
        role: 'Strategic Analyst',
        emoji: '👩‍💼',
        team: 'article',
        teamName: 'Article Team',
        level: 4,
        workspacePath: '/home/najef/.openclaw/agents/susan/',
        reportsTo: 'gemini',
        pronouns: 'she/her',
      },
      {
        id: 'arthur',
        name: 'Arthur',
        role: 'Content Lead',
        emoji: '👨‍💼',
        team: 'article',
        teamName: 'Article Team',
        level: 4,
        workspacePath: '/home/najef/.openclaw/agents/arthur/',
        reportsTo: 'gemini',
        pronouns: 'he/him',
      },
      {
        id: 'edgar',
        name: 'Edgar',
        role: 'Researcher',
        emoji: '👨‍🏫',
        team: 'article',
        teamName: 'Article Team',
        level: 4,
        workspacePath: '/home/najef/.openclaw/agents/edgar/',
        reportsTo: 'gemini',
        pronouns: 'he/him',
      },
      {
        id: 'oscar',
        name: 'Oscar',
        role: 'Writer',
        emoji: '👨‍💼',
        team: 'article',
        teamName: 'Article Team',
        level: 4,
        workspacePath: '/home/najef/.openclaw/agents/oscar/',
        reportsTo: 'gemini',
        pronouns: 'he/him',
      },
      {
        id: 'virginia',
        name: 'Virginia',
        role: 'Editor',
        emoji: '👩‍🏫',
        team: 'article',
        teamName: 'Article Team',
        level: 3,
        workspacePath: '/home/najef/.openclaw/agents/virginia/',
        reportsTo: 'gemini',
        pronouns: 'she/her',
      },
      {
        id: 'james',
        name: 'James',
        role: 'Fact Checker',
        emoji: '👨‍⚖️',
        team: 'article',
        teamName: 'Article Team',
        level: 4,
        workspacePath: '/home/najef/.openclaw/agents/james/',
        reportsTo: 'gemini',
        pronouns: 'he/him',
      },
    ],
  },
  {
    id: 'support',
    name: 'Support Team',
    description: 'Product management and coordination',
    color: '#10B981',
    agents: [
      {
        id: 'riley',
        name: 'Riley',
        role: 'Product Manager',
        emoji: '👨‍💼',
        team: 'support',
        teamName: 'Support Team',
        level: 4,
        workspacePath: '/home/najef/.openclaw/agents/riley/',
        reportsTo: 'main',
        pronouns: 'he/him',
      },
    ],
  },
];

// All agents including exec
export const ALL_AGENTS = [NAJEF, NEON, ...BMAD_TEAMS.flatMap(t => t.agents)];

export function getAgentById(id: string): Agent | undefined {
  return ALL_AGENTS.find(a => a.id === id);
}

export function getTeamColor(teamId: string): string {
  return BMAD_TEAMS.find(t => t.id === teamId)?.color || '#6B7280';
}
