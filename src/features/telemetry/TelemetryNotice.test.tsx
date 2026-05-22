import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TelemetryNotice } from './TelemetryNotice';
import { TELEMETRY_NOTICE_DISMISS_KEY, buildTelemetryNoticeDismissKey } from './telemetryNoticeStorage';

describe('TelemetryNotice', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders when showFreshInstallNotice is true', () => {
    render(
      <TelemetryNotice
        visible
        mode="minimal"
        publicDocUrl="https://example.com/telemetry"
        noticeId="install-1"
      />,
    );

    expect(screen.getByText('This fresh install is using minimal telemetry.')).toBeInTheDocument();
    expect(screen.getByText(/heartbeat snapshots and scrubbed server-side error reports/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /read the public telemetry docs/i })).toHaveAttribute('href', 'https://example.com/telemetry');
    expect(screen.getByText(/NERVE_TELEMETRY_MODE=off/i)).toBeInTheDocument();
  });

  it('dismissal only hides the notice locally for the disclosed install and leaves telemetryVisible alone', () => {
    localStorage.setItem('oc-telemetry-visible', 'true');

    render(
      <TelemetryNotice
        visible
        mode="minimal"
        publicDocUrl="https://example.com/telemetry"
        noticeId="install-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /dismiss telemetry notice/i }));

    expect(screen.queryByText('This fresh install is using minimal telemetry.')).not.toBeInTheDocument();
    expect(localStorage.getItem(buildTelemetryNoticeDismissKey('install-1'))).toBe('true');
    expect(localStorage.getItem(TELEMETRY_NOTICE_DISMISS_KEY)).toBeNull();
    expect(localStorage.getItem('oc-telemetry-visible')).toBe('true');
  });

  it('does not suppress a different fresh-install notice id after dismissing the previous one', () => {
    localStorage.setItem(buildTelemetryNoticeDismissKey('install-1'), 'true');

    const { rerender } = render(
      <TelemetryNotice
        visible
        mode="minimal"
        publicDocUrl="https://example.com/telemetry"
        noticeId="install-1"
      />,
    );

    expect(screen.queryByText('This fresh install is using minimal telemetry.')).not.toBeInTheDocument();

    rerender(
      <TelemetryNotice
        visible
        mode="minimal"
        publicDocUrl="https://example.com/telemetry"
        noticeId="install-2"
      />,
    );

    expect(screen.getByText('This fresh install is using minimal telemetry.')).toBeInTheDocument();
  });
});
