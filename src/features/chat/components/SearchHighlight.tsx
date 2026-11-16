import { escapeRegex } from '@/lib/constants';

/** Text with the search terms marked, as message bodies mark them. */
export function SearchHighlight({ text, query }: { text: string; query?: string }) {
  if (!query?.trim()) return <>{text}</>;

  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  const parts = text.split(regex);

  // split() with a capture group alternates: non-match, match, non-match, ...
  // Odd indices are always the captured matches
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="search-highlight">{part}</mark>
        ) : part
      )}
    </>
  );
}
