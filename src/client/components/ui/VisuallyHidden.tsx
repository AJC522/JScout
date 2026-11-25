import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/** Content for screen readers only (labels for icon-only controls, extra context for counts). */
export function VisuallyHidden({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('sr-only', className)} {...props} />;
}
