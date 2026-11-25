/** The job side of the application page: key facts, apply links and the saved posting. */
import { useState, type ReactNode } from 'react';
import { CircleSlash, ExternalLink } from 'lucide-react';
import { EMPLOYMENT_LABELS, REMOTE_LABELS } from '../../../../shared/constants';
import type { ApplicationDetail } from '../../../../shared/types';
import { Badge, Button, RichText } from '../../../components/ui';
import { cn } from '../../../lib/cn';
import { formatDate } from '../../../lib/format';
import { ClearanceBadge, useHeldClearance } from '../../search/job-bits';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-sm text-fg">{children}</dd>
    </div>
  );
}

/** Long postings start folded so the workflow stays in view. */
const FOLD_AT_CHARS = 1800;

export function ApplyButton({ app, onApply, className }: { app: ApplicationDetail; onApply?: () => void; className?: string }) {
  const href = app.job.applyUrl || app.job.url;
  if (!href) return null;
  return (
    <Button asChild variant="primary" trailingIcon={<ExternalLink />} className={className}>
      <a href={href} target="_blank" rel="noreferrer noopener" onClick={onApply}>
        Apply
      </a>
    </Button>
  );
}

export function JobPanel({ app }: { app: ApplicationDetail }) {
  const { job } = app;
  const long = job.descriptionHtml.length > FOLD_AT_CHARS;
  const [expanded, setExpanded] = useState(false);
  const remote = job.remote !== 'unknown' ? REMOTE_LABELS[job.remote] : null;
  const held = useHeldClearance();
  const location = [job.locationText, remote].filter(Boolean).join(' · ');

  return (
    <section aria-label="The job" className="rounded-card border border-border bg-surface">
      {app.jobClosed ? (
        <p className="flex items-start gap-2 rounded-t-card border-b border-border bg-warning-soft px-4 py-2.5 text-sm text-warning">
          <CircleSlash aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>This posting looks closed. The employer may have stopped taking applications, but the details are kept here.</span>
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-3">
        <Fact label="Company">{job.company || '–'}</Fact>
        <Fact label="Location">{location || 'Not stated'}</Fact>
        <Fact label="Salary">{job.salaryText || 'Not stated'}</Fact>
        <Fact label="Type">{EMPLOYMENT_LABELS[job.employmentType]}</Fact>
        <Fact label="Clearance">{job.clearance ? <ClearanceBadge clearance={job.clearance} held={held} /> : 'Not mentioned'}</Fact>
        <Fact label="Posted">{formatDate(job.postedAt) || 'Unknown'}</Fact>
        <Fact label="Source">
          {job.url ? (
            <a href={job.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
              {job.sourceName || 'View posting'}
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          ) : (
            job.sourceName || 'Added by you'
          )}
        </Fact>
      </dl>
      {job.skills.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-4">
          {job.skills.slice(0, 16).map((s) => (
            <Badge key={s} size="sm">
              {s}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="border-t border-border p-4">
        {job.descriptionHtml.trim() ? (
          <>
            <div className={cn('relative', long && !expanded && 'max-h-[28rem] overflow-hidden')}>
              <RichText html={job.descriptionHtml} />
              {long && !expanded ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface" /> : null}
            </div>
            {long ? (
              <Button variant="link" size="sm" className="mt-2" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                {expanded ? 'Show less' : 'Show the full posting'}
              </Button>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted">No description was saved for this job.</p>
        )}
      </div>
    </section>
  );
}
