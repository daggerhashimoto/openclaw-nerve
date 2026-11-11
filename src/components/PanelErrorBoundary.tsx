import { Component, type ReactNode } from 'react';

interface PanelErrorBoundaryProps {
  children: ReactNode;
  /** Inline label shown in the fallback (e.g. "Chat", "Sessions") */
  name?: string;
}

interface PanelErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Lightweight error boundary for individual panels / lazy-loaded features.
 *
 * Unlike the root ErrorBoundary (which shows a full-screen crash page),
 * this renders a small inline fallback with a "Retry" button that resets
 * the boundary state so the children can re-mount without a full page reload.
 */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[PanelErrorBoundary:${this.props.name ?? 'unknown'}]`, error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-4 text-center h-full min-h-[80px]">
          <p className="text-[0.867rem] text-foreground">
            {this.props.name ? `${this.props.name} crashed` : 'Something went wrong'}
          </p>
          <pre className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap px-2 font-mono text-[0.8rem] text-destructive">
            {this.state.error?.message}
          </pre>
          <button
            onClick={this.handleRetry}
            className="h-7 rounded-[3px] border border-border px-2.5 text-[0.8rem] max-sm:h-11 max-sm:px-4 font-medium text-foreground transition-colors duration-[120ms] hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
