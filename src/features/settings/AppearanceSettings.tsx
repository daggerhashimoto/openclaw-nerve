import { Monitor, Eye, Type, Activity } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { useSettings } from '@/contexts/SettingsContext';
import { themes, themeNames, type ThemeName } from '@/lib/themes';
import { fonts, fontNames, type FontName } from '@/lib/fonts';

const INLINE_SELECT_TRIGGER_CLASS =
  'min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-left text-sm font-sans text-foreground sm:min-w-[148px]';
const INLINE_SELECT_MENU_CLASS =
  'rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]';

/** Settings section for theme, font, and panel visibility. */
export function AppearanceSettings() {
  const { eventsVisible, toggleEvents, logVisible, toggleLog, theme, setTheme, font, setFont } = useSettings();

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

    </div>
  );
}
