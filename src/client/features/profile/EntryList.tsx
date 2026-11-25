/**
 * A profile list (experience, education): entries edited one at a time in a dialog that saves on
 * "Save"; reorder and remove apply at once (with undo), like every other save on this page.
 */
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ProfilePatch } from '../../../shared/api';
import { errorMessage } from '../../api/client';
import { Button, Dialog, EmptyState, IconButton, useConfirm, useToast } from '../../components/ui';
import { useSaveProfile } from './profile-api';
import { moveItem, sameJson, upsertById } from './profile-model';
import { SectionCard } from './SectionCard';

export interface EntryFormProps<T> {
  value: T;
  onChange: (next: T) => void;
  /** Field errors, shown once the user tried to save. */
  errors: Partial<Record<keyof T, string>>;
}

interface EntryListProps<T extends { id: string }> {
  id: string;
  title: string;
  description: string;
  items: readonly T[];
  toPatch: (items: T[]) => ProfilePatch;
  createEmpty: () => T;
  validate: (item: T) => Partial<Record<keyof T, string>>;
  label: (item: T) => string;
  renderSummary: (item: T) => ReactNode;
  Form: (props: EntryFormProps<T>) => ReactNode;
  noun: string;
  empty: { icon: ReactNode; title: string; description: string };
  max: number;
}

export function EntryList<T extends { id: string }>(props: EntryListProps<T>) {
  const { id, title, description, items, toPatch, createEmpty, validate, label, renderSummary, Form, noun, empty, max } = props;
  const save = useSaveProfile({ optimistic: true });
  const toast = useToast();
  const [editing, setEditing] = useState<{ item: T; isNew: boolean } | null>(null);

  const saveList = (next: T[], onDone?: () => void) =>
    save.mutate(toPatch(next), {
      onSuccess: onDone,
      onError: (err) => toast.error(`Could not update your ${title.toLowerCase()}`, { description: errorMessage(err) }),
    });

  const remove = (item: T) => {
    const previous = [...items];
    saveList(
      items.filter((entry) => entry.id !== item.id),
      () =>
        toast.success(`Removed ${label(item)}`, {
          id: `${id}-removed`,
          action: { label: 'Undo', onClick: () => saveList(previous) },
        }),
    );
  };

  const move = (index: number, to: number) => saveList(moveItem(items, index, to));

  return (
    <SectionCard
      id={id}
      title={title}
      description={description}
      actions={
        items.length > 0 ? (
          <Button size="sm" leadingIcon={<Plus />} disabled={items.length >= max} onClick={() => setEditing({ item: createEmpty(), isNew: true })}>
            Add {noun}
          </Button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <EmptyState
          compact
          bordered
          icon={empty.icon}
          title={empty.title}
          description={empty.description}
          action={
            <Button leadingIcon={<Plus />} onClick={() => setEditing({ item: createEmpty(), isNew: true })}>
              Add {noun}
            </Button>
          }
        />
      ) : (
        <ol className="flex flex-col divide-y divide-border rounded-card border border-border">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-start gap-2 p-3">
              <div className="min-w-0 flex-1">{renderSummary(item)}</div>
              <div className="flex shrink-0 items-center">
                <IconButton size="sm" label={`Move ${label(item)} up`} icon={<ArrowUp />} disabled={index === 0} onClick={() => move(index, index - 1)} />
                <IconButton
                  size="sm"
                  label={`Move ${label(item)} down`}
                  icon={<ArrowDown />}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, index + 1)}
                />
                <IconButton size="sm" label={`Edit ${label(item)}`} icon={<Pencil />} onClick={() => setEditing({ item, isNew: false })} />
                <IconButton size="sm" label={`Remove ${label(item)}`} icon={<Trash2 />} onClick={() => remove(item)} />
              </div>
            </li>
          ))}
        </ol>
      )}

      {editing ? (
        <EntryDialog
          key={editing.item.id}
          items={items}
          toPatch={toPatch}
          validate={validate}
          Form={Form}
          noun={noun}
          label={label}
          initial={editing.item}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </SectionCard>
  );
}

export interface EntryDialogProps<T extends { id: string }> extends Pick<EntryListProps<T>, 'items' | 'toPatch' | 'validate' | 'Form' | 'noun' | 'label'> {
  initial: T;
  isNew: boolean;
  onClose: () => void;
}

/** Edit one entry. Saves the whole list with this entry replaced (or appended) when the user presses Save. */
export function EntryDialog<T extends { id: string }>({ initial, isNew, onClose, items, toPatch, validate, Form, noun, label }: EntryDialogProps<T>) {
  const [value, setValue] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const save = useSaveProfile();
  const toast = useToast();
  const confirm = useConfirm();
  const errors = validate(value);
  const dirty = !sameJson(value, initial);

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Discard your changes?', confirmLabel: 'Discard', cancelLabel: 'Keep editing', tone: 'danger' }))) return;
    onClose();
  };

  const submit = () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    save.mutate(toPatch(upsertById(items, value)), {
      onSuccess: () => {
        toast.success(isNew ? `Added ${label(value)}` : `Saved ${label(value)}`, { id: 'profile-saved' });
        onClose();
      },
      onError: (err) => toast.error('Could not save', { description: errorMessage(err) }),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
      title={isNew ? `Add ${noun}` : `Edit ${noun}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => void close()}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!dirty && !isNew} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Form value={value} onChange={setValue} errors={submitted ? errors : {}} />
        {/* Lets Enter in a text field save, like the other forms on the page. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
