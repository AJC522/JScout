/** Free-form notes that save themselves shortly after the user stops typing. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert } from 'lucide-react';
import type { ApplicationDetail } from '../../../../shared/types';
import { Spinner, Textarea } from '../../../components/ui';
import { usePatchApplication } from '../queries';
import { Section } from './Section';

const SAVE_DELAY_MS = 800;
const NOTES_MAX = 20_000;

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  return (
    <span role="status" className="flex items-center gap-1.5 text-xs text-muted">
      {state === 'saving' ? <Spinner size="sm" label="Saving" /> : null}
      {state === 'saved' ? <Check aria-hidden="true" className="size-3.5 text-success" /> : null}
      {state === 'error' ? <CircleAlert aria-hidden="true" className="size-3.5 text-danger" /> : null}
      {{ dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', error: 'Not saved' }[state]}
    </span>
  );
}

export function NotesSection({ app }: { app: ApplicationDetail }) {
  const { mutate } = usePatchApplication(app.id);
  const [text, setText] = useState(app.notes);
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<number | undefined>(undefined);
  // The last text the server has (or is about to have), so unchanged text is never re-sent.
  const savedText = useRef(app.notes);
  const latest = useRef(text);
  latest.current = text;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const value = latest.current;
    if (value === savedText.current) return;
    const previous = savedText.current;
    savedText.current = value;
    setState('saving');
    mutate(
      { notes: value },
      {
        onSuccess: () => setState((s) => (latest.current === value && s === 'saving' ? 'saved' : s)),
        onError: () => {
          savedText.current = previous;
          setState('error');
        },
      },
    );
  }, [mutate]);

  // Save whatever is pending when leaving the page.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  const onChange = (value: string) => {
    setText(value);
    setState('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };

  return (
    <Section title="Notes" actions={<SaveIndicator state={state} />}>
      <Textarea
        aria-label="Notes"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={flush}
        placeholder="Who you spoke to, what they said, questions to ask…"
        rows={4}
        autoGrow
        maxRows={20}
        maxLength={NOTES_MAX}
      />
    </Section>
  );
}
