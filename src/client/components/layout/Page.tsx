import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

const WIDTHS = {
  /** Forms and reading (profile, settings, onboarding). */
  narrow: 'max-w-[760px]',
  default: 'max-w-[1200px]',
  /** List + detail layouts that use the whole screen (search, tracker board). */
  wide: 'max-w-[1600px]',
} as const;

export interface PageProps extends ComponentProps<'div'> {
  width?: keyof typeof WIDTHS;
}

/** The content column every page renders into, so gutters and widths match across the app. */
export function Page({ width = 'default', className, ...props }: PageProps) {
  return <div className={cn('mx-auto w-full px-4 pt-5 pb-12 sm:px-6 sm:pt-7 lg:px-8', WIDTHS[width], className)} {...props} />;
}
