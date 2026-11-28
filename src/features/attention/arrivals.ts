/**
 * Items that arrive while the operator is looking. They are held back behind a "2 new · Show"
 * pill instead of reshuffling the board; shown, each one goes to its ranked place among the
 * items already there, which keep their frozen order.
 */

/**
 * The stable list with arrivals placed: items present at the epoch's start keep their order,
 * held arrivals are left out, and every other arrival goes in front of the first item that
 * ranks below it in `ranked` (or at the end).
 */
export function placeArrivals<T extends { key: string }>(
  stable: T[],
  ranked: T[],
  newKeys: ReadonlySet<string>,
  held: ReadonlySet<string>,
): T[] {
  const rank = new Map(ranked.map((item, index) => [item.key, index] as const));
  const rankOf = (item: T) => rank.get(item.key) ?? Number.POSITIVE_INFINITY;
  const out = stable.filter((item) => !newKeys.has(item.key));
  const arrivals = stable
    .filter((item) => newKeys.has(item.key) && !held.has(item.key))
    .sort((a, b) => rankOf(a) - rankOf(b));
  for (const item of arrivals) {
    const at = out.findIndex((other) => rankOf(other) > rankOf(item));
    if (at === -1) out.push(item);
    else out.splice(at, 0, item);
  }
  return out;
}
