/**
 * The résumé review for one target (job, application or pasted posting): score and breakdown,
 * what to change, requirement by requirement, bullet by bullet, then a tailored draft that can
 * be edited, re-scored, copied, downloaded or saved.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check, ChevronDown, CircleDot, FileText, Lightbulb, TriangleAlert, Wand2, X } from 'lucide-react';
import type { RequirementCheck, ResumeReview, ResumeTarget } from '../../../shared/types';
import { ApiRequestError } from '../../api/client';
import { Badge, Button, CopyButton, ErrorState, ProgressBar, ScoreRing, SegmentedControl, Skeleton, SkeletonText, scoreTone } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatRelativeTime, pluralize } from '../../lib/format';
import { useProfile } from '../profile/profile-api';
import { ResumeUpload } from '../profile/ResumeUpload';
import { ISSUE_LABELS, PRIORITY_LABELS, PRIORITY_TONES, STATUS_LABELS, formatDelta, groupRequirements, targetKey } from './model';
import { useResumeReview } from './queries';
import { ResumeRework } from './ResumeRework';

const KEYWORDS_SHOWN = 12;
const RECOMMENDATIONS_SHOWN = 6;

export interface ResumeReviewPanelProps {
  target: ResumeTarget;
  /** Used to name saved and downloaded drafts. */
  company?: string;
  /** Show a link to the full Résumé review page (from the apply kit). */
  fullPageLink?: string;
  /** Name the job being compared with (off where the page already shows it). */
  showJob?: boolean;
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{children}</h3>
      {aside ? <span className="text-xs text-muted tabular-nums">{aside}</span> : null}
    </div>
  );
}

function Collapsible({ title, aside, children, defaultOpen = false }: { title: string; aside?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="rounded-card border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-card px-3 py-2.5 text-left text-sm font-medium text-fg hover:bg-hover"
      >
        <span>{title}</span>
        <span className="flex items-center gap-2 text-xs font-normal text-muted">
          {aside}
          <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open ? (
        <div id={id} className="border-t border-border p-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function ReviewSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Reviewing your résumé">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <SkeletonText lines={2} className="flex-1" />
      </div>
      <SkeletonText lines={5} />
      <Skeleton className="h-24 rounded-card" />
    </div>
  );
}

function NoResume() {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-base font-medium text-fg">Add your résumé to review it against this job</p>
        <p className="text-sm text-muted">
          JScout reads it on this computer, scores it against the posting, and shows what to change. You can replace it any time on your{' '}
          <Link to="/profile#resume" className="font-medium text-primary hover:underline">
            profile
          </Link>
          .
        </p>
      </div>
      <ResumeUpload onUploaded={() => undefined} />
    </div>
  );
}

// --- review sections -----------------------------------------------------------------------

