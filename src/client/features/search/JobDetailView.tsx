/**
 * Everything about one job: facts, actions (apply, save, hide, check), why it matches, the full
 * description and the apply kit. Used by the split view, the narrow-screen drawer and /jobs/:id.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import {
  Activity,
  ArrowUpRight,
  Banknote,
  Bookmark,
  BookmarkCheck,
  Briefcase,
  Building2,
  CalendarDays,
  Copy,
  Eye,
  EyeOff,
  Laptop,
  Maximize2,
  MoreHorizontal,
  SearchX,
  TrendingUp,
  TriangleAlert,
  X,
} from 'lucide-react';
import { EMPLOYMENT_LABELS, SENIORITY_LABELS } from '../../../shared/constants';
import type { JobDetail, LivenessResult, MatchExplanation, SearchResultItem, TitleMatchKind } from '../../../shared/types';
import { ApiRequestError, errorMessage } from '../../api/client';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  IconButton,
  RichText,
  ScoreRing,
  Skeleton,
  SkeletonText,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '../../components/ui';
import { useCopyToClipboard } from '../../lib/hooks';
import { formatDate, formatRelativeTime, formatSalary, initials } from '../../lib/format';
import { ApplyKitPanel } from '../applykit';
import { IconLink, RemoteBadge, StatusBadge } from './job-bits';
import { useCheckLiveness, useJobDetail, useSources } from './queries';
import type { JobActions } from './use-job-actions';

export interface JobDetailViewProps {
  jobId: string;
  /** A search result for this job, shown while the full detail loads. */
  placeholder?: SearchResultItem;
  actions: JobActions;
  /**
   * panel: the split view's column, with its own title and close button.
   * embedded: inside a drawer or the job page, whose header already shows the title.
   */
  variant: 'panel' | 'embedded';
  onClose?: () => void;
}

const TITLE_MATCH: Record<TitleMatchKind, string> = {
  exact: 'The title matches your search',
  synonym: 'Same role under a different title',
  related: 'A role related to your search',
  partial: 'Some words of the title match',
  none: 'Matched on the description',
};

export function JobDetailView({ jobId, placeholder, actions, variant, onClose }: JobDetailViewProps) {
  const detail = useJobDetail(jobId, placeholder);
  const data = detail.data;
  const { view } = actions;
  const check = useCheckLiveness();
  const toast = useToast();

  // Opening a job marks it viewed, once per job shown here.
  const viewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data || viewedRef.current === data.job.id) return;
    viewedRef.current = data.job.id;
    view(data);
  }, [data, view]);

  if (!data) {
    if (detail.isError) {
      if (detail.error instanceof ApiRequestError && detail.error.status === 404) {
        return (
          <EmptyState
            icon={<SearchX />}
            title="This job is no longer in your index"
            description="It was probably taken down by the employer and cleaned up after a sync."
            action={onClose ? <Button onClick={onClose}>Back to results</Button> : undefined}
          />
        );
      }
      return <ErrorState title="Could not load this job" error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />;
    }
    return <DetailSkeleton />;
  }

  const descriptionLoading = detail.isPlaceholderData && detail.isFetching;
  const runCheck = () =>
    check.mutate(data.job.id, {
      onSuccess: (result) => toast[result.status === 'closed' ? 'error' : 'info'](livenessTitle(result), { description: result.detail }),
      onError: (error) => toast.error('Could not check the posting', { description: errorMessage(error) }),
    });
  return (
    <article className="space-y-5" aria-busy={descriptionLoading || undefined}>
      {variant === 'panel' ? <PanelHeading data={data} onClose={onClose} /> : null}
      <Facts data={data} />
      <ActionRow data={data} actions={actions} showFullPageLink={variant === 'panel'} onCheck={runCheck} checking={check.isPending} />
      {actions.askingAbout === data.job.id ? <ApplyPrompt data={data} actions={actions} /> : null}
      {data.job.closedAt ? (
        <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          This posting looks closed (noticed {formatDate(data.job.closedAt, 'medium')}). It may no longer take applications.
        </p>
      ) : null}
      <SourceLine data={data} onCheck={runCheck} checking={check.isPending} />

      <Tabs defaultValue="details">
        <TabsList aria-label="Job sections">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="kit">Apply kit</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="space-y-5 pt-4">
          <WhyThisJob score={data.score} match={data.match} />
          <Description data={data} loading={descriptionLoading} failed={detail.isError} onRetry={() => void detail.refetch()} />
        </TabsContent>
        <TabsContent value="kit" className="pt-4">
          <ApplyKitPanel target={{ jobId: data.job.id, applicationId: data.userState.applicationId }} company={data.job.company} />
        </TabsContent>
      </Tabs>
    </article>
  );
}

