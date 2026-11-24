import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UPLOAD_FEATURE_CONFIG,
  getDefaultUploadMode,
  getInlineAttachmentMaxBytes,
  getInlineModeGuardrailError,
  isUploadsEnabled,
  type UploadFeatureConfig,
} from './uploadPolicy';

function makeConfig(overrides: Partial<UploadFeatureConfig> = {}): UploadFeatureConfig {
  return {
    ...DEFAULT_UPLOAD_FEATURE_CONFIG,
    ...overrides,
  };
}

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('uploadPolicy', () => {
  it('defaults small images to inline when both modes are enabled', () => {
    const config = makeConfig({
      twoModeEnabled: true,
      inlineEnabled: true,
      fileReferenceEnabled: true,
      inlineAttachmentMaxMb: 4,
    });

    const file = makeFile('small.png', 'image/png', 100_000);
    expect(getDefaultUploadMode(file, config)).toBe('inline');
  });

  it('defaults images to inline and non-images to file_reference when both modes are enabled', () => {
    const config = makeConfig({
      twoModeEnabled: true,
      inlineEnabled: true,
      fileReferenceEnabled: true,
      inlineAttachmentMaxMb: 1,
    });

    const image = makeFile('big.png', 'image/png', 2 * 1024 * 1024);
    const pdf = makeFile('notes.pdf', 'application/pdf', 400_000);
    expect(getDefaultUploadMode(image, config)).toBe('inline');
    expect(getDefaultUploadMode(pdf, config)).toBe('file_reference');
  });

  it('uses inline mode when only inline uploads are enabled', () => {
    const config = makeConfig({ inlineEnabled: true, fileReferenceEnabled: false });
    const file = makeFile('clip.mov', 'video/quicktime', 128_000);
    expect(getDefaultUploadMode(file, config)).toBe('inline');
  });

  it('uses file_reference mode when inline mode is disabled', () => {
    const config = makeConfig({ inlineEnabled: false, fileReferenceEnabled: true });
    const file = makeFile('clip.mov', 'video/quicktime', 128_000);
    expect(getDefaultUploadMode(file, config)).toBe('file_reference');
  });

  it('reports uploads disabled when both modes are off', () => {
    const config = makeConfig({ inlineEnabled: false, fileReferenceEnabled: false });
    const file = makeFile('small.png', 'image/png', 1_000);
    expect(isUploadsEnabled(config)).toBe(false);
    expect(getDefaultUploadMode(file, config)).toBeNull();
  });

  it('returns hard inline guardrail errors for oversized non-image files only', () => {
    const config = makeConfig({ inlineAttachmentMaxMb: 1.5 });
    const archive = makeFile('archive.zip', 'application/zip', 2 * 1024 * 1024);
    const image = makeFile('huge.png', 'image/png', 8 * 1024 * 1024);
    expect(getInlineModeGuardrailError(archive, config)).toContain('exceeds inline cap (1.5MB)');
    expect(getInlineModeGuardrailError(image, config)).toBeNull();
  });

  it('converts inline MB caps to bytes', () => {
    const config = makeConfig({ inlineAttachmentMaxMb: 2 });
    expect(getInlineAttachmentMaxBytes(config)).toBe(2 * 1024 * 1024);
  });
});
