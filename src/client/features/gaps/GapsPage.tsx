/**
 * Skill gaps: across the jobs you are aiming for (your target titles and saved preferences), your
 * active applications, or a search, what the postings ask for that your profile and résumé don't
 * show, how much each would raise your match, and what to do first.
 */
import { useId, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Check, FileWarning, Lightbulb, Search, SquareKanban, Target, UserRound } from 'lucide-react';
import type { GapAnalysis, GapItem, GapRecommendation, GapScope, SkillDemand } from '../../../shared/types';
import { SENIORITY_LABELS } from '../../../shared/constants';
import { errorMessage } from '../../api/client';
import { Page } from '../../components/layout/Page';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  useToast,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { pluralize } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';
import { PRIORITY_LABELS, PRIORITY_TONES } from '../resume/model';
import { useProfile, useSaveProfile } from '../profile/profile-api';
import { addToProfilePatch, categoryLabel, formatGain, gapsUrl, levelRows, profileHas, recommendationLink, requestFromParams, skillSearchUrl } from './model';
import { useGaps } from './queries';

const RECOMMENDATIONS_SHOWN = 6;
const GAPS_SHOWN = 8;
/** Below this many postings that list skills, shares are rough and the page says so. */
const FEW_WITH_SKILLS = 10;

type Kind = GapItem['kind'];

// --- small pieces --------------------------------------------------------------------------------

