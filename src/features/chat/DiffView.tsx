/**
 * DiffView: side-by-side diff display for file edits.
 * Detects Edit tool calls and renders old/new code side by side.
 */

import { useMemo } from 'react';
import diff from 'diff-sequences';
import { sanitizeHtml } from '@/lib/sanitize';
import { detectLanguage, highlightCode } from '@/lib/highlight';

interface DiffViewProps {
  oldText: string;
  newText: string;
  filePath?: string;
  language?: string;
}

type DiffLineType = 'unchanged' | 'removed' | 'added';

interface DiffLine {
  type: DiffLineType;
  oldLineNum?: number;
  newLineNum?: number;
  oldContent?: string;
  newContent?: string;
  oldHtml?: string;
  newHtml?: string;
}

function computeLineDiff(oldLines: string[], newLines: string[], oldHtmlLines: string[], newHtmlLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  
  // Arrays to track which lines are common
  const commonOld: boolean[] = new Array(oldLines.length).fill(false);
  const commonNew: boolean[] = new Array(newLines.length).fill(false);
  
  // Find common subsequences
  diff(
    oldLines.length,
    newLines.length,
    (aIndex, bIndex) => oldLines[aIndex] === newLines[bIndex],
    (nCommon, aCommon, bCommon) => {
      // Mark common lines
      for (let i = 0; i < nCommon; i++) {
        commonOld[aCommon + i] = true;
        commonNew[bCommon + i] = true;
      }
    }
  );
  
  // Build the unified diff by walking through both files
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && commonOld[oldIndex] && 
        newIndex < newLines.length && commonNew[newIndex] &&
        oldLines[oldIndex] === newLines[newIndex]) {
      // Unchanged line - show on both sides
      result.push({
        type: 'unchanged',
        oldLineNum: oldIndex + 1,
        newLineNum: newIndex + 1,
        oldContent: oldLines[oldIndex],
        newContent: newLines[newIndex],
        oldHtml: oldHtmlLines[oldIndex],
        newHtml: newHtmlLines[newIndex],
      });
      oldIndex++;
      newIndex++;
    } else if (oldIndex < oldLines.length && !commonOld[oldIndex]) {
      // Removed line - show only on left
      result.push({
        type: 'removed',
        oldLineNum: oldIndex + 1,
        oldContent: oldLines[oldIndex],
        oldHtml: oldHtmlLines[oldIndex],
      });
      oldIndex++;
    } else if (newIndex < newLines.length && !commonNew[newIndex]) {
      // Added line - show only on right
      result.push({
        type: 'added',
        newLineNum: newIndex + 1,
        newContent: newLines[newIndex],
        newHtml: newHtmlLines[newIndex],
      });
      newIndex++;
    } else {
      // This shouldn't happen if our logic is correct, but as a safeguard
      if (oldIndex < oldLines.length) oldIndex++;
      if (newIndex < newLines.length) newIndex++;
    }
  }
  
  return result;
}

/** Side-by-side or unified diff view for file edit blocks. */
export function DiffView({ oldText, newText, filePath, language }: DiffViewProps) {
  const lang = language || detectLanguage(filePath);
  
  const { diffLines, stats } = useMemo(() => {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    
    const oldHighlighted = highlightCode(oldText, lang);
    const newHighlighted = highlightCode(newText, lang);
    const oldHtmlLines = oldHighlighted.split('\n');
    const newHtmlLines = newHighlighted.split('\n');
    
    const diffLines = computeLineDiff(oldLines, newLines, oldHtmlLines, newHtmlLines);
    
    // Calculate actual stats
    const removedCount = diffLines.filter(line => line.type === 'removed').length;
    const addedCount = diffLines.filter(line => line.type === 'added').length;
    
    return {
      diffLines,
      stats: { removed: removedCount, added: addedCount }
    };
  }, [oldText, newText, lang]);

  return (
    <div className="diff-container">
      {filePath && (
        <div className="diff-header">
          <span className="diff-filepath">{filePath}</span>
          <span className="diff-stats tabular">
            <span className="text-green">+{stats.added}</span>
            {' '}
            <span className="text-red">-{stats.removed}</span>
          </span>
        </div>
      )}
      <div className="diff-panels">
        <div className="diff-panel diff-panel-old">
          <div className="diff-panel-label">Before</div>
          <pre className="diff-code hljs">
            {diffLines.map((line, i) => {
              const showOld = line.type === 'unchanged' || line.type === 'removed';
              const cssClass = line.type === 'removed' ? 'diff-line-remove' : 
                             line.type === 'unchanged' ? '' : 'diff-line-empty';
              
              return (
                <div key={`old-${i}`} className={`diff-line ${cssClass}`}>
                  <span className="diff-line-num">
                    {showOld && line.oldLineNum ? line.oldLineNum : ''}
                  </span>
                  <code dangerouslySetInnerHTML={{ 
                    __html: sanitizeHtml(showOld ? line.oldHtml || '' : '') || '&nbsp;' 
                  }} />
                </div>
              );
            })}
          </pre>
        </div>
        <div className="diff-panel diff-panel-new">
          <div className="diff-panel-label">After</div>
          <pre className="diff-code hljs">
            {diffLines.map((line, i) => {
              const showNew = line.type === 'unchanged' || line.type === 'added';
              const cssClass = line.type === 'added' ? 'diff-line-add' : 
                             line.type === 'unchanged' ? '' : 'diff-line-empty';
              
              return (
                <div key={`new-${i}`} className={`diff-line ${cssClass}`}>
                  <span className="diff-line-num">
                    {showNew && line.newLineNum ? line.newLineNum : ''}
                  </span>
                  <code dangerouslySetInnerHTML={{ 
                    __html: sanitizeHtml(showNew ? line.newHtml || '' : '') || '&nbsp;' 
                  }} />
                </div>
              );
            })}
          </pre>
        </div>
      </div>
    </div>
  );
}

// Edit block extraction moved to ./edit-blocks.ts
