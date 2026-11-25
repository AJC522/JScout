import { cn } from '../../lib/cn';

/** The JScout mark (same drawing as public/favicon.svg) with an optional wordmark. */
export function Logo({ showName = true, className }: { showName?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className="size-7 shrink-0">
        <rect width="32" height="32" rx="8" fill="#1f5f5b" />
        <circle cx="14" cy="14" r="6.5" fill="none" stroke="#fff" strokeWidth="2.6" />
        <path d="M19 19l6 6" stroke="#f2b84b" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {showName ? <span className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-fg">JScout</span> : <span className="sr-only">JScout</span>}
    </span>
  );
}
