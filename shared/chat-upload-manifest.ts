export const VOICE_PREFIX = '[voice] ';
export const TTS_HINT = '\n\n[system: User sent a voice message. Always include your full text reply AND a [tts:...] marker so it plays back as audio. Never send only TTS markers - the response must be readable in chat too. TTS marker format: [tts: your spoken text here] - place it at the end of your reply. Example reply:\n\nHere is my text response.\n\n[tts: Here is my text response.]';
export const UPLOAD_MANIFEST_OPEN = '<nerve-upload-manifest>';
export const UPLOAD_MANIFEST_CLOSE = '</nerve-upload-manifest>';
export type UploadAttachmentModeForManifest = 'inline' | 'file_reference';

export interface UploadAttachmentPolicyForManifest {
  forwardToSubagents: boolean;
}

export interface InlineUploadReferenceForManifest {
  encoding?: string;
  base64?: string;
  base64Bytes?: number;
  previewUrl?: string;
  compressed?: boolean;
}

export interface UploadAttachmentDescriptorForManifest {
  id: string;
  origin: string;
  mode: UploadAttachmentModeForManifest;
  name: string;
  mimeType: string;
  sizeBytes: number;
  inline?: InlineUploadReferenceForManifest;
  reference?: unknown;
  preparation?: unknown;
  policy: UploadAttachmentPolicyForManifest;
}

export interface UploadManifestOptionsForManifest {
  enabled: boolean;
  exposeInlineBase64ToAgent: boolean;
  allowSubagentForwarding: boolean;
}

export interface UploadPayloadForManifest {
  descriptors: UploadAttachmentDescriptorForManifest[];
  manifest: UploadManifestOptionsForManifest;
}

export function applyVoiceTTSHint(text: string): string {
  if (!text.startsWith(VOICE_PREFIX)) return text;
  return text + TTS_HINT;
}

const TTS_SYSTEM_HINT_RE = /\s*\[system: User sent a voice message\.[\s\S]*$/;

export function stripVoiceTTSHint(text: string): string {
  return text.replace(TTS_SYSTEM_HINT_RE, '').trim();
}

export function appendUploadManifest(
  text: string,
  uploadPayload?: UploadPayloadForManifest,
): string {
  if (!uploadPayload?.manifest.enabled) return text;
  if (uploadPayload.descriptors.length === 0) return text;

  const manifest = {
    version: 1,
    attachments: uploadPayload.descriptors.map((descriptor) =>
      sanitizeUploadDescriptor(descriptor, uploadPayload.manifest.exposeInlineBase64ToAgent),
    ),
  };

  return `${text}\n\n${UPLOAD_MANIFEST_OPEN}${JSON.stringify(manifest)}${UPLOAD_MANIFEST_CLOSE}`;
}

export function sanitizeUploadDescriptor<TDescriptor extends UploadAttachmentDescriptorForManifest>(
  descriptor: TDescriptor,
  exposeInlineBase64ToAgent: boolean,
): TDescriptor {
  if (descriptor.mode !== 'inline' || !descriptor.inline) {
    return descriptor;
  }

  const inline = {
    ...descriptor.inline,
    previewUrl: undefined,
    base64: exposeInlineBase64ToAgent ? descriptor.inline.base64 : '',
  };

  return {
    ...descriptor,
    inline,
  };
}
