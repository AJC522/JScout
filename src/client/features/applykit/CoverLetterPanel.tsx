/** Cover-letter drafting: tone, length and notes in; an editable letter out, ready to copy or save. */
import { useId, useState } from 'react';
import { FileText, Save } from 'lucide-react';
import { LETTER_LENGTHS, LETTER_TONES } from '../../../shared/constants';
import type { DraftResult, LetterLength, LetterTone } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Button, Field, Select, SegmentedControl, Textarea, useToast } from '../../components/ui';
import { useAddDocument } from '../tracker/queries';
import { AiDraftButton, DraftEditor } from './DraftParts';
import { targetBody, useCoverLetter, type ApplyKitTarget } from './queries';
import { LENGTH_LABELS, TONE_LABELS } from './text';

const TONE_OPTIONS = LETTER_TONES.map((t) => ({ value: t, label: TONE_LABELS[t] }));
const LENGTH_OPTIONS = LETTER_LENGTHS.map((l) => ({ value: l, label: LENGTH_LABELS[l] }));

export interface CoverLetterPanelProps {
  target: ApplyKitTarget;
  /** Used in the saved document's title. */
  company?: string;
}

export function CoverLetterPanel({ target, company }: CoverLetterPanelProps) {
  const toast = useToast();
  const draftId = useId();
  const [tone, setTone] = useState<LetterTone>('professional');
  const [length, setLength] = useState<LetterLength>('medium');
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<(DraftResult & { savedAs?: string }) | null>(null);
  const generate = useCoverLetter();
  const save = useAddDocument(target.applicationId ?? '');

  const run = (mode: 'template' | 'ai') => {
    generate.mutate(
      { ...targetBody(target), tone, length, mode, ...(notes.trim() ? { notes: notes.trim() } : {}) },
      {
        onSuccess: (result) => setDraft(result),
        onError: (err) => toast.error('Could not write the letter', { description: errorMessage(err) }),
      },
    );
  };

  const saveToApplication = () => {
    if (!draft || !target.applicationId) return;
    save.mutate(
      {
        kind: 'cover-letter',
        title: company ? `Cover letter for ${company}` : 'Cover letter',
        content: draft.content,
        generatedBy: draft.generatedBy,
      },
      {
        onSuccess: (doc) => {
          setDraft((d) => (d ? { ...d, savedAs: doc.id } : d));
          toast.success('Cover letter saved', { description: 'Find it under Documents on this application.' });
        },
        onError: (err) => toast.error('Could not save the letter', { description: errorMessage(err) }),
      },
    );
  };

  const pendingMode = generate.isPending ? generate.variables.mode : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tone">
          <Select value={tone} onChange={(e) => setTone(e.target.value as LetterTone)} options={TONE_OPTIONS} size="sm" />
        </Field>
        <Field label="Length">
          <SegmentedControl aria-label="Length" options={LENGTH_OPTIONS} value={length} onValueChange={setLength} size="sm" fullWidth />
        </Field>
      </div>
      <Field label="Points to work in" optional hint="A project, a reason you like the company, a referral…">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} autoGrow maxRows={6} maxLength={2000} />
      </Field>
      <div className="flex flex-wrap items-start gap-2">
        <Button size="sm" variant="primary" leadingIcon={<FileText />} onClick={() => run('template')} loading={pendingMode === 'template'} disabled={generate.isPending}>
          {draft ? 'Write again' : 'Write from template'}
        </Button>
        <AiDraftButton onClick={() => run('ai')} loading={pendingMode === 'ai'} disabled={generate.isPending}>
          Write with AI
        </AiDraftButton>
      </div>

      {draft ? (
        <DraftEditor
          id={draftId}
          label="Your letter"
          value={draft.content}
          onChange={(content) => setDraft((d) => (d ? { ...d, content, savedAs: undefined } : d))}
          generatedBy={draft.generatedBy}
          fallbackReason={draft.fallbackReason}
          actions={
            target.applicationId ? (
              <Button size="sm" leadingIcon={<Save />} onClick={saveToApplication} loading={save.isPending} disabled={!draft.content.trim() || Boolean(draft.savedAs)}>
                {draft.savedAs ? 'Saved' : 'Save to application'}
              </Button>
            ) : null
          }
        />
      ) : (
        <p className="rounded-control border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          Pick a tone and length, then write a draft. It uses your profile and this posting, and you can edit it before you copy it.
        </p>
      )}
    </div>
  );
}
