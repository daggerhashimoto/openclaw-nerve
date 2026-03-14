import React, { useState, useCallback } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { getExtension } from '@/lib/highlight';

interface CodeBlockActionsProps {
  code: string;
  language: string;
}

/** Copy-to-clipboard button overlay for fenced code blocks. */
export function CodeBlockActions({ code, language }: CodeBlockActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('Clipboard copy failed', err);
    }
  }, [code]);

  const handleSave = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const ext = getExtension(language);
    const filename = `code.${ext}`;
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Delay revoke to ensure download starts in all browsers
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }, [code, language]);

  return (
    <div className="code-block-actions">
      <button
        className="code-action-btn"
        onClick={handleCopy}
        aria-label={copied ? 'Code copied' : 'Copy code'}
        title={copied ? 'Copied' : 'Copy to clipboard'}
      >
        {copied ? (
          <Check size={14} className="code-action-feedback" aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
      </button>
      <button
        className="code-action-btn"
        onClick={handleSave}
        aria-label="Save to file"
        title={`Save as code.${getExtension(language)}`}
      >
        <Download size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
