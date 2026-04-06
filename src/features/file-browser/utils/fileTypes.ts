const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
]);

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

function fileExtension(name: string): string {
  return name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
}

/** Check if a filename is a supported image type. */
export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(name));
}

/** Check if a filename should open in the markdown document view. */
export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXTENSIONS.has(fileExtension(name));
}
