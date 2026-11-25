import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';
import { hotkeyLabels, isApplePlatform } from '../../lib/hotkey';

export interface KbdProps extends ComponentProps<'kbd'> {
  /** A shortcut in useHotkey syntax ("mod+k", "/", "shift+enter"), shown as platform-specific key caps. */
  combo?: string;
}

const CAP = 'inline-flex h-5 min-w-5 items-center justify-center rounded-[0.3rem] border border-border border-b-strong bg-surface px-1 font-sans text-[0.6875rem] font-medium text-muted';

/** Keyboard key cap(s). Pass `combo` for a shortcut, or children for literal text. */
export function Kbd({ combo, className, children, ...props }: KbdProps) {
  if (combo === undefined) {
    return (
      <kbd className={cn(CAP, className)} {...props}>
        {children}
      </kbd>
    );
  }
  const labels = hotkeyLabels(combo, isApplePlatform());
  return (
    <kbd className={cn('inline-flex items-center gap-0.5', className)} {...props}>
      {labels.map((label, index) => (
        <kbd key={`${label}-${index}`} className={CAP}>
          {label}
        </kbd>
      ))}
    </kbd>
  );
}
