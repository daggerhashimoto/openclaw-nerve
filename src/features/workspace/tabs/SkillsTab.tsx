/**
 * SkillsTab — Browse installed skills and their status.
 */

import { useState, useCallback } from 'react';
import { RefreshCw, Circle, ExternalLink, ChevronDown, ChevronRight, Puzzle } from 'lucide-react';
import { useSkills, type Skill, type SkillMissing } from '../hooks/useSkills';

/** Format missing requirements into a human-readable string. */
function formatMissing(missing: SkillMissing): string {
  const parts: string[] = [];
  if (missing.bins?.length) parts.push(`bins: [${missing.bins.join(', ')}]`);
  if (missing.anyBins?.length) parts.push(`anyBins: [${missing.anyBins.join(', ')}]`);
  if (missing.env?.length) parts.push(`env: [${missing.env.join(', ')}]`);
  if (missing.config?.length) parts.push(`config: [${missing.config.join(', ')}]`);
  if (missing.os?.length) parts.push(`os: [${missing.os.join(', ')}]`);
  return parts.join(', ');
}

/** Source badge color. */
function sourceColor(source: string): string {
  switch (source) {
    case 'bundled': return 'bg-purple/20 text-purple';
    case 'workspace': return 'bg-blue/20 text-blue';
    case 'clawhub': return 'bg-green/20 text-green';
    default: return 'bg-muted/30 text-muted-foreground';
  }
}

function SkillRow({ skill }: { skill: Skill }) {
  const [expanded, setExpanded] = useState(false);
  const hasMissing = !skill.eligible && skill.missing && formatMissing(skill.missing);

  const handleExpand = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);

  return (
    <div className="border-b border-border/40">
      <div className="px-3 py-2 flex items-start gap-2">
        {/* Status dot */}
        <div className="flex-shrink-0 mt-1">
          <Circle
            size={8}
            fill={skill.eligible ? 'currentColor' : 'none'}
            className={skill.eligible ? 'text-green' : 'text-muted-foreground'}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {skill.emoji && <span className="text-[11px]">{skill.emoji}</span>}
            <span className="text-[11px] text-foreground leading-tight truncate font-medium">
              {skill.name}
            </span>
            {/* Source badge */}
            <span className={`text-[9px] px-1 py-px rounded-sm leading-tight ${sourceColor(skill.source)}`}>
              {skill.source}
            </span>
          </div>
          {skill.description && (
            <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
              {skill.description}
            </div>
          )}
          {skill.disabled && (
            <div className="text-[10px] text-muted-foreground mt-0.5 italic">Disabled</div>
          )}
          {skill.blockedByAllowlist && (
            <div className="text-[10px] text-muted-foreground mt-0.5 italic">Blocked by allowlist</div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {skill.homepage && (
            <a
              href={skill.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-purple transition-colors focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
              title={`Open ${skill.name} homepage`}
              aria-label={`Open ${skill.name} homepage`}
            >
              <ExternalLink size={10} />
            </a>
          )}
          {hasMissing && (
            <button
              onClick={handleExpand}
              className="bg-transparent border border-transparent text-muted-foreground cursor-pointer p-0.5 focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
              aria-label={expanded ? 'Hide missing requirements' : 'Show missing requirements'}
            >
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded missing requirements */}
      {expanded && hasMissing && (
        <div className="px-3 pb-2 pl-8">
          <div className="text-[10px] text-muted-foreground">
            <span className="text-red/70">Missing:</span>{' '}
            {formatMissing(skill.missing!)}
          </div>
        </div>
      )}
    </div>
  );
}

interface SkillsTabProps {
  agentId: string;
}

/** Workspace tab listing installed skills and flagging missing dependencies. */
export function SkillsTab({ agentId }: SkillsTabProps) {
  const { skills, isLoading, error, refresh } = useSkills(agentId);
  const [showUnavailable, setShowUnavailable] = useState(false);

  const eligibleSkills = skills.filter(s => s.eligible);
  const unavailableSkills = skills.filter(s => !s.eligible);
  const eligibleCount = eligibleSkills.length;
  const totalCount = skills.length;

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Skills count + Refresh row */}
        {!isLoading && skills.length > 0 && (
          <div className="flex items-center border-b border-border/40">
            <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] flex-1">
              <span className="shrink-0 text-muted-foreground">
                <Puzzle size={12} />
              </span>
              <span className="text-muted-foreground">
                {eligibleCount} active
                {unavailableSkills.length > 0 && (
                  <span className="text-muted-foreground/50"> / {totalCount} total</span>
                )}
              </span>
            </div>
            <button
              onClick={refresh}
              disabled={isLoading}
              className="shrink-0 px-2 py-1.5 bg-transparent border-0 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0"
              title="Refresh skills"
              aria-label="Refresh skills"
            >
              <RefreshCw size={10} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}

        {/* Error */}
        <div aria-live="polite" aria-atomic="true">
          {error && (
            <div className="px-3 py-2 text-[10px] text-red bg-red/10">{error}</div>
          )}
        </div>

        {/* Loading skeleton */}
        {isLoading && !skills.length && !error && (
          <div className="space-y-2 py-2">
            <div className="h-10 bg-muted/20 animate-pulse rounded mx-3" />
            <div className="h-10 bg-muted/20 animate-pulse rounded mx-3" />
            <div className="h-10 bg-muted/20 animate-pulse rounded mx-3" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !eligibleSkills.length && !error && (
          <div className="text-muted-foreground px-3 py-8 text-center flex flex-col items-center gap-2">
            <Puzzle size={20} className="text-muted-foreground/50" />
            <span className="text-[11px]">No skills found</span>
          </div>
        )}

        {/* Skill rows — only eligible/ready skills */}
        {eligibleSkills.map(skill => (
          <SkillRow key={skill.name} skill={skill} />
        ))}

        {/* Unavailable skills — collapsible section */}
        {unavailableSkills.length > 0 && (
          <div className="border-t border-border/40 mt-1">
            <button
              onClick={() => setShowUnavailable(prev => !prev)}
              className="w-full flex items-center gap-1.5 px-3 py-2 bg-transparent border-0 cursor-pointer text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
            >
              {showUnavailable ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              <span className="text-[10px] uppercase tracking-wider">
                Unavailable ({unavailableSkills.length})
              </span>
            </button>
            {showUnavailable && (
              <div className="opacity-60">
                {unavailableSkills.map(skill => (
                  <SkillRow key={skill.name} skill={skill} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
