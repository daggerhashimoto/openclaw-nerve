/** The Today heading, e.g. "Today, Sat 28 Nov". Its own module so views can share it. */
export function dayHeading(now: number): string {
  const date = new Date(now);
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short' });
  const month = date.toLocaleDateString('en-GB', { month: 'short' });
  return `Today, ${weekday} ${date.getDate()} ${month}`;
}
