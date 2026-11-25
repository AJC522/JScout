/** Names and saves the current search; the name starts as a plain-English summary of the query. */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { SearchQuery } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Button, Dialog, Field, Input, useToast } from '../../components/ui';
import { describeQuery } from '../saved/describe';
import { SAVED_SEARCH_NAME_MAX } from '../saved/queries';
import { useSaveSearch } from './queries';

export function defaultSearchName(query: SearchQuery): string {
  const name = describeQuery(query);
  return name.length <= SAVED_SEARCH_NAME_MAX ? name : `${name.slice(0, SAVED_SEARCH_NAME_MAX - 1).trimEnd()}…`;
}

export interface SaveSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: SearchQuery;
}

export function SaveSearchDialog({ open, onOpenChange, query }: SaveSearchDialogProps) {
  const [name, setName] = useState('');
  const [openedFor, setOpenedFor] = useState(false);
  const save = useSaveSearch();
  const toast = useToast();
  const navigate = useNavigate();

  // Prefill each time the dialog opens, from the query at that moment.
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setName(defaultSearchName(query));
      save.reset();
    }
  }

  const trimmed = name.trim();
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    save.mutate(
      { name: trimmed, query },
      {
        onSuccess: (saved) => {
          onOpenChange(false);
          toast.success('Search saved', {
            description: `We'll count new matches for “${saved.name}”.`,
            action: { label: 'View saved', onClick: () => navigate('/saved') },
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Save this search"
      description="Saved searches keep count of new jobs, so you can check back in one click."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="save-search-form" loading={save.isPending} disabled={!trimmed}>
            Save search
          </Button>
        </>
      }
    >
      <form id="save-search-form" onSubmit={onSubmit}>
        <Field label="Name" error={save.isError ? errorMessage(save.error) : undefined}>
          <Input value={name} maxLength={SAVED_SEARCH_NAME_MAX} onChange={(e) => setName(e.target.value)} autoFocus onFocus={(e) => e.currentTarget.select()} />
        </Field>
        <p className="mt-2 text-xs text-muted">{describeQuery(query)}</p>
      </form>
    </Dialog>
  );
}