/** The summary without its "Fair match (58/100):" lead, which the ring and heading already show. */
function summaryText(summary: string): string {
  const rest = summary.replace(/^[^:]+\(\d+\/100\):\s*/, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

function ScoreHeader({ review, baseline, onTailor }: { review: ResumeReview; baseline?: number; onTailor: () => void }) {
  const delta = baseline === undefined ? undefined : review.score - baseline;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <ScoreRing value={review.score} size="lg" tone={scoreTone(review.score)} label={`Résumé match ${review.score} out of 100`} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-fg">
            {review.band}
            {delta !== undefined ? (
              <Badge size="sm" tone={delta > 0 ? 'success' : delta < 0 ? 'danger' : 'neutral'}>
                {formatDelta(delta)} vs saved résumé
              </Badge>
            ) : null}
          </p>
          <p className="text-sm text-pretty text-muted">{summaryText(review.summary)}</p>
        </div>
      </div>
      <div>
        <Button size="sm" variant="primary" leadingIcon={<Wand2 />} onClick={onTailor}>
          Tailor my résumé for this job
        </Button>
      </div>
    </div>
  );
}

function Breakdown({ review }: { review: ResumeReview }) {
  return (
    <section className="flex flex-col gap-2.5">
      <SectionTitle>Score breakdown</SectionTitle>
      <ul className="flex flex-col gap-3">
        {review.categories.map((c) => (
          <li key={c.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className={cn('font-medium', c.score === null ? 'text-muted' : 'text-fg')}>{c.label}</span>
              <span className="text-xs text-muted tabular-nums">{c.score === null ? 'Not assessed' : `${c.score}/100 · ${c.weight} pts`}</span>
            </div>
            {c.score === null ? null : <ProgressBar value={c.score} label={`${c.label} score`} tone={scoreTone(c.score)} size="sm" />}
            <p className="text-xs text-muted">{c.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BeforeAfter({ before, after }: { before?: string; after?: string }) {
  if (!before && !after) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-control bg-surface-2 p-2.5 text-sm">
      {before ? (
        <p className="flex gap-2 text-muted">
          <span className="w-12 shrink-0 text-xs font-medium tracking-wide uppercase">{after ? 'Now' : 'Line'}</span>
          <span className={cn('min-w-0', after && 'line-through decoration-subtle')}>{before}</span>
        </p>
      ) : null}
      {after ? (
        <div className="flex items-start gap-2 text-fg">
          <span className="w-12 shrink-0 text-xs font-medium tracking-wide text-success uppercase">Try</span>
          <span className="min-w-0 flex-1">{after}</span>
          <CopyButton text={after} iconOnly label="Copy suggestion" size="sm" variant="ghost" className="-my-1" />
        </div>
      ) : null}
    </div>
  );
}

function Recommendations({ review }: { review: ResumeReview }) {
  const [all, setAll] = useState(false);
  const recs = all ? review.recommendations : review.recommendations.slice(0, RECOMMENDATIONS_SHOWN);
  if (review.recommendations.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <SectionTitle>What to change</SectionTitle>
        <p className="text-sm text-muted">Nothing stands out: your résumé already covers what this posting asks for.</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2.5">
      <SectionTitle aside={pluralize(review.recommendations.length, 'suggestion')}>What to change</SectionTitle>
      <ol className="flex flex-col gap-2.5">
        {recs.map((r) => (
          <li key={r.id} className="rounded-card border border-border p-3">
            <div className="flex items-start gap-2">
              <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-fg">
                  <span className="min-w-0">{r.title}</span>
                  <Badge size="sm" tone={PRIORITY_TONES[r.priority]}>
                    {PRIORITY_LABELS[r.priority]}
                  </Badge>
                </p>
                <p className="mt-1 text-sm text-muted">{r.detail}</p>
                <BeforeAfter before={r.before} after={r.after} />
              </div>
            </div>
          </li>
        ))}
      </ol>
      {review.recommendations.length > RECOMMENDATIONS_SHOWN ? (
        <Button variant="link" size="sm" className="self-start" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${review.recommendations.length}`}
        </Button>
      ) : null}
    </section>
  );
}

const STATUS_ICON = {
  met: { icon: Check, className: 'bg-success-soft text-success' },
  partial: { icon: CircleDot, className: 'bg-warning-soft text-warning' },
  missing: { icon: X, className: 'bg-surface-3 text-muted' },
} as const;

function RequirementRow({ req }: { req: RequirementCheck }) {
  const { icon: Icon, className } = STATUS_ICON[req.status];
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', className)}>
        <Icon aria-label={STATUS_LABELS[req.status]} className="size-3" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="text-fg">{req.text}</p>
        {req.evidence ? (
          <p className="mt-0.5 text-muted">
            <span className="font-medium">Shown in:</span> “{req.evidence}”
          </p>
        ) : null}
        {req.status !== 'met' && req.missing.length > 0 ? (
          <p className="mt-0.5 text-muted">
            <span className="font-medium">Not found:</span> {req.missing.join(', ')}
          </p>
        ) : null}
        {req.note ? <p className="mt-0.5 text-xs text-muted">{req.note}</p> : null}
      </div>
    </li>
  );
}

function Requirements({ review }: { review: ResumeReview }) {
  const { required, preferred } = groupRequirements(review.requirements);
  if (review.requirements.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <SectionTitle>Requirements</SectionTitle>
        <p className="text-sm text-muted">The posting has no requirements list JScout could read; the score leans on its skills and keywords.</p>
      </section>
    );
  }
  const met = (list: RequirementCheck[]) => list.filter((r) => r.status === 'met').length;
  return (
    <section className="flex flex-col gap-3">
      {required.length > 0 ? (
        <div className="flex flex-col gap-1">
          <SectionTitle aside={`${met(required)} of ${required.length} shown`}>Requirements</SectionTitle>
          <ul className="divide-y divide-border">
            {required.map((r) => (
              <RequirementRow key={r.text} req={r} />
            ))}
          </ul>
        </div>
      ) : null}
      {preferred.length > 0 ? (
        <div className="flex flex-col gap-1">
          <SectionTitle aside={`${met(preferred)} of ${preferred.length} shown`}>Nice to have</SectionTitle>
          <ul className="divide-y divide-border">
            {preferred.map((r) => (
              <RequirementRow key={r.text} req={r} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Keywords({ review }: { review: ResumeReview }) {
  const [all, setAll] = useState(false);
  const keywords = [...review.keywords].sort((a, b) => b.weight - a.weight);
  if (keywords.length === 0) return null;
  const shown = all ? keywords : keywords.slice(0, KEYWORDS_SHOWN);
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle aside={`${keywords.filter((k) => k.present).length} of ${keywords.length} used`}>Posting keywords</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((k) =>
          k.present ? (
            <Badge key={k.term} tone="success" icon={<Check />}>
              {k.term}
            </Badge>
          ) : (
            <Badge key={k.term} tone="neutral" variant="outline" icon={<X />}>
              {k.term}
            </Badge>
          ),
        )}
      </div>
      {keywords.length > KEYWORDS_SHOWN ? (
        <Button variant="link" size="sm" className="self-start" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${keywords.length}`}
        </Button>
      ) : null}
      <p className="text-xs text-muted">Terms marked ✕ appear in the posting but not in your résumé. Use them only where they describe your real work.</p>
    </section>
  );
}

function Bullets({ review }: { review: ResumeReview }) {
  if (review.bullets.length === 0) return null;
  const flagged = review.bullets.filter((b) => b.issues.length > 0).length;
  return (
    <Collapsible title="Bullet by bullet" aside={flagged > 0 ? `${flagged} to improve` : 'All good'}>
      <ul className="flex flex-col divide-y divide-border">
        {review.bullets.map((b, i) => (
          <li key={`${i}-${b.text}`} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
            {b.context ? <p className="truncate text-xs text-subtle">{b.context}</p> : null}
            <div className="flex items-start gap-3">
              <span
                className="mt-1 h-2 w-10 shrink-0 overflow-hidden rounded-full bg-surface-3"
                role="img"
                aria-label={`Relevance to this posting: ${Math.round(b.relevance * 100)}%`}
                title={`Relevance to this posting: ${Math.round(b.relevance * 100)}%`}
              >
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(4, b.relevance * 100)}%` }} />
              </span>
              <p className="min-w-0 flex-1 text-sm text-fg">{b.text}</p>
            </div>
            {b.issues.length > 0 || b.covers.length > 0 ? (
              <div className="flex flex-wrap gap-1 pl-13">
                {b.issues.map((issue) => (
                  <Badge key={issue} size="sm" tone="warning" variant="outline">
                    {ISSUE_LABELS[issue]}
                  </Badge>
                ))}
                {b.covers.slice(0, 3).map((term) => (
                  <Badge key={term} size="sm" tone="success">
                    {term}
                  </Badge>
                ))}
              </div>
            ) : null}
            {b.rewrite ? (
              <div className="pl-13">
                <BeforeAfter after={b.rewrite} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}

function Basics({ review }: { review: ResumeReview }) {
  const ok = review.checks.filter((c) => c.ok).length;
  return (
    <Collapsible title="Résumé basics" aside={`${ok} of ${review.checks.length} in place`}>
      <ul className="flex flex-col gap-2">
        {review.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2.5 text-sm">
            {c.ok ? (
              <Check aria-label="In place" className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <X aria-label="Missing" className="mt-0.5 size-4 shrink-0 text-subtle" />
            )}
            <span className="min-w-0">
              <span className="font-medium text-fg">{c.label}.</span> <span className="text-muted">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}

function Warnings({ review }: { review: ResumeReview }) {
  if (review.warnings.length === 0) return null;
  return (
    <div className="flex gap-2 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <ul className="space-y-1 text-fg">
        {review.warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

/** The review sections for whichever review (saved résumé or draft) is being viewed. */
function ReviewSections({ review }: { review: ResumeReview }) {
  return (
    <>
      <Warnings review={review} />
      <Recommendations review={review} />
      <Requirements review={review} />
      <Breakdown review={review} />
      <Keywords review={review} />
      <div className="flex flex-col gap-2.5">
        <Bullets review={review} />
        <Basics review={review} />
      </div>
    </>
  );
}

// --- panel -----------------------------------------------------------------------------------

function ReviewBody({ target, company, saved, fullPageLink }: { target: ResumeTarget; company?: string; saved: ResumeReview; fullPageLink?: string }) {
  const [draftReview, setDraftReview] = useState<ResumeReview | null>(null);
  const [view, setView] = useState<'saved' | 'draft'>('saved');
  const reworkRef = useRef<HTMLDivElement>(null);
  const shown = view === 'draft' && draftReview ? draftReview : saved;

  const onDraftReviewed = (review: ResumeReview) => {
    setDraftReview(review);
    setView('draft');
  };
  const scrollToRework = () => {
    reworkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    reworkRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  };

  return (
    <div className="flex flex-col gap-6">
      {draftReview ? (
        <SegmentedControl
          aria-label="Which résumé to show"
          size="sm"
          fullWidth
          value={view}
          onValueChange={setView}
          options={[
            { value: 'saved', label: `Saved résumé · ${saved.score}` },
            { value: 'draft', label: `Your draft · ${draftReview.score}` },
          ]}
        />
      ) : null}
      <ScoreHeader review={shown} baseline={shown === draftReview ? saved.score : undefined} onTailor={scrollToRework} />
      <ReviewSections review={shown} />
      <div ref={reworkRef} className="scroll-mt-6">
        <ResumeRework target={target} company={company ?? saved.job.company} job={saved.job} savedScore={saved.score} onReviewed={onDraftReviewed} />
      </div>
      {fullPageLink ? (
        <Link to={fullPageLink} className="inline-flex items-center gap-1 self-start text-sm font-medium text-primary hover:underline">
          Open in Résumé review <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

export function ResumeReviewPanel({ target, company, fullPageLink, showJob = true }: ResumeReviewPanelProps) {
  const profile = useProfile();
  const resume = profile.data?.resume ?? null;
  const review = useResumeReview(target, Boolean(resume?.text.trim()));

  if (profile.isPending) return <ReviewSkeleton />;
  if (profile.isError) {
    return <ErrorState compact title="Could not load your profile" error={profile.error} onRetry={() => void profile.refetch()} retrying={profile.isFetching} />;
  }
  if (!resume?.text.trim()) return <NoResume />;
  if (review.isPending) return <ReviewSkeleton />;
  if (review.isError) {
    const missing = review.error instanceof ApiRequestError && review.error.status === 404;
    return (
      <ErrorState
        compact
        title={missing ? 'This job is no longer available' : 'Could not review your résumé'}
        error={review.error}
        onRetry={() => void review.refetch()}
        retrying={review.isFetching}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {showJob ? (
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Compared with</p>
          <h2 className="text-lg leading-snug font-semibold text-balance text-fg">
            {review.data.job.title}
            {review.data.job.company ? <span className="font-normal text-muted"> · {review.data.job.company}</span> : null}
          </h2>
        </div>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
        <FileText aria-hidden="true" className="size-3.5" />
        <span className="font-medium text-fg">{resume.fileName || 'Your résumé'}</span>
        <span>· updated {formatRelativeTime(resume.updatedAt)} ·</span>
        <Link to="/profile#resume" className="font-medium text-primary hover:underline">
          Replace
        </Link>
      </p>
      <ReviewBody key={targetKey(target)} target={target} company={company} saved={review.data} fullPageLink={fullPageLink} />
    </div>
  );
}
