import { nameHueStyle } from '@/lib/agentColors';
import { ChevronDown, ChevronUp, PanelLeftClose, PanelLeftOpen, RotateCcw, Square } from 'lucide-react';
import type { ProcessingStage } from '@/contexts/ChatContext';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { Pane } from '@/components/ui/Pane';
import { formatClock, runStateLabel } from '../utils';
import { useModelEffort } from './useModelEffort';

interface ChatHeaderProps {
  onReset?: () => void;
  onAbort: () => void;
  isGenerating: boolean;
  /** Current session or agent display name, shown at the head of the row. */
  agentName?: string;
  /** Identity hue of the agent family; shows in the run-state pane while idle. */
  agentHue?: string;
  /** What the agent is doing while it generates. */
  processingStage?: ProcessingStage;
  /** Description of the tool currently running, if any. */
  currentToolDescription?: string | null;
  /** Elapsed time of the current run in milliseconds. */
  elapsedMs?: number;
  /** File explorer toggle button shown on smaller layouts. */
  onToggleFileBrowser?: () => void;
  /** Whether the file explorer is currently collapsed. */
  isFileBrowserCollapsed?: boolean;
  /** Mobile top bar toggle handler. */
  onToggleMobileTopBar?: () => void;
  /** Whether the mobile top bar is currently hidden. */
  isMobileTopBarHidden?: boolean;
}

/** Compact outline button used for Stop and Reset in the session header. */
const headerButtonClass =
  'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[3px] border border-border bg-transparent px-2.5 text-[0.8rem] font-medium text-foreground transition-colors duration-[120ms] hover:bg-raised sm:min-h-[1.467rem] sm:px-2';

/** Flat select trigger: sentence-case text on a raised plate with no drawn border, 22px on desktop. */
const selectTriggerClass =
  'rounded-[3px] border-transparent bg-raised px-2 py-0 font-sans text-[0.8rem] text-foreground sm:min-h-[1.467rem] sm:px-2 sm:py-0 sm:text-[0.8rem]';

/**
 * Session header: one row naming the agent, its model and effort, and what it
 * is doing right now. A lit live pane and blue text while the agent works; a
 * dark pane and "Idle" otherwise.
 *
 * Model and effort state management is delegated to useModelEffort();
 * this component is purely presentational plus event wiring.
 */
