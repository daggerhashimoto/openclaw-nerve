import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectDialog } from './ConnectDialog';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

vi.mock('@/components/NerveLogo', () => ({
  default: () => <div>NerveLogo</div>,
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
        officialUrl="ws://localhost:1234/ws"
        serverSideAuth={false}
      />,
    );

    expect(screen.getByLabelText('Gateway token')).toBeTruthy();
  });

  it('hides token field when serverSideAuth is active and url is the default', () => {
    render(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken=""
        officialUrl="ws://localhost:1234/ws"
        serverSideAuth
      />,
    );

    expect(screen.queryByLabelText('Gateway token')).toBeFalsy();
  });

  it('hides token field when url is a loopback alias of the official gateway', () => {
    render(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken="stale-token"
        officialUrl="ws://127.0.0.1:1234/ws"
        serverSideAuth
      />,
    );

    expect(screen.queryByLabelText('Gateway token')).toBeFalsy();
  });

  it('shows token field when serverSideAuth is active but user changes url away from default', () => {
    render(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken=""
        officialUrl="ws://localhost:1234/ws"
        serverSideAuth
      />,
    );

    const urlInput = screen.getByLabelText('WebSocket endpoint');
    fireEvent.change(urlInput, { target: { value: 'ws://example.com:1234/ws' } });

    expect(screen.getByLabelText('Gateway token')).toBeTruthy();
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
        officialUrl="ws://localhost:1234/ws"
        serverSideAuth
      />,
    );

    const connectButton = screen.getByText('Connect to Gateway');
    fireEvent.click(connectButton);

    expect(onConnect).toHaveBeenCalledWith('ws://localhost:1234/ws', '');
  });

  it('canonicalizes loopback aliases to the official gateway url on connect', async () => {
    const onConnect = vi.fn();
    render(
      <ConnectDialog
        open
        onConnect={onConnect}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken="stale-token"
        officialUrl="ws://127.0.0.1:1234/ws"
        serverSideAuth
      />,
    );

    fireEvent.click(screen.getByText('Connect to Gateway'));

    expect(onConnect).toHaveBeenCalledWith('ws://127.0.0.1:1234/ws', '');
  });

  it('keeps token entry visible for saved custom urls when official url differs', async () => {
    const onConnect = vi.fn();
    render(
      <ConnectDialog
        open
        onConnect={onConnect}
        error=""
        defaultUrl="ws://custom.example/ws"
        defaultToken="custom-token"
        officialUrl="ws://official.example/ws"
        serverSideAuth
      />,
    );

    expect(screen.getByLabelText('Gateway token')).toBeTruthy();

    fireEvent.click(screen.getByText('Connect to Gateway'));

    expect(onConnect).toHaveBeenCalledWith('ws://custom.example/ws', 'custom-token');
  });
});