function PanelHeading({ data, onClose }: { data: JobDetail; onClose?: () => void }) {
  const { job } = data;
  return (
    <header className="flex items-start gap-3">
      <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-2 text-sm font-semibold text-muted">
        {initials(job.company)}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-xl leading-tight font-semibold text-balance text-fg">{job.title}</h2>
        <p className="mt-1 text-sm text-muted">
          <span className="font-medium text-fg">{job.company}</span>
          {job.locationText ? ` · ${job.locationText}` : ''}
        </p>
      </div>
      <div className="-mt-1 -mr-1 flex shrink-0 items-center">
        <IconLink to={`/jobs/${encodeURIComponent(job.id)}`} label="Open full page" icon={<Maximize2 />} />
        {onClose ? <IconButton size="sm" label="Close" tooltip="Close (Esc)" icon={<X />} onClick={onClose} /> : null}
      </div>
    </header>
  );
}

function Facts({ data }: { data: JobDetail }) {
  const { job } = data;
  const salary = formatSalary(job.salary);
  const annual = job.salary?.period && job.salary.period !== 'year' ? formatSalary(job.salary, { annualized: true }) : '';
  const posted = job.postedAt ?? job.firstSeenAt;
  const scope = job.location.remoteScope;
  const facts = [
    salary ? { icon: <Banknote />, text: annual && annual !== salary ? `${salary} (about ${annual})` : salary, strong: true } : null,
    job.employmentType !== 'unknown' ? { icon: <Briefcase />, text: EMPLOYMENT_LABELS[job.employmentType] } : null,
    job.seniority !== 'unknown' ? { icon: <TrendingUp />, text: SENIORITY_LABELS[job.seniority] } : null,
    job.department ? { icon: <Building2 />, text: job.department } : null,
    { icon: <CalendarDays />, text: `${job.postedAt ? 'Posted' : 'Found'} ${formatRelativeTime(posted)}`, title: formatDate(posted, 'long') },
    job.location.remote !== 'onsite' && job.location.remote !== 'unknown' && scope.length > 0
      ? { icon: <Laptop />, text: `From ${scope.slice(0, 4).join(', ')}${scope.length > 4 ? ` +${scope.length - 4}` : ''}` }
      : null,
  ].filter((f) => f !== null);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
      <RemoteBadge mode={job.location.remote} className="h-5.5 px-2 text-xs" />
      {facts.map((fact) => (
        <span key={fact.text} title={fact.title} className={`inline-flex items-center gap-1.5 [&_svg]:size-4 [&_svg]:text-subtle ${fact.strong ? 'font-medium text-fg' : ''}`}>
          {fact.icon}
          {fact.text}
        </span>
      ))}
      {data.userState.applicationStatus ? <StatusBadge status={data.userState.applicationStatus} /> : null}
    </div>
  );
}

interface ActionRowProps {
  data: JobDetail;
  actions: JobActions;
  showFullPageLink: boolean;
  onCheck: () => void;
  checking: boolean;
}

function ActionRow({ data, actions, showFullPageLink, onCheck, checking }: ActionRowProps) {
  const { job, userState } = data;
  const toast = useToast();
  const { copy } = useCopyToClipboard();
  const saved = Boolean(userState.applicationStatus);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" trailingIcon={<ArrowUpRight />} onClick={() => actions.apply(data)}>
        Apply
      </Button>
      {saved && userState.applicationId ? (
        <Button asChild variant="secondary" leadingIcon={<BookmarkCheck className="text-primary" />}>
          <Link to={`/tracker/${encodeURIComponent(userState.applicationId)}`}>{userState.applicationStatus === 'saved' ? 'Saved' : 'In your tracker'}</Link>
        </Button>
      ) : (
        <Button variant="secondary" leadingIcon={saved ? <BookmarkCheck className="text-primary" /> : <Bookmark />} disabled={saved} loading={actions.savingId === job.id} onClick={() => actions.save(data)}>
          {saved ? 'Saved' : 'Save'}
        </Button>
      )}
      <Button variant="ghost" leadingIcon={userState.hidden ? <Eye /> : <EyeOff />} onClick={() => actions.hide(data)}>
        {userState.hidden ? 'Show again' : 'Hide'}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="More actions" icon={<MoreHorizontal />} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<Activity />} onSelect={onCheck} disabled={checking}>
            Check if it's still open
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Copy />}
            onSelect={() => void copy(job.url).then((ok) => (ok ? toast.success('Link copied') : toast.error('Could not copy the link')))}
          >
            Copy link to the posting
          </DropdownMenuItem>
          {showFullPageLink ? (
            <DropdownMenuItem icon={<Maximize2 />} asChild>
              <Link to={`/jobs/${encodeURIComponent(job.id)}`}>Open full page</Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {checking ? <span className="text-xs text-muted">Checking the posting…</span> : null}
    </div>
  );
}

function livenessTitle(result: LivenessResult): string {
  if (result.status === 'open') return 'Still open';
  if (result.status === 'closed') return 'This posting looks closed';
  return "Couldn't tell if it's still open";
}

