/**
 * FileContentView: syntax-highlighted display of new file content (Write operations).
 */

import { useMemo } from 'react';
import { sanitizeHtml } from '@/lib/sanitize';
import { detectLanguage, highlightCode } from '@/lib/highlight';

interface FileContentViewProps {
  content: string;
  filePath: string;
}

/** Collapsible syntax-highlighted view of a file's contents. */
export function FileContentView({ content, filePath }: FileContentViewProps) {
  const lang = detectLanguage(filePath);
  const lines = content.split('\n');

  const highlighted = useMemo(() => {
    return highlightCode(content, lang);
  }, [content, lang]);

  const htmlLines = highlighted.split('\n');

  return (
    <div className="file-content-container">
      <div className="file-content-header">
        <span className="file-content-badge">New</span>
        <span className="file-content-filepath">{filePath}</span>
        <span className="file-content-stats tabular">{lines.length} lines</span>
      </div>
      <pre className="file-content-code hljs">
        {htmlLines.map((html, i) => (
          <div key={i} className="file-content-line">
            <span className="file-content-line-num">{i + 1}</span>
            <code dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) || '&nbsp;' }} />
          </div>
        ))}
      </pre>
    </div>
  );
}
