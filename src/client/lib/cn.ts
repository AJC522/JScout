import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * tailwind-merge only knows Tailwind's stock scales. Registering the names
 * added in styles.css lets a caller's className override ours reliably
 * (e.g. rounded-card vs rounded-control, one animate-* replacing another).
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['control', 'card'],
      shadow: ['overlay', 'dialog'],
      animate: [
        'fade-in',
        'fade-out',
        'pop-in',
        'pop-out',
        'dialog-in',
        'dialog-out',
        'sheet-in-right',
        'sheet-out-right',
        'sheet-in-left',
        'sheet-out-left',
        'toast-in',
        'toast-out',
        'indeterminate',
      ],
    },
  },
});

/** Join class names (clsx syntax) and resolve conflicting Tailwind utilities so the last one wins. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
