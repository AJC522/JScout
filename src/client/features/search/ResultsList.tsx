/** Virtualised, infinitely scrolling result list. The document scrolls, so it uses the window virtualizer. */
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { IsoDate, SearchResultItem } from '../../../shared/types';
import { Skeleton, Spinner } from '../../components/ui';
import { pluralize } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { ResultCard } from './ResultCard';
import { isNewSince } from './seen';
import type { JobRef } from './use-job-actions';

/** Space between cards, kept inside each measured row so the virtualizer sees it. */
const GAP = 10;
const ESTIMATED_ROW = 150;
/** Start loading the next page this many rows before the end. */
const PREFETCH_ROWS = 8;
/** Short lists do not need an end marker. */
const SHOW_END_FROM = 10;

export interface ResultsListHandle {
  scrollToJob: (id: string) => void;
}

export interface ResultsListProps {
  items: readonly SearchResultItem[];
  total: number;
  newSince: IsoDate | undefined;
  selectedId: string | undefined;
  cursorId: string | null;
  savingId: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (id: string) => void;
  onSave: (item: JobRef) => void;
  onHide: (item: JobRef) => void;
  ref?: Ref<ResultsListHandle>;
}

export function ResultsList({ items, total, newSince, selectedId, cursorId, savingId, hasMore, loadingMore, onLoadMore, onSelect, onSave, onHide, ref }: ResultsListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const now = useNow(60_000);

  // Content above the list (chips, notes) changes height; keep the virtualizer's offset in step.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
      setScrollMargin((prev) => (prev === top ? prev : top));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => ESTIMATED_ROW + GAP,
    overscan: 6,
    scrollMargin,
    getItemKey: (index) => items[index]?.job.id ?? index,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToJob: (id) => {
        const index = items.findIndex((item) => item.job.id === id);
        if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
      },
    }),
    [items, virtualizer],
  );

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;
  useEffect(() => {
    if (hasMore && !loadingMore && lastIndex >= items.length - PREFETCH_ROWS) onLoadMore();
  }, [hasMore, loadingMore, lastIndex, items.length, onLoadMore]);

  return (
    <div>
      <div ref={listRef} role="feed" aria-busy={loadingMore} aria-label="Search results" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map((row) => {
          const item = items[row.index];
          if (!item) return null;
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', paddingBottom: GAP, transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)` }}
            >
              <ResultCard
                item={item}
                isNew={isNewSince(item.job.firstSeenAt, newSince)}
                selected={item.job.id === selectedId}
                focused={item.job.id === cursorId}
                saving={item.job.id === savingId}
                now={now}
                onSelect={onSelect}
                onSave={onSave}
                onHide={onHide}
              />
            </div>
          );
        })}
      </div>
      <div className="flex min-h-12 items-center justify-center text-sm text-subtle">
        {loadingMore ? (
          <Spinner size="sm" label="Loading more jobs" />
        ) : !hasMore && items.length >= SHOW_END_FROM ? (
          <span>That's all {pluralize(total, 'job')}.</span>
        ) : null}
      </div>
    </div>
  );
}

export function ResultsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label="Loading results">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-card border border-border bg-surface p-4">
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <Skeleton className="size-7 rounded-full" />
          </div>
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
