import { useId, type ComponentProps, type ReactNode } from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';
import { useFieldControl } from './Field';

export interface RadioOption<V extends string = string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string = string>
  extends Omit<ComponentProps<typeof RadioGroupPrimitive.Root>, 'children' | 'value' | 'defaultValue' | 'onValueChange'> {
  options: ReadonlyArray<RadioOption<V>>;
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  /** Bordered, card-like options for choices that deserve a description. */
  variant?: 'plain' | 'cards';
}

/**
 * One-of-several choice. Arrow keys move between options (Radix roving focus).
 * Inside a <Field>, the Field's label names the group.
 */
export function RadioGroup<V extends string = string>({ options, value, defaultValue, onValueChange, variant = 'plain', orientation = 'vertical', className, ...props }: RadioGroupProps<V>) {
  const generated = useId();
  const field = useFieldControl(props);
  return (
    <RadioGroupPrimitive.Root
      {...props}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(next as V)}
      orientation={orientation}
      disabled={field.disabled}
      required={field.required}
      aria-labelledby={props['aria-labelledby'] ?? (props['aria-label'] ? undefined : field.labelId)}
      aria-describedby={field['aria-describedby']}
      className={cn('flex gap-2', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap gap-x-5', className)}
    >
      {options.map((option) => {
        const itemId = `radio-${generated}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={itemId}
            className={cn(
              'flex items-start gap-2.5',
              variant === 'cards' &&
                'rounded-control border border-border bg-surface p-3 transition-colors hover:border-strong has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft/50',
              option.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span className="flex h-5 items-center">
              <RadioGroupPrimitive.Item
                id={itemId}
                value={option.value}
                disabled={option.disabled}
                className="flex size-4 shrink-0 items-center justify-center rounded-full border border-control bg-surface transition-colors hover:border-fg/60 data-[state=checked]:border-primary disabled:cursor-not-allowed"
              >
                <RadioGroupPrimitive.Indicator className="block size-2 rounded-full bg-primary" />
              </RadioGroupPrimitive.Item>
            </span>
            <span className="min-w-0">
              <span className="block text-base text-fg">{option.label}</span>
              {option.description ? <span className="block text-sm text-muted">{option.description}</span> : null}
            </span>
          </label>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
