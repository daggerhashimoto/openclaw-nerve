import { Monitor, Eye, ChevronDown, Type, Activity } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useSettings } from '@/contexts/SettingsContext';
import { themes, themeNames, type ThemeName } from '@/lib/themes';
import { fonts, fontNames, type FontName } from '@/lib/fonts';

/** Settings section for theme, font, and panel visibility. */
export function AppearanceSettings() {
  const { eventsVisible, toggleEvents, logVisible, toggleLog, theme, setTheme, font, setFont } = useSettings();

  const handleThemeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTheme(e.target.value as ThemeName);
  };

  const handleFontChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFont(e.target.value as FontName);
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
          <select
            value={theme}
            onChange={handleThemeChange}
            className="cockpit-select w-full appearance-none pr-9 text-sm sm:min-w-[148px]"
            aria-label="Select theme"
          >
            {themeNames.map((name) => (
              <option key={name} value={name} className="bg-card text-foreground">
                {themes[name].label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
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
          <select
            value={font}
            onChange={handleFontChange}
            className="cockpit-select w-full appearance-none pr-9 text-sm sm:min-w-[148px]"
            aria-label="Select font"
          >
            {fontNames.map((name) => (
              <option key={name} value={name} className="bg-card text-foreground">
                {fonts[name].label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
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
