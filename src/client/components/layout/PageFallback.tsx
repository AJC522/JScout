import { Skeleton, SkeletonText } from '../ui/Skeleton';
import { Page } from './Page';

/** Shown while a page's code loads (first visit only; later navigations keep the old page until ready). */
export function PageFallback() {
  return (
    <Page aria-busy="true" aria-label="Loading page">
      <div className="flex flex-col gap-2 pb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((row) => (
          <div key={row} className="rounded-card border border-border bg-surface p-4">
            <Skeleton className="mb-3 h-4 w-1/3" />
            <SkeletonText lines={2} />
          </div>
        ))}
      </div>
    </Page>
  );
}
