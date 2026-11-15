export const PERFORMANCE_MODE_STORAGE_KEY = 'nerve:performanceMode';

export function isPerformanceModePreferenceEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}
