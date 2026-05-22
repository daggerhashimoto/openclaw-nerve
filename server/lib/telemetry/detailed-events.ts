import type { InstallMethod } from './install-metadata.js';

export const DETAILED_EVENT_SURFACES = ['chat', 'sessions', 'kanban', 'workspace', 'settings'] as const;
export const DETAILED_TOOL_FAMILIES = [
  'read',
  'write',
  'edit',
  'exec',
  'browser',
  'web',
  'message',
  'memory',
  'image',
  'video',
  'pdf',
  'session_ops',
  'other',
] as const;
export const TOOL_DURATION_BUCKETS = ['lt_1s', '1_5s', '5_30s', 'gt_30s'] as const;

export type DetailedEventSurface = (typeof DETAILED_EVENT_SURFACES)[number];
export type DetailedFeatureArea = DetailedEventSurface;
export type DetailedToolFamily = (typeof DETAILED_TOOL_FAMILIES)[number];
export type ToolDurationBucket = (typeof TOOL_DURATION_BUCKETS)[number];
export type DetailedEventName = 'session_created' | 'message_submitted' | 'tool_call_completed' | 'branch_switched' | 'kanban_task_created';

interface DetailedEventBaseParams {
  identity: { instanceId: string };
  appVersion: string;
  installMethod: InstallMethod;
  sentAt?: Date | string | number;
}

export interface SessionCreatedEventPayload {
  schema_version: 1;
  event: 'session_created';
  instance_id: string;
  app_version: string;
  install_method: InstallMethod;
  sent_at: string;
  properties: {
    surface: DetailedEventSurface;
    feature_area: DetailedFeatureArea;
  };
}

export interface MessageSubmittedEventPayload {
  schema_version: 1;
  event: 'message_submitted';
  instance_id: string;
  app_version: string;
  install_method: InstallMethod;
  sent_at: string;
  properties: {
    surface: DetailedEventSurface;
    feature_area: DetailedFeatureArea;
  };
}

export interface ToolCallCompletedEventPayload {
  schema_version: 1;
  event: 'tool_call_completed';
  instance_id: string;
  app_version: string;
  install_method: InstallMethod;
  sent_at: string;
  properties: {
    surface: DetailedEventSurface;
    feature_area: DetailedFeatureArea;
    tool_name: DetailedToolFamily;
    success: boolean;
    duration_bucket: ToolDurationBucket;
  };
}

export interface BranchSwitchedEventPayload {
  schema_version: 1;
  event: 'branch_switched';
  instance_id: string;
  app_version: string;
  install_method: InstallMethod;
  sent_at: string;
  properties: {
    surface: DetailedEventSurface;
    feature_area: DetailedFeatureArea;
    success: boolean;
  };
}

export interface KanbanTaskCreatedEventPayload {
  schema_version: 1;
  event: 'kanban_task_created';
  instance_id: string;
  app_version: string;
  install_method: InstallMethod;
  sent_at: string;
  properties: {
    surface: DetailedEventSurface;
    feature_area: DetailedFeatureArea;
    success: boolean;
  };
}

function resolveSentAt(value?: Date | string | number): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function normalizeSurface(value: string | undefined, fallback: DetailedEventSurface): DetailedEventSurface {
  if (DETAILED_EVENT_SURFACES.includes(value as DetailedEventSurface)) {
    return value as DetailedEventSurface;
  }
  return fallback;
}

function buildSurfaceProperties(
  surface: string | undefined,
  fallback: DetailedEventSurface,
): { surface: DetailedEventSurface; feature_area: DetailedFeatureArea } {
  const normalizedSurface = normalizeSurface(surface, fallback);
  return {
    surface: normalizedSurface,
    feature_area: normalizedSurface,
  };
}

function buildDetailedEvent<TEvent extends DetailedEventName, TProperties extends Record<string, unknown>>(
  params: DetailedEventBaseParams,
  event: TEvent,
  properties: TProperties,
): {
  schema_version: 1;
  event: TEvent;
  instance_id: string;
  app_version: string;
  install_method: InstallMethod;
  sent_at: string;
  properties: TProperties;
} {
  return {
    schema_version: 1,
    event,
    instance_id: params.identity.instanceId,
    app_version: params.appVersion,
    install_method: params.installMethod,
    sent_at: resolveSentAt(params.sentAt),
    properties,
  };
}

function canonicalToolName(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  const dotName = normalized.split('.').at(-1) || normalized;
  return dotName.split('/').at(-1) || dotName;
}

export function coerceToolFamily(toolName: string): DetailedToolFamily {
  const normalized = canonicalToolName(toolName);

  if (normalized === 'read') return 'read';
  if (normalized === 'write') return 'write';
  if (normalized === 'edit' || normalized === 'apply_patch') return 'edit';
  if (normalized === 'exec' || normalized === 'process') return 'exec';
  if (normalized === 'browser') return 'browser';
  if (normalized === 'web' || normalized === 'web_search' || normalized === 'web_fetch' || normalized === 'xurl') return 'web';
  if (normalized === 'message' || normalized === 'tts') return 'message';
  if (normalized === 'memory' || normalized === 'memory_search' || normalized === 'memory_get') return 'memory';
  if (normalized === 'image' || normalized === 'image_generate' || normalized === 'camsnap') return 'image';
  if (normalized === 'video' || normalized === 'video_generate') return 'video';
  if (normalized === 'pdf') return 'pdf';
  if (normalized === 'sessions_yield' || normalized.startsWith('session')) return 'session_ops';
  return 'other';
}

export function bucketDurationMs(durationMs: number): ToolDurationBucket {
  const normalized = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;

  if (normalized < 1_000) return 'lt_1s';
  if (normalized < 5_000) return '1_5s';
  if (normalized < 30_000) return '5_30s';
  return 'gt_30s';
}

export function buildSessionCreatedEvent(
  params: DetailedEventBaseParams & { surface: DetailedEventSurface | string },
): SessionCreatedEventPayload {
  return buildDetailedEvent(params, 'session_created', buildSurfaceProperties(params.surface, 'sessions'));
}

export function buildMessageSubmittedEvent(
  params: DetailedEventBaseParams & { surface: DetailedEventSurface | string },
): MessageSubmittedEventPayload {
  return buildDetailedEvent(params, 'message_submitted', buildSurfaceProperties(params.surface, 'chat'));
}

export function buildToolCallCompletedEvent(
  params: DetailedEventBaseParams & {
    surface: DetailedEventSurface | string;
    toolName: string;
    success: boolean;
    startedAt: number;
    finishedAt: number;
  },
): ToolCallCompletedEventPayload {
  return buildDetailedEvent(params, 'tool_call_completed', {
    ...buildSurfaceProperties(params.surface, 'chat'),
    tool_name: coerceToolFamily(params.toolName),
    success: !!params.success,
    duration_bucket: bucketDurationMs(params.finishedAt - params.startedAt),
  });
}

export function buildBranchSwitchedEvent(
  params: DetailedEventBaseParams & {
    success: boolean;
  },
): BranchSwitchedEventPayload {
  return buildDetailedEvent(params, 'branch_switched', {
    ...buildSurfaceProperties('workspace', 'workspace'),
    success: !!params.success,
  });
}

export function buildKanbanTaskCreatedEvent(
  params: DetailedEventBaseParams & {
    surface: DetailedEventSurface | string;
    success: boolean;
  },
): KanbanTaskCreatedEventPayload {
  return buildDetailedEvent(params, 'kanban_task_created', {
    ...buildSurfaceProperties(params.surface, 'kanban'),
    success: !!params.success,
  });
}
