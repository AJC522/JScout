/** Cover letters, answers and other texts saved for an application: read, edit inline, copy, delete. */
import { useState } from 'react';
import { ChevronDown, FileText, Pencil, Trash2 } from 'lucide-react';
import type { ApplicationDetail, ApplicationDocument, DocumentKind } from '../../../../shared/types';
import { errorMessage } from '../../../api/client';
import { Badge, Button, CopyButton, IconButton, Textarea, useConfirm, useToast } from '../../../components/ui';
import { cn } from '../../../lib/cn';
import { formatRelativeTime } from '../../../lib/format';
import { useDeleteDocument, useUpdateDocument } from '../queries';
import { Section } from './Section';

const KIND_LABELS: Record<DocumentKind, string> = {
  'cover-letter': 'Cover letter',
  answer: 'Answer',
  'resume-notes': 'Résumé notes',
  email: 'Email',
  other: 'Document',
};

function DocumentRow({ doc, applicationId, now }: { doc: ApplicationDocument; applicationId: string; now: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const update = useUpdateDocument(applicationId);
  const remove = useDeleteDocument(applicationId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const contentId = `doc-${doc.id}`;

  const save = () => {
    if (draft === null) return;
    if (draft === doc.content) return setDraft(null);
    update.mutate(
      { docId: doc.id, content: draft },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success('Document saved');
        },
        onError: (err) => toast.error('Could not save the document', { description: errorMessage(err) }),
      },
    );
  };

  const onDelete = async () => {
    const ok = await confirm({ title: `Delete “${doc.title}”?`, description: 'This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' });
    if (ok) remove.mutate(doc.id, { onSuccess: () => toast.success('Document deleted') });
  };

  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 text-muted transition-transform', !open && '-rotate-90')} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg">{doc.title}</span>
            <span className="text-xs text-muted">
              {KIND_LABELS[doc.kind]}
              {doc.generatedBy === 'ai' ? ' · written with AI' : doc.generatedBy === 'template' ? ' · from template' : ''} · {formatRelativeTime(doc.updatedAt, now)}
            </span>
          </span>
        </button>
        <CopyButton text={draft ?? doc.content} iconOnly variant="ghost" size="sm" label={`Copy ${doc.title}`} />
        <IconButton size="sm" label={`Delete ${doc.title}`} icon={<Trash2 />} onClick={() => void onDelete()} />
      </div>
      {open ? (
        <div id={contentId} className="mt-2 pl-6">
          {draft === null ? (
            <div className="flex flex-col items-start gap-2">
              <p className="max-h-80 w-full overflow-y-auto rounded-control bg-surface-2 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-fg">{doc.content}</p>
              <Button size="sm" variant="ghost" leadingIcon={<Pencil />} onClick={() => setDraft(doc.content)}>
                Edit
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Textarea aria-label={`Edit ${doc.title}`} value={draft} onChange={(e) => setDraft(e.target.value)} autoGrow maxRows={24} rows={8} autoFocus className="leading-relaxed" />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={save} loading={update.isPending} disabled={!draft.trim()}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function DocumentsSection({ app, now }: { app: ApplicationDetail; now: number }) {
  return (
    <Section title="Documents" meta={app.documents.length > 0 ? String(app.documents.length) : undefined}>
      {app.documents.length === 0 ? (
        <p className="flex gap-2 text-sm text-muted">
          <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Cover letters and answers you save from the apply kit show up here.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {app.documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} applicationId={app.id} now={now} />
          ))}
        </ul>
      )}
    </Section>
  );
}
