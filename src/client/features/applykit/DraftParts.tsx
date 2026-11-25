/** Pieces shared by the cover-letter and answer panels: the editable draft and the AI availability note. */
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Sparkles, TriangleAlert } from 'lucide-react';
import type { GeneratedBy } from '../../../shared/types';
import { Badge, Button, CopyButton, Textarea } from '../../components/ui';
import { pluralize } from '../../lib/format';
import { useAiStatus } from './queries';
import { wordCount } from './text';

const GENERATED_LABELS: Record<GeneratedBy, string | null> = {
  manual: null,
  template: 'From template',
  ai: 'Written with AI',
};

export interface DraftEditorProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  generatedBy: GeneratedBy;
  fallbackReason?: string;
  /** Buttons shown next to Copy (save actions). */
  actions?: ReactNode;
}

export function DraftEditor({ id, label, value, onChange, generatedBy, fallbackReason, actions }: DraftEditorProps) {
  const badge = GENERATED_LABELS[generatedBy];
  return (
    <div className="flex flex-col gap-2">
      {fallbackReason ? (
        <p className="flex gap-2 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            AI drafting did not work this time, so this was written from the template. <span className="text-fg">{fallbackReason}</span>
          </span>
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        <div className="flex items-center gap-2 text-xs text-muted">
          {badge ? <Badge size="sm" tone={generatedBy === 'ai' ? 'accent' : 'neutral'}>{badge}</Badge> : null}
          <span className="tabular-nums" aria-live="polite">
            {pluralize(wordCount(value), 'word')}
          </span>
        </div>
      </div>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} autoGrow maxRows={24} rows={8} className="leading-relaxed" />
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={value} label="Copy" size="sm" disabled={!value.trim()} />
        {actions}
      </div>
    </div>
  );
}

/** "Write with AI" button that explains itself when no AI key is set up. */
export function AiDraftButton({ onClick, loading, disabled, children }: { onClick: () => void; loading: boolean; disabled?: boolean; children: ReactNode }) {
  const status = useAiStatus();
  const hintId = useId();
  const configured = status.data?.configured === true;
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        leadingIcon={<Sparkles />}
        onClick={onClick}
        loading={loading}
        disabled={disabled || !configured}
        aria-describedby={configured ? undefined : hintId}
      >
        {children}
      </Button>
      {!configured && !status.isPending ? (
        <p id={hintId} className="text-xs text-muted">
          {status.isError ? 'AI drafting is not available right now.' : 'AI drafting needs an API key. '}
          {status.isError ? null : (
            <Link to="/settings" className="font-medium text-primary hover:underline">
              Add one in Settings
            </Link>
          )}
        </p>
      ) : null}
    </div>
  );
}
