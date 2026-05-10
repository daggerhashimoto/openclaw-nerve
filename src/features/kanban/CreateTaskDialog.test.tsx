import type React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateTaskDialog } from './CreateTaskDialog';

const mockUseSessionContext = vi.fn();

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, className, onKeyDown }: { children: React.ReactNode; className?: string; onKeyDown?: React.KeyboardEventHandler<HTMLDivElement> }) => <div className={className} onKeyDown={onKeyDown}>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => mockUseSessionContext(),
}));

function renderDialog(
  onCreate = vi.fn(async () => {}),
  onOpenChange = vi.fn(),
) {
  return render(
    <CreateTaskDialog
      open
      onOpenChange={onOpenChange}
      onCreate={onCreate}
    />,
  );
}

describe('CreateTaskDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    mockUseSessionContext.mockReturnValue({
      sessions: [
        { sessionKey: 'agent:main:main', label: 'Kim (main)' },
        { sessionKey: 'agent:designer:main', identityName: 'Designer' },
        { sessionKey: 'agent:reviewer:main', identityName: 'Reviewer' },
        { sessionKey: 'agent:designer:subagent:abc', label: 'Designer helper' },
      ],
      agentName: 'Kim',
    });
  });

  it('shows Unassigned, Operator, and active top-level agents in the assignee picker', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('combobox', { name: 'Assignee' }));

    expect(await screen.findByRole('option', { name: 'Unassigned' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Operator' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Designer (designer)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Reviewer (reviewer)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Kim (main)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Designer helper' })).not.toBeInTheDocument();
  });

  it('submits the canonical assignee value when a friendly option is selected', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => {});
    renderDialog(onCreate);

    await user.type(screen.getByLabelText(/title/i), 'Test task');
    await user.click(screen.getByRole('combobox', { name: 'Assignee' }));
    await user.click(await screen.findByRole('option', { name: 'Designer (designer)' }));
    await user.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalled();
    });

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Test task',
      assignee: 'agent:designer',
    }));
  });

  it('omits assignee from the create payload when left unassigned', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => {});
    renderDialog(onCreate);

    await user.type(screen.getByLabelText(/title/i), 'Unassigned task');
    await user.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalled();
    });

    const payload = onCreate.mock.calls[0][0];
    expect(payload.title).toBe('Unassigned task');
    expect(Object.prototype.hasOwnProperty.call(payload, 'assignee')).toBe(false);
  });

  it('does not allow arbitrary raw assignee values to be submitted', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => {});
    renderDialog(onCreate);

    await user.type(screen.getByLabelText(/title/i), 'Closed set task');
    const assigneeInput = screen.getByRole('combobox', { name: 'Assignee' });
    await user.click(assigneeInput);
    fireEvent.change(screen.getByRole('combobox', { name: 'Assignee' }), {
      target: { value: 'agent:ghost' },
    });
    expect(await screen.findByText('No matching assignees')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalled();
    });

    const payload = onCreate.mock.calls[0][0];
    expect(Object.prototype.hasOwnProperty.call(payload, 'assignee')).toBe(false);
  });
});
