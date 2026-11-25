import { useId, useMemo, useRef, useState, type Ref } from 'react';
import { cn } from '../../lib/cn';
import { mergeRefs } from '../../lib/refs';
import { Chip } from './Chip';
import { controlFrame } from './control';
import { useFieldControl } from './Field';
import { HighlightMatch, moveActiveIndex, optionId, OptionList, useAsyncOptions, type OptionLoader } from './listbox';
import { hasTag, mergeTags, splitTags, splitTyped } from './tag-input';

export interface TagInputProps {
  value: readonly string[];
  onChange: (tags: string[]) => void;
  /** Async suggestions for the text being typed (debounced). Already-added tags are hidden. */
  loadSuggestions?: OptionLoader<string>;
  /** Maximum number of tags. */
  max?: number;
  placeholder?: string;
  /** Turn leftover text into a tag when focus leaves the box. Default true, so nothing typed is lost. */
  addOnBlur?: boolean;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

/**
 * A list of short strings (skills, keywords, excluded companies) edited as chips.
 * Enter or comma adds, Backspace on an empty box removes the last chip, pasting
 * "a, b, c" or a column of lines adds each piece.
 */
export function TagInput({ value, onChange, loadSuggestions, max, placeholder, addOnBlur = true, className, ref, ...props }: TagInputProps) {
  const field = useFieldControl(props);
  const listId = `${useId()}-suggestions`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setRef = useMemo(() => mergeRefs(inputRef, ref), [ref]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [announcement, setAnnouncement] = useState('');

  const full = max !== undefined && value.length >= max;
  const remote = useAsyncOptions(loadSuggestions, text, { enabled: open && !full, debounceMs: 150, minChars: 1 });
  const suggestions = useMemo(() => remote.options.filter((option) => !hasTag(value, option)), [remote.options, value]);

  const signature = suggestions.join('\u0000');
  const [seenSignature, setSeenSignature] = useState(signature);
  if (seenSignature !== signature) {
    setSeenSignature(signature);
    setActiveIndex(-1);
  }

  const add = (incoming: string[]) => {
    const result = mergeTags(value, incoming, max);
    if (result.added.length > 0) onChange(result.tags);
    const notes = [];
    if (result.added.length > 0) notes.push(`Added ${result.added.join(', ')}.`);
    if (result.duplicates.length > 0) notes.push(`Already added: ${result.duplicates.join(', ')}.`);
    if (result.overflow.length > 0) notes.push(`Limit of ${max} reached.`);
    setAnnouncement(notes.join(' '));
    setActiveIndex(-1);
  };

  const commitText = () => {
    if (text.trim() === '') return;
    add(splitTags(text));
    setText('');
  };

  const remove = (index: number) => {
    const tag = value[index];
    if (tag === undefined) return;
    onChange(value.filter((_, at) => at !== index));
    setAnnouncement(`Removed ${tag}.`);
  };

  const active = activeIndex >= 0 ? suggestions[activeIndex] : undefined;

  const frame = (
    <div
      className={cn(
        controlFrame({ invalid: field.invalid, disabled: field.disabled }),
        'flex min-h-8.5 flex-wrap items-center gap-1.5 px-1.5 py-[0.1875rem]',
        className,
      )}
      onMouseDown={(event) => {
        if (event.target !== inputRef.current && !(event.target as HTMLElement).closest('button')) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      {value.map((tag, index) => (
        <Chip key={tag} size="sm" className="h-6 max-w-[16rem]" disabled={field.disabled} onRemove={() => remove(index)} removeLabel={`Remove ${tag}`}>
          {tag}
        </Chip>
      ))}
      <input
        ref={setRef}
        id={field.id}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        disabled={field.disabled}
        aria-label={props['aria-label']}
        aria-describedby={field['aria-describedby']}
        aria-invalid={field['aria-invalid']}
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-activedescendant={active !== undefined ? optionId(listId, activeIndex) : undefined}
        placeholder={full ? `Limit of ${max} reached` : value.length === 0 ? placeholder : undefined}
        readOnly={full}
        value={text}
        onChange={(event) => {
          const { tags, rest } = splitTyped(event.target.value);
          if (tags.length > 0) add(tags);
          setText(rest);
          setOpen(true);
        }}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData('text');
          // A single-line input would flatten newlines; split the clipboard text ourselves.
          if (!/[,;\n\r\t]/.test(pasted)) return;
          event.preventDefault();
          add(splitTags(text + pasted));
          setText('');
        }}
        onBlur={() => {
          setOpen(false);
          if (addOnBlur) commitText();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          switch (event.key) {
            case 'Enter':
              if (open && active !== undefined) {
                event.preventDefault();
                add([active]);
                setText('');
              } else if (text.trim() !== '') {
                event.preventDefault();
                commitText();
              }
              return;
            case 'Backspace':
              if (text === '' && value.length > 0) {
                event.preventDefault();
                remove(value.length - 1);
              }
              return;
            case 'ArrowDown':
            case 'ArrowUp':
              if (suggestions.length === 0) return;
              event.preventDefault();
              setOpen(true);
              setActiveIndex(moveActiveIndex(activeIndex, event.key === 'ArrowDown' ? 1 : -1, suggestions.length));
              return;
            case 'Escape':
              if (open && suggestions.length > 0) {
                event.preventDefault();
                setOpen(false);
              }
              return;
          }
        }}
        className="h-6 min-w-24 flex-1 bg-transparent px-1 text-base text-fg outline-none placeholder:text-subtle focus-visible:outline-none read-only:cursor-default"
      />
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <OptionList
        listId={listId}
        open={open && !field.disabled}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        anchor={frame}
        options={suggestions}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
        onSelect={(option) => {
          add([option]);
          setText('');
        }}
        getKey={(option) => option}
        label={props['aria-label'] ? `${props['aria-label']} suggestions` : 'Suggestions'}
        loading={false}
        renderOption={(option) => (
          <span className="truncate">
            <HighlightMatch text={option} query={text} />
          </span>
        )}
      />
      {max !== undefined && value.length > 0 ? (
        <span className="self-end text-xs text-subtle tabular-nums">
          {value.length}
          <span aria-hidden="true">/</span>
          <span className="sr-only"> of </span>
          {max}
        </span>
      ) : null}
    </div>
  );
}