/** A share of the jobs as a slim bar on a lighter track of the same hue; the figure is printed beside it. */
function Meter({ value, label, className }: { value: number; label: string; className?: string }) {
  const width = Math.min(100, Math.max(0, value));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width)}%`}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-primary-soft', className)}
    >
      <div className="h-full rounded-r-full bg-primary" style={{ width: `${width > 0 ? Math.max(width, 1.5) : 0}%` }} />
    </div>
  );
}

function StatTile({ label, value, detail, aside }: { label: string; value: ReactNode; detail?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-3xl font-semibold text-fg">{value}</span>
        {aside}
      </p>
      {detail ? <p className="text-xs text-muted">{detail}</p> : null}
    </div>
  );
}

/** A titled card that is also a named region, so assistive technology can jump between the sections. */
function SectionCard({ title, description, children, aside }: { title: string; description?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  const id = useId();
  return (
    <Card role="region" aria-labelledby={id}>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle id={id}>{title}</CardTitle>
          {aside ? <span className="text-xs text-muted tabular-nums">{aside}</span> : null}
        </div>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** "I have it": adds a skill or certification to the profile; the analysis then updates on its own. */
function useHaveIt() {
  const profile = useProfile();
  const save = useSaveProfile();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const add = (item: { name: string; kind: Kind }) => {
    if (!profile.data) return;
    setPending(item.name);
    save.mutate(addToProfilePatch(profile.data, item), {
      onSuccess: () =>
        toast.success(`Added ${item.name} to your ${item.kind === 'certification' ? 'certifications' : 'skills'}`, {
          description: 'If your résumé doesn’t mention it yet, add it there too: employers only see the résumé.',
        }),
      onError: (err) => toast.error(`Could not add ${item.name}`, { description: errorMessage(err) }),
      onSettled: () => setPending(null),
    });
  };
  return { add, pending, has: (item: { name: string; kind: Kind }) => profileHas(profile.data, item), ready: Boolean(profile.data) };
}

type HaveIt = ReturnType<typeof useHaveIt>;

function GapActions({ item, haveIt, searchLabel = 'Jobs' }: { item: { name: string; kind: Kind }; haveIt: HaveIt; searchLabel?: string }) {
  const added = haveIt.has(item);
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        leadingIcon={<Check />}
        loading={haveIt.pending === item.name}
        disabled={!haveIt.ready || added || (haveIt.pending !== null && haveIt.pending !== item.name)}
        onClick={() => haveIt.add(item)}
        aria-label={`I have ${item.name}: add it to my ${item.kind === 'certification' ? 'certifications' : 'skills'}`}
      >
        {added ? 'Added' : item.kind === 'certification' ? 'I hold it' : 'I have it'}
      </Button>
      <Button asChild size="sm" variant="ghost" leadingIcon={<Search />}>
        <Link to={skillSearchUrl(item.name)} aria-label={`Search jobs that mention ${item.name}`}>
          {searchLabel}
        </Link>
      </Button>
    </span>
  );
}

// --- sections ------------------------------------------------------------------------------------

function Stats({ data }: { data: GapAnalysis }) {
  const p = data.projection;
  const rise = p && data.avgMatch !== null ? p.avgMatch - data.avgMatch : 0;
  return (
    <div className={cn('grid grid-cols-1 gap-3', p ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
      <StatTile
        label="Average match"
        value={data.avgMatch === null ? '–' : `${data.avgMatch}%`}
        detail={data.jobsMatched > 0 ? `Across ${pluralize(data.jobsMatched, 'job')}` : 'Add your skills or résumé to compare'}
      />
      <StatTile label="Strong matches" value={data.strongJobs} detail={`Jobs at ${data.strongThreshold}% or more`} />
      {p ? (
        <StatTile
          label={`With the top ${p.added.length === 1 ? 'gap' : `${p.added.length} gaps`} closed`}
          value={`${p.avgMatch}%`}
          aside={
            rise > 0 ? (
              <Badge size="sm" tone="success">
                +{rise} points
              </Badge>
            ) : undefined
          }
          detail={`${p.added.join(', ')} · ${pluralize(p.strongJobs, 'strong match', 'strong matches')}`}
        />
      ) : null}
    </div>
  );
}

function RecommendationItem({ rec, haveIt }: { rec: GapRecommendation; haveIt: HaveIt }) {
  const link = recommendationLink(rec);
  const gap = (rec.kind === 'learn-skill' || rec.kind === 'get-certification') && rec.skills?.[0];
  return (
    <li className="rounded-card border border-border p-3">
      <div className="flex items-start gap-2">
        <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-fg">
            <span className="min-w-0">{rec.title}</span>
            <Badge size="sm" tone={PRIORITY_TONES[rec.priority]}>
              {PRIORITY_LABELS[rec.priority]}
            </Badge>
            {rec.impact ? (
              <Badge size="sm" tone="success" variant="outline">
                {rec.impact}
              </Badge>
            ) : null}
          </p>
          <p className="mt-1 text-sm text-muted">{rec.detail}</p>
          {gap ? (
            <div className="mt-2 -ml-2.5">
              <GapActions item={{ name: gap, kind: rec.kind === 'get-certification' ? 'certification' : 'skill' }} haveIt={haveIt} searchLabel="Jobs asking for it" />
            </div>
          ) : link ? (
            <Link to={link.to} className="mt-2 inline-flex text-sm font-medium text-primary hover:underline">
              {link.label}
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Recommendations({ data, haveIt }: { data: GapAnalysis; haveIt: HaveIt }) {
  const [all, setAll] = useState(false);
  const recs = all ? data.recommendations : data.recommendations.slice(0, RECOMMENDATIONS_SHOWN);
  return (
    <SectionCard
      title="What to do first"
      description="The changes that would make you a better match for these jobs, most important first."
      aside={data.recommendations.length ? pluralize(data.recommendations.length, 'suggestion') : undefined}
    >
      {data.recommendations.length === 0 ? (
        <p className="text-sm text-muted">Nothing stands out: your profile and résumé already show most of what these jobs ask for.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          <ol className="flex flex-col gap-2.5">
            {recs.map((rec) => (
              <RecommendationItem key={rec.id} rec={rec} haveIt={haveIt} />
            ))}
          </ol>
          {data.recommendations.length > RECOMMENDATIONS_SHOWN ? (
            <Button variant="link" size="sm" className="self-start" onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${data.recommendations.length}`}
            </Button>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function GapRow({ item, haveIt }: { item: GapItem; haveIt: HaveIt }) {
  const category = item.kind === 'skill' ? categoryLabel(item.category) : undefined;
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-sm">
          <span className="font-medium text-fg">{item.name}</span>
          {category ? <span className="ml-2 text-xs text-subtle">{category}</span> : null}
        </p>
        <p className="shrink-0 text-sm text-fg tabular-nums">
          {item.share}%<span className="text-xs text-muted"> · {pluralize(item.jobs, 'job')}</span>
        </p>
      </div>
      <Meter className="mt-1.5" value={item.share} label={`${item.name}: listed by ${item.share}% of the jobs that name skills`} />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-xs text-muted">
          {item.avgGain > 0 ? `${formatGain(item.avgGain)} match on those jobs${item.tierUps > 0 ? ` · ${item.tierUps} up a tier` : ''}` : null}
        </span>
        <span className="-mr-2.5">
          <GapActions item={item} haveIt={haveIt} />
        </span>
      </div>
    </li>
  );
}

