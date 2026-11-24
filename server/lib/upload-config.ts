export interface UploadFeatureConfig {
  twoModeEnabled: boolean;
  inlineEnabled: boolean;
  fileReferenceEnabled: boolean;
  inlineAttachmentMaxMb: number;
}

const DEFAULT_UPLOAD_FEATURE_CONFIG: UploadFeatureConfig = {
  twoModeEnabled: false,
  inlineEnabled: true,
  fileReferenceEnabled: false,
  inlineAttachmentMaxMb: 4,
};

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null) return fallback;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  return fallback;
}

function readNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value == null) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getUploadFeatureConfig(): UploadFeatureConfig {
  return {
    twoModeEnabled: readBooleanEnv('NERVE_UPLOAD_TWO_MODE_ENABLED', DEFAULT_UPLOAD_FEATURE_CONFIG.twoModeEnabled),
    inlineEnabled: readBooleanEnv('NERVE_UPLOAD_INLINE_ENABLED', DEFAULT_UPLOAD_FEATURE_CONFIG.inlineEnabled),
    fileReferenceEnabled: readBooleanEnv('NERVE_UPLOAD_FILE_REFERENCE_ENABLED', DEFAULT_UPLOAD_FEATURE_CONFIG.fileReferenceEnabled),
    inlineAttachmentMaxMb: readNumberEnv('NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB', DEFAULT_UPLOAD_FEATURE_CONFIG.inlineAttachmentMaxMb),
  };
}
