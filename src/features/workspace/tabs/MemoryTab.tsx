/**
 * MemoryTab — Wraps existing MemoryList component.
 * Zero changes to the underlying memory feature.
 */

import { lazy, Suspense } from 'react';
import type { Memory } from '@/types';

const MemoryList = lazy(() => import('@/features/dashboard/MemoryList').then(m => ({ default: m.MemoryList })));

interface MemoryTabProps {
  memories: Memory[];
  onRefresh: (signal?: AbortSignal) => void | Promise<void>;
  isLoading?: boolean;
  /** Compact mode for mobile/topbar dropdown; uses kebab actions for rows. */
  compact?: boolean;
}

/** Workspace tab displaying agent memories with add/refresh actions. */
export function MemoryTab({ memories, onRefresh, isLoading, compact = false }: MemoryTabProps) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center text-muted-foreground text-xs p-4">Loading…</div>}>
      <MemoryList memories={memories} onRefresh={onRefresh} isLoading={isLoading} hideHeader compact={compact} />
    </Suspense>
  );
}
