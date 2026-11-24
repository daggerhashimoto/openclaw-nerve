export type UploadMode = 'inline' | 'file_reference';

export interface UploadFeatureConfig {
  twoModeEnabled: boolean;
  inlineEnabled: boolean;
  fileReferenceEnabled: boolean;
  inlineAttachmentMaxMb: number;
}

export const DEFAULT_UPLOAD_FEATURE_CONFIG: UploadFeatureConfig = {
  twoModeEnabled: false,
  inlineEnabled: true,
  fileReferenceEnabled: false,
  inlineAttachmentMaxMb: 4,
};

export function getInlineAttachmentMaxBytes(config: UploadFeatureConfig): number {
  const mb = Number.isFinite(config.inlineAttachmentMaxMb) && config.inlineAttachmentMaxMb > 0
    ? config.inlineAttachmentMaxMb
    : DEFAULT_UPLOAD_FEATURE_CONFIG.inlineAttachmentMaxMb;
  return Math.round(mb * 1024 * 1024);
}

export function isUploadsEnabled(config: UploadFeatureConfig): boolean {
  return config.inlineEnabled || config.fileReferenceEnabled;
}

export function getDefaultUploadMode(file: File, config: UploadFeatureConfig): UploadMode | null {
  if (!isUploadsEnabled(config)) return null;

  if (config.inlineEnabled && config.fileReferenceEnabled) {
    if (file.type.startsWith('image/')) return 'inline';
    return 'file_reference';
  }

  if (config.inlineEnabled) return 'inline';
  return 'file_reference';
}

export function getInlineModeGuardrailError(file: File, config: UploadFeatureConfig): string | null {
  if (file.type.startsWith('image/')) return null;

  const maxBytes = getInlineAttachmentMaxBytes(config);
  if (file.size <= maxBytes) return null;

  const maxMbLabel = Number.isInteger(config.inlineAttachmentMaxMb)
    ? String(config.inlineAttachmentMaxMb)
    : config.inlineAttachmentMaxMb.toFixed(1);

  return `"${file.name}" exceeds inline cap (${maxMbLabel}MB).`;
}
