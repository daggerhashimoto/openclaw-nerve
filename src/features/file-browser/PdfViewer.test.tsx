import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PdfViewer } from './PdfViewer';
import type { OpenFile } from './types';

const baseFile: OpenFile = {
  path: 'docs/spec.pdf',
  name: 'spec.pdf',
  content: '',
  savedContent: '',
  dirty: false,
  locked: false,
  mtime: 0,
  loading: false,
};

const originalNavigator = {
  userAgent: window.navigator.userAgent,
  platform: window.navigator.platform,
  maxTouchPoints: window.navigator.maxTouchPoints,
};

function setNavigatorEnv({
  userAgent = originalNavigator.userAgent,
  platform = originalNavigator.platform,
  maxTouchPoints = originalNavigator.maxTouchPoints,
}: Partial<typeof originalNavigator>) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });

  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  });

  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: maxTouchPoints,
  });
}

afterEach(() => {
  setNavigatorEnv(originalNavigator);
});

describe('PdfViewer', () => {
  it('renders the inline iframe viewer on desktop browsers', () => {
    render(<PdfViewer file={baseFile} agentId="agent-1" />);

    const iframe = screen.getByTitle('spec.pdf');
    expect(iframe).toHaveAttribute(
      'src',
      '/api/files/raw?path=docs%2Fspec.pdf&agentId=agent-1',
    );
  });

  it('shows an external-open fallback on mobile web where inline PDF preview is unsupported', () => {
    setNavigatorEnv({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/123.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv81',
      maxTouchPoints: 5,
    });

    render(<PdfViewer file={baseFile} agentId="agent-1" />);

    expect(screen.getByText(/pdf preview isn't supported on mobile web/i)).toBeInTheDocument();
    expect(screen.queryByTitle('spec.pdf')).not.toBeInTheDocument();

    const openLink = screen.getByRole('link', { name: /open pdf/i });
    expect(openLink).toHaveAttribute(
      'href',
      '/api/files/raw?path=docs%2Fspec.pdf&agentId=agent-1',
    );
    expect(openLink).toHaveAttribute('target', '_blank');
    expect(openLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the mobile fallback for iPadOS Safari reporting a desktop-like UA', () => {
    setNavigatorEnv({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });

    render(<PdfViewer file={baseFile} agentId="agent-1" />);

    expect(screen.getByText(/pdf preview isn't supported on mobile web/i)).toBeInTheDocument();
    expect(screen.queryByTitle('spec.pdf')).not.toBeInTheDocument();

    const openLink = screen.getByRole('link', { name: /open pdf/i });
    expect(openLink).toHaveAttribute(
      'href',
      '/api/files/raw?path=docs%2Fspec.pdf&agentId=agent-1',
    );
    expect(openLink).toHaveAttribute('target', '_blank');
    expect(openLink).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
