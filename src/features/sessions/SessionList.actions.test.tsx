import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Session } from '@/types';
import { SessionList } from './SessionList';

const OPS_ROOT: Session = { sessionKey: 'agent:ops:main', label: 'Ops' };

function renderSessionList(
  sessions: Session[],
  props: Partial<React.ComponentProps<typeof SessionList>> = {},
) {
  return render(
    <SessionList
      sessions={sessions}
      currentSession=""
      busyState={{}}
      onSelect={() => {}}
      onRefresh={() => {}}
      onDelete={vi.fn(async () => {})}
      onRename={vi.fn(async () => {})}
      {...props}
    />,
  );
}

/** The row that shows this label, so its actions can be read without matching other rows. */
function rowFor(label: string): HTMLElement {
  const row = screen.getByText(label).closest<HTMLElement>('.group');
  if (!row) throw new Error(`No session row for ${label}`);
  return row;
}

function rowActions(label: string) {
  const row = within(rowFor(label));
  return {
    rename: row.queryByTitle('Rename session') !== null,
    delete: row.queryByTitle('Delete session') !== null,
  };
}

describe('SessionList row actions by session kind', () => {
  it.each([
    { kind: 'agent main', session: OPS_ROOT, rename: true, delete: false },
    { kind: 'default agent main', session: { sessionKey: 'agent:main:main', label: 'Fleet lead' }, rename: true, delete: false },
    { kind: 'subagent', session: { sessionKey: 'agent:ops:subagent:worker', label: 'Worker' }, rename: true, delete: true },
    { kind: 'cron', session: { sessionKey: 'agent:ops:cron:nightly', label: 'Nightly' }, rename: true, delete: true },
    { kind: 'cron run', session: { sessionKey: 'agent:ops:cron:nightly:run:r1', label: 'Nightly run' }, rename: true, delete: true },
    { kind: 'direct', session: { sessionKey: 'agent:ops:telegram:direct:123', displayName: 'Telegram DM' }, rename: true, delete: true },
    { kind: 'per-peer direct', session: { sessionKey: 'agent:ops:direct:alice', displayName: 'Alice' }, rename: true, delete: true },
    { kind: 'channel', session: { sessionKey: 'agent:ops:discord:channel:456', displayName: 'Discord ops' }, rename: true, delete: true },
    { kind: 'channel thread', session: { sessionKey: 'agent:ops:discord:channel:456:thread:789', displayName: 'Release thread' }, rename: true, delete: true },
    { kind: 'ACP child', session: { sessionKey: 'agent:ops:acp:abc', displayName: 'ACP run', parentSessionKey: 'agent:ops:main' }, rename: true, delete: true },
  ] satisfies { kind: string; session: Session; rename: boolean; delete: boolean }[])(
    'a $kind row offers rename: $rename, delete: $delete',
    ({ session, rename, delete: canDelete }) => {
      const sessions = session === OPS_ROOT ? [OPS_ROOT] : [OPS_ROOT, session];
      renderSessionList(sessions);

      const label = session.label ?? session.displayName ?? '';
      expect(rowActions(label)).toEqual({ rename, delete: canDelete });
    },
  );

  it('offers no rename or delete when the list has no handlers for them', () => {
    renderSessionList(
      [OPS_ROOT, { sessionKey: 'agent:ops:telegram:direct:123', displayName: 'Telegram DM' }],
      { onDelete: undefined, onRename: undefined },
    );

    expect(screen.queryByTitle('Rename session')).toBeNull();
    expect(screen.queryByTitle('Delete session')).toBeNull();
  });

  it('drops a row action when its handler goes away on a later render', () => {
    const sessions = [OPS_ROOT, { sessionKey: 'agent:ops:telegram:direct:123', displayName: 'Telegram DM' }];
    const { rerender } = renderSessionList(sessions);
    expect(rowActions('Telegram DM')).toEqual({ rename: true, delete: true });

    rerender(
      <SessionList
        sessions={sessions}
        currentSession=""
        busyState={{}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onRename={vi.fn(async () => {})}
      />,
    );

    expect(rowActions('Telegram DM')).toEqual({ rename: true, delete: false });
  });

  it('opens the same menu in compact mode: Rename and Delete on a direct row, Rename only on the main row', () => {
    renderSessionList(
      [OPS_ROOT, { sessionKey: 'agent:ops:telegram:direct:123', displayName: 'Telegram DM' }],
      { compact: true },
    );

    fireEvent.click(within(rowFor('Telegram DM')).getByRole('button', { name: 'Session actions' }));
    expect(rowActions('Telegram DM')).toEqual({ rename: true, delete: true });

    fireEvent.click(within(rowFor('Ops')).getByRole('button', { name: 'Session actions' }));
    expect(rowActions('Ops')).toEqual({ rename: true, delete: false });
  });
});

describe('SessionList rename and delete on channel sessions', () => {
  it('renames a direct session through the inline rename field', async () => {
    const onRename = vi.fn(async () => {});
    renderSessionList(
      [OPS_ROOT, { sessionKey: 'agent:ops:telegram:direct:123', displayName: 'Telegram DM' }],
      { onRename },
    );

    fireEvent.click(within(rowFor('Telegram DM')).getByTitle('Rename session'));
    const field = screen.getByDisplayValue('Telegram DM');
    fireEvent.change(field, { target: { value: 'Alice on Telegram' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('agent:ops:telegram:direct:123', 'Alice on Telegram'));
    await waitFor(() => expect(screen.queryByDisplayValue('Alice on Telegram')).toBeNull());
  });

  it('deletes a channel session after the confirm dialog', async () => {
    const onDelete = vi.fn(async () => {});
    renderSessionList(
      [OPS_ROOT, { sessionKey: 'agent:ops:discord:channel:456', displayName: 'Discord ops' }],
      { onDelete },
    );

    fireEvent.click(within(rowFor('Discord ops')).getByTitle('Delete session'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete session')).toBeInTheDocument();
    expect(within(dialog).getByText('agent:ops:discord:channel:456')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('agent:ops:discord:channel:456');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('counts the children a direct session takes with it in the confirm dialog', () => {
    renderSessionList([
      OPS_ROOT,
      { sessionKey: 'agent:ops:telegram:direct:123', displayName: 'Telegram DM' },
      { sessionKey: 'agent:ops:subagent:dm-helper', label: 'DM helper', parentSessionKey: 'agent:ops:telegram:direct:123' },
    ]);

    fireEvent.click(within(rowFor('Telegram DM')).getByTitle('Delete session'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete session tree')).toBeInTheDocument();
    expect(within(dialog).getByText('This will permanently delete this session and 1 nested child session.')).toBeInTheDocument();
  });
});
