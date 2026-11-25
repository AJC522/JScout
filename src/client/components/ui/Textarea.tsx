import { useCallback, useLayoutEffect, useMemo, useRef, type ComponentProps } from 'react';
import { cn } from '../../lib/cn';
import { mergeRefs } from '../../lib/refs';
import { controlFrame } from './control';
import { useFieldControl } from './Field';

export interface TextareaProps extends ComponentProps<'textarea'> {
  /** Grow with the content instead of scrolling, up to `maxRows`. */
  autoGrow?: boolean;
  /** Upper limit for autoGrow, in rows. Default 16. */
  maxRows?: number;
  invalid?: boolean;
  /** Use the monospace font (e.g. for pasted résumé text). */
  mono?: boolean;
}

export function Textarea({ autoGrow = false, maxRows = 16, rows = 3, invalid, mono = false, className, ref, onInput, ...props }: TextareaProps) {
  const field = useFieldControl({ ...props, invalid });
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useMemo(() => mergeRefs(innerRef, ref), [ref]);

  const resize = useCallback(() => {
    const node = innerRef.current;
    if (!autoGrow || !node) return;
    const style = window.getComputedStyle(node);
    const px = (value: string) => Number.parseFloat(value) || 0;
    const borders = px(style.borderTopWidth) + px(style.borderBottomWidth);
    const max = (px(style.lineHeight) || 22) * maxRows + px(style.paddingTop) + px(style.paddingBottom) + borders;
    // Collapse first so the box can also shrink when text is deleted.
    node.style.height = 'auto';
    const wanted = node.scrollHeight + borders;
    node.style.height = `${Math.min(wanted, max)}px`;
    node.style.overflowY = wanted > max ? 'auto' : 'hidden';
  }, [autoGrow, maxRows]);

  useLayoutEffect(resize, [resize, props.value]);

  return (
    <textarea
      ref={setRef}
      rows={rows}
      {...props}
      id={field.id}
      required={field.required}
      disabled={field.disabled}
      aria-invalid={field['aria-invalid']}
      aria-describedby={field['aria-describedby']}
      onInput={(event) => {
        onInput?.(event);
        resize();
      }}
      className={cn(
        controlFrame({ invalid: field.invalid, disabled: field.disabled }),
        'block w-full px-2.5 py-2 text-base leading-relaxed outline-none placeholder:text-subtle focus-visible:outline-none',
        autoGrow ? 'resize-none' : 'resize-y',
        mono && 'font-mono text-sm',
        className,
      )}
    />
  );
}
