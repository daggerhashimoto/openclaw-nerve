/**
 * OrgChart — ElkJS-powered hierarchical org chart
 *
 * Layout: ElkJS computes positions, SVG renders nodes + edges.
 * Horizontal flow: Najef → Neon → Orion → Sarah → David → Marcus
 * Images: /public/org/agents/<agent-id>.png (optional)
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { RefreshCw } from 'lucide-react';
import { useSessionContext } from '@/contexts/SessionContext';
import { NAJEF, NEON, BMAD_TEAMS, ALL_AGENTS, type Agent } from './teams';

const elk = new ELK();

interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const IMAGE_FOLDER = '/org/agents/';

// Hook: subscribe to theme changes by observing .dark class on :root
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains('dark'));
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    // Read immediately
    setIsDark(root.classList.contains('dark'));
    return () => observer.disconnect();
  }, []);
  return isDark;
}

// Read a CSS custom property at render time — re-evaluated on every render
// so it always reflects the current theme without needing to subscribe
function readCssVar(varName: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim() || fallback;
}



type AgentActivityStatus = 'active' | 'recent' | 'idle' | 'offline';

function getAgentStatus(agentId: string, sessions: { sessionKey?: string; key?: string; updatedAt?: number }[]): AgentActivityStatus {
  const session = sessions.find(s => {
    const key = (s.sessionKey || s.key || '').toLowerCase();
    return key.includes(agentId.toLowerCase());
  });
  
  if (!session) return 'offline';
  
  const now = Date.now();
  const updatedAt = session.updatedAt || now;
  const minutesAgo = (now - updatedAt) / (1000 * 60);
  
  if (minutesAgo <= 5) return 'active';
  if (minutesAgo <= 15) return 'recent';
  return 'idle';
}

function getTeamColor(teamId: string): string {
  return BMAD_TEAMS.find(t => t.id === teamId)?.color || '#6b7280';
}

function getLevelBorderColor(agent: Agent): string {
  const teamColor = getTeamColor(agent.team);
  // Level 5 - Founder (Najef)
  if (agent.id === 'najef') {
    return 'var(--color-muted-foreground)';
  }
  // Level 5 - Executive (Neon)
  if (agent.id === 'main') {
    return 'var(--color-info)';
  }
  // Level 5 - Orchestrators (Orion, Gemini)
  if (agent.id === 'orion' || agent.id === 'gemini') {
    return 'var(--color-orange)';
  }
  // Level 3 - Junior/mid: team color at reduced opacity
  if (agent.level < 4) {
    return `color-mix(in srgb, ${teamColor} 70%, transparent)`;
  }
  // Level 4 - Senior members: full team color
  return teamColor;
}

function AgentNode({
  agent,
  x,
  y,
  status,
}: {
  agent: Agent;
  x: number;
  y: number;
  status: AgentActivityStatus;
}) {
  const imgSrc = `${IMAGE_FOLDER}${agent.id}.png`;
  const [imgError, setImgError] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hasImage = !imgError;
  const isDark = useIsDark();

  const borderColor = getLevelBorderColor(agent);

  // All colors via CSS variables — re-read on every render so they stay in sync with theme
  const cardBg = readCssVar('--color-card', '#faf9f7');
  const textPrimary = readCssVar('--color-foreground', '#1e293b');
  const textSecondary = readCssVar('--color-muted-foreground', '#64748b');
  const avatarBg = readCssVar('--color-muted', '#f1f5f9');
  const statusColor = status === 'active'
    ? '#22c55e'  // Green - last 5 min
    : status === 'recent'
      ? '#eab308'  // Yellow - 5-15 min
      : readCssVar('--color-muted-foreground', '#94a3b8');  // Gray - 15+ min
  const baseShadow = '0 1px 4px rgba(0,0,0,0.08)';
  const hoverShadow = '0 4px 12px rgba(0,0,0,0.15)';
  const shadow = hovered
    ? (isDark ? '0 4px 16px rgba(0,0,0,0.5)' : hoverShadow)
    : (isDark ? '0 1px 4px rgba(0,0,0,0.4)' : baseShadow);

  return (
    <foreignObject
      x={x}
      y={y}
      width={NODE_WIDTH}
      height={NODE_HEIGHT}
      style={{ overflow: 'visible' }}
    >
      <div
        xmlns="http://www.w3.org/1999/xhtml"
        style={{
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          borderRadius: 10,
          border: `2px solid ${borderColor}`,
          background: cardBg,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          boxSizing: 'border-box',
          cursor: 'pointer',
          transition: 'transform 150ms ease, box-shadow 150ms ease',
          transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
          boxShadow: shadow,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Avatar - 56x56px */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 10,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            background: avatarBg,
            flexShrink: 0,
          }}
        >
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc}
              alt={agent.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={() => setImgError(true)}
            />
          ) : (
            <span style={{ fontSize: 28 }}>{agent.emoji}</span>
          )}
        </div>

        {/* Name + Role */}
        <div className="flex flex-col justify-center min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: textPrimary,
                lineHeight: 1.2,
              }}
            >
              {agent.name}
            </span>
            {/* Status dot */}
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: statusColor,
                border: '1px solid rgba(0,0,0,0.1)',
                flexShrink: 0,
                animation: status === 'active' ? 'pulse 2s infinite' : 'none',
              }}
            />
          </div>
          <span
            style={{
              fontSize: 10,
              color: textSecondary,
              lineHeight: 1.2,
              whiteSpace: 'normal',
              wordBreak: 'break-word',
            }}
          >
            {agent.role}
          </span>
        </div>
      </div>
    </foreignObject>
  );
}

