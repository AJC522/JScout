/** /companies — the employer job boards JScout checks directly: follow, unfollow, add and remove. */
import { useCallback, useMemo, useState } from 'react';
import { Building, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import type { AtsKind, CompanyBoard } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Page } from '../../components/layout/Page';
import { Button, Chip, EmptyState, ErrorState, IconButton, Input, PageHeader, SegmentedControl, Select, Skeleton, useConfirm, useToast } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatNumber, pluralize } from '../../lib/format';
import { useDebouncedValue, useDocumentTitle, useNow } from '../../lib/hooks';
import { AddCompanyDialog } from './AddCompanyDialog';
import { CompanyRow, ROW_GRID } from './CompanyRow';
import { ATS_KINDS, ATS_LABELS, COMPANIES_PAGE_SIZE, DEFAULT_FILTERS, hasFilters, pageRange, planBulk, toListQuery, type CompanyFilters, type FollowFilter } from './model';
import { useBulkFollow, useCompanies, useCompanySources, useRemoveCompany, useSetFollowing } from './queries';

const FOLLOW_OPTIONS: Array<{ value: FollowFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'following', label: 'Following' },
  { value: 'not-following', label: 'Not following' },
];
const ATS_OPTIONS = [{ value: '', label: 'Any job board' }, ...ATS_KINDS.map((ats) => ({ value: ats, label: ATS_LABELS[ats] }))];
const INDUSTRY_CHIPS = 10;

