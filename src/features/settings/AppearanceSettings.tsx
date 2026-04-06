import { Monitor, Eye, Type, Activity, ALargeSmall, Code2, Columns3 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { useSettings } from '@/contexts/SettingsContext';
import { themes, themeNames, type ThemeName } from '@/lib/themes';
import { fonts, fontNames, type FontName } from '@/lib/fonts';

const INLINE_SELECT_TRIGGER_CLASS =
  'min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-left text-sm font-sans text-foreground sm:min-w-[148px]';
const INLINE_SELECT_MENU_CLASS =
  'rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]';

const EDITOR_FONT_SIZE_OPTIONS = [
  { value: '10', label: '10px' },
  { value: '11', label: '11px' },
  { value: '12', label: '12px' },
  { value: '13', label: '13px (default)' },
  { value: '14', label: '14px' },
  { value: '15', label: '15px' },
  { value: '16', label: '16px' },
  { value: '17', label: '17px' },
  { value: '18', label: '18px' },
  { value: '20', label: '20px' },
  { value: '22', label: '22px' },
  { value: '24', label: '24px' },
];

const FONT_SIZE_OPTIONS = [
  { value: '10', label: '10px' },
  { value: '11', label: '11px' },
  { value: '12', label: '12px' },
  { value: '13', label: '13px' },
  { value: '14', label: '14px' },
  { value: '15', label: '15px (default)' },
  { value: '16', label: '16px' },
  { value: '17', label: '17px' },
  { value: '18', label: '18px' },
  { value: '20', label: '20px' },
  { value: '22', label: '22px' },
  { value: '24', label: '24px' },
];

/** Settings section for theme, font, font size, and panel visibility. */
export function AppearanceSettings() {
  const {
    eventsVisible,
    toggleEvents,
    logVisible,
    toggleLog,
    kanbanVisible,
    toggleKanbanVisible,
    theme,
    setTheme,
    font,
    setFont,
    fontSize,
    setFontSize,
    editorFontSize,
    setEditorFontSize,
  } = useSettings();

  const handleThemeChange = (next: string) => {
    setTheme(next as ThemeName);
  };

  const handleFontChange = (next: string) => {
    setFont(next as FontName);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="cockpit-kicker">
          <span className="text-primary">◆</span>
          Appearance
        </span>
      </div>

      {/* Theme selector */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Monitor size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">Theme</span>
            <span className="text-xs text-muted-foreground">Swap the full cockpit palette in one move.</span>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <InlineSelect
            value={theme}
            onChange={handleThemeChange}
            options={themeNames.map((name) => ({ value: name, label: themes[name].label }))}
            ariaLabel="Select theme"
            triggerClassName={INLINE_SELECT_TRIGGER_CLASS}
            menuClassName={INLINE_SELECT_MENU_CLASS}
          />
        </div>
      </div>

      {/* Font selector */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Type size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">UI font</span>
            <span className="text-xs text-muted-foreground">Code blocks stay monospace</span>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <InlineSelect
            value={font}
            onChange={handleFontChange}
            options={fontNames.map((name) => ({ value: name, label: fonts[name].label }))}
            ariaLabel="Select font"
            triggerClassName={INLINE_SELECT_TRIGGER_CLASS}
            menuClassName={INLINE_SELECT_MENU_CLASS}
          />
        </div>
      </div>

      {/* Font size selector */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ALargeSmall size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">Font size</span>
            <span className="text-xs text-muted-foreground">Base size for all UI text</span>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <InlineSelect
            value={String(fontSize)}
            onChange={(next) => setFontSize(parseInt(next, 10))}
            options={FONT_SIZE_OPTIONS}
            ariaLabel="Select font size"
            triggerClassName={INLINE_SELECT_TRIGGER_CLASS}
            menuClassName={INLINE_SELECT_MENU_CLASS}
          />
        </div>
      </div>

      {/* Editor font size selector */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Code2 size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">Editor font size</span>
            <span className="text-xs text-muted-foreground">Size for the code editor</span>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <InlineSelect
            value={String(editorFontSize)}
            onChange={(next) => setEditorFontSize(parseInt(next, 10))}
            options={EDITOR_FONT_SIZE_OPTIONS}
            ariaLabel="Select editor font size"
            triggerClassName={INLINE_SELECT_TRIGGER_CLASS}
            menuClassName={INLINE_SELECT_MENU_CLASS}
          />
        </div>
      </div>

      {/* Events Panel Visibility */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex items-center gap-3">
          <Eye size={14} className={eventsVisible ? 'text-primary' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground" id="events-label">Show events</span>
            <span className="text-xs text-muted-foreground">Keep the event rail visible in the telemetry row.</span>
          </div>
        </div>
        <Switch
          checked={eventsVisible}
          onCheckedChange={toggleEvents}
          aria-label="Toggle events panel visibility"
        />
      </div>

      {/* Log Panel Visibility */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex items-center gap-3">
          <Activity size={14} className={logVisible ? 'text-green' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground" id="log-label">Show activity log</span>
            <span className="text-xs text-muted-foreground">Surface agent activity in the top chrome.</span>
          </div>
        </div>
        <Switch
          checked={logVisible}
          onCheckedChange={toggleLog}
          aria-label="Toggle log panel visibility"
        />
      </div>

      {/* Workspace Kanban Visibility */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex items-center gap-3">
          <Columns3 size={14} className={kanbanVisible ? 'text-primary' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground" id="kanban-label">Show workspace tasks</span>
            <span className="text-xs text-muted-foreground">Toggle the Kanban view inside the workspace tabs.</span>
          </div>
        </div>
        <Switch
          checked={kanbanVisible}
          onCheckedChange={toggleKanbanVisible}
          aria-label="Toggle workspace kanban visibility"
        />
      </div>

    </div>
  );
}
