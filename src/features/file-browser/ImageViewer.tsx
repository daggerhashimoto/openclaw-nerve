/**
 * ImageViewer — Renders image files (png, jpg, svg, etc.) in a centered view.
 */

import { Loader2, AlertTriangle } from 'lucide-react';
import type { OpenFile } from './types';

interface ImageViewerProps {
  file: OpenFile;
  agentId: string;
}

export function ImageViewer({ file, agentId }: ImageViewerProps) {
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
        <div className="text-sm">Failed to load image</div>
        <div className="text-xs">{file.error}</div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center p-6 overflow-auto bg-[#0a0a0a]">
      <img
        src={`/api/files/raw?path=${encodeURIComponent(file.path)}&agentId=${encodeURIComponent(agentId)}`}
        alt={file.name}
        className="max-w-full max-h-full object-contain rounded"
        draggable={false}
      />
    </div>
  );
}
