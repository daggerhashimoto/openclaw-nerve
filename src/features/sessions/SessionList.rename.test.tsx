import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Session } from '@/types';
import { SessionList } from './SessionList';

const SESSIONS: Session[] = [
  { sessionKey: 'agent:ops:main', label: 'Ops' },
  { sessionKey: 'agent:ops:telegram:direct:123', displayName: 'Telegram DM' },
  { sessionKey: 'agent:ops:discord:channel:456', displayName: 'Discord ops' },
];

function renderSessionList(onRename: (sessionKey: string, label: string) => Promise<void>, compact = false) {
  return render(
    <SessionList
      sessions={SESSIONS}
      currentSession=""
      busyState={{}}
      onSelect={() => {}}
      onRefresh={() => {}}
      onDelete={async () => {}}
      onRename={onRename}
      compact={compact}
    />,
  );
}

function rowFor(label: string): HTMLElement {
  const row = screen.getByText(label).closest<HTMLElement>('.group');
  if (!row) throw new Error(`No session row for ${label}`);
  return row;
}

/** Open the rename field on a row, type a name and press Enter. */
async function renameTo(rowLabel: string, name: string) {
  fireEvent.click(within(rowFor(rowLabel)).getByTitle('Rename session'));
  const field = screen.getByDisplayValue(rowLabel);
  fireEvent.change(field, { target: { value: name } });
  await act(async () => {
    fireEvent.keyDown(field, { key: 'Enter' });
  });
  return field;
}

describe('SessionList rename failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the field open with the typed name and says why when the gateway refuses the label', async () => {
    const onRename = vi.fn().mockRejectedValueOnce(new Error('label already in use: Ops on Telegram'));
    renderSessionList(onRename);

    await renameTo('Telegram DM', 'Ops on Telegram');

    const field = screen.getByDisplayValue('Ops on Telegram');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Name already in use');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAttribute('aria-describedby', alert.id);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('agent:ops:telegram:direct:123', 'Ops on Telegram');
  });

  it.each([
    ['invalid label: too long (max 512)', 'Name too long (max 512)'],
    ['Not connected', 'Not connected'],
    ['request failed', 'Request failed'],
  ])('shows the reason for "%s" as "%s"', async (message, reason) => {
    renderSessionList(vi.fn().mockRejectedValueOnce(new Error(message)));

    await renameTo('Telegram DM', 'Alice');

    expect(await screen.findByRole('alert')).toHaveTextContent(reason);
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
  });

  it('closes the field and clears the reason when a retry succeeds', async () => {
    const onRename = vi.fn()
      .mockRejectedValueOnce(new Error('label already in use: Ops'))
      .mockResolvedValueOnce(undefined);
    renderSessionList(onRename);

    const field = await renameTo('Telegram DM', 'Ops');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: 'Alice on Telegram' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });

    await waitFor(() => expect(screen.queryByDisplayValue('Alice on Telegram')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onRename).toHaveBeenLastCalledWith('agent:ops:telegram:direct:123', 'Alice on Telegram');
  });

  it('abandons the edit and clears the reason on Escape', async () => {
    renderSessionList(vi.fn().mockRejectedValueOnce(new Error('label already in use: Ops')));

    const field = await renameTo('Telegram DM', 'Ops');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.keyDown(field, { key: 'Escape' });

    expect(screen.queryByDisplayValue('Ops')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Telegram DM')).toBeInTheDocument();
  });

  it('abandons the edit on blur when the refused name was left as it was, without asking again', async () => {
    const onRename = vi.fn().mockRejectedValueOnce(new Error('label already in use: Ops'));
    renderSessionList(onRename);

    const field = await renameTo('Telegram DM', 'Ops');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await act(async () => {
      fireEvent.blur(field);
    });

    expect(screen.queryByDisplayValue('Ops')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it('does not carry the reason over to a rename started on another row', async () => {
    renderSessionList(vi.fn().mockRejectedValueOnce(new Error('label already in use: Ops')));

    await renameTo('Telegram DM', 'Ops');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.click(within(rowFor('Discord ops')).getByTitle('Rename session'));

    const other = screen.getByDisplayValue('Discord ops');
    expect(other).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByDisplayValue('Ops')).toBeNull();
  });

  it('shows the reason under the field in the compact column too', async () => {
    renderSessionList(vi.fn().mockRejectedValueOnce(new Error('label already in use: Ops')), true);

    fireEvent.click(within(rowFor('Telegram DM')).getByRole('button', { name: 'Session actions' }));
    fireEvent.click(within(rowFor('Telegram DM')).getByTitle('Rename session'));
    const field = screen.getByDisplayValue('Telegram DM');
    fireEvent.change(field, { target: { value: 'Ops' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Name already in use');
    expect(screen.getByDisplayValue('Ops')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('SessionList rename without a change', () => {
  it.each([
    ['an empty name', '   '],
    ['the same name', 'Telegram DM'],
    ['the same name with spaces around it', '  Telegram DM '],
  ])('closes the field without asking the gateway for %s', async (_case, value) => {
    const onRename = vi.fn(async () => {});
    renderSessionList(onRename);

    await renameTo('Telegram DM', value);

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Telegram DM')).toBeInTheDocument();
  });

  it('sends one rename when the field loses focus while the first is still saving', async () => {
    let finish: () => void = () => {};
    const onRename = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderSessionList(onRename);

    const field = await renameTo('Telegram DM', 'Alice');
    fireEvent.blur(field);
    await act(async () => {
      finish();
    });

    expect(onRename).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });
});
