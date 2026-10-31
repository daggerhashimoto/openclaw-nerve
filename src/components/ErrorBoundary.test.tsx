/** Tests for the ErrorBoundary component. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// Component that throws on render
function Thrower({ error }: { error: Error }) {
  throw error;
}

function SafeChild() {
  return <div data-testid="safe-child">Hello</div>;
}

describe('ErrorBoundary', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <SafeChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('safe-child')).toBeInTheDocument();
  });

  it('catches errors and shows fallback UI', () => {
    render(
      <ErrorBoundary>
        <Thrower error={new Error('test crash')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('test crash')).toBeInTheDocument();
  });

  it('shows a reload button', () => {
    render(
      <ErrorBoundary>
        <Thrower error={new Error('boom')} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('displays the error message in the fallback', () => {
    const message = 'Something specific broke';
    render(
      <ErrorBoundary>
        <Thrower error={new Error(message)} />
      </ErrorBoundary>,
    );

    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
