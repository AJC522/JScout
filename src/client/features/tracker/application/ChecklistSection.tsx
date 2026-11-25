/** Per-application checklist: tick, rename, reorder, add and remove steps. */
import { useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ApplicationDetail, ChecklistItem } from '../../../../shared/types';
import { Checkbox, IconButton, Input, ProgressBar } from '../../../components/ui';
import { usePatchApplication } from '../queries';
import { Section } from './Section';

const LABEL_MAX = 200;

function newId(): string {
  return crypto.randomUUID();
}

function ItemRow({
  item,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  item: ChecklistItem;
  index: number;
  count: number;
  onChange: (item: ChecklistItem) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label);
  // Set once editing ends (Enter, Escape or blur) so the blur that follows cannot save again.
  const closed = useRef(false);

  const startEditing = () => {
    closed.current = false;
    setDraft(item.label);
    setEditing(true);
  };

  const commit = () => {
    if (closed.current) return;
    closed.current = true;
    const label = draft.trim();
    setEditing(false);
    if (label && label !== item.label) onChange({ ...item, label });
    else setDraft(item.label);
  };

  return (
    <li className="group flex min-h-9 items-center gap-2 rounded-control px-1 hover:bg-hover">
      {editing ? (
        <Input
          aria-label="Step name"
          size="sm"
          value={draft}
          maxLength={LABEL_MAX}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              e.stopPropagation();
              closed.current = true;
              setEditing(false);
            }
          }}
          wrapperClassName="flex-1"
        />
      ) : (
        <Checkbox
          checked={item.done}
          onCheckedChange={(checked) => onChange({ ...item, done: checked === true })}
          label={<span className={item.done ? 'text-sm text-muted line-through' : 'text-sm text-fg'}>{item.label}</span>}
          className="min-w-0 flex-1"
        />
      )}
      {editing ? null : (
        <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <IconButton size="xs" label="Rename" icon={<Pencil />} onClick={startEditing} />
          <IconButton size="xs" label="Move up" icon={<ArrowUp />} disabled={index === 0} onClick={() => onMove(-1)} />
          <IconButton size="xs" label="Move down" icon={<ArrowDown />} disabled={index === count - 1} onClick={() => onMove(1)} />
          <IconButton size="xs" label="Remove" icon={<Trash2 />} onClick={onRemove} />
        </div>
      )}
    </li>
  );
}

export function ChecklistSection({ app }: { app: ApplicationDetail }) {
  const patch = usePatchApplication(app.id);
  const [label, setLabel] = useState('');
  const items = app.checklist;
  const done = items.filter((i) => i.done).length;

  const save = (checklist: ChecklistItem[]) => patch.mutate({ checklist });

  const add = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    save([...items, { id: newId(), label: trimmed, done: false }]);
    setLabel('');
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    const a = items[index];
    const b = items[target];
    if (!a || !b) return;
    const next = [...items];
    next[index] = b;
    next[target] = a;
    save(next);
  };

  return (
    <Section title="Checklist" meta={items.length > 0 ? `${done} of ${items.length} done` : undefined}>
      {items.length > 0 ? (
        <>
          <ProgressBar value={(done / items.length) * 100} label="Checklist progress" size="sm" tone={done === items.length ? 'success' : 'primary'} className="mb-3" />
          <ul className="-mx-1 flex flex-col">
            {items.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                index={index}
                count={items.length}
                onChange={(next) => save(items.map((i) => (i.id === item.id ? next : i)))}
                onMove={(delta) => move(index, delta)}
                onRemove={() => save(items.filter((i) => i.id !== item.id))}
              />
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted">No steps yet. Add the things you need to do for this application.</p>
      )}
      <form onSubmit={add} className="mt-3 flex gap-2">
        <Input aria-label="New step" size="sm" placeholder="Add a step" value={label} maxLength={LABEL_MAX} onChange={(e) => setLabel(e.target.value)} wrapperClassName="flex-1" />
        <IconButton type="submit" size="sm" variant="secondary" label="Add step" icon={<Plus />} disabled={!label.trim()} />
      </form>
    </Section>
  );
}
