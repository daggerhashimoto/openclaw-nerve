/**
 * SkillsTab: browse installed skills and their status.
 */

import { useState, useCallback } from 'react';
import { RefreshCw, ExternalLink, ChevronDown, ChevronRight, Puzzle } from 'lucide-react';
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

function SkillRow({ skill }: { skill: Skill }) {
  const [expanded, setExpanded] = useState(false);
  const hasMissing = !skill.eligible && skill.missing && formatMissing(skill.missing);

  const handleExpand = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);

  const ghostAction =
    'grid size-6 shrink-0 place-items-center rounded-[3px] text-muted-foreground transition-colors duration-[120ms] hover:bg-raised hover:text-foreground';

  return (
    <div className="pb-1">
      <div className="flex min-h-[var(--row-unit)] items-center gap-2 pl-3 pr-1.5">
        <span className="min-w-0 flex-1 truncate text-[0.867rem] text-foreground">
          {skill.name}
        </span>
        <span className="shrink-0 text-[0.8rem] text-muted-foreground">
          {skill.source}
        </span>
        {skill.homepage && (
          <a
            href={skill.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className={ghostAction}
            title={`Open ${skill.name} homepage`}
            aria-label={`Open ${skill.name} homepage`}
          >
            <ExternalLink size={14} />
          </a>
        )}
        {hasMissing && (
          <button
            onClick={handleExpand}
            className={`${ghostAction} cursor-pointer`}
            aria-label={expanded ? 'Hide missing requirements' : 'Show missing requirements'}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>

      <div className="pl-3 pr-3 text-[0.8rem] leading-snug text-muted-foreground">
        {skill.description && (
          <div className="line-clamp-2">
            {skill.description}
          </div>
        )}
        {skill.disabled && (
          <div className="mt-0.5">Disabled</div>
        )}
        {skill.blockedByAllowlist && (
          <div className="mt-0.5">Blocked by allowlist</div>
        )}
        {/* Expanded missing requirements */}
        {expanded && hasMissing && (
          <div className="mt-1">
            <span className="text-foreground">Missing:</span>{' '}
            <span className="font-mono">{formatMissing(skill.missing!)}</span>
          </div>
        )}
      </div>
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
          <div className="flex min-h-[var(--row-unit)] items-center gap-2 border-b border-border pl-3 pr-1">
            <Puzzle size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[0.8rem] text-muted-foreground">
              <span className="font-mono tabular">{eligibleCount}</span> active
              {unavailableSkills.length > 0 && (
                <> of <span className="font-mono tabular">{totalCount}</span> total</>
              )}
            </span>
            <button
              onClick={refresh}
              disabled={isLoading}
              className="shell-icon-button shrink-0 cursor-pointer disabled:opacity-50"
              title="Refresh skills"
              aria-label="Refresh skills"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}

        {/* Error */}
        <div aria-live="polite" aria-atomic="true">
          {error && (
            <div className="border-b border-border bg-destructive/10 px-3 py-2 text-[0.8rem] text-destructive">{error}</div>
          )}
        </div>

        {/* Loading */}
        {isLoading && !skills.length && !error && (
          <div className="flex min-h-[var(--row-unit)] items-center px-3 text-[0.8rem] text-muted-foreground">
            Loading skills…
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !eligibleSkills.length && !error && (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-muted-foreground">
            <Puzzle size={16} aria-hidden="true" />
            <span className="text-[0.8rem]">No skills found</span>
          </div>
        )}

        {/* Skill rows: only eligible/ready skills */}
        {eligibleSkills.map(skill => (
          <SkillRow key={skill.name} skill={skill} />
        ))}

        {/* Unavailable skills: collapsible section */}
        {unavailableSkills.length > 0 && (
          <div className="mt-1 border-t border-border">
            <button
              onClick={() => setShowUnavailable(prev => !prev)}
              className="flex min-h-[var(--row-unit)] w-full cursor-pointer items-center gap-2 border-0 bg-transparent pl-3 pr-3 text-[0.867rem] text-foreground transition-colors duration-[120ms] hover:bg-raised"
            >
              {showUnavailable
                ? <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                : <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate text-left">Unavailable</span>
              <span className="shrink-0 font-mono text-[0.8rem] text-muted-foreground tabular">{unavailableSkills.length}</span>
            </button>
            {showUnavailable && (
              <div>
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
