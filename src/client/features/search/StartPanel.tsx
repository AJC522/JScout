/** First visit without a query: search with the saved profile in one click, or pick a recent search. */
import { Link } from 'react-router';
import { Building2, Clock, History, MapPin, Sparkles, UserRound } from 'lucide-react';
import type { SearchQuery } from '../../../shared/types';
import { Button, Card, ErrorState, Skeleton } from '../../components/ui';
import { formatRelativeTime, pluralize } from '../../lib/format';
import { useCompanies } from '../companies/queries';
import { aboutCount } from '../onboarding/industries';
import { describeQuery, SUMMARY_SEPARATOR } from '../saved/describe';
import { useClearHistory, useProfileQuery, useSearchHistory } from './queries';

const MAX_RECENT = 6;

function splitTitles(q: string): string[] {
  return q
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

/** The query summary without its leading "what" part (the titles are shown as chips). */
function describeWhereAndFilters(query: SearchQuery): string {
  return describeQuery(query).split(SUMMARY_SEPARATOR).slice(1).join(SUMMARY_SEPARATOR);
}

function ProfileCard({ onRun }: { onRun: (query: SearchQuery) => void }) {
  const profileQuery = useProfileQuery(true);
  if (profileQuery.isPending) {
    return (
      <Card padded className="space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-9 w-44" />
      </Card>
    );
  }
  if (profileQuery.isError) {
    return <ErrorState compact title="Could not load your profile search" error={profileQuery.error} onRetry={() => void profileQuery.refetch()} retrying={profileQuery.isFetching} />;
  }
  const query = profileQuery.data;
  const titles = splitTitles(query.q);
  return (
    <Card padded className="border-primary/30 bg-primary-soft/30">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Search with your profile
          </h2>
          {titles.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Target titles">
              {titles.slice(0, 6).map((t) => (
                <li key={t} className="rounded-full bg-surface px-2.5 py-0.5 text-sm text-fg ring-1 ring-border">
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{describeWhereAndFilters(query)}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
          <Button variant="primary" onClick={() => onRun(query)}>
            Search with my profile
          </Button>
          <Link to="/profile" className="text-center text-xs text-muted hover:text-fg hover:underline">
            Edit preferences
          </Link>
        </div>
      </div>
    </Card>
  );
}

function RecentSearches({ onRun }: { onRun: (query: SearchQuery) => void }) {
  const history = useSearchHistory(true);
  const clear = useClearHistory();
  if (history.isPending) {
    return (
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  // History is a convenience; a failure here should not take over the page.
  if (history.isError || history.data.length === 0) return null;
  const now = Date.now();
  return (
    <section aria-labelledby="recent-title">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="recent-title" className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <History className="size-4 text-subtle" aria-hidden="true" />
          Recent searches
        </h2>
        <Button size="sm" variant="ghost" onClick={() => clear.mutate()} loading={clear.isPending}>
          Clear
        </Button>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        {history.data.slice(0, MAX_RECENT).map((entry) => (
          <li key={`${entry.ranAt}:${describeQuery(entry.query)}`}>
            <button
              type="button"
              onClick={() => onRun(entry.query)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
            >
              <Clock className="size-4 shrink-0 text-subtle" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{describeQuery(entry.query)}</span>
              <span className="shrink-0 text-xs text-subtle">
                {pluralize(entry.total, 'job')} · {formatRelativeTime(entry.ranAt, now)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Only the totals are needed, not the boards. */
const COMPANY_TOTALS_QUERY = { limit: 1 } as const;

/** Bundled company boards start unfollowed; until the user follows some, point at where to do it. */
function FollowCompaniesCard() {
  const companies = useCompanies(COMPANY_TOTALS_QUERY);
  if (!companies.data || companies.data.enabledTotal > 0 || companies.data.total === 0) return null;
  return (
    <Card padded className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Building2 className="size-8 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-fg">Search employers’ career pages too</h2>
        <p className="mt-0.5 text-sm text-muted">
          JScout can also check {aboutCount(companies.data.total)} companies’ own job boards, which list many jobs the big boards miss. Follow the
          industries you care about.
        </p>
      </div>
      <Button asChild variant="secondary">
        <Link to="/companies">Choose companies</Link>
      </Button>
    </Card>
  );
}

export function StartPanel({ onboarded, onRun }: { onboarded: boolean; onRun: (query: SearchQuery) => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {onboarded ? (
        <ProfileCard onRun={onRun} />
      ) : (
        <Card padded className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <UserRound className="size-8 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-fg">Search faster with a profile</h2>
            <p className="mt-0.5 text-sm text-muted">Tell JScout the roles and places you want once. Then search, rank and apply in one click.</p>
          </div>
          <Button asChild variant="primary">
            <Link to="/welcome">Set up my profile</Link>
          </Button>
        </Card>
      )}
      <FollowCompaniesCard />
      <RecentSearches onRun={onRun} />
      <p className="text-center text-sm text-muted">
        Or{' '}
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => onRun({ q: '', sort: 'date' })}>
          browse the newest jobs
        </button>
        .
      </p>
    </div>
  );
}
