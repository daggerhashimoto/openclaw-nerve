# Org Chart Feature - Setup & Documentation

## Overview

The Org Chart displays the agent hierarchy in a visual tree diagram. It shows:
- Agent photos (or emoji fallback)
- Agent names and roles
- Activity status (green/yellow/gray dot)
- Reporting relationships with connecting lines

## Activity Status

| Status | Color | Meaning |
|--------|-------|---------|
| Green | `#22c55e` | Active within last 5 minutes |
| Yellow | `#eab308` | Active 5-15 minutes ago |
| Gray | `#94a3b8` | Idle for more than 15 minutes |

## Setup

### 1. Agent Photos (Optional)

Photos are stored in:
```text
Nerve-CerAImic/public/org/agents/
```

**File naming:** `{agent-id}.png`

| Agent | File Name | Agent ID |
|-------|-----------|----------|
| Najef | `najef.png` | najef |
| Neon | `main.png` | main |
| Orion | `orion.png` | orion |
| Sarah | `sarah.png` | sarah |
| David | `david.png` | david |
| Marcus | `marcus.png` | marcus |
| Emma | `emma.png` | emma |
| Jordan | `jordan.png` | jordan |
| Alex | `alex.png` | alex |
| Gemini | `gemini.png` | gemini |
| Susan | `susan.png` | susan |
| Arthur | `arthur.png` | arthur |
| Edgar | `edgar.png` | edgar |
| Oscar | `oscar.png` | oscar |
| Virginia | `virginia.png` | virginia |
| James | `james.png` | james |
| Riley | `riley.png` | riley |

**Note:** Neon uses `main.png` because her agent ID is `main`, not `neon`.

### 2. Hierarchy Configuration

The hierarchy is defined in `teams.ts`:

```typescript
// Location: Nerve-CerAImic/src/features/org/teams.ts

// Example: How an agent reports to another
{
  id: 'marcus',
  name: 'Marcus',
  role: 'Senior Developer',
  team: 'app-dev',
  reportsTo: 'david',  // ← Reports to David
  ...
}
```

**Rules:**
- Top level (Najef): `reportsTo: undefined`
- Everyone else: `reportsTo: 'parent-agent-id'`

### 3. Agent Levels

| Level | Description |
|-------|-------------|
| 5 | Founder (Najef) |
| 5 | Executive (Neon) |
| 5 | Orchestrators (Orion, Gemini) |
| 4 | Senior members |
| 3 | Junior/mid members |

Border colors are assigned based on level and role.

## File Structure

```text
Nerve-CerAImic/
├── public/
│   └── org/
│       └── agents/          # Agent photos
│           ├── najef.png
│           ├── main.png      # Neon
│           ├── orion.png
│           └── ...
└── src/
    └── features/
        └── org/
            ├── OrgChart.tsx  # Main component
            └── teams.ts      # Agent & hierarchy config
```

## Key Files

### `OrgChart.tsx`
Main component. Uses:
- **ElkJS** for tree layout algorithm
- **SVG** for rendering
- **CSS variables** for theme-aware colors
- **MutationObserver** for dark/light theme detection

### `teams.ts`
Configuration file containing:
- `NAJEF` - Founder definition
- `NEON` - Executive OS definition
- `BMAD_TEAMS` - All teams with agents
- `ALL_AGENTS` - Flat list of all agents
- `getAgentById()` - Lookup function
- `getTeamColor()` - Team color helper

## Adding a New Agent

1. **Add photo** to `public/org/agents/{agent-id}.png`
2. **Add to teams.ts** in the appropriate team:

```typescript
{
  id: 'newagent',
  name: 'New Agent',
  role: 'Job Title',
  emoji: '🤖',
  team: 'app-dev',
  teamName: 'App Dev Team',
  level: 3,  // or 4 for senior
  workspacePath: '/home/najef/.openclaw/agents/newagent/',
  reportsTo: 'manager-id',  // Who this agent reports to
  pronouns: 'they/them',
},
```

3. **Restart Vite dev server** to see changes

## Layout Options

The ElkJS layout is configured in `OrgChart.tsx`:

```typescript
const result = await elk.layout({
  layoutOptions: {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',  // TOP→BOTTOM flow
    // 'RIGHT' for LEFT→RIGHT flow
    'elk.spacing.nodeNode': '20',           // Horizontal gap
    'elk.layered.spacing.nodeNodeBetweenLayers': '70',  // Vertical gap
    'elk.padding': '[top=100, left=100, bottom=100, right=100]',
  },
});
```

### Changing Flow Direction

**Vertical (top-to-bottom):**
```typescript
'elk.direction': 'DOWN',
```

**Horizontal (left-to-right):**
```typescript
'elk.direction': 'RIGHT',
```

When switching directions, update the edge rendering coordinates in the SVG path drawing code.

## Theme Support

The chart automatically responds to dark/light theme changes:

- **Light theme**: White cards, dark text
- **Dark theme**: Dark cards (`#10151d`), light text (`#d0c8bc`)

Colors are read from CSS variables on the `:root` element. No hardcoded theme colors in the component.

## Development

```bash
cd Nerve-CerAImic
npm run dev
# Visit http://127.0.0.1:3080
```

Then switch to Org view using the TopBar view mode selector.

## Troubleshooting

### Photos not showing
1. Check file exists in `public/org/agents/`
2. Check filename matches agent ID exactly (lowercase)
3. Check browser console for 404 errors
4. Vite may need restart to serve new files

### Status always gray
1. Check agent is running (has active session)
2. Verify session `updatedAt` timestamp is being set
3. Check browser console for session fetch errors

### Layout looks wrong
1. Verify `reportsTo` chain is correct in `teams.ts`
2. Check ElkJS is computing positions (no layout errors in console)
3. Try adjusting `spacing.nodeNodeBetweenLayers` for tighter/looser spacing
