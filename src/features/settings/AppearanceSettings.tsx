import { useState, useCallback } from 'react';
import { Monitor, Eye, Type, Activity, ALargeSmall, Code2, Columns3, Command, LayoutGrid, Contrast, Download, Upload } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { useSettings } from '@/contexts/SettingsContext';
import { themes, themeNames, type ThemeName } from '@/lib/themes';
import { fonts, fontNames, type FontName } from '@/lib/fonts';
import { layoutTemplates } from '@/lib/layout-templates';
import { fetchTweakcnTheme } from '@/lib/theme-io';
import { exportAsCSS, exportAsJSON } from '@/lib/theme-io';
import { validateTheme } from '@/lib/theme-schema';

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

const LAYOUT_TEMPLATE_OPTIONS = Object.values(layoutTemplates).map(t => ({
  value: t.name,
  label: t.label,
}));

/** Settings section for theme, font, font size, and panel visibility. */
export function AppearanceSettings() {
  const {
    eventsVisible,
    toggleEvents,
    logVisible,
    toggleLog,
    showHiddenWorkspaceEntries,
    toggleShowHiddenWorkspaceEntries,
    commandPaletteButtonVisible,
    toggleCommandPaletteButtonVisible,
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
    layoutTemplate,
    setLayoutTemplate,
    importedTheme,
    setImportedTheme,
    highContrast,
    setHighContrast,
  } = useSettings();

  const [importInput, setImportInput] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [importError, setImportError] = useState('');
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);

  const handleThemeChange = (next: string) => {
    setTheme(next as ThemeName);
  };

  const handleFontChange = (next: string) => {
    setFont(next as FontName);
  };

  const handleImportTheme = useCallback(async () => {
    if (!importInput.trim()) return;
    setImportStatus('loading');
    setImportError('');
    try {
      const nerveTheme = await fetchTweakcnTheme(importInput.trim());
      const missing = validateTheme(nerveTheme.colors);
      if (missing.length > 0) {
        console.warn(`Imported theme missing variables: ${missing.join(', ')}. They will fall back to defaults.`);
      }
      setImportedTheme(nerveTheme);
      setImportStatus('success');
      setImportInput('');
    } catch (e) {
      setImportStatus('error');
      setImportError(e instanceof Error ? e.message : 'Failed to import theme');
    }
  }, [importInput, setImportedTheme]);

  const handleClearImported = useCallback(() => {
    setImportedTheme(null);
    setImportStatus('idle');
    setImportError('');
  }, [setImportedTheme]);

  const handleExportCSS = useCallback(() => {
    if (!importedTheme) return;
    const css = exportAsCSS(importedTheme);
    navigator.clipboard.writeText(css).then(() => {
      setCopiedFormat('CSS');
      setTimeout(() => setCopiedFormat(null), 2000);
    });
  }, [importedTheme]);

  const handleExportJSON = useCallback(() => {
    if (!importedTheme) return;
    const json = exportAsJSON(importedTheme);
    navigator.clipboard.writeText(json).then(() => {
      setCopiedFormat('JSON');
      setTimeout(() => setCopiedFormat(null), 2000);
    });
  }, [importedTheme]);

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

      {/* Layout template selector */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <LayoutGrid size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">Layout</span>
            <span className="text-xs text-muted-foreground">Tune spacing and density across the cockpit.</span>
          </div>
        </div>
        <div className="relative w-full sm:w-auto">
          <InlineSelect
            value={layoutTemplate}
            onChange={setLayoutTemplate}
            options={LAYOUT_TEMPLATE_OPTIONS}
            ariaLabel="Select layout template"
            triggerClassName={INLINE_SELECT_TRIGGER_CLASS}
            menuClassName={INLINE_SELECT_MENU_CLASS}
          />
        </div>
      </div>

      {/* High Contrast toggle */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex items-center gap-3">
          <Contrast size={14} className={highContrast ? 'text-primary' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground" id="high-contrast-label">High contrast</span>
            <span className="text-xs text-muted-foreground">Boost borders, focus rings, and text contrast.</span>
          </div>
        </div>
        <Switch
          checked={highContrast}
          onCheckedChange={setHighContrast}
          aria-labelledby="high-contrast-label"
        />
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

      {/* Theme Import section */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Download size={14} className="text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">Import theme</span>
            <span className="text-xs text-muted-foreground">Paste a tweakcn URL or JSON to import a custom palette.</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 w-full sm:w-auto sm:min-w-[200px]">
          {importedTheme && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <span className="inline-block w-2 h-2 rounded-full bg-primary" />
              Custom theme active
            </span>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={importInput}
              onChange={(e) => { setImportInput(e.target.value); setImportStatus('idle'); setImportError(''); }}
              placeholder="tweakcn.com/..."
              className="flex-1 min-h-11 rounded-2xl border border-border/80 bg-background/65 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
              onKeyDown={(e) => { if (e.key === 'Enter') handleImportTheme(); }}
            />
            <button
              onClick={handleImportTheme}
              disabled={importStatus === 'loading' || !importInput.trim()}
              className="min-h-11 px-4 rounded-2xl border border-border/80 bg-background/65 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importStatus === 'loading' ? '…' : 'Import'}
            </button>
          </div>
          {importedTheme && (
            <button
              onClick={handleClearImported}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors self-end"
            >
              Clear imported theme
            </button>
          )}
          {importStatus === 'error' && importError && (
            <span className="text-xs text-destructive">{importError}</span>
          )}
          {importStatus === 'success' && (
            <span className="text-xs text-green">Theme imported successfully</span>
          )}
        </div>
      </div>

      {/* Theme Export section */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Upload size={14} className={importedTheme ? 'text-primary' : 'text-muted-foreground'} />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">Export theme</span>
            <span className="text-xs text-muted-foreground">Copy the current palette as CSS or JSON.</span>
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={handleExportCSS}
            disabled={!importedTheme}
            className="min-h-11 px-4 rounded-2xl border border-border/80 bg-background/65 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {copiedFormat === 'CSS' ? 'Copied!' : 'Copy CSS'}
          </button>
          <button
            onClick={handleExportJSON}
            disabled={!importedTheme}
            className="min-h-11 px-4 rounded-2xl border border-border/80 bg-background/65 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {copiedFormat === 'JSON' ? 'Copied!' : 'Copy JSON'}
          </button>
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

      {/* Hidden workspace entries visibility */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex items-center gap-3">
          <Eye size={14} className={showHiddenWorkspaceEntries ? 'text-primary' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground" id="hidden-workspace-entries-label">Show hidden workspace entries</span>
            <span className="text-xs text-muted-foreground">Reveal dotfiles and dotfolders in the workspace browser when you need them.</span>
          </div>
        </div>
        <Switch
          checked={showHiddenWorkspaceEntries}
          onCheckedChange={toggleShowHiddenWorkspaceEntries}
          aria-label="Toggle hidden workspace entries visibility"
        />
      </div>

      {/* Chatbox command palette visibility */}
      <div className="cockpit-row items-start justify-between">
        <div className="flex items-center gap-3">
          <Command size={14} className={commandPaletteButtonVisible ? 'text-primary' : 'text-muted-foreground'} aria-hidden="true" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground" id="chatbox-commands-label">Show chatbox Commands button</span>
            <span className="text-xs text-muted-foreground">Keep the Commands launcher visible in the chat composer.</span>
          </div>
        </div>
        <Switch
          checked={commandPaletteButtonVisible}
          onCheckedChange={toggleCommandPaletteButtonVisible}
          aria-labelledby="chatbox-commands-label"
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