/**
 * Answers to application questions from the user's saved answer bank: similarity ranking,
 * light adaptation to the current job, and honest outlines when nothing in the bank fits.
 */
import { describeClearance } from '../../../shared/clearance';
import type { Profile, SavedAnswer } from '../../../shared/types';
import { formatSalary } from '../../lib/salary';
import { escapeRegExp, foldText } from '../../lib/text';
import type { JobContext } from './context';
import {
  STOPWORDS,
  firstPersonSummary,
  formatMoney,
  listPhrase,
  lowerFirst,
  startPhrase,
  stripEnd,
  withArticle,
  words,
} from './text';

export type QuestionType =
  | 'why-company'
  | 'why-role'
  | 'about-you'
  | 'strengths'
  | 'weaknesses'
  | 'salary'
  | 'start'
  | 'authorization'
  | 'clearance'
  | 'relocation'
  | 'behavioral'
  | 'other';

/** Checked in order: specific question types before broader ones. */
const QUESTION_PATTERNS: Array<[QuestionType, RegExp]> = [
  ['salary', /\b(salary|compensation|pay expectations?|desired pay|expected pay|rate expectations?|remuneration|pay range)\b/i],
  ['start', /\b(notice period|start date|when can you start|earliest (start|date|availability)|available to start|availability)\b/i],
  ['clearance', /\b(security clearance|clearance|ts\/sci|top secret|polygraph|cleared)\b/i],
  ['authorization', /\b(authori[sz]ed to work|work authori[sz]ation|right to work|visa|sponsorship|work permit|legally (eligible|able) to work)\b/i],
  ['relocation', /\b(relocat\w*|willing to move|commute)\b/i],
  ['weaknesses', /\b(weakness(es)?|areas? (for|of) (improvement|growth|development)|improve on)\b/i],
  ['behavioral', /\b(tell (me|us) about a time|describe a (time|situation)|give (me |us )?an example|share an example|a time when|have you ever)\b/i],
  ['strengths', /\b(strengths?|why should we hire you|what makes you (a good|the right|a strong|a great) (fit|candidate)|superpower)\b/i],
  ['about-you', /\b(tell (me|us) about yourself|introduce yourself|describe yourself|your background|walk (me|us) through your (background|resume|résumé|cv|career))\b/i],
  [
    'why-role',
    /\b(why (this|the) (role|position|job)|why are you (interested in|applying (for|to)) (this|the) (role|position|job)|why do you want this (role|job|position)|what (interests|attracts|excites|draws|appeals to) you about (this|the) (role|position|job|opportunity))\b/i,
  ],
  [
    'why-company',
    /\b(why do you want to (work|join)|why would you like to (work|join)|why (this|our) (company|organi[sz]ation|team)|why us|why .{1,40}\b(here|us)\b|what (interests|attracts|excites|draws|appeals to) you about (us|our|working|joining|the company|this company)|what do you know about (us|our company|the company)|why are you (interested in|applying (to|at)) )/i,
  ],
];

export function classifyQuestion(question: string): QuestionType {
  return QUESTION_PATTERNS.find(([, re]) => re.test(question))?.[0] ?? 'other';
}

/** Words that mean the same thing in application questions, mapped (by stem) to one concept. */
const CONCEPTS: Record<string, string> = {};
for (const [concept, list] of Object.entries({
  company: 'company organization organisation employer firm here us team',
  role: 'role position job opening opportunity',
  want: 'want interest excit attract draw appeal motivat motivation',
  salary: 'salary compensation pay remuneration',
  start: 'start notice availability available',
  strength: 'strength strong',
  weakness: 'weakness weak improvement improv',
  about: 'yourself background',
})) {
  for (const word of list.split(' ')) CONCEPTS[word] = concept;
}

/** Question words are left to classifyQuestion; "us" stays because it means the company. */
const QUESTION_STOPWORDS = new Set([...STOPWORDS].filter((w) => w !== 'us'));

function concepts(text: string): Set<string> {
  return new Set(
    words(text)
      .filter((w) => !QUESTION_STOPWORDS.has(w.norm))
      .map((w) => CONCEPTS[w.stem] ?? CONCEPTS[w.norm] ?? w.stem),
  );
}

/** Similarity of a question to a saved answer: concept overlap, same question type, matching tags. */
export function similarity(question: string, saved: SavedAnswer): number {
  const q = concepts(question);
  const a = concepts(saved.question);
  const shared = [...q].filter((t) => a.has(t)).length;
  let score = q.size > 0 && a.size > 0 ? shared / Math.sqrt(q.size * a.size) : 0;
  const type = classifyQuestion(question);
  if (type !== 'other' && type === classifyQuestion(saved.question)) score += 0.5;
  const tagHits = saved.tags.filter((tag) => [...concepts(tag)].some((t) => q.has(t))).length;
  return score + Math.min(0.5, tagHits * 0.25);
}

