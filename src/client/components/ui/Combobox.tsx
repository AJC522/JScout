import { useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { mergeRefs } from '../../lib/refs';
import { BARE_INPUT, CONTROL_HEIGHT, CONTROL_PADDING_X, controlFrame, type ControlSize } from './control';
import { useFieldControl } from './Field';
import { HighlightMatch, moveActiveIndex, optionId, OptionList, useAsyncOptions, type OptionLoader } from './listbox';
import { Spinner } from './Spinner';

const STATIC_LIMIT = 50;

export interface ComboboxProps<T> {
  /** The text in the box. Free text is always allowed; options are suggestions. */
  value: string;
  onValueChange: (text: string) => void;
  /** Async suggestions for the current text (debounced; aborted when the text changes). */
  loadOptions?: OptionLoader<T>;
  /** A fixed list, filtered by substring as the user types. Use instead of loadOptions. */
  options?: readonly T[];
  /** Text an option puts in the box. Defaults to String(option). */
  getOptionLabel?: (option: T) => string;
  /** Stable key; defaults to the label. */
  getOptionKey?: (option: T) => string;
  /** Custom row content (e.g. a title with its job count). The default highlights the matched text. */
  renderOption?: (option: T, state: { active: boolean; query: string }) => ReactNode;
  /** Called after an option was picked (its label is already in the box). */
  onSelect?: (option: T) => void;
  /** Enter pressed with no option highlighted. When omitted, Enter submits the surrounding form. */
  onSubmit?: (text: string) => void;
  /** Characters needed before suggestions show. 0 shows them on focus. Default 1. */
  minChars?: number;
  debounceMs?: number;
  /** Shown when the text matched nothing; omit to just hide the list. */
  emptyMessage?: ReactNode;
  /** Show a clear button while there is text. Default true. */
  clearable?: boolean;
  placeholder?: string;
  leadingIcon?: ReactNode;
  size?: ControlSize;
  id?: string;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  /** Classes for the outer box. */
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

/**
 * Text box with a suggestion list (the "what" and "where" boxes). Arrow keys move through
 * suggestions, Enter picks the highlighted one, Escape closes the list, and typing anything
 * else is always accepted as free text.
 */
export function Combobox<T = string>({
  value,
  onValueChange,
  loadOptions,
  options: staticOptions,
  getOptionLabel = String,
  getOptionKey,
  renderOption,
  onSelect,
  onSubmit,
  minChars = 1,
  debounceMs = 150,
  emptyMessage,
  clearable = true,
  placeholder,
  leadingIcon,
  size = 'md',
  name,
  autoFocus,
  className,
  ref,
  ...props
}: ComboboxProps<T>) {
  const field = useFieldControl(props);
  const listId = `${useId()}-listbox`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setRef = useMemo(() => mergeRefs(inputRef, ref), [ref]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const remote = useAsyncOptions(loadOptions, value, { enabled: open && !staticOptions, debounceMs, minChars });
  const options = useMemo(() => {
    if (!staticOptions) return remote.options;
    const needle = value.trim().toLowerCase();
    if (needle.length < minChars) return [];
    return staticOptions.filter((option) => getOptionLabel(option).toLowerCase().includes(needle)).slice(0, STATIC_LIMIT);
  }, [staticOptions, remote.options, value, minChars, getOptionLabel]);

  // A new set of options invalidates the highlighted row.
  const [optionsSeen, setOptionsSeen] = useState(options);
  if (optionsSeen !== options) {
    setOptionsSeen(options);
    setActiveIndex(-1);
  }

  const keyOf = getOptionKey ?? getOptionLabel;
  const loading = !staticOptions && remote.loading;
  const active = activeIndex >= 0 ? options[activeIndex] : undefined;

  const select = (option: T) => {
    onValueChange(getOptionLabel(option));
    onSelect?.(option);
    setOpen(false);
    setActiveIndex(-1);
  };

  const frame = (
    <div
      className={cn(
        controlFrame({ invalid: field.invalid, disabled: field.disabled }),
        'flex items-center gap-2',
        CONTROL_HEIGHT[size],
        CONTROL_PADDING_X[size],
        className,
      )}
      onMouseDown={(event) => {
        if (event.target !== inputRef.current && !(event.target as HTMLElement).closest('button')) {
          event.preventDefault();
          inputRef.current?.focus();
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
        id={field.id}
        name={name}
        type="text"
        role="combobox"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        disabled={field.disabled}
        required={field.required}
        aria-label={props['aria-label']}
        aria-describedby={field['aria-describedby']}
        aria-invalid={field['aria-invalid']}
        aria-autocomplete="list"
        aria-expanded={open && (options.length > 0 || loading)}
        aria-controls={listId}
        aria-activedescendant={active !== undefined ? optionId(listId, activeIndex) : undefined}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (minChars === 0) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp': {
              event.preventDefault();
              if (!open) {
                setOpen(true);
                return;
              }
              setActiveIndex(moveActiveIndex(activeIndex, event.key === 'ArrowDown' ? 1 : -1, options.length));
              return;
            }
            case 'Enter': {
              if (open && active !== undefined) {
                event.preventDefault();
                select(active);
                return;
              }
              setOpen(false);
              if (onSubmit) {
                event.preventDefault();
                onSubmit(value);
              }
              return;
            }
            case 'Escape': {
              if (open) {
                event.preventDefault();
                setOpen(false);
                setActiveIndex(-1);
              }
              return;
            }
            case 'Tab':
              setOpen(false);
              return;
          }
        }}
        className={cn(BARE_INPUT, 'h-full')}
      />
      {loading ? <Spinner size="sm" label={null} className="text-subtle" /> : null}
      {clearable && value !== '' && !field.disabled ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => {
            onValueChange('');
            setActiveIndex(-1);
            inputRef.current?.focus();
          }}
          className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-hover hover:text-fg"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );

  return (
    <OptionList
      listId={listId}
      open={open && !field.disabled}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      anchor={frame}
      options={options}
      activeIndex={activeIndex}
      onActiveIndexChange={setActiveIndex}
      onSelect={select}
      getKey={keyOf}
      label={props['aria-label']}
      loading={loading}
      emptyMessage={value.trim().length >= Math.max(1, minChars) ? emptyMessage : undefined}
      renderOption={(option, isActive) =>
        renderOption ? (
          renderOption(option, { active: isActive, query: value })
        ) : (
          <span className="truncate">
            <HighlightMatch text={getOptionLabel(option)} query={value} />
          </span>
        )
      }
    />
  );
}
