/**
 * SessionSkeleton: static placeholder for session list rows while they load.
 *
 * One row unit tall, shaped like a real row: a dark pane, the label, and the token count.
 */

export function SessionSkeleton() {
  return (
    <div className="flex h-7 items-center gap-2 px-3" aria-hidden="true">
      {/* Pane placeholder */}
      <div className="h-[0.933rem] w-[0.667rem] shrink-0 rounded-[1px] bg-raised" />

      {/* Session label */}
      <div className="h-2.5 w-20 flex-1 rounded-[2px] bg-raised" />

      {/* Token count */}
      <div className="h-2.5 w-10 shrink-0 rounded-[2px] bg-raised" />
    </div>
  );
}

/**
 * SessionSkeletonGroup: multiple skeletons for the loading state.
 */
export function SessionSkeletonGroup({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SessionSkeleton key={i} />
      ))}
    </>
  );
}
