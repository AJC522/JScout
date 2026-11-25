/** Drafts answers to application questions from the user's answer bank (or AI) and saves good ones back. */
import { useId, useState } from 'react';
import { BookmarkPlus, Library, Save } from 'lucide-react';
import type { AnswerDraftResult } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Button, Chip, Field, Input, useToast } from '../../components/ui';
import { useAddDocument } from '../tracker/queries';
import { AiDraftButton, DraftEditor } from './DraftParts';
import { targetBody, useAnswerDraft, useSaveToAnswerBank, type ApplyKitTarget } from './queries';
import { answerTitle, COMMON_QUESTIONS } from './text';

const QUESTION_MAX = 500;

interface Draft extends AnswerDraftResult {
  question: string;
  savedToApplication?: boolean;
  savedToBank?: boolean;
}

export function AnswerHelper({ target }: { target: ApplyKitTarget }) {
  const toast = useToast();
  const draftId = useId();
  const [question, setQuestion] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const generate = useAnswerDraft();
  const saveDocument = useAddDocument(target.applicationId ?? '');
  const saveToBank = useSaveToAnswerBank();

  const trimmed = question.trim();
  const run = (mode: 'bank' | 'ai') => {
    if (!trimmed || generate.isPending) return;
    generate.mutate(
      { ...targetBody(target), question: trimmed, mode },
      {
        onSuccess: (result) => setDraft({ ...result, question: trimmed }),
        onError: (err) => toast.error('Could not draft an answer', { description: errorMessage(err) }),
      },
    );
  };

  const edit = (content: string) =>
    setDraft((d) => (d ? { ...d, content, savedToApplication: false, savedToBank: false } : d));

  const toApplication = () => {
    if (!draft || !target.applicationId) return;
    saveDocument.mutate(
      { kind: 'answer', title: answerTitle(draft.question), content: draft.content, generatedBy: draft.generatedBy },
      {
        onSuccess: () => {
          setDraft((d) => (d ? { ...d, savedToApplication: true } : d));
          toast.success('Answer saved to this application');
        },
        onError: (err) => toast.error('Could not save the answer', { description: errorMessage(err) }),
      },
    );
  };

  const toBank = () => {
    if (!draft) return;
    saveToBank.mutate(
      { question: draft.question.slice(0, QUESTION_MAX), answer: draft.content },
      {
        onSuccess: () => {
          setDraft((d) => (d ? { ...d, savedToBank: true } : d));
          toast.success('Added to your answer bank', { description: 'JScout will suggest it for similar questions.' });
        },
        onError: (err) => toast.error('Could not update your answer bank', { description: errorMessage(err) }),
      },
    );
  };

  const pendingMode = generate.isPending ? generate.variables.mode : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Field label="Question from the application">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run('bank');
            }}
            onClear={() => setQuestion('')}
            placeholder="e.g. Why do you want to work here?"
            maxLength={QUESTION_MAX}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5" aria-label="Common questions">
          {COMMON_QUESTIONS.map((q) => (
            <Chip key={q} size="sm" selected={question === q} onSelectedChange={() => setQuestion(q)}>
              {q}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <Button size="sm" variant="primary" leadingIcon={<Library />} onClick={() => run('bank')} loading={pendingMode === 'bank'} disabled={!trimmed || generate.isPending}>
          Draft from my saved answers
        </Button>
        <AiDraftButton onClick={() => run('ai')} loading={pendingMode === 'ai'} disabled={!trimmed || generate.isPending}>
          Draft with AI
        </AiDraftButton>
      </div>

      {draft && draft.related.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">From your answer bank</h3>
          <ul className="flex flex-col gap-2">
            {draft.related.slice(0, 3).map((a) => (
              <li key={a.id} className="rounded-control border border-border bg-surface-2 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-fg">{a.question}</p>
                  <Button size="sm" variant="ghost" className="-my-1 shrink-0" onClick={() => edit(a.answer)}>
                    Use this
                  </Button>
                </div>
                <p className="mt-1 line-clamp-3 text-sm text-muted">{a.answer}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {draft ? (
        <DraftEditor
          id={draftId}
          label="Your answer"
          value={draft.content}
          onChange={edit}
          generatedBy={draft.generatedBy}
          fallbackReason={draft.fallbackReason}
          actions={
            <>
              {target.applicationId ? (
                <Button size="sm" leadingIcon={<Save />} onClick={toApplication} loading={saveDocument.isPending} disabled={!draft.content.trim() || draft.savedToApplication}>
                  {draft.savedToApplication ? 'Saved' : 'Save to application'}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" leadingIcon={<BookmarkPlus />} onClick={toBank} loading={saveToBank.isPending} disabled={!draft.content.trim() || draft.savedToBank}>
                {draft.savedToBank ? 'In your answer bank' : 'Save to my answer bank'}
              </Button>
            </>
          }
        />
      ) : (
        <p className="rounded-control border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          Paste a question from the form. JScout starts from answers you have saved before and fills in details from this posting.
        </p>
      )}
    </div>
  );
}
