import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NerveLogo from './NerveLogo';

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('NerveLogo', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    globalThis.requestAnimationFrame = vi.fn(() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    cleanup();
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.restoreAllMocks();
  });

  it('renders a static logo without canvas work when animation is disabled', () => {
    render(<NerveLogo size={24} static />);

    expect(screen.getByRole('img', { name: /nerve logo/i })).toBeInTheDocument();
    expect(document.querySelector('canvas')).not.toBeInTheDocument();
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('respects reduced motion without scheduling animation frames', () => {
    mockMatchMedia(true);

    render(<NerveLogo size={24} />);

    expect(screen.getByRole('img', { name: /nerve logo/i })).toBeInTheDocument();
    expect(document.querySelector('canvas')).not.toBeInTheDocument();
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('uses the static logo when persisted performance mode is enabled', () => {
    localStorage.setItem('nerve:performanceMode', 'true');

    render(<NerveLogo size={24} />);

    expect(screen.getByRole('img', { name: /nerve logo/i })).toBeInTheDocument();
    expect(document.querySelector('canvas')).not.toBeInTheDocument();
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
  });
});