export const MAX_RELATED = 5;
const RELATED_MIN = 0.25;
/** Below this the best saved answer is only "related", not reused as the draft. */
const REUSE_MIN = 0.6;

export interface RankedAnswer {
  answer: SavedAnswer;
  score: number;
}

export function rankAnswers(question: string, answers: SavedAnswer[]): RankedAnswer[] {
  return answers
    .map((answer) => ({ answer, score: similarity(question, answer) }))
    .filter((r) => r.score >= RELATED_MIN)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RELATED);
}

const TOKEN = /\{\{?\s*(company|employer|title|role|position|job title)\s*\}\}?|\[(company|employer|title|role|position|job title)\]/gi;

function wholeWord(text: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(text)}(?![\\p{L}\\p{N}])`, 'giu');
}

/**
 * Fill {company}/{title} tokens, and swap the names of another tracked job the answer was
 * evidently written for (its company appears in the text) for the current job's.
 */
export function adaptAnswer(text: string, job: JobContext | undefined, otherJobs: Array<{ company: string; title: string }>): string {
  if (!job) return text;
  let out = text.replace(TOKEN, (match, a?: string, b?: string) => {
    const kind = (a ?? b ?? '').toLowerCase();
    const value = kind === 'company' || kind === 'employer' ? job.company : job.title;
    return value || match;
  });
  if (!job.company) return out;
  for (const other of otherJobs) {
    const name = other.company.trim();
    if (name.length < 3 || foldText(name) === foldText(job.company) || !wholeWord(name).test(out)) continue;
    out = out.replace(wholeWord(name), job.company);
    if (other.title.trim().length >= 3 && job.title) out = out.replace(wholeWord(other.title.trim()), job.title);
  }
  return out;
}

export interface ScaffoldInput {
  question: string;
  job?: JobContext;
  profile: Profile;
  /** Skills worth naming: those the posting asks for that the user has, else the user's top skills. */
  strengths: string[];
}

function currentRole(profile: Profile): string {
  const { currentTitle, currentCompany } = profile.work;
  if (!currentTitle.trim()) return '';
  return `${withArticle(currentTitle.trim())}${currentCompany.trim() ? ` at ${currentCompany.trim()}` : ''}`;
}

function fitLine(input: ScaffoldInput): string {
  const role = currentRole(input.profile);
  if (input.strengths.length === 0) return role ? `In my work as ${role}, [the experience most relevant here].` : '[The skills and experience that match the posting.]';
  return `I bring ${listPhrase(input.strengths.slice(0, 3))}${role ? `, which I use in my work as ${role}` : ''}.`;
}

function identity(profile: Profile): string | undefined {
  const summary = firstPersonSummary(profile.work.summary)[0];
  if (summary) return summary;
  const role = currentRole(profile);
  const years = profile.work.yearsExperience;
  if (role) return `I'm currently ${role}${years ? `, with ${years} years of professional experience` : ''}.`;
  return years ? `I have ${years} years of professional experience.` : undefined;
}

function salaryAnswer(input: ScaffoldInput): string[] {
  const { salaryMin, salaryCurrency } = input.profile.preferences;
  const lines = [
    salaryMin !== null
      ? `I'm looking for a base salary of around ${formatMoney(salaryMin, salaryCurrency)} or more, depending on the full package.`
      : '[Your target range: research the market rate for this role and location first.]',
  ];
  const posted = input.job?.salary;
  if (posted) {
    const top = posted.annualMax ?? posted.annualMin;
    const comparable = !posted.currency || posted.currency === salaryCurrency;
    if (salaryMin !== null && comparable && top !== undefined && top >= salaryMin) {
      lines.push(`The range listed in the posting (${formatSalary(posted)}) is in line with that.`);
    } else {
      lines.push(`[The posting lists ${formatSalary(posted)}; decide whether that works for you before answering.]`);
    }
  }
  return lines;
}

function startAnswer(profile: Profile): string[] {
  const start = profile.work.earliestStart.trim();
  const notice = stripEnd(profile.work.noticePeriod);
  const phrase = start ? startPhrase(start) : undefined;
  const lines = [
    ...(phrase ? [`I can start ${phrase}.`] : start ? [`Earliest start: ${stripEnd(start)}.`] : []),
    ...(notice ? [`My notice period is ${lowerFirst(notice)}.`] : []),
  ];
  return lines.length > 0 ? lines : ['[Your earliest start date and notice period.]'];
}

function authorizationAnswer(profile: Profile): string[] {
  const auth = stripEnd(profile.work.workAuthorization);
  const sponsorship = profile.work.requiresSponsorship;
  return [
    auth ? `Work authorization: ${auth}.` : '[Your work authorization status.]',
    sponsorship === true
      ? 'I will need visa sponsorship.'
      : sponsorship === false
        ? "I don't need visa sponsorship."
        : '[Whether you need visa sponsorship.]',
  ];
}

