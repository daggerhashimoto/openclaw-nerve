/**
 * Local system notices (a send or reset that failed, a history read that failed,
 * a session reset) are built in the browser rather than read from history. The
 * redesigned bubble renders a message's rawText, so a notice built with its text
 * only in html showed an empty "System" row.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import { systemNotice } from './types';

beforeAll(async () => {
  // The bubble lazy-loads the real markdown renderer; load it before the first render.
  await import('@/features/markdown/MarkdownRenderer');
});

function renderNotice(text: string, isCollapsed: boolean) {
  return render(
    <MessageBubble
      msg={systemNotice(text)}
      index={0}
      isCollapsed={isCollapsed}
      isMemoryCollapsed={false}
      onToggleCollapse={() => {}}
      onToggleMemory={() => {}}
    />,
  );
}

describe('systemNotice', () => {
  it('is a system row that carries its text for the bubble and as escaped html', () => {
    const notice = systemNotice('Send error: <b>boom</b>');
    expect(notice.role).toBe('system');
    expect(notice.rawText).toBe('Send error: <b>boom</b>');
    expect(notice.html).toBe('Send error: &lt;b&gt;boom&lt;/b&gt;');
    expect(notice.msgId).toBeTruthy();
  });

  it.each([
    'Send error: Disconnected',
    'Session reset. Starting fresh.',
    'Reset failed: Not connected',
    'Failed to load history: Timeout',
  ])('shows "%s" in an open bubble', async (text) => {
    renderNotice(text, false);
    expect(await screen.findByText(text, undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows the notice as the preview of a collapsed bubble', () => {
    const { container } = renderNotice('Send error: Disconnected', true);
    expect(container.textContent).toContain('Send error: Disconnected');
  });

  it('shows markdown in an error message literally, so an image or link in it is never fetched or followed', async () => {
    const text = 'Send error: ![x](https://example.invalid/pixel.png) see [docs](https://example.invalid) **now**';
    const { container } = renderNotice(text, false);
    expect(await screen.findByText(text, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
  });

  it('shows markup in an error message as text, never as elements', async () => {
    const { container } = renderNotice('Send error: <b>boom</b>', false);
    expect(await screen.findByText('Send error: <b>boom</b>', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });
});
