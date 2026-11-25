/** Kanban board: one column per active status plus a collapsible lane for closed ones, with drag and drop. */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { ACTIVE_STATUSES, CLOSED_STATUSES, STATUS_LABELS } from '../../../shared/constants';
import type { Application, ApplicationStatus } from '../../../shared/types';
import { Badge, IconButton, type Tone } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useLocalStorage } from '../../lib/hooks';
import { ApplicationCardView, SortableCard } from './ApplicationCard';
import { findColumn, groupByStatus, moveBetweenColumns, planMove, toColumnIds, type ColumnIds } from './board';
import { useMoveApplication } from './queries';
import { STATUS_TONES } from './status';

const DOT_CLASSES: Record<Tone, string> = {
  neutral: 'bg-subtle',
  primary: 'bg-primary',
  info: 'bg-info',
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  accent: 'bg-accent',
};

const COLUMN_WIDTH = 'w-[17rem] shrink-0 snap-start sm:w-[15rem] xl:w-auto xl:min-w-[11.5rem] xl:flex-1 xl:basis-0';

function ColumnHeader({ status, count }: { status: ApplicationStatus; count: number }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 pb-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <span aria-hidden="true" className={cn('size-2 rounded-full', DOT_CLASSES[STATUS_TONES[status]])} />
        {STATUS_LABELS[status]}
      </h2>
      <span className="text-xs text-muted tabular-nums">{count}</span>
    </div>
  );
}

interface ColumnProps {
  status: ApplicationStatus;
  ids: string[];
  byId: Map<string, Application>;
  now: number;
  onOpen: (app: Application) => void;
}

function BoardColumn({ status, ids, byId, now, onOpen }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const apps = ids.map((id) => byId.get(id)).filter((a): a is Application => a !== undefined);
  return (
    <section aria-label={STATUS_LABELS[status]} className={cn('flex flex-col', COLUMN_WIDTH)}>
      <ColumnHeader status={status} count={apps.length} />
      <SortableContext id={status} items={ids} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={cn(
            'flex min-h-32 flex-1 flex-col gap-2 rounded-card bg-surface-2 p-2 transition-colors',
            isOver && 'bg-primary-soft ring-1 ring-primary/40',
          )}
        >
          {apps.map((app) => (
            <SortableCard key={app.id} app={app} now={now} onOpen={onOpen} />
          ))}
          {apps.length === 0 ? <li className="m-auto px-2 py-6 text-center text-xs text-subtle">Drop here</li> : null}
        </ul>
      </SortableContext>
    </section>
  );
}

/** A collapsed closed status: a small drop target that still accepts cards. */
function CompactDropZone({ status, count }: { status: ApplicationStatus; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-16 flex-1 items-center justify-between gap-2 rounded-card border border-dashed border-border bg-surface-2 px-3 py-2 transition-colors',
        isOver && 'border-primary bg-primary-soft',
      )}
    >
      <span className="text-sm text-fg">{STATUS_LABELS[status]}</span>
      <Badge size="sm" tone={STATUS_TONES[status]}>
        {count}
      </Badge>
    </div>
  );
}

export interface TrackerBoardProps {
  /** The applications to show (already filtered); cards are placed between their visible neighbours. */
  apps: Application[];
  now: number;
  onOpen: (app: Application) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Only show these statuses (status filter); undefined shows the whole pipeline. */
  onlyStatus?: ApplicationStatus;
}

