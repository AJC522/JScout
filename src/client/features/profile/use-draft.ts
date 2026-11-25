/** Per-section editing state: a local draft of saved data, whether it differs, and a guard against losing it. */
import { useCallback, useEffect, useState } from 'react';
import { useBlocker } from 'react-router';
import { useConfirm } from '../../components/ui';
import { sameJson } from './profile-model';

export interface Draft<T> {
  value: T;
  set: (next: T | ((current: T) => T)) => void;
  dirty: boolean;
  /** Throw away edits and show the saved value again. */
  reset: () => void;
  /** After a save: the server's version (which may be normalised) becomes both the saved and the edited value. */
  commit: (saved: T) => void;
}

/**
 * Keeps an editable copy of `saved`. While the user has not changed anything the draft follows
 * `saved` (e.g. after a save or a résumé import); once edited it keeps the user's edits.
 */
export function useDraft<T>(saved: T): Draft<T> {
  const [base, setBase] = useState(saved);
  const [value, setValue] = useState(saved);
  const dirty = !sameJson(value, base);

  // Adjusting state while rendering (instead of in an effect) avoids a flash of the old value.
  if (!sameJson(saved, base) && !dirty) {
    setBase(saved);
    setValue(saved);
  }

  const reset = useCallback(() => setValue(base), [base]);
  const commit = useCallback((next: T) => {
    setBase(next);
    setValue(next);
  }, []);
  return { value, set: setValue, dirty, reset, commit };
}

/**
 * While `dirty`, ask before leaving the page (in-app navigation and closing the tab).
 * Moving between anchors on the same page is not leaving.
 */
export function useUnsavedChangesGuard(dirty: boolean): void {
  const confirm = useConfirm();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let cancelled = false;
    void confirm({
      title: 'Leave without saving?',
      description: 'You have changes on this page that are not saved yet.',
      confirmLabel: 'Leave without saving',
      cancelLabel: 'Stay on this page',
      tone: 'danger',
    }).then((leave) => {
      if (cancelled) return;
      if (leave) blocker.proceed();
      else blocker.reset();
    });
    return () => {
      cancelled = true;
    };
  }, [blocker, confirm]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

/** Tell the page whether a section has unsaved edits, so it can guard navigation. `onDirtyChange` must be stable. */
export function useReportDirty(dirty: boolean, onDirtyChange: (dirty: boolean) => void): void {
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
}
