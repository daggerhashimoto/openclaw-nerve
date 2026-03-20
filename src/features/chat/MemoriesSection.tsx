import { Brain, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Card, CardContent } from '@/components/ui/card';

interface MemoriesSectionProps {
  memories: string;
  isCollapsed: boolean;
  onToggle: () => void;
}

/** Collapsible section showing memories referenced in a message. */
export function MemoriesSection({ memories, isCollapsed, onToggle }: MemoriesSectionProps) {
  return (
    <div className="w-full mx-4 my-1 max-w-[calc(100%-2rem)]">
      <Collapsible open={!isCollapsed} onOpenChange={onToggle}>
        <Card className="overflow-hidden rounded-2xl border-border/50 bg-card/40 py-0 shadow-none">
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors cursor-pointer hover:bg-primary/[0.04]">
            <ChevronRight size={12} className={`text-muted-foreground shrink-0 transition-transform duration-200 ${!isCollapsed ? 'rotate-90' : ''}`} />
            <Brain size={12} className="shrink-0 text-primary/80" />
            <span className="flex-1 truncate text-[0.733rem] font-medium text-muted-foreground">Referenced memories</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="border-t border-border/40 bg-background/32 px-3.5 py-3">
              <div className="max-h-[200px] overflow-y-auto whitespace-pre-wrap text-[0.8rem] leading-6 text-foreground/74">
                {memories}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