export function CompaniesPage() {
  useDocumentTitle('Companies');
  const [filters, setFilters] = useState<CompanyFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [allIndustries, setAllIndustries] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 250);
  const now = useNow(60_000);
  const confirm = useConfirm();
  const toast = useToast();

  // The text box is debounced; every other filter applies at once. Any change goes back to page 1.
  const effective = useMemo(() => ({ ...filters, q: debouncedSearch }), [filters, debouncedSearch]);
  const [lastQ, setLastQ] = useState(debouncedSearch);
  if (lastQ !== debouncedSearch) {
    setLastQ(debouncedSearch);
    if (filters.page !== 0) setFilters((f) => ({ ...f, page: 0 }));
  }
  const update = (patch: Partial<CompanyFilters>) => setFilters((f) => ({ ...f, page: 0, ...patch }));

  const list = useCompanies(toListQuery(effective));
  const sources = useCompanySources();
  const toggle = useSetFollowing();
  const remove = useRemoveCompany();
  const bulk = useBulkFollow();

  const { mutate: toggleMutate } = toggle;
  const onToggle = useCallback((company: CompanyBoard, enabled: boolean) => toggleMutate({ company, enabled }), [toggleMutate]);
  const { mutate: removeMutate } = remove;
  const onRemove = useCallback(
    async (company: CompanyBoard) => {
      const ok = await confirm({
        title: `Remove ${company.name}?`,
        description: 'JScout will stop checking its job board. You can add it again any time.',
        confirmLabel: 'Remove',
        tone: 'danger',
      });
      if (ok) removeMutate(company);
    },
    [confirm, removeMutate],
  );

  const data = list.data;
  const filtered = hasFilters(effective);
  const boardJobs = sources.data?.filter((s) => s.perCompany).reduce((sum, s) => sum + s.jobCount, 0);

  const runBulk = async (enabled: boolean) => {
    if (!data) return;
    const plan = planBulk(effective, enabled, data.items.map((c) => c.id), data.total);
    if (plan.count === 0) return;
    const verb = enabled ? 'Follow' : 'Stop following';
    const ok = await confirm({
      title: `${verb} ${pluralize(plan.count, 'company', 'companies')}?`,
      description:
        plan.scope === 'page'
          ? 'This changes the companies listed on this page.'
          : enabled
            ? 'Their jobs will be fetched at the next sync.'
            : 'Their jobs stop updating and will not be fetched again until you follow them.',
      confirmLabel: verb,
      tone: enabled ? undefined : 'danger',
    });
    if (!ok) return;
    bulk.mutate(plan.body, {
      onSuccess: (res) => toast.success(enabled ? `Following ${pluralize(res.updated, 'more company', 'more companies')}` : `Stopped following ${pluralize(res.updated, 'company', 'companies')}`),
      onError: (error) => toast.error('Could not update the companies', { description: errorMessage(error) }),
    });
  };

  const summary = data
    ? filtered
      ? `${pluralize(data.total, 'company', 'companies')} match · ${formatNumber(data.enabledTotal)} followed`
      : `Following ${formatNumber(data.enabledTotal)} of ${pluralize(data.total, 'company', 'companies')}${boardJobs !== undefined ? ` · ${pluralize(boardJobs, 'open job')}` : ''}`
    : null;
  const industries = data?.industries ?? [];
  const shownIndustries = allIndustries ? industries : industries.slice(0, INDUSTRY_CHIPS);
  const pages = data ? Math.max(1, Math.ceil(data.total / COMPANIES_PAGE_SIZE)) : 1;

  return (
    <Page>
      <PageHeader
        title="Companies"
        description="Employer job boards JScout checks directly, so you see openings that never reach the big job sites."
        actions={
          <Button variant="primary" leadingIcon={<Plus />} onClick={() => setAddOpen(true)}>
            Add a company
          </Button>
        }
      />

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            aria-label="Search companies"
            placeholder="Search companies"
            leadingIcon={<Search />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
            wrapperClassName="sm:max-w-xs sm:flex-1"
          />
          <Select aria-label="Job board" options={ATS_OPTIONS} value={filters.ats ?? ''} onChange={(e) => update({ ats: (e.target.value || undefined) as AtsKind | undefined })} wrapperClassName="sm:w-44" />
          <SegmentedControl aria-label="Following" options={FOLLOW_OPTIONS} value={filters.follow} onValueChange={(follow) => update({ follow })} />
          <Chip selected={filters.mine} onSelectedChange={(mine) => update({ mine })}>
            Added by you
          </Chip>
        </div>

        {industries.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Industry">
            {shownIndustries.map((i) => (
              <Chip key={i.value} size="sm" selected={filters.industry === i.value} count={formatNumber(i.count)} onSelectedChange={(on) => update({ industry: on ? i.value : undefined })}>
                {i.value}
              </Chip>
            ))}
            {industries.length > INDUSTRY_CHIPS ? (
              <Button size="sm" variant="link" onClick={() => setAllIndustries((v) => !v)}>
                {allIndustries ? 'Fewer' : `${industries.length - INDUSTRY_CHIPS} more`}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted" aria-live="polite">
            {summary ?? <Skeleton className="h-4 w-64" />}
          </p>
          {data && data.items.length > 0 ? (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => void runBulk(true)} disabled={bulk.isPending}>
                Follow all shown
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void runBulk(false)} disabled={bulk.isPending}>
                Unfollow all shown
              </Button>
            </div>
          ) : null}
        </div>

        {list.isPending ? (
          <ListSkeleton />
        ) : list.isError && !data ? (
          <ErrorState title="Could not load companies" error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />
        ) : data && data.items.length === 0 ? (
          filtered ? (
            <EmptyState
              bordered
              icon={<Search />}
              title="No companies match"
              description="Try a different name or clear the filters. If a company is missing, add it by its careers page link."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    onClick={() => {
                      setSearch('');
                      setFilters(DEFAULT_FILTERS);
                    }}
                  >
                    Clear filters
                  </Button>
                  <Button variant="primary" leadingIcon={<Plus />} onClick={() => setAddOpen(true)}>
                    Add a company
                  </Button>
                </div>
              }
            />
          ) : (
            <EmptyState
              bordered
              icon={<Building />}
              title="No companies yet"
              description="Add an employer by its careers page link and JScout will include its openings in your searches."
              action={
                <Button variant="primary" leadingIcon={<Plus />} onClick={() => setAddOpen(true)}>
                  Add a company
                </Button>
              }
            />
          )
        ) : data ? (
          <div className={cn('overflow-hidden rounded-card border border-border bg-surface transition-opacity', list.isPlaceholderData && 'opacity-60')}>
            <div className={cn('hidden border-b border-border bg-surface-2 px-4 py-2 text-xs font-medium text-subtle', ROW_GRID)}>
              <span>Company</span>
              <span>Job board</span>
              <span>Industry</span>
              <span className="text-right">Open jobs</span>
              <span>Status</span>
              <span className="text-center">Follow</span>
              <span className="sr-only">Remove</span>
            </div>
            <ul className="divide-y divide-border">
              {data.items.map((company) => (
                <CompanyRow key={company.id} company={company} now={now} onToggle={onToggle} onRemove={onRemove} />
              ))}
            </ul>
          </div>
        ) : null}

        {data && data.total > COMPANIES_PAGE_SIZE ? (
          <nav aria-label="Pages" className="flex items-center justify-end gap-2 text-sm text-muted">
            <span className="tabular-nums">{pageRange(filters.page, data.items.length, data.total)}</span>
            <IconButton label="Previous page" icon={<ChevronLeft />} disabled={filters.page === 0} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))} />
            <IconButton label="Next page" icon={<ChevronRight />} disabled={filters.page + 1 >= pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))} />
          </nav>
        ) : null}
      </div>

      <AddCompanyDialog open={addOpen} onOpenChange={setAddOpen} />
    </Page>
  );
}

function ListSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface" aria-busy="true" aria-label="Loading companies">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-20 max-sm:hidden" />
          <Skeleton className="h-4 w-24 max-sm:hidden" />
          <span className="flex-1" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
      ))}
    </div>
  );
}