export function OrgChart() {
  const { sessions } = useSessionContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ nodes: ElkNode[]; edges: ElkEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });

  // Detect theme — used for container bg and edge color
  const isDark = useIsDark();

  const computeLayout = useCallback(async () => {
    setLoading(true);

    // Build ElkJS graph from agent hierarchy
    const elkNodes = ALL_AGENTS.map(agent => ({
      id: agent.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    }));

    // Build edges from reportsTo
    const elkEdges: ElkEdge[] = ALL_AGENTS
      .filter(a => a.reportsTo)
      .map(agent => ({
        id: `${agent.reportsTo}-${agent.id}`,
        sources: [agent.reportsTo!],
        targets: [agent.id],
      }));

    try {
      const result = await elk.layout({
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.spacing.nodeNode': '20',
          'elk.layered.spacing.nodeNodeBetweenLayers': '70',
          'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
          'elk.padding': '[top=100, left=100, bottom=100, right=100]',
        },
        children: elkNodes,
        edges: elkEdges,
      });

      // Compute bounding box
      let maxX = 0, maxY = 0;
      for (const node of result.children || []) {
        if (node.x !== undefined && node.y !== undefined) {
          maxX = Math.max(maxX, node.x + NODE_WIDTH);
          maxY = Math.max(maxY, node.y + NODE_HEIGHT);
        }
      }

      setSvgSize({ width: maxX + 50, height: maxY + 50 });
      setLayout({ nodes: result.children || [], edges: result.edges || [] });
    } catch (err) {
      console.error('[OrgChart] ElkJS layout error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    computeLayout();
  }, [computeLayout]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <RefreshCw size={16} className="animate-spin" />
        <span className="text-xs">Computing layout...</span>
      </div>
    );
  }

  if (!layout) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        Failed to compute layout
      </div>
    );
  }

  const { nodes, edges } = layout;

  // Theme-aware container bg — re-read CSS var on every render
  const bgColor = readCssVar('--color-background', '#f8fafc');
  const edgeColor = readCssVar('--color-border', '#94a3b8');

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-auto"
      style={{ minHeight: '100%', background: bgColor }}
    >
      {/* Pulsing animation for active status */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
      
      <svg
        width={svgSize.width}
        height={svgSize.height}
        style={{ display: 'block', minWidth: '100%', minHeight: '100%' }}
      >
        {/* Render edges as lines with arrows */}
        {edges.map(edge => {
          const sourceNode = nodes.find(n => n.id === edge.sources[0]);
          const targetNode = nodes.find(n => n.id === edge.targets[0]);
          if (!sourceNode || !targetNode) return null;

          // Vertical flow: from bottom of source to top of target
          const sx = (sourceNode.x || 0) + NODE_WIDTH / 2;
          const sy = (sourceNode.y || 0) + NODE_HEIGHT;
          const tx = (targetNode.x || 0) + NODE_WIDTH / 2;
          const ty = targetNode.y || 0;

          const midY = sy + (ty - sy) / 2;

          return (
            <g key={edge.id}>
              {/* Line with bend */}
              <path
                d={`M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`}
                fill="none"
                stroke={edgeColor}
                strokeWidth={2}
              />
              {/* Arrow head pointing down */}
              <polygon
                points={`${tx-5},${ty} ${tx},${ty+8} ${tx+5},${ty}`}
                fill={edgeColor}
              />
            </g>
          );
        })}

        {/* Render agent nodes */}
        {nodes.map(node => {
          const agent = ALL_AGENTS.find(a => a.id === node.id);
          if (!agent) return null;

          const status = getAgentStatus(agent.id, sessions);

          return (
            <AgentNode
              key={agent.id}
              agent={agent}
              x={node.x || 0}
              y={node.y || 0}
              status={status}
            />
          );
        })}
      </svg>
    </div>
  );
}
