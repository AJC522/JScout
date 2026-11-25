import { createContext, useContext, useId, type ReactNode } from 'react';
import { CircleExclamationPoint } from 'lucide-react';
import { cn } from '../../lib/cn';

interface FieldContextValue {
  controlId: string;
  labelId: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldControlProps {
  id?: string;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  'aria-describedby'?: string;
  'aria-labelledby'?: string;
}

/**
 * Merges a control's own props with the surrounding <Field>, so controls placed in a
 * Field are labelled, described and marked invalid without any wiring by the caller.
 * Explicit props win over the Field's.
 */
export function useFieldControl(props: FieldControlProps) {
  const field = useContext(FieldContext);
  const describedBy = [field?.describedBy, props['aria-describedby']].filter(Boolean).join(' ') || undefined;
  const invalid = props.invalid ?? field?.invalid ?? false;
  return {
    id: props.id ?? field?.controlId,
    labelId: field?.labelId,
    required: props.required ?? field?.required,
    disabled: props.disabled ?? field?.disabled,
    invalid,
    'aria-describedby': describedBy,
    'aria-invalid': invalid || undefined,
  };
}

export interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  /** Help text under the control. Stays visible when there is an error. */
  hint?: ReactNode;
  /** Validation message; marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Shows a quiet "Optional" next to the label (use when most fields in the form are required). */
  optional?: boolean;
  disabled?: boolean;
  /** Something right-aligned on the label row, e.g. a "Generate" link or a character count. */
  labelAction?: ReactNode;
  /** Visually hide the label (it is still announced). */
  hideLabel?: boolean;
  /** Id for the control; generated when omitted. */
  id?: string;
  className?: string;
}

/** Label + control + hint/error, with ids and aria attributes wired up through context. */
export function Field({ label, children, hint, error, required = false, optional = false, disabled = false, labelAction, hideLabel = false, id, className }: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field-${generated}`;
  const labelId = `${controlId}-label`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const value: FieldContextValue = {
    controlId,
    labelId,
    describedBy: [errorId, hintId].filter(Boolean).join(' ') || undefined,
    invalid: Boolean(error),
    required,
    disabled,
  };

  return (
    <FieldContext.Provider value={value}>
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        <div className={cn('flex min-h-5 items-end justify-between gap-3', hideLabel && 'sr-only')}>
          <label id={labelId} htmlFor={controlId} className="text-sm font-medium text-fg">
            {label}
            {required ? (
              <span className="ml-0.5 text-danger" aria-hidden="true">
                *
              </span>
            ) : null}
            {optional && !required ? <span className="ml-1.5 font-normal text-subtle">Optional</span> : null}
          </label>
          {labelAction ? <div className="text-sm text-muted">{labelAction}</div> : null}
        </div>
        {children}
        {error ? (
          <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger">
            <CircleExclamationPoint aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-sm text-subtle">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