export function TrackerBoard({ apps, now, onOpen, scrollRef, onlyStatus }: TrackerBoardProps) {
  const [closedOpen, setClosedOpen] = useLocalStorage('jscout.tracker.closed-open', false);
  const move = useMoveApplication();
  const baseIds = useMemo(() => toColumnIds(groupByStatus(apps)), [apps]);
  const byId = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);

  const [dragIds, setDragIds] = useState<ColumnIds | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // After a drop, keep showing the dropped order until the optimistic cache update arrives.
  const settling = useRef(false);
  useEffect(() => {
    if (settling.current) {
      settling.current = false;
      setDragIds(null);
    }
  }, [apps]);

  const ids = dragIds ?? baseIds;
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const titleOf = (id: UniqueIdentifier) => byId.get(String(id))?.job.title ?? 'Application';
  const columnOf = (id: UniqueIdentifier | undefined) => {
    const col = id === undefined ? undefined : findColumn(idsRef.current, String(id));
    return col ? STATUS_LABELS[col] : 'nowhere';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}. Use the arrow keys to move it, Space to drop, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} is over ${columnOf(over.id)}.` : `${titleOf(active.id)} is not over a column.`),
    onDragEnd: ({ active, over }) => (over ? `${titleOf(active.id)} moved to ${columnOf(active.id)}.` : `${titleOf(active.id)} was dropped back in place.`),
    onDragCancel: ({ active }) => `Move cancelled. ${titleOf(active.id)} is back where it was.`,
  };

  const reset = () => {
    setActiveId(null);
    setDragIds(null);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setDragIds(baseIds);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDragIds((current) => {
      if (!current) return current;
      const from = findColumn(current, String(active.id));
      const to = findColumn(current, String(over.id));
      if (!from || !to || from === to) return current;
      const overIndex = current[to].indexOf(String(over.id));
      const translated = active.rect.current.translated;
      const below = translated !== null && translated.top > over.rect.top + over.rect.height / 2;
      const index = overIndex === -1 ? current[to].length : overIndex + (below ? 1 : 0);
      return moveBetweenColumns(current, String(active.id), from, to, index);
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const current = dragIds;
    setActiveId(null);
    if (!over || !current) return reset();
    const id = String(active.id);
    const status = findColumn(current, id);
    if (!status) return reset();
    let ordered = current[status];
    const overIndex = ordered.indexOf(String(over.id));
    const fromIndex = ordered.indexOf(id);
    if (overIndex !== -1 && overIndex !== fromIndex) ordered = arrayMove(ordered, fromIndex, overIndex);

    const plan = planMove(apps, id, status, ordered);
    if (!plan) return reset();
    settling.current = true;
    setDragIds({ ...current, [status]: ordered });
    move.mutate({ ...plan, columnOrder: ordered });
  };

  const active = activeId ? byId.get(activeId) : undefined;
  const activeStatuses = onlyStatus ? [onlyStatus] : ACTIVE_STATUSES;
  const showClosed = !onlyStatus;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: 'To move an application, press Space to pick it up, use the arrow keys to move it between columns, then press Space again to drop it. Press Escape to cancel.',
        },
      }}
    >
      <div
        ref={scrollRef}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:snap-none sm:px-6 lg:-mx-8 lg:px-8"
      >
        {activeStatuses.map((status) => (
          <BoardColumn key={status} status={status} ids={ids[status]} byId={byId} now={now} onOpen={onOpen} />
        ))}
        {showClosed && closedOpen
          ? CLOSED_STATUSES.map((status) => <BoardColumn key={status} status={status} ids={ids[status]} byId={byId} now={now} onOpen={onOpen} />)
          : null}
        {showClosed ? (
          <section aria-label="Closed" className={cn('flex shrink-0 flex-col snap-start', closedOpen ? 'w-10' : 'w-[17rem] sm:w-40')}>
            <div className={cn('flex items-center gap-1 pb-2', closedOpen ? 'justify-center' : 'justify-between px-1')}>
              {closedOpen ? null : <h2 className="text-sm font-semibold text-muted">Closed</h2>}
              <IconButton
                size="xs"
                label={closedOpen ? 'Collapse closed columns' : 'Expand closed columns'}
                icon={closedOpen ? <ChevronsLeft /> : <ChevronsRight />}
                onClick={() => setClosedOpen((v) => !v)}
                aria-expanded={closedOpen}
              />
            </div>
            {closedOpen ? null : (
              <div className="flex flex-1 flex-col gap-2">
                {CLOSED_STATUSES.map((status) => (
                  <CompactDropZone key={status} status={status} count={ids[status].length} />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>{active ? <ApplicationCardView app={active} now={now} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
