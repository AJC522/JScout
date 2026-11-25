/** A tracker card: the presentational view plus the sortable (draggable) wrapper used on the board. */
import type { CSSProperties, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BellRing, CalendarClock, CircleSlash, GripVertical } from 'lucide-react';
import { STATUS_LABELS } from '../../../shared/constants';
import type { Application } from '../../../shared/types';
import { Badge } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/format';
import { daysSince, followUpState, type FollowUpState } from './board';
import { PRIORITY_LABELS, PRIORITY_TONES } from './status';

function followUpLabel(state: FollowUpState, followUpAt: string): string {
  if (state.kind === 'overdue') return state.days === 1 ? 'Follow up: 1 day late' : `Follow up: ${state.days} days late`;
  if (state.kind === 'today') return 'Follow up today';
  return `Follow up ${formatDate(followUpAt, 'short')}`;
}

export function FollowUpBadge({ app, now }: { app: Application; now: number }) {
  const state = followUpState(app, now);
  if (!state || !app.followUpAt) return null;
  const due = state.kind !== 'upcoming';
  return (
    <Badge size="sm" tone={due ? 'warning' : 'neutral'} icon={due ? <BellRing /> : <CalendarClock />}>
      {followUpLabel(state, app.followUpAt)}
    </Badge>
  );
}

export function ClosedBadge() {
  return (
    <Badge size="sm" tone="danger" icon={<CircleSlash />}>
      Posting closed
    </Badge>
  );
}

function daysInStatus(app: Application, now: number): string {
  const days = daysSince(app.statusChangedAt, now);
  if (days === 0) return `${STATUS_LABELS[app.status]} today`;
  return `${days}d in ${STATUS_LABELS[app.status].toLowerCase()}`;
}

export interface ApplicationCardViewProps {
  app: Application;
  now: number;
  /** Rendered in the drag overlay (lifted look, no interactions). */
  overlay?: boolean;
  /** The original card while its copy is being dragged. */
  placeholder?: boolean;
  handle?: ReactNode;
  onOpen?: () => void;
}

export function ApplicationCardView({ app, now, overlay = false, placeholder = false, handle, onOpen }: ApplicationCardViewProps) {
  const { job } = app;
  const meta = [job.company, job.locationText].filter(Boolean).join(' · ');
  return (
    <div
      className={cn(
        'group relative flex flex-col gap-2 rounded-card border border-border bg-surface p-3 text-left transition-[border-color,box-shadow]',
        !overlay && !placeholder && 'hover:border-border-strong',
        overlay && 'rotate-1 cursor-grabbing border-border-strong shadow-overlay',
        placeholder && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <Link
              to={`/tracker/${app.id}`}
              draggable={false}
              onClick={(e) => {
                // Let modified clicks open a new tab as usual.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                onOpen();
              }}
              className="line-clamp-2 text-sm leading-snug font-medium text-fg after:absolute after:inset-0 after:rounded-card hover:text-primary focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus"
            >
              {job.title}
            </Link>
          ) : (
            <p className="line-clamp-2 text-sm leading-snug font-medium text-fg">{job.title}</p>
          )}
          {meta ? <p className="mt-0.5 truncate text-xs text-muted">{meta}</p> : null}
        </div>
        {handle}
      </div>
      {job.salaryText ? <p className="truncate text-xs text-fg">{job.salaryText}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {app.priority > 0 ? (
          <Badge size="sm" tone={PRIORITY_TONES[app.priority]} variant="outline">
            {PRIORITY_LABELS[app.priority]} priority
          </Badge>
        ) : null}
        <FollowUpBadge app={app} now={now} />
        {app.jobClosed ? <ClosedBadge /> : null}
      </div>
      <p className="text-xs text-subtle tabular-nums">{daysInStatus(app, now)}</p>
    </div>
  );
}

export interface SortableCardProps {
  app: Application;
  now: number;
  onOpen: (app: Application) => void;
}

/**
 * The whole card can be dragged with a pointer; the grip button is the keyboard handle
 * (Space to lift, arrows to move, Space to drop, Escape to cancel). The title link opens the application.
 */
export function SortableCard({ app, now, onOpen }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: app.id,
    data: { status: app.status },
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style} className="touch-manipulation list-none">
      {/* Listeners on the whole card for pointer dragging; dnd-kit only starts a keyboard drag from the activator (the grip). */}
      <div {...listeners} className="cursor-grab">
        <ApplicationCardView
          app={app}
          now={now}
          placeholder={isDragging}
          onOpen={() => onOpen(app)}
          handle={
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              aria-label={`Move ${app.job.title}`}
              className="relative z-10 -mt-0.5 -mr-1 flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-subtle transition-colors hover:bg-hover hover:text-muted focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              <GripVertical aria-hidden="true" className="size-4" />
            </button>
          }
        />
      </div>
    </li>
  );
}

/**
 * Opens an application, remembering the tracker URL (with its filters) so the application
 * page's "Back to tracker" link returns to the same view.
 */
export function useOpenApplication() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = `${location.pathname}${location.search}`;
  return (id: string) => void navigate(`/tracker/${id}`, { state: { from } });
}
