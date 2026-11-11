import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

interface MemoriesSectionProps {
  memories: string;
  isCollapsed: boolean;
  onToggle: () => void;
}

/** Collapsible section showing memories referenced in a message. */
export function MemoriesSection({ memories, isCollapsed, onToggle }: MemoriesSectionProps) {
  return (
    <div className="w-full">
      <Collapsible open={!isCollapsed} onOpenChange={onToggle}>
        <CollapsibleTrigger className="flex min-h-[var(--row-unit)] w-full cursor-pointer items-center gap-2 rounded-sm text-left text-[0.8rem] text-muted-foreground transition-colors duration-[120ms] hover:text-foreground">
          {isCollapsed
            ? <ChevronRight size={14} className="shrink-0" aria-hidden="true" />
            : <ChevronDown size={14} className="shrink-0" aria-hidden="true" />}
          <Brain size={14} className="shrink-0" aria-hidden="true" />
          <span className="flex-1 truncate font-medium">Referenced memories</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mb-1 max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-[3px] border border-border bg-card px-3 py-2 text-[0.8rem] leading-relaxed text-foreground">
            {memories}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
