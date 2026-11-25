import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/** Placeholder block while content loads. Size it with className (h-4 w-32, size-10 rounded-full…). */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-surface-3', className)} {...props} />;
}

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/** A paragraph-shaped placeholder; the last line is shorter so it reads as text. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-3.5', index === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}
