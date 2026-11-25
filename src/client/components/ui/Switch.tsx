import { useId, type ComponentProps, type ReactNode } from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';
import { useFieldControl } from './Field';

export interface SwitchProps extends Omit<ComponentProps<typeof SwitchPrimitive.Root>, 'children'> {
  /** Text next to the switch. Without it, give the switch an aria-label or wrap it in a Field. */
  label?: ReactNode;
  description?: ReactNode;
  size?: 'sm' | 'md';
  /** Put the label on the left and the switch on the right (settings-list layout). */
  labelPosition?: 'start' | 'end';
}

/** On/off toggle for settings that apply immediately. Use a Checkbox inside forms that are submitted. */
export function Switch({ label, description, size = 'md', labelPosition = 'end', className, id, ...props }: SwitchProps) {
  const generated = useId();
  const field = useFieldControl({ ...props, id });
  const controlId = field.id ?? `switch-${generated}`;
  const descriptionId = description ? `${controlId}-description` : undefined;

  const control = (
    <SwitchPrimitive.Root
      {...props}
      id={controlId}
      disabled={field.disabled}
      aria-describedby={[field['aria-describedby'], descriptionId].filter(Boolean).join(' ') || undefined}
      className={cn(
        'group relative inline-flex shrink-0 items-center rounded-full border border-transparent bg-border-control/60 transition-colors',
        'hover:bg-border-control/80 data-[state=checked]:bg-primary data-[state=checked]:hover:bg-primary-hover',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
        !label && className,
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform',
          size === 'sm' ? 'size-3 translate-x-0.5 data-[state=checked]:translate-x-3.5' : 'size-4 translate-x-0.5 data-[state=checked]:translate-x-[1.125rem]',
        )}
      />
    </SwitchPrimitive.Root>
  );

  if (!label) return control;
  return (
    <div className={cn('flex items-start gap-3', labelPosition === 'start' && 'flex-row-reverse justify-between', className)}>
      <span className="flex h-5 items-center">{control}</span>
      <div className="min-w-0">
        <label htmlFor={controlId} className="text-base text-fg">
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
