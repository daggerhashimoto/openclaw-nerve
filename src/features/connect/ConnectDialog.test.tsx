import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectDialog } from './ConnectDialog';

describe('ConnectDialog Mobile Usability', () => {
  const defaultProps = {
    open: true,
    onConnect: vi.fn(),
    error: '',
    defaultUrl: 'ws://localhost:18789',
    defaultToken: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog with connection form', () => {
    render(<ConnectDialog {...defaultProps} />);
    
    expect(screen.getByText('// CONNECT TO GATEWAY')).toBeInTheDocument();
    expect(screen.getByLabelText(/websocket url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/auth token/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  it('should call onConnect with trimmed values when submitted', async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(<ConnectDialog {...defaultProps} onConnect={onConnect} />);

    const urlInput = screen.getByLabelText(/websocket url/i);
    const tokenInput = screen.getByLabelText(/auth token/i);
    const connectButton = screen.getByRole('button', { name: /connect/i });

    fireEvent.change(urlInput, { target: { value: '  ws://test:8080  ' } });
    fireEvent.change(tokenInput, { target: { value: '  test-token  ' } });
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith('ws://test:8080', 'test-token');
    });
  });

  it('should handle Enter key in token input', async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(<ConnectDialog {...defaultProps} onConnect={onConnect} />);

    const tokenInput = screen.getByLabelText(/auth token/i);
    fireEvent.change(tokenInput, { target: { value: 'test-token' } });
    fireEvent.keyDown(tokenInput, { key: 'Enter' });

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalled();
    });
  });

  it('should show error message when provided', () => {
    render(<ConnectDialog {...defaultProps} error="Connection failed" />);
    
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });

  it('should show connecting state when button is clicked', async () => {
    const onConnect = vi.fn().mockImplementation(() => new Promise(() => {})); // Never resolves
    render(<ConnectDialog {...defaultProps} onConnect={onConnect} />);
    
    const urlInput = screen.getByLabelText(/websocket url/i);
    const tokenInput = screen.getByLabelText(/auth token/i);
    const connectButton = screen.getByRole('button', { name: /connect/i });
    
    fireEvent.change(urlInput, { target: { value: 'ws://test:8080' } });
    fireEvent.change(tokenInput, { target: { value: 'test-token' } });
    fireEvent.click(connectButton);
    
    // Button should show loading state
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('should not submit if URL or token is empty', () => {
    const onConnect = vi.fn();
    render(<ConnectDialog {...defaultProps} onConnect={onConnect} />);

    // Don't fill in values, just click connect
    const connectButton = screen.getByRole('button', { name: /connect/i });
    fireEvent.click(connectButton);

    expect(onConnect).not.toHaveBeenCalled();
  });
});
