import { useMemo, useRef, type ComponentProps, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { mergeRefs } from '../../lib/refs';
import { BARE_INPUT, CONTROL_HEIGHT, CONTROL_PADDING_X, controlFrame, type ControlSize } from './control';
import { useFieldControl } from './Field';

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  size?: ControlSize;
  /** Icon at the start of the box (decorative). */
  leadingIcon?: ReactNode;
  /** Anything at the end of the box: a unit, a Kbd hint, a small button. */
  trailing?: ReactNode;
  /** Shows a clear button while the (controlled) value is non-empty; called when it is pressed and on Escape. */
  onClear?: () => void;
  invalid?: boolean;
  /** Classes for the outer box; `className` goes to the <input>. */
  wrapperClassName?: string;
}

export function Input({
  size = 'md',
  leadingIcon,
  trailing,
  onClear,
  invalid,
  wrapperClassName,
  className,
  ref,
  onKeyDown,
  ...props
}: InputProps) {
  const field = useFieldControl({ ...props, invalid });
  const innerRef = useRef<HTMLInputElement | null>(null);
  const setRef = useMemo(() => mergeRefs(innerRef, ref), [ref]);
  const hasValue = props.value !== undefined ? String(props.value) !== '' : false;
  const showClear = Boolean(onClear) && hasValue && !field.disabled && !props.readOnly;

  return (
    <div
      className={cn(
        controlFrame({ invalid: field.invalid, disabled: field.disabled }),
        'flex items-center gap-2',
        CONTROL_HEIGHT[size],
        CONTROL_PADDING_X[size],
        wrapperClassName,
      )}
      // Clicking the padding or an icon should still focus the text box.
      onMouseDown={(event) => {
        if (event.target !== innerRef.current && !(event.target as HTMLElement).closest('button, a')) {
          event.preventDefault();
          innerRef.current?.focus();
        }
      }}
    >
      {leadingIcon ? (
        <span aria-hidden="true" className="flex shrink-0 text-subtle [&_svg]:size-4">
          {leadingIcon}
        </span>
      ) : null}
      <input
        ref={setRef}
        {...props}
        id={field.id}
        required={field.required}
        disabled={field.disabled}
        aria-invalid={field['aria-invalid']}
        aria-describedby={field['aria-describedby']}
        className={cn(BARE_INPUT, 'h-full', className)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && event.key === 'Escape' && showClear) {
            event.preventDefault();
            onClear?.();
          }
        }}
      />
      {showClear ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => {
            onClear?.();
            innerRef.current?.focus();
          }}
          className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-hover hover:text-fg"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
      {trailing ? <span className="flex shrink-0 items-center text-sm text-subtle">{trailing}</span> : null}
    </div>
  );
}
