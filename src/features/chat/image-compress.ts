/**
 * image-compress.ts: Client-side adaptive image compression for chat attachments.
 *
 * Iteratively rescales and recompresses images so inline uploads stay within the
 * configured model-context-safe byte budget before falling back to file references.
 */

function getBase64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Check whether a canvas has any non-opaque pixels (samples every 4th pixel for speed) */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 16) {
    if (data[i] < 250) return true;
  }
  return false;
}

function clampDimension(value: number): number {
  return Math.max(1, Math.round(value));
}

export function buildQualityLadder(baseQualityPercent: number): number[] {
  const normalizedBase = Math.max(1, Math.min(100, Math.round(baseQualityPercent)));
  return Array.from(new Set([normalizedBase, 74, 66]));
}

export function computeScaledSize(sourceWidth: number, sourceHeight: number, maxDimension: number): { width: number; height: number } {
  if (sourceWidth <= maxDimension && sourceHeight <= maxDimension) {
    return { width: sourceWidth, height: sourceHeight };
  }

  const ratio = Math.min(maxDimension / sourceWidth, maxDimension / sourceHeight);
  return {
    width: clampDimension(sourceWidth * ratio),
    height: clampDimension(sourceHeight * ratio),
  };
}

export function computeDimensionRungs(startDimension: number, minDimension: number): number[] {
  const normalizedStart = clampDimension(startDimension);
  const normalizedMin = Math.min(normalizedStart, clampDimension(minDimension));
  const rungs: number[] = [normalizedStart];

  let current = normalizedStart;
  while (current > normalizedMin) {
    const next = Math.max(normalizedMin, clampDimension(current * 0.85));
    if (next === current) break;
    rungs.push(next);
    current = next;
  }

  if (rungs[rungs.length - 1] !== normalizedMin) {
    rungs.push(normalizedMin);
  }

  return rungs;
}

export interface CompressImagePolicy {
  contextMaxBytes: number;
  contextTargetBytes?: number;
  maxDimension: number;
  minDimension: number;
  webpQuality?: number;
}

export interface CompressionAttempt {
  iteration: number;
  maxDimension: number;
  width: number;
  height: number;
  quality: number;
  mimeType: string;
  bytes: number;
  metTarget: boolean;
  fitWithinLimit: boolean;
}

export interface CompressedImage {
  base64: string;
  mimeType: string;
  preview: string;
  width: number;
  height: number;
  bytes: number;
  iterations: number;
  attempts: CompressionAttempt[];
  targetBytes: number;
  maxBytes: number;
  minDimension: number;
  fallbackReason?: string;
}

/** Compress an image file to an adaptive inline-safe payload. */
export function compressImage(file: File, policy: CompressImagePolicy): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const sourceWidth = img.naturalWidth || img.width;
      const sourceHeight = img.naturalHeight || img.height;
      if (!sourceWidth || !sourceHeight) {
        reject(new Error('Failed to read image dimensions'));
        return;
      }

      const startDimension = Math.min(
        Math.max(1, Math.round(policy.maxDimension)),
        Math.max(sourceWidth, sourceHeight),
      );
      const minDimension = Math.min(
        Math.max(1, Math.round(policy.minDimension)),
        startDimension,
      );
      const maxBytes = Math.max(1, Math.round(policy.contextMaxBytes));
      const targetBytes = Math.min(
        maxBytes,
        Math.max(1, Math.round(policy.contextTargetBytes ?? Math.floor(maxBytes * 0.9))),
      );
      const qualityLadder = buildQualityLadder(policy.webpQuality ?? 82);
      const dimensionRungs = computeDimensionRungs(startDimension, minDimension);
      const attempts: CompressionAttempt[] = [];

      const alphaProbeCanvas = document.createElement('canvas');
      alphaProbeCanvas.width = sourceWidth;
      alphaProbeCanvas.height = sourceHeight;
      const alphaProbeCtx = alphaProbeCanvas.getContext('2d');
      if (!alphaProbeCtx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      alphaProbeCtx.drawImage(img, 0, 0, sourceWidth, sourceHeight);

      const isPngLike = file.type === 'image/png' || file.type === 'image/webp';
      const preserveAlpha = isPngLike && hasAlpha(alphaProbeCtx, sourceWidth, sourceHeight);
      const mimeType = preserveAlpha ? 'image/png' : 'image/webp';
      const encodeQualities = preserveAlpha ? [100] : qualityLadder;

      let firstAcceptable: CompressedImage | null = null;
      let bestEffort: CompressedImage | null = null;

      for (const maxDimension of dimensionRungs) {
        const { width, height } = computeScaledSize(sourceWidth, sourceHeight, maxDimension);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas not supported'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        for (const quality of encodeQualities) {
          const dataUrl = preserveAlpha
            ? canvas.toDataURL(mimeType)
            : canvas.toDataURL(mimeType, quality / 100);
          const base64 = dataUrl.split(',')[1] || '';
          const bytes = getBase64ByteLength(base64);
          const fitWithinLimit = bytes <= maxBytes;
          const metTarget = bytes <= targetBytes;
          const iteration = attempts.length + 1;

          attempts.push({
            iteration,
            maxDimension,
            width,
            height,
            quality,
            mimeType,
            bytes,
            metTarget,
            fitWithinLimit,
          });

          const candidate: CompressedImage = {
            base64,
            mimeType,
            preview: dataUrl,
            width,
            height,
            bytes,
            iterations: iteration,
            attempts: [...attempts],
            targetBytes,
            maxBytes,
            minDimension,
          };

          bestEffort = candidate;

          if (fitWithinLimit && !firstAcceptable) {
            firstAcceptable = candidate;
          }

          if (metTarget) {
            resolve(candidate);
            return;
          }
        }

        if (firstAcceptable) {
          resolve(firstAcceptable);
          return;
        }
      }

      if (bestEffort) {
        resolve({
          ...bestEffort,
          fallbackReason: `Unable to shrink image inline below ${maxBytes} bytes.`,
        });
        return;
      }

      reject(new Error(`Unable to shrink image inline below ${maxBytes} bytes.`));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}
