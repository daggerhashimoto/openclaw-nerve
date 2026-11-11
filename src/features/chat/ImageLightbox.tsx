import { useState, useCallback } from 'react';
import { Download, ExternalLink, X } from 'lucide-react';
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import { Dialog as DialogPrimitive } from 'radix-ui';

interface ImageLightboxProps {
  src: string;
  alt?: string;
  thumbnailClassName?: string;
}

/** Flat overlay control: popover plate, 1px rule, 28px tall (44px on touch layouts). */
const lightboxButtonClass =
  'inline-flex min-h-11 items-center gap-1.5 rounded-[3px] border border-border bg-popover px-2.5 text-[0.8rem] font-medium text-foreground transition-colors duration-[120ms] hover:bg-raised sm:min-h-[var(--row-unit)]';

/**
 * Thumbnail that expands into a full-screen lightbox on click. An image that
 * cannot be loaded (a gateway-hosted image the gateway has since forgotten,
 * say) leaves a quiet note in its place rather than a broken image or a gap.
 */
export function ImageLightbox({ src, alt = 'Image', thumbnailClassName }: ImageLightboxProps) {
  const [open, setOpen] = useState(false);
  // The source that failed, so a new source gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Extract filename: handle /api/files?path=... and direct URLs
      const pathParam = new URL(src, window.location.origin).searchParams.get('path');
      const rawName = pathParam
        ? pathParam.split('/').pop()
        : src.split('/').pop()?.split('?')[0];
      const filename = rawName || `image-${Date.now()}.png`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in new tab
      window.open(src, '_blank');
    }
  }, [src]);

  const handleOpenOriginal = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(src, '_blank');
  }, [src]);

  if (failedSrc === src) {
    return (
      <span
        className="inline-flex min-h-[var(--row-unit)] w-fit items-center self-start rounded-[3px] border border-border bg-card px-2.5 text-[0.8rem] text-muted-foreground"
        title={alt}
      >
        Image no longer available
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <img
          src={src}
          alt={alt}
          className={thumbnailClassName || "max-w-[512px] max-h-[512px] cursor-pointer rounded-[3px] border border-border object-contain transition-colors duration-[120ms] hover:border-pane-edge"}
          loading="lazy"
          onError={() => setFailedSrc(src)}
        />
      </DialogPrimitive.Trigger>
      <DialogPortal>
        <DialogOverlay className="bg-black/80" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
          onClick={() => setOpen(false)}
        >
          <DialogPrimitive.Title className="sr-only">{alt}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Expanded view of {alt}</DialogPrimitive.Description>
          <img
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[85vh] rounded-[3px] object-contain shadow-[0_12px_32px_rgba(0,0,0,0.32)]"
            onClick={(e) => e.stopPropagation()}
          />
          {/* Top-right action buttons */}
          <div className="absolute top-4 right-4 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={lightboxButtonClass}
              onClick={handleDownload}
              aria-label="Download image"
              title="Download"
            >
              <Download size={14} aria-hidden="true" />
              Save
            </button>
            <button
              type="button"
              className={lightboxButtonClass}
              onClick={handleOpenOriginal}
              aria-label="Open original"
              title="Open in new tab"
            >
              <ExternalLink size={14} aria-hidden="true" />
              Open
            </button>
            <button
              type="button"
              className={`${lightboxButtonClass} w-11 justify-center px-0 sm:w-[var(--row-unit)]`}
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
