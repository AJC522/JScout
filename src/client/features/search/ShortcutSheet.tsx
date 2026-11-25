/** The "?" sheet listing the search page's keyboard shortcuts. */
import { Dialog, Kbd } from '../../components/ui';

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['/'], label: 'Focus the search box' },
  { keys: ['j', 'arrowdown'], label: 'Next job' },
  { keys: ['k', 'arrowup'], label: 'Previous job' },
  { keys: ['enter', 'o'], label: 'Open the job' },
  { keys: ['s'], label: 'Save to your tracker' },
  { keys: ['h'], label: 'Hide (or show again)' },
  { keys: ['a'], label: 'Apply on the employer’s site' },
  { keys: ['escape'], label: 'Close the job' },
  { keys: ['?'], label: 'Show these shortcuts' },
];

export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" size="sm">
      <ul className="divide-y divide-border">
        {SHORTCUTS.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="text-fg">{s.label}</span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-subtle">
              {s.keys.map((key, i) => (
                <span key={key} className="flex items-center gap-1">
                  {i > 0 ? 'or' : null}
                  <Kbd combo={key} />
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
