/** How well the user's profile fits a posting: score, skills, keywords, alignment, flags and suggestions. */
import { useState } from 'react';
import { Link } from 'react-router';
import { Check, CircleHelp, Lightbulb, TriangleAlert, X } from 'lucide-react';
import { SENIORITY_LABELS } from '../../../shared/constants';
import type { FitAnalysis, TitleMatchKind } from '../../../shared/types';
import { ApiRequestError } from '../../api/client';
import { Badge, Button, ErrorState, ScoreRing, Skeleton, SkeletonText, scoreTone } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useFitAnalysis, type ApplyKitTarget } from './queries';

type Verdict = 'ok' | 'warn' | 'unknown';

const VERDICT_ICONS: Record<Verdict, { icon: typeof Check; className: string; label: string }> = {
  ok: { icon: Check, className: 'bg-success-soft text-success', label: 'Good match' },
  warn: { icon: TriangleAlert, className: 'bg-warning-soft text-warning', label: 'Worth checking' },
  unknown: { icon: CircleHelp, className: 'bg-surface-3 text-muted', label: 'Not enough information' },
};

const TITLE_VERDICT: Record<TitleMatchKind, Verdict> = {
  exact: 'ok',
  synonym: 'ok',
  related: 'warn',
  partial: 'warn',
  none: 'warn',
};

function okVerdict(ok: boolean | null): Verdict {
  if (ok === null) return 'unknown';
  return ok ? 'ok' : 'warn';
}

const KEYWORDS_SHOWN = 10;

function AlignmentRow({ label, verdict, detail }: { label: string; verdict: Verdict; detail: string }) {
  const { icon: Icon, className, label: verdictLabel } = VERDICT_ICONS[verdict];
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', className)}>
        <Icon aria-label={verdictLabel} className="size-3" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{label}</p>
        <p className="text-sm text-muted">{detail || 'Not stated in the posting.'}</p>
      </div>
    </li>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{children}</h3>;
}

function FitSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Analysing the posting">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <SkeletonText lines={2} className="flex-1" />
      </div>
      <Skeleton className="h-6 w-3/4" />
      <SkeletonText lines={4} />
    </div>
  );
}

function FitResult({ fit }: { fit: FitAnalysis }) {
  const [allKeywords, setAllKeywords] = useState(false);
  const keywords = [...fit.keywords].sort((a, b) => b.weight - a.weight);
  const shownKeywords = allKeywords ? keywords : keywords.slice(0, KEYWORDS_SHOWN);
  const covered = fit.keywords.filter((k) => k.present).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <ScoreRing value={fit.score} size="lg" tone={scoreTone(fit.score)} label="Fit score" />
        <p className="min-w-0 text-sm text-fg text-pretty">{fit.summary}</p>
      </div>

      {fit.flags.length > 0 ? (
        <div className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5">
          <p className="flex items-center gap-2 text-sm font-medium text-warning">
            <TriangleAlert aria-hidden="true" className="size-4" /> Possible blockers
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-6 text-sm text-fg">
            {fit.flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="flex flex-col gap-2.5">
        <SectionTitle>Skills</SectionTitle>
        {fit.skillsMatched.length + fit.skillsMissing.length === 0 ? (
          <p className="text-sm text-muted">The posting does not name specific skills.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {fit.skillsMatched.map((s) => (
              <Badge key={`m-${s}`} tone="success" icon={<Check />}>
                {s}
              </Badge>
            ))}
            {fit.skillsMissing.map((s) => (
              <Badge key={`x-${s}`} tone="neutral" variant="outline" icon={<X />}>
                {s}
              </Badge>
            ))}
          </div>
        )}
        {fit.skillsMissing.length > 0 ? (
          <p className="text-xs text-muted">Skills marked ✕ are asked for in the posting but are not on your profile or résumé.</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-1">
        <SectionTitle>How it lines up</SectionTitle>
        <ul className="divide-y divide-border">
          <AlignmentRow label="Job title" verdict={TITLE_VERDICT[fit.titleAlignment.kind]} detail={fit.titleAlignment.detail} />
          <AlignmentRow
            label={fit.seniorityAlignment.job === 'unknown' ? 'Seniority' : `Seniority: ${SENIORITY_LABELS[fit.seniorityAlignment.job]}`}
            verdict={fit.seniorityAlignment.job === 'unknown' ? 'unknown' : 'ok'}
            detail={fit.seniorityAlignment.detail}
          />
          <AlignmentRow label="Location" verdict={okVerdict(fit.locationAlignment.ok)} detail={fit.locationAlignment.detail} />
          <AlignmentRow label="Salary" verdict={okVerdict(fit.salaryAlignment.ok)} detail={fit.salaryAlignment.detail} />
        </ul>
      </section>

      {keywords.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <SectionTitle>Keywords in the posting</SectionTitle>
            <span className="text-xs text-muted tabular-nums">
              {covered} of {keywords.length} covered
            </span>
          </div>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {shownKeywords.map((k) => (
              <li key={k.term} className="flex items-center gap-2 text-sm">
                {k.present ? (
                  <Check aria-label="On your profile" className="size-3.5 shrink-0 text-success" />
                ) : (
                  <X aria-label="Missing" className="size-3.5 shrink-0 text-subtle" />
                )}
                <span className={cn('truncate', k.present ? 'text-fg' : 'text-muted')}>{k.term}</span>
              </li>
            ))}
          </ul>
          {keywords.length > KEYWORDS_SHOWN ? (
            <Button variant="link" size="sm" className="self-start" onClick={() => setAllKeywords((v) => !v)}>
              {allKeywords ? 'Show fewer' : `Show all ${keywords.length}`}
            </Button>
          ) : null}
        </section>
      ) : null}

      {fit.suggestions.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionTitle>Suggestions</SectionTitle>
          <ul className="flex flex-col gap-2">
            {fit.suggestions.map((s) => (
              <li key={s} className="flex gap-2 text-sm text-fg">
                <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-muted">
        Based on your{' '}
        <Link to="/profile" className="font-medium text-primary hover:underline">
          profile and résumé
        </Link>
        . Keep them up to date for a sharper match.
      </p>
    </div>
  );
}

export function FitPanel({ target }: { target: ApplyKitTarget }) {
  const fit = useFitAnalysis(target);
  if (fit.isPending) return <FitSkeleton />;
  if (fit.isError) {
    const unavailable = fit.error instanceof ApiRequestError && fit.error.status === 501;
    return (
      <ErrorState
        compact
        title={unavailable ? 'Fit analysis is not available yet' : 'Could not analyse this posting'}
        error={fit.error}
        onRetry={() => void fit.refetch()}
        retrying={fit.isFetching}
      />
    );
  }
  return <FitResult fit={fit.data} />;
}