function clearanceAnswer(profile: Profile): string[] {
  const held = profile.work.clearance;
  if (!held) return ["I don't currently hold a security clearance. [Whether you're eligible for one, e.g. a U.S. citizen willing to undergo a background investigation.]"];
  return held.status === 'active'
    ? [`Yes, I hold an active ${describeClearance(held)} clearance.`, '[Granting agency and investigation date, if they ask.]']
    : [`I previously held a ${describeClearance(held)} clearance; it is currently inactive.`, '[When it lapsed, so they know whether it can be reinstated.]'];
}

function relocationAnswer(profile: Profile): string[] {
  const home = profile.personal.location.trim();
  const relocate = profile.work.willingToRelocate;
  return [
    ...(home ? [`I'm currently based in ${home}.`] : []),
    relocate === true
      ? "I'm open to relocating for the right role."
      : relocate === false
        ? "I'm not planning to relocate."
        : '[Whether you would relocate, and any timing constraints.]',
  ];
}

/** A highlight from the profile that shares words with the question (for STAR answers). */
function matchingHighlight(question: string, profile: Profile): { text: string; company: string } | undefined {
  const q = concepts(question);
  let best: { text: string; company: string; n: number } | undefined;
  for (const e of profile.experience) {
    for (const h of e.highlights) {
      const n = [...concepts(h)].filter((t) => q.has(t)).length;
      if (n > 0 && (!best || n > best.n)) best = { text: stripEnd(h), company: e.company, n };
    }
  }
  return best && { text: best.text, company: best.company };
}

/** An outline in the user's voice, with [brackets] for what only they can supply. */
export function scaffoldAnswer(input: ScaffoldInput): string {
  const { profile, job } = input;
  const company = job?.company || 'the company';
  const title = job?.title || 'this';
  switch (classifyQuestion(input.question)) {
    case 'why-company':
      return [
        `What draws me to ${company}: [one specific thing, such as the product, the mission, or something in the posting].`,
        fitLine(input),
        '[One concrete result from your experience that matters for this role.]',
      ].join('\n\n');
    case 'why-role':
      return [
        `What interests me about the ${title} role: [the part of the work you most want to do, in your own words].`,
        fitLine(input),
        '[What you hope to learn or take on in this role.]',
      ].join('\n\n');
    case 'about-you': {
      const skills = input.strengths.length > 0 ? `My core skills include ${listPhrase(input.strengths.slice(0, 4))}.` : undefined;
      return [
        identity(profile) ?? '[Who you are professionally, in one sentence.]',
        skills ?? '[Two or three skills you are known for.]',
        '[One recent achievement you are proud of.]',
        `[Why you are interested in ${job ? `the ${title} role` : 'this role'}.]`,
      ].join('\n\n');
    }
    case 'strengths': {
      const named = input.strengths.slice(0, 3);
      while (named.length < 3) named.push('[strength]');
      return named.map((s, i) => `${i + 1}. ${s}: [an example where you used it, and the result]`).join('\n');
    }
    case 'weaknesses':
      return [
        '[A real area you are working on, ideally not a core requirement of this role.]',
        '[What you are doing about it: a course, a habit, feedback you asked for.]',
        '[Evidence it is improving.]',
      ].join('\n\n');
    case 'salary':
      return salaryAnswer(input).join(' ');
    case 'start':
      return startAnswer(profile).join(' ');
    case 'authorization':
      return authorizationAnswer(profile).join(' ');
    case 'clearance':
      return clearanceAnswer(profile).join(' ');
    case 'relocation':
      return relocationAnswer(profile).join(' ');
    case 'behavioral': {
      const hint = matchingHighlight(input.question, profile);
      return [
        'Situation: [where you were and what was going on]',
        'Task: [what you were responsible for]',
        'Action: [what you did, step by step; say "I", not "we"]',
        'Result: [the outcome, with a number if you have one]',
        ...(hint ? [`[A highlight from your profile that may fit: "${hint.text}" (${hint.company}).]`] : []),
      ].join('\n');
    }
    case 'other':
      return [
        '[Answer the question directly in your first sentence.]',
        identity(profile) ?? fitLine(input),
        '[Add one specific example from your experience.]',
      ].join('\n\n');
  }
}

/**
 * The bank-mode draft: the best saved answer adapted to this job when it is a close match,
 * otherwise an outline for the question type.
 */
export function bankAnswer(
  ranked: RankedAnswer[],
  input: ScaffoldInput,
  otherJobs: () => Array<{ company: string; title: string }>,
): string {
  const best = ranked[0];
  if (best && best.score >= REUSE_MIN) return adaptAnswer(best.answer.answer, input.job, otherJobs());
  return scaffoldAnswer(input);
}
