/**
 * PdfViewer — Renders PDF files using the browser's built-in PDF viewer via iframe.
 * Falls back to opening the raw file directly on mobile web, where inline PDF embeds
 * are unreliable in Chrome-based browsers.
 */

import { Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OpenFile } from './types';

interface PdfViewerProps {
  file: OpenFile;
  agentId: string;
}

export function PdfViewer({ file, agentId }: PdfViewerProps) {
  if (file.loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs gap-2">
        <Loader2 className="animate-spin" size={14} />
        Loading {file.name}...
      </div>
    );
  }

  if (file.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <AlertTriangle size={24} className="text-destructive" />
        <div className="text-sm">Failed to load PDF</div>
        <div className="text-xs">{file.error}</div>
      </div>
    );
  }

  const src = `/api/files/raw?path=${encodeURIComponent(file.path)}&agentId=${encodeURIComponent(agentId)}`;
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const userAgent = (nav?.userAgent || '').toLowerCase();
  // navigator.platform is deprecated, but the MacIntel + touchpoints check is still
  // the most reliable way to catch iPadOS Safari reporting a desktop-like UA.
  const platform = (nav?.platform || '').toLowerCase();
  const maxTouchPoints = nav?.maxTouchPoints ?? 0;
  const isMobileWeb = /android|iphone|ipad|mobile|tablet/.test(userAgent)
    || (platform === 'macintel' && maxTouchPoints > 1);

  if (isMobileWeb) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#0a0a0a] px-6 text-center text-muted-foreground">
        <AlertTriangle size={24} className="text-amber-400" />
        <div className="text-sm text-foreground">PDF preview isn't supported on mobile web.</div>
        <div className="max-w-sm text-xs">
          Open the file directly for your browser's native PDF handling.
        </div>
        <Button asChild size="sm">
          <a href={src} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} />
            Open PDF
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-[#0a0a0a]">
      <iframe
        key={`pdf-${file.path}-v${file.viewerVersion ?? 0}`}
        src={src}
        title={file.name}
        className="w-full h-full border-0"
      />
    </div>
  );
}
