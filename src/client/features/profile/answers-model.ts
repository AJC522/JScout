/** The answer bank: filtering and the common questions offered as a starting point. */
import type { SavedAnswer } from '../../../shared/types';

export const COMMON_QUESTIONS: ReadonlyArray<{ question: string; tags: string[] }> = [
  { question: 'Tell us about yourself.', tags: ['intro'] },
  { question: 'Why do you want to work here?', tags: ['motivation'] },
  { question: 'Why are you looking for a new role?', tags: ['motivation'] },
  { question: 'What are your salary expectations?', tags: ['salary'] },
  { question: 'Are you legally authorised to work in this country?', tags: ['eligibility'] },
  { question: 'Describe a challenge you faced at work and how you handled it.', tags: ['behavioural'] },
  { question: 'What is your greatest professional achievement?', tags: ['behavioural'] },
  { question: 'How did you hear about this job?', tags: ['other'] },
];

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Answers whose question, answer or tags contain every word of `query`. */
export function filterAnswers(answers: readonly SavedAnswer[], query: string): SavedAnswer[] {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0) return [...answers];
  return answers.filter((a) => {
    const haystack = normalize(`${a.question} ${a.answer} ${a.tags.join(' ')}`);
    return words.every((w) => haystack.includes(w));
  });
}

/** Common questions the user has not answered yet (ignoring case and punctuation). */
export function unansweredCommon(answers: readonly SavedAnswer[]): typeof COMMON_QUESTIONS {
  const have = new Set(answers.map((a) => normalize(a.question)));
  return COMMON_QUESTIONS.filter((q) => !have.has(normalize(q.question)));
}
