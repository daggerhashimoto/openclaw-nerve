import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectDialog } from './ConnectDialog';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

describe('ConnectDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows token field when serverSideAuth is disabled', () => {
    render(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken=""
        serverSideAuth={false}
      />,
    );

    expect(screen.getByLabelText('Auth Token')).toBeTruthy();
  });

  it('hides token field when serverSideAuth is active and url is the default', () => {
    render(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken=""
        serverSideAuth
      />,
    );

    expect(screen.queryByLabelText('Auth Token')).toBeFalsy();
  });

  it('shows token field when serverSideAuth is active but user changes url away from default', () => {
    render(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken=""
        serverSideAuth
      />,
    );

    const urlInput = screen.getByLabelText('WebSocket URL');
    fireEvent.change(urlInput, { target: { value: 'ws://example.com:1234/ws' } });

    expect(screen.getByLabelText('Auth Token')).toBeTruthy();
  });

  it('forces empty token when serverSideAuth is active for default host', async () => {
    const onConnect = vi.fn();
    render(
      <ConnectDialog
        open
        onConnect={onConnect}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken="stale-token"
        serverSideAuth
      />,
    );

    const connectButton = screen.getByText('CONNECT');
    fireEvent.click(connectButton);

    expect(onConnect).toHaveBeenCalledWith('ws://localhost:1234/ws', '');
  });
});
