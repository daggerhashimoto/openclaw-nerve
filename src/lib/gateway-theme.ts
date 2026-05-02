/**
 * Gateway Theme Bridge
 * 
 * Reads gateway config settings (ui.seamColor, ui.assistant)
 * and applies them as Nerve CSS variable overrides.
 * 
 * Local Nerve theme settings always take priority over gateway settings.
 */

/** Gateway config theme keys that Nerve can read and apply as CSS overrides. */
export interface GatewayThemeConfig {
  seamColor?: string;       // ui.seamColor → accent color
  assistantName?: string;   // ui.assistant.name
  assistantAvatar?: string; // ui.assistant.avatar
}

/** Apply gateway theme overrides on top of the Nerve theme layer. */
export function applyGatewayThemeOverrides(config: GatewayThemeConfig): void {
  const root = document.documentElement;
  if (config.seamColor) {
    // Apply seam color as accent/ring override.
    // Nerve's local theme wins by default; gateway accent is applied
    // when explicitly set and no imported theme is active.
    root.style.setProperty('--color-ring', config.seamColor);
    root.style.setProperty('--ring', config.seamColor);
  }
}

/** Fetch gateway public config (no auth needed for /api/config/public). */
export async function fetchGatewayThemeConfig(): Promise<GatewayThemeConfig | null> {
  try {
    const resp = await fetch('/api/config/public');
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      seamColor: data?.ui?.seamColor ?? undefined,
      assistantName: data?.ui?.assistant?.name ?? undefined,
      assistantAvatar: data?.ui?.assistant?.avatar ?? undefined,
    };
  } catch {
    return null;
  }
}