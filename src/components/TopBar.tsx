import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import {
  Activity,
  BarChart3,
  Settings,
  Radio,
  Users,
  Brain,
} from "lucide-react";
import type { ViewMode } from "@/features/command-palette/commands";
import type { AgentLogEntry, EventEntry, TokenData } from "@/types";
import { Pane } from "@/components/ui/Pane";
import { fleetWords, type FleetCounts, type PaneState } from "@/lib/paneState";

const AgentLog = lazy(() =>
  import("@/features/activity/AgentLog").then((m) => ({ default: m.AgentLog })),
);
const EventLog = lazy(() =>
  import("@/features/activity/EventLog").then((m) => ({ default: m.EventLog })),
);
const TokenUsage = lazy(() =>
  import("@/features/dashboard/TokenUsage").then((m) => ({
    default: m.TokenUsage,
  })),
);

/** Identifies which dropdown panel is currently open, or `null` for none. */
type PanelId =
  | "agent-log"
  | "usage"
  | "events"
  | "sessions"
  | "workspace"
  | null;

type PanelConfig = {
  boxClass: string;
  heightClass: string;
  contentClass: string;
};

const PANEL_CONFIG: Record<Exclude<PanelId, null> | "default", PanelConfig> = {
  sessions: {
    boxClass: "w-[440px] max-w-[calc(100vw-1.067rem)]",
    heightClass: "max-h-[70vh] opacity-100",
    contentClass: "max-h-[65vh] overflow-y-auto",
  },
  workspace: {
    boxClass: "w-[600px] max-w-[calc(100vw-1.067rem)]",
    heightClass: "max-h-[75vh] opacity-100",
    contentClass: "h-[70vh] max-h-[70vh] overflow-hidden",
  },
  "agent-log": {
    boxClass: "w-[480px] max-w-[calc(100vw-1.067rem)]",
    heightClass: "max-h-[400px] opacity-100",
    contentClass: "max-h-[400px] overflow-y-auto",
  },
  usage: {
    boxClass: "w-[480px] max-w-[calc(100vw-1.067rem)]",
    heightClass: "max-h-[400px] opacity-100",
    contentClass: "max-h-[400px] overflow-y-auto",
  },
  events: {
    boxClass: "w-[480px] max-w-[calc(100vw-1.067rem)]",
    heightClass: "max-h-[400px] opacity-100",
    contentClass: "max-h-[400px] overflow-y-auto",
  },
  default: {
    boxClass: "w-[480px] max-w-[calc(100vw-1.067rem)]",
    heightClass: "max-h-[400px] opacity-100",
    contentClass: "max-h-[400px] overflow-y-auto",
  },
};

/** Props for {@link TopBar}. */
interface TopBarProps {
  /** Callback to open the settings modal. */
  onSettings: () => void;
  /** Agent log entries rendered in the dropdown log panel. */
  agentLogEntries: AgentLogEntry[];
  /** Token usage data for the usage panel (null while loading). */
  tokenData: TokenData | null;
  /** Whether the agent-log icon should pulse green to indicate recent activity. */
  logGlow: boolean;
  /** Event log entries for the events panel. */
  eventEntries: EventEntry[];
  /** Whether the Events button/panel should be shown (feature flag). */
  eventsVisible: boolean;
  /** Whether the Log button/panel should be shown (feature flag). */
  logVisible: boolean;
  /** Show compact-layout panel launchers (Sessions/Workspace). */
  mobilePanelButtonsVisible?: boolean;
  /** Renderable Sessions panel content (compact mode). */
  sessionsPanel?: ReactNode;
  /** Renderable Workspace panel content (compact mode). */
  workspacePanel?: ReactNode;
  /** Current view mode (chat or kanban). */
  viewMode?: ViewMode;
  /** Callback to change the view mode. */
  onViewModeChange?: (mode: ViewMode) => void;
  /** Whether the Tasks/Kanban view toggle should be shown. */
  showKanbanView?: boolean;
  /**
   * Freeze non-essential animated chrome for lower idle repaint cost.
   * The bar no longer carries animated chrome, so this is accepted and ignored.
   */
  performanceMode?: boolean;
  /** The fleet in one pane beside the wordmark: live, waiting on you, or off. */
  activity?: PaneState;
  /** The fleet in numbers, printed in words beside the wordmark. */
  fleet?: FleetCounts;
}

const BRAND_PANE_LABEL: Record<PaneState, string | undefined> = {
  live: "Agents working",
  operator: "Waiting on you",
  error: "An agent failed",
  off: undefined,
};

/**
 * Top navigation bar for the Nerve cockpit.
 *
 * Displays the Nerve wordmark, and provides toggle buttons for the
 * Agent Log, Events, Token Usage, and (in compact mode) Sessions +
 * Workspace panels.
 */