export function ChatHeader({
  onReset,
  onAbort,
  isGenerating,
  agentName = 'Agent',
  agentHue,
  processingStage = null,
  currentToolDescription = null,
  elapsedMs = 0,
  onToggleFileBrowser,
  isFileBrowserCollapsed = true,
  onToggleMobileTopBar,
  isMobileTopBarHidden = false,
}: ChatHeaderProps) {
  const {
    modelOptions,
    effortOptions,
    selectedModel,
    selectedEffort,
    selectedEffortLabel,
    handleModelChange,
    handleEffortChange,
    controlsDisabled,
    uiError,
  } = useModelEffort();

  const modelSelectorDisabled = controlsDisabled || modelOptions.length === 0;
  const visibleModelOptions = modelOptions.length > 0
    ? modelOptions
    : [{ value: '', label: 'No configured models' }];

  const showToolDescription = isGenerating && processingStage === 'tool_use' && Boolean(currentToolDescription);

  return (
    <div
      className={`nerve-chat-header flex min-h-[var(--row-unit)] shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-border py-0 pl-2 pr-1 max-sm:py-1 sm:pl-3 ${agentHue ? 'room-hued' : ''}`}
      style={agentHue ? ({ '--room-hue': agentHue } as React.CSSProperties) : undefined}
    >
      {/* Mobile chrome controls */}
      {onToggleMobileTopBar ? (
        <div className="flex size-11 shrink-0 flex-col overflow-hidden rounded-[3px] border border-border bg-card max-[371px]:size-[38px]">
          <button
            type="button"
            onClick={onToggleMobileTopBar}
            className="flex flex-1 items-center justify-center border-b border-border text-muted-foreground transition-colors duration-[120ms] hover:bg-raised hover:text-foreground"
            title={isMobileTopBarHidden ? 'Show header controls' : 'Hide header controls'}
            aria-label={isMobileTopBarHidden ? 'Show header controls' : 'Hide header controls'}
          >
            {isMobileTopBarHidden ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            type="button"
            onClick={onToggleFileBrowser}
            disabled={!onToggleFileBrowser}
            className="flex flex-1 items-center justify-center text-muted-foreground transition-colors duration-[120ms] hover:bg-raised hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
            title={`${isFileBrowserCollapsed ? 'Open' : 'Close'} file explorer (Ctrl+B)`}
            aria-label={`${isFileBrowserCollapsed ? 'Open' : 'Close'} file explorer`}
          >
            {isFileBrowserCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>
      ) : onToggleFileBrowser && (
        <button
          type="button"
          onClick={onToggleFileBrowser}
          className="shell-icon-button shrink-0"
          title="Open file explorer (Ctrl+B)"
          aria-label="Open file explorer"
        >
          <PanelLeftOpen size={16} />
        </button>
      )}

      <span className={`nerve-nameplate min-w-0 max-w-[7rem] shrink truncate text-foreground sm:max-w-[16rem] ${agentHue ? 'name-hued' : ''}`} style={nameHueStyle(agentHue)} title={agentName}>
        {agentName}
      </span>

      <InlineSelect
        value={selectedModel}
        onChange={handleModelChange}
        ariaLabel="Model"
        disabled={modelSelectorDisabled}
        title={controlsDisabled ? 'Connect to gateway to change model' : uiError || undefined}
        triggerClassName={`max-w-[110px] sm:max-w-[180px] ${selectTriggerClass}`}
        menuClassName="min-w-[180px] sm:min-w-[220px]"
        options={visibleModelOptions}
      />
      <InlineSelect
        value={selectedEffort}
        onChange={handleEffortChange}
        ariaLabel="Effort"
        disabled={controlsDisabled}
        title={controlsDisabled ? 'Connect to gateway to change effort' : undefined}
        triggerClassName={`max-w-[82px] sm:max-w-none ${selectTriggerClass}`}
        displayLabel={selectedEffortLabel}
        options={effortOptions}
      />

      {/* Run state: lit while the agent works, dark when idle */}
      <div
        className="flex h-[1.467rem] min-w-0 flex-1 items-center gap-2 px-1 text-[0.8rem] sm:min-w-[5rem]"
        data-testid="chat-run-state"
        data-state={isGenerating ? 'live' : 'off'}
      >
        <Pane state={isGenerating ? 'live' : 'off'} hue={agentHue} />
        {isGenerating ? (
          <>
            <span className="shrink-0 text-live-text">
              {runStateLabel(processingStage)}{showToolDescription ? ':' : ''}
            </span>
            {showToolDescription && (
              <span className="min-w-0 truncate font-mono text-foreground" title={currentToolDescription ?? undefined}>
                {currentToolDescription}
              </span>
            )}
            <span className="ml-auto shrink-0 font-mono tabular text-live-text">{formatClock(elapsedMs)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Idle</span>
        )}
      </div>

      {uiError && (
        <span
          className="hidden max-w-[220px] shrink-0 items-center gap-1.5 text-[0.8rem] text-destructive md:inline-flex"
          title={uiError}
          role="status"
          aria-live="polite"
        >
          <Pane state="error" size="sm" />
          <span className="truncate">{uiError}</span>
        </span>
      )}
      {isGenerating && (
        <button
          type="button"
          onClick={onAbort}
          aria-label="Stop generating"
          title="Stop generating"
          className={headerButtonClass}
        >
          <Square size={12} aria-hidden="true" />
          <span className="hidden sm:inline">Stop</span>
        </button>
      )}
      {onReset && (
        <button
          type="button"
          onClick={() => onReset()}
          title="Reset session (start fresh)"
          aria-label="Reset session"
          className={headerButtonClass}
        >
          <RotateCcw size={12} aria-hidden="true" />
          <span className="hidden sm:inline">Reset</span>
        </button>
      )}
    </div>
  );
}
