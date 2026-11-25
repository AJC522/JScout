/**
 * What the user can do to a job from a card, the detail view or the keyboard: save to the
 * tracker, hide (with undo), open the application page, and record that they applied.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { SearchResultItem } from '../../../shared/types';
import { useToast } from '../../components/ui';
import { useHideJob, useMarkApplied, useMarkViewed, useSaveJob, useUnhideJob } from './queries';

export type JobRef = Pick<SearchResultItem, 'job' | 'userState'>;

export interface JobActions {
  save: (item: JobRef) => void;
  hide: (item: JobRef) => void;
  /** Opens the employer's application page in a new tab and asks afterwards whether the user applied. */
  apply: (item: JobRef) => void;
  markApplied: (item: JobRef) => void;
  view: (item: JobRef) => void;
  /** Job id the "Did you apply?" question is showing for. */
  askingAbout: string | null;
  dismissAsk: () => void;
  savingId: string | null;
}

export function applyLink(item: JobRef): string {
  return item.job.applyUrl ?? item.job.url;
}

export function useJobActions(): JobActions {
  const navigate = useNavigate();
  const toast = useToast();
  const saveJob = useSaveJob();
  const hideJob = useHideJob();
  const unhideJob = useUnhideJob();
  const markAppliedJob = useMarkApplied();
  const viewJob = useMarkViewed();
  const [askingAbout, setAskingAbout] = useState<string | null>(null);

  const { mutate: saveMutate } = saveJob;
  const save = useCallback(
    (item: JobRef) => {
      const { applicationId, applicationStatus } = item.userState;
      if (applicationId || applicationStatus) {
        if (applicationId) navigate(`/tracker/${applicationId}`);
        return;
      }
      saveMutate(item, {
        onSuccess: (app) =>
          toast.success('Saved to your tracker', {
            description: `${item.job.title} at ${item.job.company}`,
            action: { label: 'Open', onClick: () => navigate(`/tracker/${app.id}`) },
          }),
      });
    },
    [saveMutate, navigate, toast],
  );

  const { mutate: hideMutate } = hideJob;
  const { mutate: unhideMutate } = unhideJob;
  const hide = useCallback(
    (item: JobRef) => {
      if (item.userState.hidden) {
        unhideMutate(item, { onSuccess: () => toast.info('Job shown again', { description: item.job.title }) });
        return;
      }
      hideMutate(item, {
        onSuccess: () =>
          toast.info('Job hidden', {
            description: `${item.job.title} at ${item.job.company}`,
            action: { label: 'Undo', onClick: () => unhideMutate({ job: item.job, userState: { ...item.userState, hidden: true } }) },
          }),
      });
    },
    [hideMutate, unhideMutate, toast],
  );

  const { mutate: appliedMutate } = markAppliedJob;
  const markApplied = useCallback(
    (item: JobRef) => {
      setAskingAbout(null);
      appliedMutate(item, {
        onSuccess: (app) =>
          toast.success('Marked as applied', {
            description: `${item.job.title} at ${item.job.company}`,
            action: { label: 'Open', onClick: () => navigate(`/tracker/${app.id}`) },
          }),
      });
    },
    [appliedMutate, navigate, toast],
  );

  const apply = useCallback((item: JobRef) => {
    window.open(applyLink(item), '_blank', 'noopener,noreferrer');
    const status = item.userState.applicationStatus;
    // Only worth asking while the tracker does not already say they applied.
    if (!status || status === 'saved') setAskingAbout(item.job.id);
  }, []);

  const { mutate: viewMutate } = viewJob;
  const view = useCallback((item: JobRef) => viewMutate(item), [viewMutate]);
  const dismissAsk = useCallback(() => setAskingAbout(null), []);

  const savingId = saveJob.isPending ? (saveJob.variables?.job.id ?? null) : null;
  return useMemo(
    () => ({ save, hide, apply, markApplied, view, askingAbout, dismissAsk, savingId }),
    [save, hide, apply, markApplied, view, askingAbout, dismissAsk, savingId],
  );
}
