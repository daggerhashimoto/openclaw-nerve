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
      <h3 className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground flex items-center gap-2">
        <span className="text-purple">◆</span>
        APPEARANCE
      </h3>

      {/* Theme selector */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
        <div className="flex items-center gap-3">
          <Monitor size={14} className="text-primary" />
          <span className="text-[12px]">Theme</span>
        </div>
        <div className="relative">
          <select
            value={theme}
            onChange={handleThemeChange}
            className="appearance-none bg-secondary border border-border/60 text-[11px] font-mono uppercase tracking-wide px-3 py-1.5 pr-7 cursor-pointer hover:border-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
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
      <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
        <div className="flex items-center gap-3">
          <Type size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-[12px]">Font</span>
            <span className="text-[10px] text-muted-foreground">Code blocks stay monospace</span>
          </div>
        </div>
        <div className="relative">
          <select
            value={font}
            onChange={handleFontChange}
            className="appearance-none bg-secondary border border-border/60 text-[11px] font-mono uppercase tracking-wide px-3 py-1.5 pr-7 cursor-pointer hover:border-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
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
      <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
        <div className="flex items-center gap-3">
          <Eye size={14} className={eventsVisible ? 'text-purple' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-[12px]" id="events-label">Display Events</span>
            <span className="text-[10px] text-muted-foreground">Show event log in telemetry row</span>
          </div>
        </div>
        <Switch
          checked={eventsVisible}
          onCheckedChange={toggleEvents}
          aria-label="Toggle events panel visibility"
        />
      </div>

      {/* Log Panel Visibility */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-background border border-border/60 hover:border-muted-foreground transition-colors">
        <div className="flex items-center gap-3">
          <Activity size={14} className={logVisible ? 'text-green' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-[12px]" id="log-label">Display Log</span>
            <span className="text-[10px] text-muted-foreground">Show agent activity log in top bar</span>
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
