import { useState } from 'react';
import { MessageSquareText, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Profile, SavedAnswer } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Badge, Button, EmptyState, Field, IconButton, Input, TagInput, Textarea, useToast } from '../../components/ui';
import { filterAnswers, unansweredCommon } from './answers-model';
import { EntryDialog, type EntryFormProps } from './EntryList';
import { useSaveProfile } from './profile-api';
import { newId } from './profile-model';
import { SectionCard } from './SectionCard';

const MAX_ANSWERS = 200;
const SUGGESTIONS_SHOWN = 4;

const newAnswer = (question = '', tags: string[] = []): SavedAnswer => ({ id: newId(), question, answer: '', tags, updatedAt: '' });

function validateAnswer(a: SavedAnswer): Partial<Record<keyof SavedAnswer, string>> {
  const errors: Partial<Record<keyof SavedAnswer, string>> = {};
  if (!a.question.trim()) errors.question = 'Add the question';
  if (!a.answer.trim()) errors.answer = 'Add your answer';
  if (a.answer.length > 10_000) errors.answer = 'Keep it under 10,000 characters';
  return errors;
}

const shortQuestion = (a: SavedAnswer) => (a.question.length > 40 ? `“${a.question.slice(0, 40)}…”` : `“${a.question}”`);

export function AnswersSection({ profile }: { profile: Profile }) {
  const answers = profile.answers;
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ item: SavedAnswer; isNew: boolean } | null>(null);
  const remove = useSaveProfile({ optimistic: true });
  const toast = useToast();
  const shown = filterAnswers(answers, query);
  const suggestions = unansweredCommon(answers).slice(0, SUGGESTIONS_SHOWN);
  const full = answers.length >= MAX_ANSWERS;

  const onRemove = (answer: SavedAnswer) => {
    const previous = [...answers];
    const undo = () => remove.mutate({ answers: previous });
    remove.mutate(
      { answers: answers.filter((a) => a.id !== answer.id) },
      {
        onSuccess: () => toast.success('Answer deleted', { id: 'answer-removed', action: { label: 'Undo', onClick: undo } }),
        onError: (err) => toast.error('Could not delete the answer', { description: errorMessage(err) }),
      },
    );
  };

  return (
    <SectionCard
      id="answers"
      title="Saved answers"
      description="Write answers to common application questions once and reuse them. JScout suggests them when you apply."
      actions={
        answers.length > 0 ? (
          <Button size="sm" leadingIcon={<Plus />} disabled={full} onClick={() => setEditing({ item: newAnswer(), isNew: true })}>
            Add answer
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {answers.length > 3 ? (
          <Input
            aria-label="Search your answers"
            leadingIcon={<Search />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            placeholder="Search your answers"
          />
        ) : null}

        {answers.length === 0 ? (
          <EmptyState
            compact
            bordered
            icon={<MessageSquareText />}
            title="No saved answers yet"
            description="Start with one of the common questions below, or add your own."
            action={
              <Button leadingIcon={<Plus />} onClick={() => setEditing({ item: newAnswer(), isNew: true })}>
                Add answer
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No answers match “{query}”.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
            {shown.map((answer) => (
              <li key={answer.id} className="flex items-start gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{answer.question}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted">{answer.answer}</p>
                  {answer.tags.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {answer.tags.map((tag) => (
                        <Badge key={tag} size="sm">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0">
                  <IconButton size="sm" label={`Edit answer to ${shortQuestion(answer)}`} icon={<Pencil />} onClick={() => setEditing({ item: answer, isNew: false })} />
                  <IconButton size="sm" label={`Delete answer to ${shortQuestion(answer)}`} icon={<Trash2 />} onClick={() => onRemove(answer)} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {suggestions.length > 0 && !full ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">Common questions to start from</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Button
                  key={s.question}
                  size="sm"
                  leadingIcon={<Plus />}
                  className="h-auto min-h-8 py-1 text-left whitespace-normal"
                  onClick={() => setEditing({ item: newAnswer(s.question, s.tags), isNew: true })}
                >
                  {s.question}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {editing ? (
        <EntryDialog<SavedAnswer>
          key={editing.item.id}
          initial={editing.item}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          items={answers}
          toPatch={(next) => ({ answers: next })}
          validate={validateAnswer}
          Form={AnswerForm}
          noun="answer"
          label={shortQuestion}
        />
      ) : null}
    </SectionCard>
  );
}

function AnswerForm({ value, onChange, errors }: EntryFormProps<SavedAnswer>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Question" error={errors.question}>
        <Input value={value.question} onChange={(e) => onChange({ ...value, question: e.target.value })} autoFocus={!value.question} />
      </Field>
      <Field label="Your answer" error={errors.answer} hint="Write it the way you would paste it into a form.">
        <Textarea value={value.answer} onChange={(e) => onChange({ ...value, answer: e.target.value })} autoGrow rows={6} maxRows={16} autoFocus={!!value.question} />
      </Field>
      <Field label="Tags" optional hint="Words that help you find it later, like salary or motivation.">
        <TagInput value={value.tags} onChange={(tags) => onChange({ ...value, tags })} max={20} placeholder="Add a tag" />
      </Field>
    </div>
  );
}