export function TopBar({
  onSettings,
  agentLogEntries,
  tokenData,
  logGlow,
  eventEntries,
  eventsVisible,
  logVisible,
  mobilePanelButtonsVisible = false,
  sessionsPanel,
  workspacePanel,
  viewMode = "chat",
  onViewModeChange,
  showKanbanView = true,
  activity = "off",
  fleet,
}: TopBarProps) {
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);

  const togglePanel = useCallback((panel: PanelId) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  const isPanelAvailable = useCallback(
    (panel: PanelId) => {
      if (!panel) return true;
      if (panel === "events") return eventsVisible;
      if (panel === "agent-log") return logVisible;
      if (panel === "sessions")
        return mobilePanelButtonsVisible && Boolean(sessionsPanel);
      if (panel === "workspace")
        return mobilePanelButtonsVisible && Boolean(workspacePanel);
      return true;
    },
    [
      eventsVisible,
      logVisible,
      mobilePanelButtonsVisible,
      sessionsPanel,
      workspacePanel,
    ],
  );

  const visiblePanel = useMemo<PanelId>(() => {
    if (!activePanel) return null;
    return isPanelAvailable(activePanel) ? activePanel : null;
  }, [activePanel, isPanelAvailable]);

  // Clear stale panel state asynchronously when panel availability changes.
  useEffect(() => {
    if (!activePanel || visiblePanel) return;
    const timer = window.setTimeout(() => setActivePanel(null), 0);
    return () => window.clearTimeout(timer);
  }, [activePanel, visiblePanel]);

  // Click outside to close
  useEffect(() => {
    if (!visiblePanel) return;
    function handleClick(e: MouseEvent) {
      const targetNode = e.target as Node;
      if (
        panelRef.current?.contains(targetNode) ||
        buttonsRef.current?.contains(targetNode)
      )
        return;

      const targetElement = e.target instanceof Element ? e.target : null;
      // Keep topbar panel open while interacting with modal/portal content
      // launched from inside the panel (e.g., Spawn Agent, Add Memory dialogs).
      if (
        targetElement?.closest(
          '[data-slot="dialog-content"], [data-slot="dialog-overlay"], [role="dialog"], [data-radix-popper-content-wrapper]',
        )
      ) {
        return;
      }

      setActivePanel(null);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [visiblePanel]);

  // Escape to close
  useEffect(() => {
    if (!visiblePanel) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActivePanel(null);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [visiblePanel]);

  const totalCost = useMemo(() => {
    if (!tokenData) return null;
    const cost = tokenData.persistent?.totalCost ?? tokenData.totalCost ?? 0;
    return "$" + cost.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [tokenData]);

  const panelConfig = useMemo(() => {
    if (!visiblePanel) return PANEL_CONFIG.default;
    return PANEL_CONFIG[visiblePanel] ?? PANEL_CONFIG.default;
  }, [visiblePanel]);

  const panelBoxClass = panelConfig.boxClass;
  const panelHeightClass = visiblePanel
    ? panelConfig.heightClass
    : "max-h-0 opacity-0 pointer-events-none";
  const panelContentClass = panelConfig.contentClass;

  const buttonBase = "shell-icon-button px-2 max-[371px]:gap-0.5 max-[371px]:px-1.5";
  const countClass = "hidden min-w-4 items-center justify-center rounded-[2px] bg-raised px-1 font-mono text-[0.733rem] leading-4 tabular text-muted-foreground md:inline-flex";

  return (
    <div className="relative z-40 shrink-0">
      <header className="topbar-mobile-compact flex min-h-[2.933rem] flex-wrap items-center gap-x-1.5 border-b border-border bg-background pl-4 pr-2 max-[371px]:pl-3 max-[371px]:pr-1 sm:h-[2.933rem] sm:flex-nowrap">
        <span className="nerve-wordmark mr-2 shrink-0">
          <span>Nerve</span>
          {/* The fleet in one pane: blue while any agent works, cantaloupe when work waits on you */}
          <Pane
            state={activity}
            className="nerve-brand-pane"
            label={BRAND_PANE_LABEL[activity]}
          />
        </span>
        {/* The fleet in words: quiet when all is idle, lit text when something works or waits */}
        {fleet && fleet.total > 0 && (
          <span
            className={`nerve-fleet-words mr-3 hidden md:inline-flex ${fleet.running > 0 ? "text-live-text" : fleet.waiting > 0 ? "text-operator-text" : ""}`}
            data-testid="fleet-words"
          >
            {fleetWords(fleet)}
          </span>
        )}
        {/* View mode toggle */}
        {onViewModeChange && (
          <div className="seg-track order-3 flex w-full items-center sm:order-none sm:w-auto">
            <button
              onClick={() => onViewModeChange("chat")}
              title="Chat view"
              aria-label="Switch to chat view"
              aria-pressed={viewMode === "chat"}
              data-active={viewMode === "chat"}
              style={viewMode === "chat" ? { viewTransitionName: "seg-active" } : undefined}
              className="shell-chip flex-1 sm:flex-none"
            >
              Chat
            </button>
            {showKanbanView && (
              <button
                onClick={() => onViewModeChange("kanban")}
                title="Tasks view"
                aria-label="Switch to tasks view"
                aria-pressed={viewMode === "kanban"}
                data-active={viewMode === "kanban"}
                style={viewMode === "kanban" ? { viewTransitionName: "seg-active" } : undefined}
                className="shell-chip flex-1 sm:flex-none"
              >
                Tasks
              </button>
            )}
          </div>
        )}
        <div ref={buttonsRef} className="ml-auto flex min-w-0 max-w-full items-center justify-end gap-1 overflow-x-auto max-[371px]:gap-0.5 sm:max-w-none sm:overflow-visible">
          {/* Compact layout launchers (chat-first mode) */}
          {mobilePanelButtonsVisible && sessionsPanel && (
            <button
              onClick={() => togglePanel("sessions")}
              title="Sessions"
              aria-label="Toggle sessions panel"
              aria-expanded={visiblePanel === "sessions"}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              data-active={visiblePanel === "sessions"}
              className={buttonBase}
            >
              <Users size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Sessions</span>
            </button>
          )}

          {mobilePanelButtonsVisible && workspacePanel && (
            <button
              onClick={() => togglePanel("workspace")}
              title="Workspace"
              aria-label="Toggle workspace panel"
              aria-expanded={visiblePanel === "workspace"}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              data-active={visiblePanel === "workspace"}
              className={buttonBase}
            >
              <Brain size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Workspace</span>
            </button>
          )}

          {/* Agent Log button */}
          {logVisible && (
            <button
              onClick={() => togglePanel("agent-log")}
              title="Agent log"
              aria-label="Toggle agent log panel"
              aria-expanded={visiblePanel === "agent-log"}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              data-active={visiblePanel === "agent-log"}
              className={buttonBase}
            >
              {logGlow ? (
                <Pane state="live" size="sm" label="Agent active" />
              ) : null}
              <Activity size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Log</span>
              {agentLogEntries.length > 0 && (
                <span className={countClass}>
                  {agentLogEntries.length}
                </span>
              )}
            </button>
          )}

          {/* Events button */}
          {eventsVisible && (
            <button
              onClick={() => togglePanel("events")}
              title="Events"
              aria-label="Toggle events panel"
              aria-expanded={visiblePanel === "events"}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              data-active={visiblePanel === "events"}
              className={buttonBase}
            >
              <Radio size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Events</span>
              {eventEntries.length > 0 && (
                <span className={countClass}>
                  {eventEntries.length}
                </span>
              )}
            </button>
          )}

          {/* Usage button */}
          <button
            onClick={() => togglePanel("usage")}
            title="Token usage"
            aria-label="Toggle usage panel"
            aria-expanded={visiblePanel === "usage"}
            aria-haspopup="true"
            aria-controls="topbar-panel"
            data-active={visiblePanel === "usage"}
            className={`${buttonBase} gap-2 sm:px-2.5`}
          >
            <BarChart3 size={14} aria-hidden="true" className="sm:hidden" />
            <span className="hidden text-[0.867rem] font-normal text-muted-foreground sm:inline">Usage</span>
            {totalCost && (
              <span className="hidden font-mono text-[0.867rem] font-normal tabular text-foreground lg:inline">
                {totalCost}
              </span>
            )}
          </button>

          {/* Settings button */}
          <button
            onClick={onSettings}
            title="Settings"
            aria-label="Open settings"
            className="shell-icon-button px-0"
          >
            <Settings size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Expandable dropdown panel */}
      <div
        ref={panelRef}
        id="topbar-panel"
        role="region"
        aria-label={visiblePanel ? `${visiblePanel} panel` : undefined}
        hidden={!visiblePanel}
        className={`absolute right-2 mt-1 overflow-hidden rounded-[3px] border border-border bg-popover shadow-[0_12px_32px_rgba(0,0,0,0.32)] ${panelBoxClass} ${panelHeightClass}`}
        style={{ top: "100%" }}
      >
        <div className={panelContentClass}>
          <Suspense
            fallback={
              <div className="p-3 text-[0.8rem] text-muted-foreground">Loading…</div>
            }
          >
            {visiblePanel === "agent-log" && (
              <AgentLog entries={agentLogEntries} glow={logGlow} />
            )}
            {visiblePanel === "events" && <EventLog entries={eventEntries} />}
            {visiblePanel === "usage" && <TokenUsage data={tokenData} />}
            {visiblePanel === "sessions" && sessionsPanel}
            {visiblePanel === "workspace" && workspacePanel}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
