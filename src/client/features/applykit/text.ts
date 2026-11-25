/** Pure helpers for the apply kit: word counts, quick-fill grouping and display labels. */
import type { LetterLength, LetterTone, QuickFillField } from '../../../shared/types';

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export const TONE_LABELS: Record<LetterTone, string> = {
  professional: 'Professional',
  warm: 'Warm',
  concise: 'Concise',
  enthusiastic: 'Enthusiastic',
};

export const LENGTH_LABELS: Record<LetterLength, string> = {
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
};

/** Shortcuts for questions most application forms ask. */
export const COMMON_QUESTIONS = [
  'Why do you want to work here?',
  'Why are you a good fit for this role?',
  'Tell us about a project you are proud of.',
  'What are your salary expectations?',
  'When can you start?',
] as const;

export type QuickFillGroup = QuickFillField['group'];

export const QUICK_FILL_GROUP_LABELS: Record<QuickFillGroup, string> = {
  contact: 'Contact',
  links: 'Links',
  work: 'Work',
  education: 'Education',
  other: 'Other',
};

const GROUP_ORDER: QuickFillGroup[] = ['contact', 'links', 'work', 'education', 'other'];

/** Fields grouped in a fixed order, keeping the server's order inside each group and dropping empty groups. */
export function groupQuickFill(fields: readonly QuickFillField[]): Array<{ group: QuickFillGroup; label: string; fields: QuickFillField[] }> {
  return GROUP_ORDER.map((group) => ({
    group,
    label: QUICK_FILL_GROUP_LABELS[group],
    fields: fields.filter((f) => f.group === group),
  })).filter((g) => g.fields.length > 0);
}

/** A short, readable title for a saved document, from the question it answers. */
export function answerTitle(question: string): string {
  const clean = question.trim().replace(/\s+/g, ' ');
  if (!clean) return 'Answer';
  return clean.length > 80 ? `${clean.slice(0, 77).trimEnd()}…` : clean;
}
