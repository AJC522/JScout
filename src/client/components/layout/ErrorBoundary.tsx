import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useRouteError } from 'react-router';
import { RefreshCw, TriangleExclamationPoint } from 'lucide-react';
import { Button } from '../ui/Button';

interface ErrorFallbackProps {
  error: unknown;
  /** "page" fills the content area; "app" fills the window (used when the shell itself fails). */
  variant?: 'page' | 'app';
  onReset?: () => void;
}

/** Friendly "something broke" screen with the technical message tucked away. */
export function ErrorFallback({ error, variant = 'page', onReset }: ErrorFallbackProps) {
  const app = variant === 'app';
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className={app ? 'flex min-h-dvh items-center justify-center bg-canvas p-6' : 'flex justify-center px-4 py-16 sm:px-6'}>
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <div aria-hidden="true" className="mb-1 flex size-12 items-center justify-center rounded-card bg-danger-soft text-danger">
          <TriangleExclamationPoint className="size-6" />
        </div>
        <h1 className="text-lg font-semibold text-fg">{app ? 'JScout ran into a problem' : 'This page ran into a problem'}</h1>
        <p className="text-base text-muted">Your data is safe: it is stored on this computer and nothing was lost. Reloading usually fixes this.</p>
        <details className="w-full rounded-control border border-border bg-surface-2 px-3 py-2 text-left text-sm text-muted">
          <summary className="font-medium text-fg">Technical details</summary>
          <pre className="mt-2 font-mono text-xs break-words whitespace-pre-wrap">{message}</pre>
        </details>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button variant="primary" leadingIcon={<RefreshCw />} onClick={() => window.location.reload()}>
            Reload
          </Button>
          {onReset ? <Button onClick={onReset}>Try again</Button> : null}
        </div>
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  variant?: 'page' | 'app';
}

/**
 * Catches render errors so one broken page does not blank the whole app. AppLayout keys
 * it by route, so navigating elsewhere recovers.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { error: unknown }> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error: error ?? new Error('Unknown error') };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // A local app: the browser console is where the user (or a bug report) will find this.
    console.error('JScout render error', error, info.componentStack);
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <ErrorFallback
        error={this.state.error}
        variant={this.props.variant}
        onReset={this.props.variant === 'app' ? undefined : () => this.setState({ error: null })}
      />
    );
  }
}

/** react-router's errorElement for failures outside the page boundary (e.g. in the shell). */
export function RouteErrorFallback() {
  return <ErrorFallback error={useRouteError()} variant="app" />;
}
