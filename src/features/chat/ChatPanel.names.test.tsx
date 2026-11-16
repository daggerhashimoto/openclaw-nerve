/**
 * Who a room's replies belong to.
 *
 * A direct or channel session is named after the person or room on the other end (a Telegram
 * peer, a Discord channel). The replies in it are still the agent's, so the transcript rows and
 * the header nameplate carry the agent family's name, and the header names the session beside it.
 * A main room is named by its agent alone, as before.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { forwardRef } from 'react';
import type { ChatMessage, Session } from '@/types';
import { getChatRoomNames } from '@/features/sessions/sessionKeys';
import { processChatMessages } from './operations/loadHistory';
import { ChatPanel } from './ChatPanel';

vi.mock('./InputBar', () => ({
  InputBar: forwardRef(function InputBarStub() {
    return <div data-testid="input-bar" />;
  }),
}));
vi.mock('./components/useModelEffort', () => ({
  useModelEffort: () => ({
    modelOptions: [],
    effortOptions: [],
    selectedModel: '',
    selectedEffort: '',
    selectedEffortLabel: '',
    handleModelChange: vi.fn(),
    handleEffortChange: vi.fn(),
    controlsDisabled: true,
    uiError: null,
  }),
}));

beforeAll(() => {
  // jsdom has no layout; the panel scrolls its list into view.
  Element.prototype.scrollIntoView = vi.fn();
});

const T0 = Date.parse('2026-11-16T09:00:00Z');
const TELEGRAM_DM = 'agent:main:telegram:direct:469914749';
const DISCORD_CHANNEL = 'agent:ops:discord:channel:1488657713385701408';

const sessions: Session[] = [
  { key: 'agent:main:main' },
  { key: TELEGRAM_DM, label: 'Shaun (@shaunfi) id:469914749', displayName: 'Shaun (@shaunfi) id:469914749' },
  { key: 'agent:main:subagent:abc', label: 'Release notes' },
  { key: 'agent:ops:main', identityName: 'Varys' },
  { key: DISCORD_CHANNEL, displayName: '#releases' },
];

const transcript = processChatMessages([
  { role: 'user', content: 'Are we shipping today?', timestamp: T0, __openclaw: { id: 'u-1', seq: 0 } },
  { role: 'assistant', content: 'Yes, after the release check.', timestamp: T0 + 1000, __openclaw: { id: 'a-1', seq: 1 } },
] as ChatMessage[]);

function openRoom(sessionKey: string) {
  const names = getChatRoomNames(sessionKey, sessions, 'Jen');
  return render(
    <ChatPanel
      messages={transcript}
      onSend={vi.fn()}
      onAbort={vi.fn()}
      isGenerating={false}
      stream={{ html: '', text: '' } as never}
      historyLoaded
      agentName={names.agentName}
      sessionName={names.sessionName}
    />,
  );
}

function speakers(container: HTMLElement) {
  return {
    operator: container.querySelector('.msg-user .msg-speaker')?.textContent,
    agent: Array.from(container.querySelectorAll('.msg-assistant .msg-speaker')).map((el) => el.textContent),
    nameplate: container.querySelector('.nerve-chat-header .nerve-nameplate')?.textContent,
    session: container.querySelector('[data-testid="chat-session-name"]')?.textContent ?? null,
  };
}

describe('ChatPanel names the agent, not the session', () => {
  it('gives a Telegram direct session\'s replies to the agent and names the peer only in the header', () => {
    const { container } = openRoom(TELEGRAM_DM);

    expect(speakers(container)).toEqual({
      operator: 'You',
      agent: ['Jen (main)'],
      nameplate: 'Jen (main)',
      session: 'Shaun (@shaunfi) id:469914749',
    });
    // The peer never speaks for the agent.
    container.querySelectorAll('.msg-speaker').forEach((el) => {
      expect(el.textContent).not.toContain('Shaun');
    });
  });

  it('gives a Discord channel session\'s replies to its agent family and names the channel in the header', () => {
    const { container } = openRoom(DISCORD_CHANNEL);

    expect(speakers(container)).toEqual({
      operator: 'You',
      agent: ['Varys (ops)'],
      nameplate: 'Varys (ops)',
      session: '#releases',
    });
  });

  it('keeps a main room named by its agent alone', () => {
    const { container } = openRoom('agent:main:main');

    expect(speakers(container)).toEqual({
      operator: 'You',
      agent: ['Jen (main)'],
      nameplate: 'Jen (main)',
      session: null,
    });
  });

  it('keeps a subagent room named by the subagent', () => {
    const { container } = openRoom('agent:main:subagent:abc');

    expect(speakers(container)).toEqual({
      operator: 'You',
      agent: ['Release notes'],
      nameplate: 'Release notes',
      session: null,
    });
  });
});
