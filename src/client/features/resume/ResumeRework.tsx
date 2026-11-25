/**
 * Tailor the résumé for one job: a draft from the template (reorder, stronger openers, skills
 * first) or from AI, editable, re-scored against the same posting, then copied, downloaded,
 * saved to the application, or made the saved résumé.
 */
import { useId, useState } from 'react';
import { Check, Download, FileUp, Gauge, Save, Wand2 } from 'lucide-react';
import type { ResumeReview, ResumeReworkResult, ResumeTarget } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Badge, Button, useConfirm, useToast } from '../../components/ui';
import { AiDraftButton, DraftEditor } from '../applykit/DraftParts';
import { useUploadResume } from '../profile/profile-api';
import { useAddDocument } from '../tracker/queries';
import { draftFileName, formatDelta } from './model';
import { resumeTargetBody, useDraftReview, useResumeRework } from './queries';

export interface ResumeReworkProps {
  target: ResumeTarget;
  company: string;
  job: { title: string; company: string };
  /** Score of the saved résumé, to show what the draft gains. */
  savedScore: number;
  /** Called with the draft's review after a re-check. */
  onReviewed: (review: ResumeReview) => void;
}

type Draft = ResumeReworkResult & { savedAs?: string };

function download(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ResumeRework({ target, company, job, savedScore, onReviewed }: ResumeReworkProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const editorId = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [checked, setChecked] = useState<{ text: string; score: number } | null>(null);
  const rework = useResumeRework();
  const recheck = useDraftReview();
  const save = useAddDocument(target.applicationId ?? '');
  const replace = useUploadResume();
  const body = resumeTargetBody(target);

  const check = (text: string) => {
    recheck.mutate(
      { ...body, resumeText: text },
      {
        onSuccess: (review) => {
          setChecked({ text, score: review.score });
          onReviewed(review);
        },
        onError: (err) => toast.error('Could not score the draft', { description: errorMessage(err) }),
      },
    );
  };

  const run = (mode: 'template' | 'ai') => {
    rework.mutate(
      { ...body, mode },
      {
        onSuccess: (result) => {
          setDraft(result);
          setChecked(null);
          check(result.content);
        },
        onError: (err) => toast.error('Could not tailor your résumé', { description: errorMessage(err) }),
      },
    );
  };

  const saveToApplication = () => {
    if (!draft || !target.applicationId) return;
    save.mutate(
      { kind: 'resume', title: `Résumé for ${company || job.title}`, content: draft.content, generatedBy: draft.generatedBy },
      {
        onSuccess: (doc) => {
          setDraft((d) => (d ? { ...d, savedAs: doc.id } : d));
          toast.success('Résumé saved to the application', { description: 'Find it under Documents on this application.' });
        },
        onError: (err) => toast.error('Could not save the résumé', { description: errorMessage(err) }),
      },
    );
  };

  const useAsSaved = async () => {
    if (!draft) return;
    const ok = await confirm({
      title: 'Make this your saved résumé?',
      description:
        'Your saved résumé is replaced by this text (the original file too, so download it first if you want to keep it). JScout uses your saved résumé for every job, so keep it general if you apply to different kinds of roles.',
      confirmLabel: 'Replace saved résumé',
    });
    if (!ok) return;
    replace.mutate(
      { kind: 'text', text: draft.content },
      {
        onSuccess: () => toast.success('Saved résumé updated', { description: 'Reviews and fit scores now use this version.' }),
        onError: (err) => toast.error('Could not replace your résumé', { description: errorMessage(err) }),
      },
    );
  };

  const pendingMode = rework.isPending ? rework.variables.mode : null;
  const stale = draft !== null && checked !== null && checked.text !== draft.content;
  const fresh = draft !== null && checked !== null && checked.text === draft.content;

  return (
    <section className="flex flex-col gap-4 rounded-card border border-border bg-surface-2/50 p-4" aria-labelledby={`${editorId}-title`}>
      <div>
        <h3 id={`${editorId}-title`} className="flex items-center gap-2 text-base font-semibold text-fg">
          <Wand2 aria-hidden="true" className="size-4 text-accent" /> Tailor your résumé for this job
        </h3>
        <p className="mt-1 text-sm text-muted">
          The template draft only reorders your bullets and skills, turns weak openers into action verbs and adds skills already on your profile. It never adds
          experience, and the results and numbers are yours to fill in. AI goes further with the wording, under the same rules.
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <Button size="sm" variant="primary" leadingIcon={<Wand2 />} onClick={() => run('template')} loading={pendingMode === 'template'} disabled={rework.isPending}>
          {draft ? 'Start over from template' : 'Create tailored draft'}
        </Button>
        <AiDraftButton onClick={() => run('ai')} loading={pendingMode === 'ai'} disabled={rework.isPending}>
          Rewrite with AI
        </AiDraftButton>
      </div>
      {pendingMode === 'ai' ? <p className="text-xs text-muted">Rewriting a whole résumé can take up to a minute or two.</p> : null}

      {draft ? (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-1.5 text-sm">
            {draft.changes.map((change) => (
              <li key={change} className="flex gap-2 text-fg">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                <span>{change}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
            {recheck.isPending ? (
              <span className="text-muted">Scoring the draft…</span>
            ) : fresh ? (
              <>
                <span className="text-fg">
                  This draft scores <span className="font-semibold tabular-nums">{checked.score}</span>
                </span>
                <Badge size="sm" tone={checked.score > savedScore ? 'success' : checked.score < savedScore ? 'danger' : 'neutral'}>
                  {formatDelta(checked.score - savedScore)} vs saved résumé
                </Badge>
              </>
            ) : stale ? (
              <span className="text-muted">You have edited the draft since it was scored.</span>
            ) : null}
            <Button size="sm" variant="ghost" leadingIcon={<Gauge />} onClick={() => check(draft.content)} loading={recheck.isPending} disabled={!draft.content.trim() || fresh}>
              {fresh ? 'Score is up to date' : 'Check score'}
            </Button>
          </div>

          <DraftEditor
            id={editorId}
            label="Your tailored résumé"
            value={draft.content}
            onChange={(content) => setDraft((d) => (d ? { ...d, content, savedAs: undefined } : d))}
            generatedBy={draft.generatedBy}
            fallbackReason={draft.fallbackReason}
            actions={
              <>
                <Button size="sm" leadingIcon={<Download />} onClick={() => download(draft.content, draftFileName(job))} disabled={!draft.content.trim()}>
                  Download .txt
                </Button>
                {target.applicationId ? (
                  <Button size="sm" leadingIcon={<Save />} onClick={saveToApplication} loading={save.isPending} disabled={!draft.content.trim() || Boolean(draft.savedAs)}>
                    {draft.savedAs ? 'Saved' : 'Save to application'}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" leadingIcon={<FileUp />} onClick={() => void useAsSaved()} loading={replace.isPending} disabled={!draft.content.trim()}>
                  Make this my saved résumé
                </Button>
              </>
            }
          />
        </div>
      ) : (
        <p className="rounded-control border border-dashed border-border px-4 py-5 text-center text-sm text-muted">
          Create a draft to see your résumé rearranged for this job. You can edit it, check its score again, and copy or download it when it reads right.
        </p>
      )}
    </section>
  );
}
