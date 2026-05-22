import crypto from 'node:crypto';
import type { InstallMethod } from './install-metadata.js';

export interface BuildErrorPayloadParams {
  identity: { instanceId: string };
  appVersion: string;
  installMethod: InstallMethod;
  surface: string;
  error: unknown;
  errorCode?: string;
  occurredAt?: Date | string | number;
}

export interface ErrorTelemetryPayload {
  schema_version: 1;
  instance_id: string;
  app_version: string;
  install_method: InstallMethod;
  error_kind: 'server_exception' | 'non_error_throwable';
  error_code: string;
  surface: string;
  fingerprint: string;
  occurred_at: string;
}

const SAFE_ERROR_CODE = /^[A-Z0-9_]{1,64}$/;
const SAFE_SURFACE = /^[a-z0-9_]{1,32}$/;
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

function resolveOccurredAt(value?: Date | string | number): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function normalizeErrorCode(value: unknown): string {
  if (typeof value !== 'string') return 'UNKNOWN';

  const normalized = value.trim().toUpperCase();
  return SAFE_ERROR_CODE.test(normalized) ? normalized : 'UNKNOWN';
}

function normalizeSurface(value: string): string {
  const normalized = value.trim().toLowerCase();
  return SAFE_SURFACE.test(normalized) ? normalized : 'server';
}

function resolveErrorKind(error: unknown): ErrorTelemetryPayload['error_kind'] {
  return error instanceof Error ? 'server_exception' : 'non_error_throwable';
}

function resolveErrorCode(params: { error: unknown; explicitErrorCode?: string }): string {
  if (params.explicitErrorCode) {
    return normalizeErrorCode(params.explicitErrorCode);
  }

  if (params.error && typeof params.error === 'object' && 'code' in params.error) {
    return normalizeErrorCode(params.error.code);
  }

  return 'UNKNOWN';
}

function resolveSafeName(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  return SAFE_NAME.test(error.name) ? error.name : 'Error';
}

function buildFingerprint(input: {
  errorKind: ErrorTelemetryPayload['error_kind'];
  errorCode: string;
  surface: string;
  errorName: string;
}): string {
  const digest = crypto
    .createHash('sha256')
    .update([input.errorKind, input.errorCode, input.surface, input.errorName].join('|'))
    .digest('hex');

  return `sha256:${digest}`;
}

export function buildErrorPayload(params: BuildErrorPayloadParams): ErrorTelemetryPayload {
  const errorKind = resolveErrorKind(params.error);
  const errorCode = resolveErrorCode({ error: params.error, explicitErrorCode: params.errorCode });
  const surface = normalizeSurface(params.surface);
  const errorName = resolveSafeName(params.error);

  return {
    schema_version: 1,
    instance_id: params.identity.instanceId,
    app_version: params.appVersion,
    install_method: params.installMethod,
    error_kind: errorKind,
    error_code: errorCode,
    surface,
    fingerprint: buildFingerprint({ errorKind, errorCode, surface, errorName }),
    occurred_at: resolveOccurredAt(params.occurredAt),
  };
}
