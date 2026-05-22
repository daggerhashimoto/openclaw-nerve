export const TELEMETRY_NOTICE_DISMISS_KEY = 'nerve:telemetry:fresh-install-notice-dismissed';

export function buildTelemetryNoticeDismissKey(noticeId?: string): string {
  return noticeId ? `${TELEMETRY_NOTICE_DISMISS_KEY}:${noticeId}` : TELEMETRY_NOTICE_DISMISS_KEY;
}
