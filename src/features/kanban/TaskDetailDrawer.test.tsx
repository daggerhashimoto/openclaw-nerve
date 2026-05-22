import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import type { KanbanTask } from './types';

const mockUseSessionContext = vi.fn();

vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => mockUseSessionContext(),
}));

vi.mock('@/features/markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}));

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: 'task-1',
    title: 'Existing task',
    description: 'Hello',
    status: 'todo',
    priority: 'normal',
    createdBy: 'operator',
    createdAt: 1,
    updatedAt: 2,
    version: 3,
    assignee: 'agent:designer',
    labels: ['frontend'],
    columnOrder: 0,
    feedback: [],
    ...overrides,
  };
}

function renderDrawer(task: KanbanTask | null, onUpdate = vi.fn(async () => task as KanbanTask)) {
  const onDelete = vi.fn(async () => {});
  const onClose = vi.fn();
  render(
    <TaskDetailDrawer
      task={task}
      onClose={onClose}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />,
  );
  return { onUpdate, onDelete, onClose };
}

describe('TaskDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    mockUseSessionContext.mockReturnValue({
      sessions: [
        { sessionKey: 'agent:designer:main', identityName: 'Designer' },
        { sessionKey: 'agent:reviewer:main', identityName: 'Reviewer' },
      ],
      agentName: 'Kim',
    });
  });

  it('shows the friendly current assignee label when the task assignee is active', () => {
    renderDrawer(makeTask({ assignee: 'agent:designer' }));

    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveValue('Designer (designer)');
  });

  it('does not render the assignee combobox inside an extra input-styled shell', () => {
    renderDrawer(makeTask({ assignee: 'agent:designer' }));

    const combobox = screen.getByRole('combobox', { name: 'Assignee' });
    expect(combobox.parentElement).not.toHaveClass('cockpit-input');
  });

  it('shows a disabled stale-current option when the current assignee is no longer active', async () => {
    const user = userEvent.setup();
    renderDrawer(makeTask({ assignee: 'agent:ghost-reviewer' }));

    await user.click(screen.getByRole('combobox', { name: 'Assignee' }));

    const staleOption = await screen.findByRole('option', { name: /ghost reviewer.*inactive/i });
    expect(staleOption).toHaveAttribute('aria-disabled', 'true');
  });

  it('saves assignee as null when Unassigned is selected', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn(async () => makeTask({ assignee: undefined }));
    renderDrawer(makeTask({ assignee: 'agent:designer' }), onUpdate);

    await user.click(screen.getByRole('combobox', { name: 'Assignee' }));
    await user.click(await screen.findByRole('option', { name: 'Unassigned' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('task-1', expect.objectContaining({ assignee: null }));
    });
  });

  it('replaces a stale assignee with an active canonical value on save', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn(async () => makeTask({ assignee: 'agent:reviewer' }));
    renderDrawer(makeTask({ assignee: 'agent:ghost-reviewer' }), onUpdate);

    await user.click(screen.getByRole('combobox', { name: 'Assignee' }));
    await user.click(await screen.findByRole('option', { name: 'Reviewer (reviewer)' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('task-1', expect.objectContaining({ assignee: 'agent:reviewer' }));
    });
  });

  describe('result field markdown', () => {
    it('forwards task.result verbatim into MarkdownRenderer', async () => {
      // MarkdownRenderer is mocked above; this asserts the raw string is the
      // content prop reaching the renderer. The renderer's own GFM transform
      // (## headings, tables, etc.) is covered by tests inside the markdown
      // package and is intentionally NOT re-verified here.
      const result = '## Heading\n\n| col | col |\n|--|--|\n| a | b |';
      renderDrawer(makeTask({ result }));

      const md = await screen.findByTestId('md');
      expect(md.textContent).toBe(result);
    });

    it('does not render the result block when task.result is empty', () => {
      renderDrawer(makeTask({ result: '' }));
      expect(screen.queryByText('Result')).not.toBeInTheDocument();
    });

    it('does not render the result block when task.result is missing', () => {
      renderDrawer(makeTask({ result: undefined }));
      expect(screen.queryByText('Result')).not.toBeInTheDocument();
    });

    it('does not render the result block for whitespace-only content', () => {
      renderDrawer(makeTask({ result: '   \n\t  ' }));
      expect(screen.queryByText('Result')).not.toBeInTheDocument();
    });
  });

  describe('description edit toggle', () => {
    it('defaults to editing mode with the textarea visible', async () => {
      renderDrawer(makeTask({ description: '## Hello\n\n- bullet' }));

      expect(screen.getByRole('textbox', { name: /description/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /toggle description edit mode/i })).toHaveAttribute('aria-pressed', 'true');
    });

    it('renders markdown preview when the toggle is pressed off', async () => {
      const user = userEvent.setup();
      renderDrawer(makeTask({ description: '## Hello\n\n- bullet' }));

      await user.click(screen.getByRole('button', { name: /toggle description edit mode/i }));

      expect(screen.queryByRole('textbox', { name: /description/i })).not.toBeInTheDocument();
      const md = await screen.findByTestId('md');
      expect(md.textContent).toBe('## Hello\n\n- bullet');
    });

    it('preview reflects edited content, not the task original', async () => {
      const user = userEvent.setup();
      renderDrawer(makeTask({ description: 'original copy' }));

      const textarea = screen.getByRole('textbox', { name: /description/i });
      await user.clear(textarea);
      await user.type(textarea, 'edited body before toggle');

      await user.click(screen.getByRole('button', { name: /toggle description edit mode/i }));

      const md = await screen.findByTestId('md');
      expect(md.textContent).toBe('edited body before toggle');
      expect(md.textContent).not.toContain('original copy');
    });

    it('preserves in-flight edits when toggling off and back on', async () => {
      const user = userEvent.setup();
      renderDrawer(makeTask({ description: 'original' }));

      const textarea = screen.getByRole('textbox', { name: /description/i });
      await user.clear(textarea);
      await user.type(textarea, 'edited copy');

      const toggle = screen.getByRole('button', { name: /toggle description edit mode/i });
      await user.click(toggle);
      await user.click(toggle);

      expect(screen.getByRole('textbox', { name: /description/i })).toHaveValue('edited copy');
    });

    it('resets to editing mode when a different task is loaded', async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <TaskDetailDrawer
          task={makeTask({ id: 'task-A', description: '# A' })}
          onClose={vi.fn()}
          onUpdate={vi.fn(async () => makeTask())}
          onDelete={vi.fn(async () => {})}
        />,
      );

      await user.click(screen.getByRole('button', { name: /toggle description edit mode/i }));
      expect(screen.getByRole('button', { name: /toggle description edit mode/i })).toHaveAttribute('aria-pressed', 'false');

      rerender(
        <TaskDetailDrawer
          task={makeTask({ id: 'task-B', description: '# B' })}
          onClose={vi.fn()}
          onUpdate={vi.fn(async () => makeTask())}
          onDelete={vi.fn(async () => {})}
        />,
      );

      expect(screen.getByRole('button', { name: /toggle description edit mode/i })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('textbox', { name: /description/i })).toBeInTheDocument();
    });

    it('also resets to editing when the same task id rerenders with a new object reference', async () => {
      // The reset effect keys on the task reference, not task.id. A parent
      // re-render that hands down a fresh object (websocket tick, optimistic
      // update echo) is expected to behave identically to a task switch.
      // Pinning that here so a future refactor to [task?.id] surfaces as a
      // test break instead of a silent UX change.
      const user = userEvent.setup();
      const { rerender } = render(
        <TaskDetailDrawer
          task={makeTask({ id: 'task-A', description: '# A' })}
          onClose={vi.fn()}
          onUpdate={vi.fn(async () => makeTask())}
          onDelete={vi.fn(async () => {})}
        />,
      );

      await user.click(screen.getByRole('button', { name: /toggle description edit mode/i }));
      expect(screen.getByRole('button', { name: /toggle description edit mode/i })).toHaveAttribute('aria-pressed', 'false');

      rerender(
        <TaskDetailDrawer
          task={makeTask({ id: 'task-A', description: '# A' })}
          onClose={vi.fn()}
          onUpdate={vi.fn(async () => makeTask())}
          onDelete={vi.fn(async () => {})}
        />,
      );

      expect(screen.getByRole('button', { name: /toggle description edit mode/i })).toHaveAttribute('aria-pressed', 'true');
    });

    it('supports keyboard activation of the toggle', async () => {
      const user = userEvent.setup();
      renderDrawer(makeTask({ description: '# kb' }));

      const toggle = screen.getByRole('button', { name: /toggle description edit mode/i });
      toggle.focus();
      await user.keyboard('{Enter}');

      expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
