import { RefreshCw, TriangleExclamationPoint } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { cn } from '../../lib/cn';
import { Button } from './Button';

export interface ErrorStateProps {
  /** Defaults to "Something went wrong". */
  title?: string;
  /** An Error/ApiRequestError (its message is shown) or text. */
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  className?: string;
}

/** A failed load, with the reason and a retry button. Use inline where the content would have been. */
export function ErrorState({ title = 'Something went wrong', error, onRetry, retrying = false, compact = false, className }: ErrorStateProps) {
  const message = typeof error === 'string' ? error : error === undefined ? undefined : errorMessage(error);
  return (
    <div role="alert" className={cn('flex flex-col items-center text-center', compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-14', className)}>
      <div
        aria-hidden="true"
        className={cn('flex items-center justify-center rounded-card bg-danger-soft text-danger', compact ? 'size-9 [&_svg]:size-[1.125rem]' : 'mb-1 size-12 [&_svg]:size-6')}
      >
        <TriangleExclamationPoint />
      </div>
      <div className="flex max-w-md flex-col gap-1">
        <h2 className={cn('font-semibold text-fg', compact ? 'text-base' : 'text-lg')}>{title}</h2>
        {message ? <p className="text-base text-muted text-pretty">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button className="mt-1" size={compact ? 'sm' : 'md'} onClick={onRetry} loading={retrying} leadingIcon={<RefreshCw />}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
