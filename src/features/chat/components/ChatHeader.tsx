import { Cpu, Gauge, PanelLeftOpen } from 'lucide-react';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { useModelEffort } from './useModelEffort';

interface ChatHeaderProps {
  onReset?: () => void;
  onAbort: () => void;
  isGenerating: boolean;
  /** Explorer expand button shown whenever the file browser is collapsed. */
  onToggleFileBrowser?: () => void;
}

/**
 * COMMS header with model/effort selectors and controls.
 *
 * Model and effort state management is delegated to useModelEffort() —
 * this component is purely presentational + event wiring.
 */
export function ChatHeader({
  onReset,
  onAbort,
  isGenerating,
  onToggleFileBrowser,
}: ChatHeaderProps) {
  const {
    modelOptions,
    effortOptions,
    selectedModel,
    selectedEffort,
    handleModelChange,
    handleEffortChange,
    controlsDisabled,
    uiError,
  } = useModelEffort();

  return (
    <div className="panel-header items-center gap-2 overflow-x-auto border-l-[3px] border-l-primary/70 px-2.5 py-2 whitespace-nowrap sm:gap-2.5 sm:px-3 sm:py-3">
      {/* Explorer expand button */}
      {onToggleFileBrowser && (
        <button
          onClick={onToggleFileBrowser}
          className="shell-icon-button size-11 shrink-0 px-0 sm:size-10"
          title="Open file explorer (Ctrl+B)"
          aria-label="Open file explorer"
        >
          <PanelLeftOpen size={17} />
        </button>
      )}
      <div className="flex shrink-0 items-center gap-2">
        <span className="cockpit-badge" data-tone="primary">
          <span className="text-[8px]">◆</span>
          Comms
        </span>
      </div>

      {/* Model + Effort selectors on the right */}
      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap sm:gap-2">
        {uiError && (
          <span
            className="hidden max-w-[220px] truncate text-[11px] text-red md:inline"
            title={uiError}
            role="status"
            aria-live="polite"
          >
            ⚠ {uiError}
          </span>
        )}
        <div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1">
          <Cpu size={12} className="hidden shrink-0 text-foreground/70 sm:block" aria-hidden="true" />
          <span className="hidden text-[11px] text-muted-foreground sm:inline">Model</span>
          <InlineSelect
            value={selectedModel}
            onChange={handleModelChange}
            ariaLabel="Model"
            disabled={controlsDisabled}
            title={controlsDisabled ? 'Connect to gateway to change model' : undefined}
            triggerClassName="max-w-[110px] rounded-xl border-border/75 bg-background/65 px-2.5 py-1.5 text-[11px] font-sans text-foreground sm:max-w-[180px] sm:min-h-8 sm:px-2.5 sm:py-1"
            menuClassName="min-w-[180px] rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_50px_rgba(0,0,0,0.28)] sm:min-w-[220px]"
            options={modelOptions}
          />
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1">
          <Gauge size={12} className="hidden shrink-0 text-foreground/70 sm:block" aria-hidden="true" />
          <span className="hidden text-[11px] text-muted-foreground sm:inline">Effort</span>
          <InlineSelect
            value={selectedEffort}
            onChange={handleEffortChange}
            ariaLabel="Effort"
            disabled={controlsDisabled}
            title={controlsDisabled ? 'Connect to gateway to change effort' : undefined}
            triggerClassName="max-w-[82px] rounded-xl border-border/75 bg-background/65 px-2.5 py-1.5 text-[11px] font-sans text-foreground sm:max-w-none sm:min-h-8 sm:px-2.5 sm:py-1"
            menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_50px_rgba(0,0,0,0.28)]"
            options={effortOptions}
          />
        </div>
        {isGenerating && (
          <button
            onClick={onAbort}
            aria-label="Stop generating"
            title="Stop generating"
            className="cockpit-toolbar-button min-h-11 px-3 sm:min-h-9 sm:px-3"
            data-tone="danger"
          >
            <span aria-hidden="true">⏹</span>
            <span className="hidden sm:inline">Stop</span>
          </button>
        )}
        {onReset && (
          <button
            onClick={() => onReset()}
            title="Reset session (start fresh)"
            aria-label="Reset session"
            className="cockpit-toolbar-button min-h-11 px-3 sm:min-h-9 sm:px-3"
            data-tone="danger"
          >
            <span aria-hidden="true">↺</span>
            <span className="hidden sm:inline">Reset</span>
          </button>
        )}
      </div>
    </div>
  );
}
