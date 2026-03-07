import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionList } from './SessionList';
import type { DiscoveredInstance } from '@/contexts/InstanceContext';

vi.mock('./SpawnAgentDialog', () => ({
  SpawnAgentDialog: () => null,
}));

vi.mock('./CreateInstanceDialog', () => ({
  CreateInstanceDialog: () => null,
}));

describe('SessionList instance stop button', () => {
  const onRefreshInstances = vi.fn().mockResolvedValue(undefined);
  const fetchMock = vi.fn();
  const originalFetch = globalThis.fetch;

  function renderList(instance: DiscoveredInstance) {
    return render(
      <SessionList
        instances={[instance]}
        sessions={[]}
        currentSession=""
        busyState={{}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onRefreshInstances={onRefreshInstances}
      />,
    );
  }

  beforeEach(() => {
    onRefreshInstances.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('enables stop button and calls stop endpoint when runtime state is running (availability ready)', async () => {
    renderList({
      id: 'inst-running',
      name: 'running',
      image: 'img',
      state: 'running',
      status: 'running',
      createdAt: null,
      hasGatewayToken: true,
      availability: 'ready',
    });

    const stopButton = screen.getByTitle('Stop instance');
    expect(stopButton).toBeEnabled();
    await userEvent.click(stopButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/instances/inst-running/stop');
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: 'POST' });
  });

  it('disables stop button when runtime state is not running even if availability is ready', async () => {
    renderList({
      id: 'inst-stopped',
      name: 'stopped',
      image: 'img',
      state: 'exited',
      status: 'Exited (0) 2 minutes ago',
      createdAt: null,
      hasGatewayToken: true,
      availability: 'ready',
    });

    const stopButton = screen.getByTitle('Instance already stopped');
    expect(stopButton).toBeDisabled();
    await userEvent.click(stopButton);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
