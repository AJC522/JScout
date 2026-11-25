/** One search result. Memoised: hovering or moving the cursor re-renders only the cards involved. */
import { memo, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { Bookmark, BookmarkCheck, EyeOff, Eye, Maximize2 } from 'lucide-react';
import type { SearchResultItem } from '../../../shared/types';
import { Badge, Button, IconButton } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatRelativeTime, formatSalary } from '../../lib/format';
import { IconLink, MatchScore, RemoteBadge, sourceLine, StatusBadge } from './job-bits';
import type { JobRef } from './use-job-actions';

const MAX_SKILLS = 4;

export interface ResultCardProps {
  item: SearchResultItem;
  isNew: boolean;
  /** Shown in the detail view. */
  selected: boolean;
  /** Under the keyboard cursor. */
  focused: boolean;
  saving: boolean;
  now: number;
  onSelect: (id: string) => void;
  onSave: (item: JobRef) => void;
  onHide: (item: JobRef) => void;
}

function isModifiedClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

export const ResultCard = memo(function ResultCard({ item, isNew, selected, focused, saving, now, onSelect, onSave, onHide }: ResultCardProps) {
  const { job, userState, match, duplicates } = item;
  const salary = formatSalary(job.salary);
  const posted = job.postedAt ?? job.firstSeenAt;
  const status = userState.applicationStatus;
  const viewed = Boolean(userState.viewedAt) && !selected;
  const skills = match.skillsMatched.slice(0, MAX_SKILLS);

  // The whole card selects the job; buttons and links inside it keep their own behaviour.
  const onCardClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('a, button')) return;
    onSelect(job.id);
  };

  return (
    <article
      data-job-id={job.id}
      aria-current={selected ? 'true' : undefined}
      onClick={onCardClick}
      className={cn(
        'group relative cursor-pointer rounded-card border bg-surface p-3.5 transition-[border-color,box-shadow,background-color] sm:p-4',
        selected ? 'border-primary bg-primary-soft/40 shadow-[0_0_0_1px_var(--color-primary)]' : 'border-border hover:border-strong',
        focused && !selected && 'ring-2 ring-focus ring-offset-1 ring-offset-canvas',
        job.closedAt && 'bg-surface-2',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-start gap-2 text-base leading-snug font-medium">
            <Link
              to={`/jobs/${encodeURIComponent(job.id)}`}
              onClick={(event) => {
                if (isModifiedClick(event)) return;
                event.preventDefault();
                onSelect(job.id);
              }}
              className={cn(
                'line-clamp-2 rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
                viewed ? 'text-muted' : 'text-fg',
              )}
            >
              {job.title}
            </Link>
            {isNew ? (
              <Badge tone="accent" variant="solid" size="sm" className="mt-0.5">
                New
              </Badge>
            ) : null}
          </h3>
          <p className="mt-0.5 truncate text-sm text-muted">
            <span className="font-medium text-fg/90">{job.company}</span>
            {job.locationText ? <span> · {job.locationText}</span> : null}
          </p>
        </div>
        <MatchScore score={item.score} match={match} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
        <RemoteBadge mode={job.location.remote} />
        {salary ? <span className="font-medium text-fg/90 tabular-nums">{salary}</span> : null}
        <span title={posted}>{formatRelativeTime(posted, now)}</span>
        <span className="truncate text-subtle">{sourceLine(job.sourceName, duplicates.length)}</span>
        {job.closedAt ? (
          <Badge tone="warning" size="sm">
            Closed
          </Badge>
        ) : null}
        {status ? <StatusBadge status={status} /> : null}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <ul className="flex min-w-0 flex-1 flex-wrap gap-1" aria-label="Matching skills">
          {skills.map((skill) => (
            <li key={skill} className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.6875rem] text-muted">
              {skill}
            </li>
          ))}
        </ul>
        <div className="-my-1 -mr-1.5 flex shrink-0 items-center gap-0.5">
          {status && userState.applicationId ? (
            <Button asChild size="sm" variant="ghost" leadingIcon={<BookmarkCheck className="text-primary" />}>
              <Link to={`/tracker/${encodeURIComponent(userState.applicationId)}`}>{status === 'saved' ? 'Saved' : 'In tracker'}</Link>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              loading={saving}
              disabled={Boolean(status)}
              leadingIcon={status ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
              onClick={() => onSave(item)}
            >
              {status ? 'Saved' : 'Save'}
            </Button>
          )}
          <IconButton
            size="sm"
            label={userState.hidden ? 'Show again' : 'Hide'}
            icon={userState.hidden ? <Eye /> : <EyeOff />}
            onClick={() => onHide(item)}
          />
          <IconLink to={`/jobs/${encodeURIComponent(job.id)}`} label="Open full page" icon={<Maximize2 />} />
        </div>
      </div>
    </article>
  );
});
