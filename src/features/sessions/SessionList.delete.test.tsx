import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@/types';
import { SessionList } from './SessionList';

function renderSessionList(sessions: Session[], onDelete: (sessionKey: string) => Promise<void>) {
  return render(
    <SessionList
      sessions={sessions}
      currentSession=""
      busyState={{}}
      onSelect={() => {}}
      onRefresh={() => {}}
      onDelete={onDelete}
      onRename={async () => {}}
    />,
  );
}

describe('SessionList delete', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the confirm dialog open with the reason when a delete fails, then closes on a successful retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onDelete = vi.fn()
      .mockRejectedValueOnce(new Error('Session agent:ops:subagent:worker is still active; try again.'))
      .mockResolvedValueOnce(undefined);
    renderSessionList([{ sessionKey: 'agent:ops:subagent:worker', label: 'Worker' }], onDelete);

    act(() => {
      screen.getByTitle('Delete session').click();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Delete' }).click();
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Session agent:ops:subagent:worker is still active; try again.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();

    await act(async () => {
      screen.getByRole('button', { name: 'Delete' }).click();
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(onDelete).toHaveBeenNthCalledWith(2, 'agent:ops:subagent:worker');
  });
});
