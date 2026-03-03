export function shouldDeferEdgeVoiceAutoSwitch(language: string, support: Array<{ code: string }> | null): boolean {
  return language !== 'en' && !support?.some((entry) => entry.code === language);
}
