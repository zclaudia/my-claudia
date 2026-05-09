import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional label shown in the error UI to identify the failing area */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string;
}

/**
 * Catch-all React error boundary.
 *
 * Wrap top-level routes and heavy feature modules so a crash in one area
 * doesn't take down the entire application.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack || '' });
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`, error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, componentStack: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4">
          <div className="text-4xl">:(</div>
          <h2 className="text-lg font-semibold">
            {this.props.label ? `${this.props.label} crashed` : 'Something went wrong'}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90"
          >
            Retry
          </button>
          <details className="text-xs text-muted-foreground max-w-lg text-left">
            <summary className="cursor-pointer">Error details</summary>
            <pre className="mt-2 p-2 bg-secondary rounded-md overflow-auto max-h-40 whitespace-pre-wrap">
              {this.state.error?.stack}
            </pre>
            {this.state.componentStack && (
              <pre className="mt-2 p-2 bg-secondary rounded-md overflow-auto max-h-40 whitespace-pre-wrap">
                {this.state.componentStack}
              </pre>
            )}
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}
