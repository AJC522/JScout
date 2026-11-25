import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { CONTROL_HEIGHT, controlFrame, type ControlSize } from './control';
import { useFieldControl } from './Field';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentProps<'select'>, 'size'> {
  size?: ControlSize;
  /** Shorthand for <option> children. */
  options?: readonly SelectOption[];
  /** Adds a first, empty-valued option with this text. */
  placeholder?: string;
  invalid?: boolean;
  wrapperClassName?: string;
}

/** Native <select> with the control look: the most robust choice for plain option lists (keyboard, mobile pickers). */
export function Select({ size = 'md', options, placeholder, invalid, wrapperClassName, className, children, ...props }: SelectProps) {
  const field = useFieldControl({ ...props, invalid });
  return (
    <div className={cn('relative flex', CONTROL_HEIGHT[size], wrapperClassName)}>
      <select
        {...props}
        id={field.id}
        required={field.required}
        disabled={field.disabled}
        aria-invalid={field['aria-invalid']}
        aria-describedby={field['aria-describedby']}
        className={cn(
          controlFrame({ invalid: field.invalid, disabled: field.disabled }),
          'h-full w-full min-w-0 appearance-none truncate pr-8 outline-none focus-visible:outline-none',
          'focus:border-focus focus:ring-1 focus:ring-focus',
          size === 'sm' ? 'pl-2 text-sm' : 'pl-2.5 text-base',
          className,
        )}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-subtle" />
    </div>
  );
}
