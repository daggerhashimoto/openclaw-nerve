import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('@/features/markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content, onOpenWorkspacePath }: { content: string; onOpenWorkspacePath?: ((path: string) => void) & { handlerId?: string }; onOpenBeadId?: ((beadId: string) => void) }) => (
    <div data-handler-id={onOpenWorkspacePath?.handlerId ?? ''}>{content}</div>
  ),
}));

vi.mock('@/features/charts/InlineChart', () => ({
  default: () => null,
}));

import { MessageBubble } from './MessageBubble';
import type { ChatMsg } from './types';

function makeMessage(overrides: Partial<ChatMsg> = {}): ChatMsg {
  return {
    role: 'user',
    html: '',
    rawText: 'hello from operator',
    timestamp: new Date('2026-03-18T12:00:00Z'),
    ...overrides,
  };
}

describe('MessageBubble', () => {
  it('heads operator messages with a "You" line and sets the text in a left-aligned plate', () => {
    const { container, getByText } = render(
      <MessageBubble
        msg={makeMessage()}
        index={0}
        isCollapsed={false}
        isMemoryCollapsed={false}
        onToggleCollapse={() => {}}
        onToggleMemory={() => {}}
      />,
    );

    const bubble = container.querySelector('.msg-user');
    const plate = container.querySelector('.msg-user .bg-message-user');
    const body = container.querySelector('.msg-body');

    expect(bubble).toBeTruthy();
    expect(getByText('You')).toBeTruthy();
    expect(bubble?.querySelector('.pane[data-state="operator"]')).toBeTruthy();
    expect(plate).toBeTruthy();
    expect(plate?.className).toContain('w-full');
    // The operator's whole turn sits on the plate: the name line is inside it
    expect(plate?.textContent).toContain('You');
    expect(body).toBeTruthy();
    expect(plate?.contains(body)).toBe(true);
    expect(body?.className).toContain('text-left');
  });

  it('leads assistant messages with the agent name and a dark pane once done', () => {
    const { container, getByText } = render(
      <MessageBubble
        msg={makeMessage({ role: 'assistant', rawText: 'Done.' })}
        index={0}
        isCollapsed={false}
        isMemoryCollapsed={false}
        onToggleCollapse={() => {}}
        onToggleMemory={() => {}}
        agentName="Jen (main)"
      />,
    );

    expect(getByText('Jen (main)')).toBeTruthy();
    expect(container.querySelector('.msg-assistant .pane[data-state="off"]')).toBeTruthy();
  });

  it('re-renders when onOpenWorkspacePath changes', async () => {
    const handlerOne = Object.assign(() => {}, { handlerId: 'one' });
    const handlerTwo = Object.assign(() => {}, { handlerId: 'two' });

    const { container, rerender } = render(
      <MessageBubble
        msg={makeMessage({ role: 'assistant', rawText: '[notes](docs/todo.md)' })}
        index={0}
        isCollapsed={false}
        isMemoryCollapsed={false}
        onToggleCollapse={() => {}}
        onToggleMemory={() => {}}
        onOpenWorkspacePath={handlerOne}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-handler-id="one"]')).toBeTruthy();
    });

    rerender(
      <MessageBubble
        msg={makeMessage({ role: 'assistant', rawText: '[notes](docs/todo.md)' })}
        index={0}
        isCollapsed={false}
        isMemoryCollapsed={false}
        onToggleCollapse={() => {}}
        onToggleMemory={() => {}}
        onOpenWorkspacePath={handlerTwo}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-handler-id="two"]')).toBeTruthy();
    });
  });

  it('renders upload attachment metadata for user messages loaded from history', async () => {
    const { getByText } = render(
      <MessageBubble
        msg={makeMessage({
          rawText: 'Please review these.',
          uploadAttachments: [
            {
              id: 'att-path',
              origin: 'server_path',
              mode: 'file_reference',
              name: 'capture.mov',
              mimeType: 'video/quicktime',
              sizeBytes: 8_000_000,
              reference: {
                kind: 'local_path',
                path: '/workspace/capture.mov',
                uri: 'file:///workspace/capture.mov',
              },
              preparation: {
                sourceMode: 'file_reference',
                finalMode: 'file_reference',
                outcome: 'file_reference_ready',
                originalMimeType: 'video/quicktime',
                originalSizeBytes: 8_000_000,
              },
              policy: { forwardToSubagents: true },
            },
          ],
        })}
        index={0}
        isCollapsed={false}
        isMemoryCollapsed={false}
        onToggleCollapse={() => {}}
        onToggleMemory={() => {}}
      />,
    );

    await waitFor(() => {
      expect(getByText('capture.mov')).toBeTruthy();
      expect(getByText('Local file')).toBeTruthy();
      expect(getByText('/workspace/capture.mov')).toBeTruthy();
    });
  });

  it('re-renders when upload attachment mimeType changes', async () => {
    const attachment = {
      id: 'att-path',
      origin: 'server_path' as const,
      mode: 'file_reference' as const,
      name: 'capture.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 8_000_000,
      reference: {
        kind: 'local_path' as const,
        path: '/workspace/capture.mov',
        uri: 'file:///workspace/capture.mov',
      },
      preparation: {
        sourceMode: 'file_reference' as const,
        finalMode: 'file_reference' as const,
        outcome: 'file_reference_ready' as const,
        originalMimeType: 'video/quicktime',
        originalSizeBytes: 8_000_000,
      },
      policy: { forwardToSubagents: true },
    };

    const { getByText, queryByText, rerender } = render(
      <MessageBubble
        msg={makeMessage({ rawText: 'Please review these.', uploadAttachments: [attachment] })}
        index={0}
        isCollapsed={false}
        isMemoryCollapsed={false}
        onToggleCollapse={() => {}}
        onToggleMemory={() => {}}
      />,
    );

    await waitFor(() => {
      expect(getByText('video/quicktime')).toBeTruthy();
    });

    rerender(
      <MessageBubble
        msg={makeMessage({
          rawText: 'Please review these.',
          uploadAttachments: [{ ...attachment, mimeType: 'video/mp4' }],
        })}
        index={0}
        isCollapsed={false}
        isMemoryCollapsed={false}
        onToggleCollapse={() => {}}
        onToggleMemory={() => {}}
      />,
    );

    await waitFor(() => {
      expect(getByText('video/mp4')).toBeTruthy();
      expect(queryByText('video/quicktime')).toBeNull();
    });
  });

  it('re-renders when upload attachment size changes', async () => {
    const attachment = {
      id: 'att-path',
      origin: 'server_path' as const,
      mode: 'file_reference' as const,
      name: 'capture.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 1024,
      reference: {
        kind: 'local_path' as const,
        path: '/workspace/capture.mov',
        uri: 'file:///workspace/capture.mov',
      },
      preparation: {
        sourceMode: 'file_reference' as const,
        finalMode: 'file_reference' as const,
        outcome: 'file_reference_ready' as const,
        originalMimeType: 'video/quicktime',
        originalSizeBytes: 1024,
      },
      policy: { forwardToSubagents: true },
    };

    const { getByText, queryByText, rerender } = render(
      <MessageBubble
        msg={makeMessage({ rawText: 'Please review these.', uploadAttachments: [attachment] })}
        index={0}
        isCollapsed={false}
        isMemoryCollapsed={false}
        onToggleCollapse={() => {}}
        onToggleMemory={() => {}}
      />,
    );

    await waitFor(() => {
      expect(getByText('1 KB')).toBeTruthy();
    });

    rerender(
      <MessageBubble
        msg={makeMessage({
          rawText: 'Please review these.',
          uploadAttachments: [{ ...attachment, sizeBytes: 2048, preparation: { ...attachment.preparation, originalSizeBytes: 2048 } }],
        })}
        index={0}
        isCollapsed={false}
        isMemoryCollapsed={false}
        onToggleCollapse={() => {}}
        onToggleMemory={() => {}}
      />,
    );

    await waitFor(() => {
      expect(getByText('2 KB')).toBeTruthy();
      expect(queryByText('1 KB')).toBeNull();
    });
  });
});
