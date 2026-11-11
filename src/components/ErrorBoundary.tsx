import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Root-level React error boundary for the Nerve application.
 *
 * Catches unhandled render errors and displays a full-screen crash page
 * with the error message and a reload button. Wrap the entire app tree
 * with this component. For panel-scoped recovery see {@link PanelErrorBoundary}.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex flex-col items-center justify-center bg-background text-foreground p-8">
          <h1 className="mb-3 text-[1.2rem] font-semibold text-foreground">Something went wrong</h1>
          <pre className="mb-4 max-w-lg overflow-auto rounded-[3px] border border-border bg-card p-3 font-mono text-[0.8rem] text-muted-foreground">
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="h-9 rounded-[3px] bg-primary px-4 text-[0.867rem] font-semibold text-primary-foreground transition-[filter] duration-[120ms] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
