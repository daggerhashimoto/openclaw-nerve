/** Cron run status helpers shared by the Crons tab and the Attention brief. */

const OK_STATUSES = new Set(['success', 'ok', 'finished']);

export function isOkCronStatus(status?: string): boolean {
  return Boolean(status) && OK_STATUSES.has(status!.toLowerCase());
}

/** A run that did not happen (a skipped heartbeat) is quiet, not broken. */
export function isFailedCronStatus(status?: string): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return !OK_STATUSES.has(normalized) && normalized !== 'skipped';
}
