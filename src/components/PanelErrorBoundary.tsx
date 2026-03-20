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
          <p className="text-xs text-muted-foreground">
            {this.props.name ? `${this.props.name} crashed` : 'Something went wrong'}
          </p>
          <pre className="text-[0.667rem] text-destructive max-w-full overflow-hidden text-ellipsis whitespace-nowrap px-2">
            {this.state.error?.message}
          </pre>
          <button
            onClick={this.handleRetry}
            className="px-3 py-1 text-[0.667rem] font-mono uppercase tracking-wider bg-muted text-muted-foreground hover:bg-muted/80 border border-border"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
