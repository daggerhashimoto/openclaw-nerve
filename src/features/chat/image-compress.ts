/**
 * image-compress.ts — Client-side image compression for chat attachments.
 *
 * Resizes and compresses images to stay within the WebSocket 512KB payload limit.
 * Preserves PNG transparency when detected, falls back to JPEG otherwise.
 */

/** Max width/height in pixels */
const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.7;
/** ~350KB base64 budget per image (under 512KB WS limit with overhead) */
const MAX_COMPRESSED_BYTES = 350_000;

/** Check whether a canvas has any non-opaque pixels (samples every 4th pixel for speed) */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 16) {
    if (data[i] < 250) return true;
  }
  return false;
}

export interface CompressedImage {
  base64: string;
  mimeType: string;
  preview: string;
}

/** Compress an image file to JPEG/WebP within size and dimension limits. */
export function compressImage(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not supported'));
      ctx.drawImage(img, 0, 0, width, height);

      const isPng = file.type === 'image/png' || file.type === 'image/webp';
      const useAlpha = isPng && hasAlpha(ctx, width, height);
      const mimeType = useAlpha ? 'image/png' : 'image/jpeg';
      const quality = JPEG_QUALITY;

      const dataUrl = canvas.toDataURL(mimeType, quality);
      const base64 = dataUrl.split(',')[1];

      if (base64.length > MAX_COMPRESSED_BYTES) {
        // Retry at lower quality
        const retryMime = useAlpha ? 'image/jpeg' : mimeType;
        const retryUrl = canvas.toDataURL(retryMime, 0.4);
        const retryBase64 = retryUrl.split(',')[1];

        if (retryBase64.length <= MAX_COMPRESSED_BYTES) {
          resolve({ base64: retryBase64, mimeType: retryMime, preview: retryUrl });
          return;
        }

        // Still too large: scale dimensions to 50% and try once more
        const halfW = Math.round(width / 2);
        const halfH = Math.round(height / 2);
        const smallCanvas = document.createElement('canvas');
        smallCanvas.width = halfW;
        smallCanvas.height = halfH;
        const smallCtx = smallCanvas.getContext('2d');
        if (!smallCtx) return reject(new Error('Canvas not supported'));
        smallCtx.drawImage(canvas, 0, 0, halfW, halfH);

        const smallUrl = smallCanvas.toDataURL(retryMime, 0.4);
        const smallBase64 = smallUrl.split(',')[1];

        if (smallBase64.length > MAX_COMPRESSED_BYTES) {
          reject(new Error('Image is too large to send. Please use a smaller image.'));
          return;
        }

        resolve({ base64: smallBase64, mimeType: retryMime, preview: smallUrl });
      } else {
        resolve({ base64, mimeType, preview: dataUrl });
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
