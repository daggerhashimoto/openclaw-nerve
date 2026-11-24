/**
 * Following the conversation when content grows after it rendered.
 *
 * A reply can grow after it is on screen without the messages changing: a lazy chart
 * shows a one-line fallback and then takes its full height, an image finishes loading,
 * an embed sizes itself. While the chat follows the conversation it keeps the end in
 * view as that content grows, and the growth alone never reads as the operator scrolling
 * up. Once the operator has scrolled up, growth leaves them where they are.
 *
 * jsdom has no layout, so the list's heights, its clamped scroll position, the frame
 * callbacks and the resize observer are simulated. A browser delivers the scroll event
 * for a scroll the panel makes at the next frame, and runs resize observers after
 * layout, after that frame's scroll events.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { forwardRef } from 'react';
import type { ChatMsg } from './types';
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

/** Frame callbacks, run when the test says a frame has passed. */
let frames: FrameRequestCallback[] = [];
const nextFrame = () => act(() => {
  const due = frames;
  frames = [];
  due.forEach((callback) => callback(0));
});

/** The resize observers the panel registered, and what each watches. */
const observers: Array<{ callback: ResizeObserverCallback; targets: Set<Element> }> = [];
class FakeResizeObserver {
  private entry: { callback: ResizeObserverCallback; targets: Set<Element> };
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: new Set() };
    observers.push(this.entry);
  }
  observe(target: Element) { this.entry.targets.add(target); }
  unobserve(target: Element) { this.entry.targets.delete(target); }
  disconnect() { this.entry.targets.clear(); }
}
/** What the browser does after layout: tell each observer watching something that it changed size. */
const runResizeObservers = () => {
  for (const { callback, targets } of observers) {
    if (targets.size > 0) callback([], {} as ResizeObserver);
  }
};

beforeEach(() => {
  frames = [];
  observers.length = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const at = (minute: number) => new Date(Date.UTC(2026, 10, 24, 12, minute));
const question: ChatMsg = { msgId: 'u-1', role: 'user', html: '', rawText: 'How has gold done this year?', timestamp: at(0) };
const reply: ChatMsg = { msgId: 'a-1', role: 'assistant', html: '', rawText: 'Up about a quarter. The weekly chart:', timestamp: at(1) };

const VIEWPORT = 500;
const CONTENT = 1000;
/** A TradingView chart replacing its one-line fallback. */
const CHART_GROWTH = 450;

/** Give the list a viewport and a content height, and a scroll position the browser clamps to them. */
function layOut(list: HTMLElement) {
  let height = CONTENT;
  let top = 0;
  Object.defineProperties(list, {
    clientHeight: { configurable: true, get: () => VIEWPORT },
    scrollHeight: { configurable: true, get: () => height },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(value, height - VIEWPORT)); },
    },
  });
  return { grow: (by: number) => { height += by; } };
}

/** Open a room whose reply has just rendered, and let the panel scroll to its end. */
function openRoom() {
  render(
    <ChatPanel messages={[question, reply]} onSend={vi.fn()} onAbort={vi.fn()} isGenerating={false}
      stream={{ html: '', text: '' } as never} historyLoaded />,
  );
  const list = screen.getByRole('log', { name: 'Chat messages' });
  const layout = layOut(list);
  nextFrame();
  expect(list.scrollTop).toBe(CONTENT - VIEWPORT);
  return { list, layout };
}

const scrollToBottomButton = () => screen.queryByRole('button', { name: /^Scroll to bottom/ });

describe('following the conversation as a reply grows after it rendered', () => {
  it.each([
    ['before the observers run', ['scroll event', 'observers'] as const],
    ['after the observers ran', ['observers', 'scroll event'] as const],
  ])('keeps the end in view when the scroll event of its own scroll arrives after the growth, %s', (_when, order) => {
    const { list, layout } = openRoom();

    // The chart takes its full height before the scroll event of the panel's last scroll is delivered
    layout.grow(CHART_GROWTH);
    for (const step of order) {
      if (step === 'scroll event') fireEvent.scroll(list);
      else act(runResizeObservers);
    }

    expect(scrollToBottomButton()).toBeNull();
    expect(list.scrollTop).toBe(CONTENT + CHART_GROWTH - VIEWPORT);
  });

  it('keeps the end in view when the growth comes after the scroll settled, as in a room reopened from history', () => {
    const { list, layout } = openRoom();
    fireEvent.scroll(list);

    layout.grow(CHART_GROWTH);
    act(runResizeObservers);

    expect(scrollToBottomButton()).toBeNull();
    expect(list.scrollTop).toBe(CONTENT + CHART_GROWTH - VIEWPORT);
  });
});

describe('leaving the operator where they are once they have scrolled up', () => {
  it('does not pull the view down when content grows', () => {
    const { list, layout } = openRoom();
    fireEvent.scroll(list);
    list.scrollTop = 200;
    fireEvent.scroll(list);
    expect(scrollToBottomButton()).not.toBeNull();

    layout.grow(CHART_GROWTH);
    act(runResizeObservers);

    expect(list.scrollTop).toBe(200);
    expect(scrollToBottomButton()).not.toBeNull();
  });

  it('does not pull the view down when content grows in the same frame as the scroll up', () => {
    const { list, layout } = openRoom();
    fireEvent.scroll(list);

    // A streaming reply grows every frame: the scroll up and the growth land before the panel renders again
    act(() => {
      list.scrollTop = 200;
      list.dispatchEvent(new Event('scroll'));
      layout.grow(CHART_GROWTH);
      runResizeObservers();
    });

    expect(list.scrollTop).toBe(200);
    expect(scrollToBottomButton()).not.toBeNull();
  });

  it('does not pull the view down after a short scroll up from where the panel last pinned it', () => {
    const { list, layout } = openRoom();
    fireEvent.scroll(list);
    // The panel follows a large growth; the scroll event of that pin is not delivered yet
    layout.grow(CHART_GROWTH);
    act(runResizeObservers);
    const pinned = list.scrollTop;

    // One scroll event carries the pin and a short scroll up; the reply grows again in that frame
    act(() => {
      list.scrollTop = pinned - 100;
      list.dispatchEvent(new Event('scroll'));
      layout.grow(CHART_GROWTH);
      runResizeObservers();
    });

    expect(list.scrollTop).toBe(pinned - 100);
    expect(scrollToBottomButton()).not.toBeNull();
  });
});
