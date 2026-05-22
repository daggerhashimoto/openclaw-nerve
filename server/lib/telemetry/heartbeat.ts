import { computeActive24h, type Counts24h, type FeaturesUsed24h, type HeartbeatReason } from './types.js';

export interface BuildHeartbeatPayloadParams {
  identity: { instanceId: string };
  installMethod: 'release' | 'source' | 'unknown';
  appVersion: string;
  reason: HeartbeatReason;
  sentAt?: string;
  snapshot: {
    counts24h: Counts24h;
    featuresUsed24h: FeaturesUsed24h;
    windowStart: string;
    windowEnd: string;
  };
}

export interface HeartbeatPayload {
  schema_version: 1;
  instance_id: string;
  app_version: string;
  install_method: 'release' | 'source' | 'unknown';
  reason: HeartbeatReason;
  sent_at: string;
  window_start: string;
  window_end: string;
  active_24h: boolean;
  counts_24h: Counts24h;
  features_used_24h: FeaturesUsed24h;
}

export function buildHeartbeatPayload(params: BuildHeartbeatPayloadParams): HeartbeatPayload {
  return {
    schema_version: 1,
    instance_id: params.identity.instanceId,
    app_version: params.appVersion,
    install_method: params.installMethod,
    reason: params.reason,
    sent_at: params.sentAt || params.snapshot.windowEnd,
    window_start: params.snapshot.windowStart,
    window_end: params.snapshot.windowEnd,
    active_24h: computeActive24h(params.snapshot.counts24h, params.snapshot.featuresUsed24h),
    counts_24h: params.snapshot.counts24h,
    features_used_24h: params.snapshot.featuresUsed24h,
  };
}

export function shouldSendFirstSeen(lastHeartbeatSentAtByReason: Partial<Record<HeartbeatReason, string>>): boolean {
  return !lastHeartbeatSentAtByReason.first_seen;
}

export function shouldSendVersionChange(params: {
  appVersion: string;
  lastHeartbeatAppVersion?: string;
}): boolean {
  return !!params.lastHeartbeatAppVersion && params.lastHeartbeatAppVersion !== params.appVersion;
}

export function shouldSendDailyCatchUp(params: {
  now: Date;
  jitterMs: number;
  lastHeartbeatSentAtByReason: Partial<Record<HeartbeatReason, string>>;
}): boolean {
  const todayTarget = Date.UTC(
    params.now.getUTCFullYear(),
    params.now.getUTCMonth(),
    params.now.getUTCDate(),
  ) + Math.max(0, params.jitterMs);

  if (params.now.getTime() < todayTarget) {
    return false;
  }

  const lastDailySentAt = params.lastHeartbeatSentAtByReason.daily;
  if (!lastDailySentAt) {
    return true;
  }

  const lastDailyTime = new Date(lastDailySentAt).getTime();
  if (Number.isNaN(lastDailyTime)) {
    return true;
  }

  return lastDailyTime < todayTarget;
}

export function nextDailyHeartbeatAt(now: Date, jitterMs: number): Date {
  const current = now.getTime();
  const currentUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayTarget = currentUtcMidnight + Math.max(0, jitterMs);

  if (current < todayTarget) {
    return new Date(todayTarget);
  }

  return new Date(currentUtcMidnight + (24 * 60 * 60 * 1000) + Math.max(0, jitterMs));
}
