import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentLog } from './AgentLog';
import { EventLog } from './EventLog';
import { eventKind, logPaneState } from './activityWords';

describe('AgentLog', () => {
  it('lights a pane only for failures and approval requests', () => {
    expect(logPaneState('❌')).toBe('error');
    expect(logPaneState('⛔')).toBe('off'); // aborted, usually the operator's Stop: not a failure
    expect(logPaneState('🔐')).toBe('operator');
    expect(logPaneState('🧠')).toBe('off');
    expect(logPaneState('🔧')).toBe('off');
  });

  it('prints each line with a mono time and no glyphs, newest first as given', () => {
    const ts = new Date(2026, 10, 2, 14, 5, 9).getTime();
    const { container } = render(
      <AgentLog
        entries={[
          { icon: '❌', text: 'generation failed', ts },
          { icon: '🔧', text: 'Reading src/types.ts', ts: ts - 1000 },
        ]}
        glow
      />,
    );
    expect(screen.getByText('Agent log')).toBeInTheDocument();
    expect(screen.getByLabelText('Agent working')).toHaveAttribute('data-state', 'live');
    expect(screen.getByText('14:05:09')).toBeInTheDocument();
    expect(screen.getByText('generation failed')).toHaveClass('text-destructive');
    expect(screen.getByLabelText('Failed')).toHaveAttribute('data-state', 'error');
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}◆]/u);
    expect(container.querySelector('.uppercase')).toBeNull();
  });

  it('says when nothing has been logged', () => {
    render(<AgentLog entries={[]} />);
    expect(screen.getByText('Nothing logged yet.')).toBeInTheDocument();
  });
});

describe('EventLog', () => {
  it('lowers the kind into the mono voice', () => {
    expect(eventKind('CHAT')).toBe('chat');
    expect(eventKind('ERROR')).toBe('error');
  });

  it('lists events with the kind, the description and a relative time, errors in red', () => {
    const { container } = render(
      <EventLog
        entries={[
          { badge: 'ERROR', badgeCls: 'badge-error', desc: 'Gateway connection failed', ts: new Date() },
          { badge: 'CHAT', badgeCls: 'badge-chat', desc: 'Response complete', ts: new Date(Date.now() - 120_000) },
        ]}
      />,
    );
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('error')).toHaveClass('text-destructive');
    expect(screen.getByText('Gateway connection failed')).toHaveClass('text-destructive');
    expect(screen.getByText('chat')).toHaveClass('text-muted-foreground');
    expect(screen.getByText('2m')).toBeInTheDocument();
    expect(screen.getByLabelText('Failed')).toHaveAttribute('data-state', 'error');
    expect(container.querySelector('.uppercase')).toBeNull();
    expect(container.querySelector('[class*="tracking-"]')).toBeNull();
  });

  it('says when there are no events', () => {
    render(<EventLog entries={[]} />);
    expect(screen.getByText('No events yet.')).toBeInTheDocument();
  });
});
