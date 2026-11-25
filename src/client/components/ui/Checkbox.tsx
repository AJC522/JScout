import { useId, type ComponentProps, type ReactNode } from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useFieldControl } from './Field';

export interface CheckboxProps extends Omit<ComponentProps<typeof CheckboxPrimitive.Root>, 'children'> {
  /** Clickable text next to the box. Without it, give the checkbox an aria-label or wrap it in a Field. */
  label?: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  invalid?: boolean;
}

/** Checkbox with optional label. `checked` may be 'indeterminate' for "some selected". */
export function Checkbox({ label, description, invalid, className, id, ...props }: CheckboxProps) {
  const generated = useId();
  const field = useFieldControl({ ...props, id, invalid });
  const controlId = field.id ?? `checkbox-${generated}`;
  const descriptionId = description ? `${controlId}-description` : undefined;

  const box = (
    <CheckboxPrimitive.Root
      {...props}
      id={controlId}
      disabled={field.disabled}
      required={field.required}
      aria-invalid={field['aria-invalid']}
      aria-describedby={[field['aria-describedby'], descriptionId].filter(Boolean).join(' ') || undefined}
      className={cn(
        'peer inline-flex size-4 shrink-0 items-center justify-center rounded-[0.3rem] border border-control bg-surface text-on-primary transition-colors',
        'hover:border-fg/60 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        field.invalid && 'border-danger',
        !label && className,
      )}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {props.checked === 'indeterminate' ? (
          <Minus aria-hidden="true" className="size-3" strokeWidth={3} />
        ) : (
          <Check aria-hidden="true" className="size-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!label) return box;
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <span className="flex h-5 items-center">{box}</span>
      <div className="min-w-0">
        <label htmlFor={controlId} className="text-base text-fg peer-disabled:cursor-not-allowed">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
