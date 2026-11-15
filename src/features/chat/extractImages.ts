/**
 * extractImages: Pull image references out of agent message text.
 *
 * Detects three patterns:
 *  1. Markdown images: ![alt](url)
 *  2. MEDIA: markers: MEDIA: /path/to/image.png (OpenClaw convention)
 *  3. Raw URLs ending in image extensions on their own line
 *
 * Returns cleaned text (markers stripped) and an array of extracted images.
 */

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

/** Markdown image: ![alt](url) */
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** MEDIA: /path/to/file or MEDIA: https://... (full line) */
const MEDIA_RE = /^MEDIA:\s*(.+)$/gm;

/** Bare URL on its own line pointing to an image */
const BARE_URL_RE = /^(https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?)$/gim;

export interface ExtractedImage {
  url: string;
  alt?: string;
  isLocal: boolean;
}

export interface ImageExtractionResult {
  cleaned: string;
  images: ExtractedImage[];
}

function isLocalPath(ref: string): boolean {
  return ref.startsWith('/') || ref.startsWith('./') || ref.startsWith('~');
}

function imageUrl(ref: string): string {
  if (isLocalPath(ref)) {
    return `/api/files?path=${encodeURIComponent(ref)}`;
  }
  return ref;
}

/** Extract image URLs and base64 images from markdown text. */
export function extractImages(text: string): ImageExtractionResult {
  const images: ExtractedImage[] = [];
  const seen = new Set<string>();

  let cleaned = text;

  // 1. Markdown images: only extract if the URL looks like an image
  cleaned = cleaned.replace(MD_IMAGE_RE, (match, alt: string, url: string) => {
    if (!IMAGE_EXTENSIONS.test(url.split('?')[0])) return match; // keep non-image markdown links
    const raw = url.trim();
    if (!seen.has(raw)) {
      seen.add(raw);
      images.push({ url: imageUrl(raw), alt: alt || undefined, isLocal: isLocalPath(raw) });
    }
    return ''; // strip the marker
  });

  // 2. MEDIA: markers
  cleaned = cleaned.replace(MEDIA_RE, (_match, ref: string) => {
    const raw = ref.trim();
    if (!IMAGE_EXTENSIONS.test(raw.split('?')[0])) return _match; // only images
    if (!seen.has(raw)) {
      seen.add(raw);
      images.push({ url: imageUrl(raw), alt: undefined, isLocal: isLocalPath(raw) });
    }
    return '';
  });

  // 3. Bare image URLs on their own line
  cleaned = cleaned.replace(BARE_URL_RE, (match) => {
    const raw = match.trim();
    if (!seen.has(raw)) {
      seen.add(raw);
      images.push({ url: raw, alt: undefined, isLocal: false });
    }
    return '';
  });

  // Collapse excessive blank lines left by stripping
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return { cleaned, images };
}
