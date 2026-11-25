/** What happened with an application, newest first, plus notes, interviews and follow-ups the user logs. */
import { useState, type FormEvent } from 'react';
import { ArrowRightLeft, BellRing, FileText, MessageSquare, Plus, Sparkle, Trash2, UserRound, Users } from 'lucide-react';
import type { ApplicationDetail, ApplicationEventType } from '../../../../shared/types';
import { errorMessage } from '../../../api/client';
import { Button, Dialog, Field, IconButton, Input, Select, Textarea, useConfirm, useToast } from '../../../components/ui';
import { cn } from '../../../lib/cn';
import { formatDate, formatRelativeTime } from '../../../lib/format';
import { fromDateInput, toDateInput } from '../board';
import { useAddEvent, useRemoveEvent } from '../queries';
import { Section } from './Section';

type LoggableType = Extract<ApplicationEventType, 'note' | 'interview' | 'follow-up'>;

const EVENT_ICONS: Record<ApplicationEventType, typeof FileText> = {
  created: Sparkle,
  status: ArrowRightLeft,
  note: MessageSquare,
  interview: Users,
  'follow-up': BellRing,
  document: FileText,
  contact: UserRound,
};

const LOGGABLE: Array<{ value: LoggableType; label: string; placeholder: string }> = [
  { value: 'note', label: 'Note', placeholder: 'e.g. Recruiter said they will decide next week' },
  { value: 'interview', label: 'Interview', placeholder: 'e.g. Technical interview with the team lead' },
  { value: 'follow-up', label: 'Follow-up', placeholder: 'e.g. Sent a thank-you email' },
];

const FORM_ID = 'event-form';

function EventDialog({ open, onOpenChange, applicationId }: { open: boolean; onOpenChange: (open: boolean) => void; applicationId: string }) {
  const toast = useToast();
  const add = useAddEvent(applicationId);
  const [type, setType] = useState<LoggableType>('note');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [date, setDate] = useState(() => toDateInput(new Date().toISOString()));
  const [error, setError] = useState<string>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Add a short title.');
      return;
    }
    const today = toDateInput(new Date().toISOString());
    // Today's events keep the current time so they sort above earlier ones from the same day.
    const at = date === today ? new Date().toISOString() : fromDateInput(date);
    add.mutate(
      { type, title: title.trim(), ...(detail.trim() ? { detail: detail.trim() } : {}), ...(at ? { at } : {}) },
      {
        onSuccess: () => {
          toast.success('Added to the timeline');
          onOpenChange(false);
        },
        onError: (err) => toast.error('Could not add the event', { description: errorMessage(err) }),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add to timeline"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={FORM_ID} loading={add.isPending}>
            Add
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as LoggableType)} options={LOGGABLE} />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="What happened" required error={error} className="sm:col-span-2">
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError(undefined);
            }}
            placeholder={LOGGABLE.find((l) => l.value === type)?.placeholder}
            maxLength={200}
            autoFocus
          />
        </Field>
        <Field label="Details" optional className="sm:col-span-2">
          <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} autoGrow maxRows={8} maxLength={5000} />
        </Field>
      </form>
    </Dialog>
  );
}

export function TimelineSection({ app, now }: { app: ApplicationDetail; now: number }) {
  const remove = useRemoveEvent(app.id);
  const confirm = useConfirm();
  const [dialogKey, setDialogKey] = useState<number | null>(null);

  return (
    <Section
      title="Timeline"
      actions={
        <Button size="sm" variant="ghost" leadingIcon={<Plus />} onClick={() => setDialogKey(Date.now())}>
          Add
        </Button>
      }
    >
      {app.events.length === 0 ? (
        <p className="text-sm text-muted">Nothing logged yet.</p>
      ) : (
        <ol className="relative flex flex-col">
          {app.events.map((event, i) => {
            const Icon = EVENT_ICONS[event.type];
            const removable = event.type === 'note' || event.type === 'interview' || event.type === 'follow-up';
            return (
              <li key={event.id} className="group relative flex gap-3 pb-4 last:pb-0">
                {i < app.events.length - 1 ? <span aria-hidden="true" className="absolute top-7 bottom-0 left-3.5 w-px bg-border" /> : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    'relative flex size-7 shrink-0 items-center justify-center rounded-full border border-border',
                    event.type === 'interview' ? 'bg-info-soft text-info' : 'bg-surface-2 text-muted',
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-fg">{event.title}</p>
                    {removable ? (
                      <IconButton
                        size="xs"
                        label="Remove from timeline"
                        icon={<Trash2 />}
                        onClick={async () => {
                          const ok = await confirm({ title: 'Remove this entry?', description: event.title, confirmLabel: 'Remove', tone: 'danger' });
                          if (ok) remove.mutate(event.id);
                        }}
                        className="-mt-0.5 shrink-0 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                      />
                    ) : null}
                  </div>
                  {event.detail ? <p className="mt-0.5 text-sm whitespace-pre-line text-muted">{event.detail}</p> : null}
                  <p className="mt-0.5 text-xs text-subtle">
                    <time dateTime={event.at} title={formatDate(event.at, 'long')}>
                      {formatDate(event.at, 'medium')} · {formatRelativeTime(event.at, now)}
                    </time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {dialogKey !== null ? <EventDialog key={dialogKey} open onOpenChange={(open) => !open && setDialogKey(null)} applicationId={app.id} /> : null}
    </Section>
  );
}
