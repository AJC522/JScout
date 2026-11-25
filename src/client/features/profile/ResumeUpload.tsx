/** Drop, choose or paste a résumé. Used by onboarding and the profile page. */
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ClipboardPaste, FileUp } from 'lucide-react';
import type { ResumeResult } from '../../../shared/api';
import { MAX_RESUME_BYTES } from '../../../shared/constants';
import { errorMessage } from '../../api/client';
import { Button, Field, ProgressBar, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatBytes } from '../../lib/format';
import { useUploadResume, type ResumeInput } from './profile-api';
import { RESUME_ACCEPT, checkResumeFile } from './validation';

interface ResumeUploadProps {
  onUploaded: (result: ResumeResult) => void;
  /** Start on the paste box (e.g. after a scanned PDF could not be read). */
  startWithPaste?: boolean;
  /** Shown next to the main action, e.g. a Cancel button when replacing. */
  extraAction?: ReactNode;
}

const MIN_PASTE_CHARS = 40;

export function ResumeUpload({ onUploaded, startWithPaste = false, extraAction }: ResumeUploadProps) {
  const upload = useUploadResume();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'file' | 'paste'>(startWithPaste ? 'paste' : 'file');
  const [dragging, setDragging] = useState(false);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<ResumeInput | null>(null);

  const send = (input: ResumeInput) => {
    setProblem(null);
    setLastInput(input);
    upload.mutate(input, {
      onSuccess: (result) => onUploaded(result),
      onError: (err) => setProblem(errorMessage(err)),
    });
  };

  const pick = (file: File | undefined) => {
    if (!file) return;
    const issue = checkResumeFile(file);
    if (issue) {
      setProblem(issue);
      setLastInput(null);
      return;
    }
    send({ kind: 'file', file });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!upload.isPending) pick(event.dataTransfer.files[0]);
  };

  if (upload.isPending) {
    const name = lastInput?.kind === 'file' ? lastInput.file.name : 'your pasted text';
    return (
      <div className="flex min-h-44 flex-col justify-center gap-3 rounded-card border border-border bg-surface-2 p-6" aria-live="polite">
        <p className="text-sm font-medium text-fg">Reading {name}…</p>
        <ProgressBar label="Uploading and reading your résumé" />
        <p className="text-sm text-muted">This takes a few seconds. Nothing leaves your computer.</p>
      </div>
    );
  }

  const error = problem ? (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
      <span>{problem}</span>
      {lastInput ? (
        <Button size="sm" variant="ghost" onClick={() => send(lastInput)}>
          Try again
        </Button>
      ) : null}
    </div>
  ) : null;

  if (mode === 'paste') {
    const tooShort = text.trim().length < MIN_PASTE_CHARS;
    return (
      <div className="flex flex-col gap-3">
        <Field label="Paste your résumé" hint="Copy everything from your résumé document and paste it here.">
          <Textarea value={text} onChange={(event) => setText(event.target.value)} autoGrow maxRows={16} rows={8} placeholder="Jane Doe · jane@example.com …" />
        </Field>
        {error}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={tooShort} onClick={() => send({ kind: 'text', text })}>
            Read this text
          </Button>
          <Button variant="ghost" leadingIcon={<FileUp />} onClick={() => setMode('file')}>
            Upload a file instead
          </Button>
          {extraAction}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex min-h-44 flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed px-6 py-8 text-center transition-colors',
          dragging ? 'border-primary bg-primary-soft' : 'border-border-control bg-surface-2',
        )}
      >
        <FileUp className="size-8 text-subtle" aria-hidden />
        <div>
          <p className="text-base font-medium text-fg">Drop your résumé here</p>
          <p className="text-sm text-muted">PDF, Word (.docx) or text, up to {formatBytes(MAX_RESUME_BYTES)}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => inputRef.current?.click()}>
            Choose a file
          </Button>
          <Button variant="ghost" leadingIcon={<ClipboardPaste />} onClick={() => setMode('paste')}>
            Paste text instead
          </Button>
          {extraAction}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={RESUME_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a résumé file"
          onChange={(event) => {
            pick(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      {error}
    </div>
  );
}
