/** One saved search: name (renamable), what it looks for, counts, and its actions. */
import { useState } from 'react';
import { Pencil, Pin, PinOff, Play, Trash2 } from 'lucide-react';
import type { SavedSearch } from '../../../shared/types';
import { Badge, Button, IconButton, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatRelativeTime, pluralize } from '../../lib/format';
import { describeQuery } from './describe';
import { SAVED_SEARCH_NAME_MAX } from './queries';

export interface SavedSearchRowProps {
  search: SavedSearch;
  now: number;
  onRun: () => void;
  onRename: (name: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

export function SavedSearchRow({ search, now, onRun, onRename, onTogglePin, onDelete }: SavedSearchRowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(search.name);

  const startEditing = () => {
    setName(search.name);
    setEditing(true);
  };
  const commit = () => {
    const trimmed = name.trim();
    setEditing(false);
    if (trimmed && trimmed !== search.name) onRename(trimmed);
  };

  return (
    <li className={cn('flex flex-col gap-3 rounded-card border bg-surface p-4 sm:flex-row sm:items-center', search.pinned ? 'border-primary/30' : 'border-border')}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {search.pinned ? <Pin aria-label="Pinned" className="size-3.5 shrink-0 fill-current text-primary" /> : null}
          {editing ? (
            <Input
              aria-label="Name"
              size="sm"
              value={name}
              maxLength={SAVED_SEARCH_NAME_MAX}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
              wrapperClassName="w-full max-w-sm"
            />
          ) : (
            <h2 className="truncate text-base font-medium text-fg">
              <button type="button" onClick={onRun} className="truncate text-left hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none">
                {search.name}
              </button>
            </h2>
          )}
          {search.newCount > 0 ? (
            <Badge tone="accent" variant="solid" size="sm" className="shrink-0">
              {search.newCount} new
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-muted">{describeQuery(search.query)}</p>
        <p className="mt-1.5 text-xs text-subtle">
          {pluralize(search.total, 'open job')}
          {' · '}
          {search.lastViewedAt ? `Viewed ${formatRelativeTime(search.lastViewedAt, now)}` : 'Not opened yet'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="primary" leadingIcon={<Play />} onClick={onRun}>
          Run
        </Button>
        <IconButton label={search.pinned ? 'Unpin' : 'Pin to top'} icon={search.pinned ? <PinOff /> : <Pin />} onClick={onTogglePin} />
        <IconButton label="Rename" icon={<Pencil />} onClick={startEditing} />
        <IconButton label="Delete" icon={<Trash2 />} onClick={onDelete} />
      </div>
    </li>
  );
}
