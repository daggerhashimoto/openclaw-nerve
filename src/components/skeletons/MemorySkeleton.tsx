/**
 * MemorySkeleton: static placeholder for memory list rows while they load.
 *
 * One row unit tall, shaped like a real row: a chevron slot and the text.
 */

export function MemorySkeleton() {
  return (
    <div className="flex h-7 items-center gap-2 px-3" aria-hidden="true">
      {/* Chevron placeholder */}
      <div className="size-2.5 shrink-0 rounded-[2px] bg-raised" />

      {/* Text content */}
      <div className="flex flex-1 gap-2">
        <div className="h-2.5 flex-1 rounded-[2px] bg-raised" />
        <div className="h-2.5 w-1/4 rounded-[2px] bg-raised" />
      </div>
    </div>
  );
}

/**
 * MemorySkeletonGroup: multiple skeletons for the loading state.
 */
export function MemorySkeletonGroup({ count = 6 }: { count?: number }) {
  // Vary the widths so the placeholder reads like a real list
  const patterns = [
    { section: true, width: 'w-3/4' },
    { section: false, width: 'w-full' },
    { section: true, width: 'w-2/3' },
    { section: false, width: 'w-4/5' },
    { section: true, width: 'w-1/2' },
    { section: false, width: 'w-3/4' },
  ];

  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const pattern = patterns[i % patterns.length];
        return (
          <div
            key={i}
            className={`flex h-7 items-center gap-2 ${pattern.section ? 'px-3' : 'pl-8 pr-3'}`}
            aria-hidden="true"
          >
            {/* Chevron slot for section rows */}
            {pattern.section && <div className="size-2.5 shrink-0 rounded-[2px] bg-raised" />}

            {/* Text content with varying widths */}
            <div className={`h-2.5 ${pattern.width} rounded-[2px] bg-raised`} />
          </div>
        );
      })}
    </>
  );
}
