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

  it('shows token field when auth is disabled', () => {
    render(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken=""
        authEnabled={false}
      />,
    );

    expect(screen.getByText('Auth Token')).toBeInTheDocument();
  });

  it('hides token field when auth is enabled and url is the default', () => {
    render(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken=""
        authEnabled
      />,
    );

    expect(screen.queryByText('Auth Token')).not.toBeInTheDocument();
  });

  it('shows token field when auth is enabled but user changes url away from default', () => {
    render(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken=""
        authEnabled
      />,
    );

    const urlInput = screen.getByDisplayValue('ws://localhost:1234/ws');
    fireEvent.change(urlInput, { target: { value: 'ws://example.com:1234/ws' } });

    expect(screen.getByText('Auth Token')).toBeInTheDocument();
  });
});
