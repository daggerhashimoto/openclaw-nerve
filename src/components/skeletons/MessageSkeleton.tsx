/**
 * MessageSkeleton: static placeholder for chat messages while they load.
 *
 * Shaped like a real message: a name and timestamp line, then body lines.
 */

interface MessageSkeletonProps {
  variant?: 'user' | 'assistant';
}

export function MessageSkeleton({ variant = 'assistant' }: MessageSkeletonProps) {
  const isUser = variant === 'user';

  return (
    <div className="px-4 py-3" aria-hidden="true">
      {/* Header row: name + timestamp */}
      <div className="mb-2 flex items-center gap-2">
        <div className={`h-3 rounded-[2px] bg-raised ${isUser ? 'w-8' : 'w-16'}`} />
        <div className="h-2.5 w-10 rounded-[2px] bg-raised" />
      </div>

      {/* Message body lines */}
      <div className="max-w-[var(--reading-measure)] space-y-2">
        <div className="h-2.5 w-4/5 rounded-[2px] bg-raised" />
        <div className="h-2.5 w-3/5 rounded-[2px] bg-raised" />
        {!isUser && <div className="h-2.5 w-2/5 rounded-[2px] bg-raised" />}
      </div>
    </div>
  );
}

/**
 * MessageSkeletonGroup: multiple skeletons for the loading state.
 */
export function MessageSkeletonGroup({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <MessageSkeleton key={i} variant={i % 2 === 0 ? 'user' : 'assistant'} />
      ))}
    </>
  );
}
