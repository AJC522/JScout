import { RefreshCw, WifiOff } from 'lucide-react';
import { ApiRequestError, errorMessage } from '../../api/client';
import { useBootstrap } from '../../app/bootstrap';
import { Button } from '../ui/Button';

function isUnreachable(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 0 || error.status >= 502);
}

/** Shown above every page while the local server cannot be reached (or bootstrap fails). Clears itself on recovery. */
export function ApiBanner() {
  const bootstrap = useBootstrap();
  if (!bootstrap.isError) return null;
  const unreachable = isUnreachable(bootstrap.error);
  return (
    <div role="alert" className="border-b border-warning/25 bg-warning-soft text-warning">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <WifiOff aria-hidden="true" className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">{unreachable ? 'JScout is not responding.' : 'Some app data could not be loaded.'}</span>{' '}
          {unreachable
            ? 'Check that it is still running in your terminal (npm start). Retrying automatically…'
            : errorMessage(bootstrap.error)}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="text-warning hover:bg-warning/10 hover:text-warning"
          loading={bootstrap.isFetching}
          leadingIcon={<RefreshCw />}
          onClick={() => void bootstrap.refetch()}
        >
          Retry now
        </Button>
      </div>
    </div>
  );
}
