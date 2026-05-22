export const TELEMETRY_FEATURE_NAMES = ['chat', 'sessions', 'branches', 'kanban', 'settings'] as const;
export const HEARTBEAT_REASONS = ['first_seen', 'daily', 'version_change'] as const;

export type TelemetryFeatureName = (typeof TELEMETRY_FEATURE_NAMES)[number];
export type HeartbeatReason = (typeof HEARTBEAT_REASONS)[number];

export interface Counts24h {
  sessions_created: number;
  messages_sent: number;
  tool_calls: number;
}

export type FeaturesUsed24h = Record<TelemetryFeatureName, boolean>;

export interface TelemetryWindowSnapshot {
  windowStart: string;
  windowEnd: string;
  counts24h: Counts24h;
  featuresUsed24h: FeaturesUsed24h;
  active24h: boolean;
  lastHeartbeatSentAtByReason: Partial<Record<HeartbeatReason, string>>;
  lastHeartbeatAppVersion?: string;
}

export function emptyCounts24h(): Counts24h {
  return {
    sessions_created: 0,
    messages_sent: 0,
    tool_calls: 0,
  };
}

export function emptyFeaturesUsed24h(): FeaturesUsed24h {
  return {
    chat: false,
    sessions: false,
    branches: false,
    kanban: false,
    settings: false,
  };
}

export function computeActive24h(counts24h: Counts24h, featuresUsed24h: FeaturesUsed24h): boolean {
  return counts24h.sessions_created > 0
    || counts24h.messages_sent > 0
    || counts24h.tool_calls > 0
    || Object.values(featuresUsed24h).some(Boolean);
}