function GapList({ title, description, items, haveIt, empty }: { title: string; description: string; items: GapItem[]; haveIt: HaveIt; empty: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, GAPS_SHOWN);
  return (
    <SectionCard title={title} description={description} aside={items.length ? pluralize(items.length, 'gap') : undefined}>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col divide-y divide-border">
            {shown.map((item) => (
              <GapRow key={item.name} item={item} haveIt={haveIt} />
            ))}
          </ul>
          {items.length > GAPS_SHOWN ? (
            <Button variant="link" size="sm" className="self-start" onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${items.length}`}
            </Button>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function LevelCard({ data }: { data: GapAnalysis }) {
  const { level } = data;
  const rows = levelRows(level);
  const yours = level.yours.map((s) => SENIORITY_LABELS[s]).join(' or ');
  const years = level.years !== null ? `${pluralize(level.years, 'year')} of experience` : null;
  return (
    <SectionCard title="Level" description="The seniority these jobs ask for, against yours.">
      {level.yours.length === 0 ? (
        <p className="text-sm text-muted">
          JScout can’t tell your level yet.{' '}
          <Link to="/profile#work" className="font-medium text-primary hover:underline">
            Add your years of experience
          </Link>{' '}
          to compare.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">None of these jobs states a level.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <li key={row.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-fg">{row.label}</span>
                  <span className="text-fg tabular-nums">
                    {row.share}%<span className="text-xs text-muted"> · {pluralize(row.count, 'job')}</span>
                  </span>
                </div>
                <Meter className="mt-1.5" value={row.share} label={`${row.label}: ${row.share}% of the jobs that state a level`} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            Your level: {yours}
            {years ? ` · ${years}` : ''}
            {level.unknown > 0 ? ` · ${pluralize(level.unknown, 'job')} state no level` : ''}
          </p>
        </div>
      )}
    </SectionCard>
  );
}

function StrengthsCard({ data }: { data: GapAnalysis }) {
  const notOnResume = new Set(data.resumeGaps.map((d) => d.name));
  const chip = (d: SkillDemand) => {
    const missing = notOnResume.has(d.name);
    return (
      <li
        key={d.name}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm',
          missing ? 'border-warning/40 bg-warning-soft text-fg' : 'border-border bg-surface-2 text-fg',
        )}
      >
        {missing ? <FileWarning aria-hidden="true" className="size-3.5 text-warning" /> : null}
        <span>{d.name}</span>
        <span className="text-xs text-muted tabular-nums">{d.share}%</span>
        {missing ? <span className="sr-only">(not on your résumé)</span> : null}
      </li>
    );
  };
  return (
    <SectionCard title="Your strengths" description="Skills you have that these jobs ask for most. Lead with them on your résumé.">
      {data.strengths.length === 0 ? (
        <p className="text-sm text-muted">None of your skills appear in these postings yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-wrap gap-1.5">{data.strengths.map(chip)}</ul>
          {notOnResume.size > 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <FileWarning aria-hidden="true" className="size-3.5 text-warning" /> Not on your résumé yet
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function Blocked({ data, onScope }: { data: GapAnalysis; onScope: (scope: GapScope) => void }) {
  if (data.blocker === 'no-targets') {
    return (
      <EmptyState
        icon={<Target />}
        title="Tell JScout which jobs you want"
        description="Add the job titles you are aiming for (or your current title) to your profile, and this page shows what those jobs ask for that you don’t show yet."
        action={
          <Button asChild variant="primary">
            <Link to="/profile#preferences">Add target titles</Link>
          </Button>
        }
      />
    );
  }
  if (data.blocker === 'no-applications') {
    return (
      <EmptyState
        icon={<SquareKanban />}
        title="No active applications"
        description="Save jobs to your tracker to see what they ask for, or look at the jobs you are aiming for instead."
        action={
          <>
            <Button variant="primary" onClick={() => onScope('profile')}>
              Jobs I’m aiming for
            </Button>
            <Button asChild>
              <Link to="/">Find jobs</Link>
            </Button>
          </>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={<Search />}
      title="No jobs to look at"
      description={`No open jobs match ${data.basis}. Try broader target titles, or wait for the next sync to bring in more jobs.`}
      action={
        <Button asChild>
          <Link to="/profile#preferences">Edit target titles</Link>
        </Button>
      }
    />
  );
}

function Basis({ data }: { data: GapAnalysis }) {
  if (data.blocker) return null;
  return (
    <p className="text-sm text-muted">
      Based on {pluralize(data.jobs, 'job')}: <span className="font-medium text-fg">{data.basis}</span>.{' '}
      {data.jobsWithSkills < data.jobs ? `${data.jobsWithSkills} of them list skills. ` : ''}
      {data.scope === 'profile' ? (
        <Link to="/profile#preferences" className="font-medium text-primary hover:underline">
          Change target titles
        </Link>
      ) : null}
    </p>
  );
}

function Analysis({ data, onScope }: { data: GapAnalysis; onScope: (scope: GapScope) => void }) {
  const haveIt = useHaveIt();
  if (data.blocker) {
    return (
      <Card padded>
        <Blocked data={data} onScope={onScope} />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {data.jobsWithSkills < FEW_WITH_SKILLS ? (
        <p className="rounded-control bg-info-soft px-3 py-2 text-sm text-fg">
          Only {pluralize(data.jobsWithSkills, 'of these postings lists', 'of these postings list')} specific skills, so treat the shares below as rough.
        </p>
      ) : null}
      <Stats data={data} />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Recommendations data={data} haveIt={haveIt} />
        <div className="flex min-w-0 flex-col gap-6">
          <GapList
            title="Skills they ask for"
            description="Skills these jobs list that your profile and résumé don’t show, by how much each would raise your match."
            items={data.missingSkills}
            haveIt={haveIt}
            empty="You show every skill these jobs commonly list."
          />
          {data.missingCerts.length > 0 ? (
            <GapList
              title="Certifications they ask for"
              description="Certifications and licences these jobs list that you don’t hold."
              items={data.missingCerts}
              haveIt={haveIt}
              empty=""
            />
          ) : null}
          <LevelCard data={data} />
          <StrengthsCard data={data} />
        </div>
      </div>
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Looking at the jobs">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Skeleton className="h-96 rounded-card" />
        <Skeleton className="h-96 rounded-card" />
      </div>
    </div>
  );
}

// --- page ----------------------------------------------------------------------------------------

export function GapsPage() {
  useDocumentTitle('Skill gaps');
  const [params, setParams] = useSearchParams();
  const { request, search } = requestFromParams(params);
  const gaps = useGaps(request);

  const setScope = (scope: GapScope) => {
    const url = new URL(gapsUrl(scope, scope === 'search' ? search : undefined), window.location.origin);
    setParams(url.searchParams, { replace: true });
  };

  const options: Array<{ value: GapScope; label: string; icon: ReactNode }> = [
    { value: 'profile', label: 'Jobs I’m aiming for', icon: <UserRound /> },
    { value: 'applications', label: 'My applications', icon: <SquareKanban /> },
    ...(search ? [{ value: 'search' as const, label: 'This search', icon: <Search /> }] : []),
  ];

  return (
    <Page>
      <PageHeader
        title="Skill gaps"
        description="What the jobs you want ask for that your profile and résumé don’t show yet, and which changes would make you a better match."
      />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <SegmentedControl aria-label="Which jobs to look at" size="sm" value={request.scope} onValueChange={setScope} options={options} className="self-start max-sm:w-full" fullWidth={false} />
          {gaps.data ? <Basis data={gaps.data} /> : null}
        </div>
        {gaps.isPending ? (
          <AnalysisSkeleton />
        ) : gaps.isError ? (
          <ErrorState title="Could not look at the jobs" error={gaps.error} onRetry={() => void gaps.refetch()} retrying={gaps.isFetching} />
        ) : (
          <div className={cn('transition-opacity', gaps.isPlaceholderData && 'opacity-60')}>
            <Analysis data={gaps.data} onScope={setScope} />
          </div>
        )}
      </div>
    </Page>
  );
}