function ApplyPrompt({ data, actions }: { data: JobDetail; actions: JobActions }) {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-card border border-primary/30 bg-primary-soft px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">Did you apply?</p>
        <p className="text-xs text-muted">We'll mark it as applied in your tracker.</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="primary" onClick={() => actions.markApplied(data)}>
          Yes, I applied
        </Button>
        <Button size="sm" variant="ghost" onClick={actions.dismissAsk}>
          Not yet
        </Button>
      </div>
    </div>
  );
}

function SourceLine({ data, onCheck, checking }: { data: JobDetail; onCheck: () => void; checking: boolean }) {
  const sources = useSources();
  const { job, duplicates, liveness } = data;
  const sourceIds = [job.source, ...duplicates.map((d) => d.source)];
  // Sources that ask for credit get it wherever their postings appear.
  const credits = [...new Set(sourceIds.map((id) => sources.data?.find((s) => s.id === id)?.attribution).filter((a): a is string => Boolean(a)))];
  const linkClass = 'font-medium text-fg underline decoration-border underline-offset-2 hover:decoration-fg';
  return (
    <div className="space-y-1 text-xs text-muted">
      <p>
        Listed on{' '}
        <a href={job.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
          {job.sourceName}
        </a>
        {duplicates.length > 0 ? (
          <>
            {' · Also on '}
            {duplicates.map((d, i) => (
              <span key={d.jobId}>
                {i > 0 ? ', ' : null}
                <a href={d.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {d.sourceName}
                </a>
              </span>
            ))}
          </>
        ) : null}
        {liveness ? (
          <span>
            {' · '}
            <span className={liveness.status === 'closed' ? 'text-danger' : liveness.status === 'open' ? 'text-success' : undefined}>
              {livenessTitle(liveness)}
            </span>{' '}
            (checked {formatRelativeTime(liveness.checkedAt)})
          </span>
        ) : (
          <>
            {' · '}
            <button type="button" onClick={onCheck} disabled={checking} className="font-medium text-primary hover:underline disabled:opacity-60">
              {checking ? 'Checking…' : "Check if it's still open"}
            </button>
          </>
        )}
      </p>
      {credits.map((credit) => (
        <p key={credit} className="text-subtle">
          {credit}
        </p>
      ))}
    </div>
  );
}

function WhyThisJob({ score, match }: { score: number; match: MatchExplanation }) {
  const reasons = match.reasons.toSorted((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return (
    <section aria-labelledby="why-title" className="rounded-card border border-border bg-surface-2/50 p-4">
      <div className="flex items-center gap-3">
        <ScoreRing value={score} size="md" />
        <div>
          <h3 id="why-title" className="text-sm font-semibold text-fg">
            Why this job
          </h3>
          <p className="text-xs text-muted">{TITLE_MATCH[match.titleMatch]}</p>
        </div>
      </div>
      {reasons.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {reasons.map((r) => (
            <li key={r.key} className="flex items-baseline justify-between gap-3">
              <span className="text-fg">{r.label}</span>
              <span className={`shrink-0 text-xs tabular-nums ${r.points >= 0 ? 'text-success' : 'text-danger'}`}>
                {r.points >= 0 ? '+' : '−'}
                {Math.abs(Math.round(r.points))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {match.skillsMatched.length > 0 ? <SkillList title="Your skills it asks for" skills={match.skillsMatched} tone="success" /> : null}
      {match.skillsMissing.length > 0 ? <SkillList title="Skills it mentions that aren't in your profile" skills={match.skillsMissing} tone="warning" /> : null}
    </section>
  );
}

function SkillList({ title, skills, tone }: { title: string; skills: readonly string[]; tone: 'success' | 'warning' }) {
  return (
    <div className="mt-3">
      <p className="text-xs text-subtle">{title}</p>
      <ul className="mt-1 flex flex-wrap gap-1">
        {skills.map((skill) => (
          <li key={skill}>
            <Badge tone={tone} size="md">
              {skill}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Description({ data, loading, failed, onRetry }: { data: JobDetail; loading: boolean; failed: boolean; onRetry: () => void }) {
  if (data.descriptionHtml) return <RichText html={data.descriptionHtml} />;
  if (loading) return <SkeletonText lines={10} />;
  return (
    <div className="space-y-2 text-sm text-muted">
      {data.job.snippet ? <p>{data.job.snippet}</p> : null}
      {failed ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Load the full description
        </Button>
      ) : (
        <p>
          The full description isn't available here.{' '}
          <a href={data.job.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
            Read it on {data.job.sourceName}
          </a>
          .
        </p>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading the job">
      <div className="flex gap-3">
        <Skeleton className="size-11 rounded-control" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-4 w-2/3" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-20" />
      </div>
      <SkeletonText lines={10} />
    </div>
  );
}
