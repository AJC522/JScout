/**
 * Offline cover letters assembled from the profile and the posting.
 *
 * Every sentence states only facts found in the inputs; the template supplies tone, not
 * content. Each slot has several phrasings, chosen deterministically from the job key so
 * letters for different jobs differ. Optional sentences are added in priority order until
 * the requested length is reached. A [bracketed placeholder] appears only when something
 * essential (the user's name, anything about their background) is missing.
 */
import type { ExperienceEntry, LetterLength, LetterTone, Profile } from '../../../shared/types';
import type { JobContext } from './context';
import {
  asSentence,
  listPhrase,
  lowerFirst,
  pick,
  splitSentences,
  startPhrase,
  stripEnd,
  upperFirst,
  withArticle,
  wordCount,
} from './text';

export const LETTER_TARGET_WORDS: Record<LetterLength, number> = { short: 150, medium: 250, long: 380 };

export interface LetterInput {
  job: JobContext;
  profile: Profile;
  /** Posting requirements the user meets, most important first (matched skills, then covered terms). */
  strengths: string[];
  tone: LetterTone;
  length: LetterLength;
  notes?: string;
}

type Section = 'opening' | 'match' | 'background' | 'notes' | 'closing';

interface Sentence {
  section: Section;
  text: string;
  /** 0 = always included; larger numbers are added later, while there is room. */
  priority: number;
}

/** Résumé bullets that start with a past-tense verb can follow "I …". */
const PAST_VERB =
  /^(\w+ed|built|led|ran|grew|won|drove|made|wrote|took|set|cut|began|brought|taught|sold|kept|held|became|oversaw|spearheaded|shipped|rebuilt|undertook)\b/i;

/** Current roles first, then most recent start date. */
function byRecency(entries: ExperienceEntry[]): ExperienceEntry[] {
  return [...entries]
    .filter((e) => e.title.trim() && e.company.trim())
    .sort((a, b) => Number(b.current) - Number(a.current) || (b.end || b.start).localeCompare(a.end || a.start));
}

/** Highlights that mention a strength first, so the evidence the posting cares about leads. */
function relevantHighlights(entry: ExperienceEntry, strengths: string[]): string[] {
  const score = (h: string) => strengths.filter((s) => h.toLowerCase().includes(s.toLowerCase())).length;
  return entry.highlights
    .map(stripEnd)
    .filter(Boolean)
    .map((h, i) => ({ h, i, n: score(h) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.h);
}

/** The first one or two summary sentences, turned into first person where the form is recognisable. */
function summarySentences(summary: string): string[] {
  const out: string[] = [];
  for (const [i, raw] of splitSentences(summary).slice(0, 2).entries()) {
    const s = stripEnd(raw);
    if (/^(I|I['’](m|ve|d)|My)\b/.test(s)) out.push(asSentence(s));
    else if (i > 0) break;
    else if (/^(over|more than|nearly|almost|\d)/i.test(s)) out.push(asSentence(`I bring ${lowerFirst(s)}`));
    else if (/^\p{L}+ing\b/u.test(s)) out.push(asSentence(`I've been ${lowerFirst(s)}`));
    else out.push(asSentence(`I'm ${withArticle(lowerFirst(s))}`));
  }
  return out;
}

/** User notes are used verbatim; "mention that X" style instructions keep only X. */
function noteSentences(notes: string): string[] {
  return notes
    .split(/\n+/)
    .map((line) => stripEnd(line).replace(/^(please )?(mention|note|say|add|include|explain) that\s+/i, ''))
    .filter(Boolean)
    .map((line) => asSentence(upperFirst(line)));
}

function select(all: Sentence[], target: number): Sentence[] {
  const keep = new Set(all.filter((s) => s.priority === 0));
  // Greeting and sign-off take a handful of words.
  let total = 6 + [...keep].reduce((n, s) => n + wordCount(s.text), 0);
  const optional = all.filter((s) => s.priority > 0).sort((a, b) => a.priority - b.priority);
  for (const s of optional) {
    const n = wordCount(s.text);
    if (total + n > target * 1.1) continue;
    keep.add(s);
    total += n;
  }
  return all.filter((s) => keep.has(s));
}

export function templateLetter(input: LetterInput): string {
  const { job, profile, tone, strengths } = input;
  const variant = (slot: string, options: readonly string[]) => pick(options, job.key, `${tone}:${slot}`);
  const sentences: Sentence[] = [];
  const add = (section: Section, text: string, priority: number) => sentences.push({ section, text, priority });

  const title = job.title.trim() || '[Job title]';
  const company = job.company.trim();
  const companyName = company || '[Company]';
  const work = profile.work;
  const years = work.yearsExperience;
  const experience = byRecency(profile.experience);
  const recent = experience[0];
  const currentTitle = work.currentTitle.trim() || (recent?.current ? recent.title : '');
  const currentCompany = work.currentCompany.trim() || (recent?.current ? recent.company : '');

  // Opening: the role, then who the candidate is.
  add('opening', variant('open', OPENERS[tone](title, companyName)), 0);
  const currentRole = currentTitle
    ? variant('current', [
        `I currently work as ${withArticle(currentTitle)}${currentCompany ? ` at ${currentCompany}` : ''}.`,
        `I'm currently ${withArticle(currentTitle)}${currentCompany ? ` at ${currentCompany}` : ''}.`,
        `Right now I work as ${withArticle(currentTitle)}${currentCompany ? ` at ${currentCompany}` : ''}.`,
      ])
    : undefined;
  const yearsSentence = years ? `I have ${years} year${years === 1 ? '' : 's'} of professional experience.` : undefined;
  const summary = summarySentences(work.summary);
  if (summary[0]) {
    add('opening', summary[0], 0);
    if (summary[1]) add('opening', summary[1], 3);
    if (currentRole && !(currentCompany && work.summary.includes(currentCompany))) add('opening', currentRole, 2);
    if (yearsSentence && !/\d/.test(work.summary)) add('opening', yearsSentence, 3);
  } else if (currentRole) {
    add('opening', years ? `${currentRole.slice(0, -1)}, with ${years} years of professional experience.` : currentRole, 0);
  } else if (yearsSentence) {
    add('opening', yearsSentence, 0);
  } else if (!recent) {
    add('opening', '[A sentence or two about your background and what makes you a fit for this role.]', 0);
  }

  // Requirements the user meets.
  if (strengths.length > 0) add('match', variant('match', MATCHES[tone](listPhrase(strengths.slice(0, 3)), companyName)), 0);
  if (strengths.length > 3) add('background', `I also work with ${listPhrase(strengths.slice(3, 6))}.`, 4);

  // Most recent role and its highlights.
  if (recent) {
    if (!recent.current) add('match', `Most recently, I worked as ${withArticle(recent.title)} at ${recent.company}.`, 1);
    const at = recent.company;
    const highlights = relevantHighlights(recent, strengths);
    const firstLead = recent.current
      ? [`At ${at}, I`, `In my work at ${at}, I`, `As part of my role at ${at}, I`]
      : [`At ${at}, I`, `During my time at ${at}, I`, `While at ${at}, I`];
    const laterLead = ['I also', 'Beyond that, I', 'In addition, I'];
    highlights.slice(0, 3).forEach((h, i) => {
      const verb = PAST_VERB.test(h);
      const lead = i === 0 ? variant('h0', firstLead) : variant(`h${i}`, laterLead);
      const text = verb ? `${lead} ${lowerFirst(h)}.` : `${i === 0 ? `One highlight from ${at}` : 'Another highlight'}: ${asSentence(h)}`;
      add('match', text, i === 0 ? 1 : i === 1 ? 2 : 5);
    });
    if (highlights.length === 0 && recent.summary.trim()) {
      const s = stripEnd(splitSentences(recent.summary)[0] ?? '');
      if (PAST_VERB.test(s)) add('match', `${variant('h0', firstLead)} ${lowerFirst(s)}.`, 1);
      else if (/^(I|My)\b/.test(s)) add('match', asSentence(s), 1);
    }
  }

  // Earlier roles and education.
  const previous = experience[1];
  if (previous) {
    const h = relevantHighlights(previous, strengths).find((x) => PAST_VERB.test(x));
    const lead = variant('previous', ['Before that, I worked as', 'Previously, I worked as', 'Earlier in my career, I worked as']);
    add('background', `${lead} ${withArticle(previous.title)} at ${previous.company}${h ? `, where I ${lowerFirst(h)}` : ''}.`, 3);
  }
  const older = experience[2];
  if (older) add('background', `I also spent time as ${withArticle(older.title)} at ${older.company}.`, 6);
  const edu = profile.education.find((e) => e.school.trim() && (e.degree.trim() || e.field.trim()));
  if (edu) {
    const degree = edu.degree.trim();
    const field = edu.field.trim();
    add(
      'background',
      degree
        ? `I hold ${withArticle(degree)}${field ? ` in ${field}` : ''} from ${edu.school.trim()}.`
        : `I studied ${field} at ${edu.school.trim()}.`,
      4,
    );
  }

  for (const note of noteSentences(input.notes ?? '')) add('notes', note, 0);

  // Close.
  const start = work.earliestStart.trim() ? startPhrase(work.earliestStart) : undefined;
  const notice = stripEnd(work.noticePeriod);
  if (start) add('closing', `I'm available to start ${start}.`, 3);
  else if (notice && !/^(none|no|n\/a|0)\b/i.test(notice) && notice.split(/\s+/).length <= 4) {
    add('closing', `My notice period is ${lowerFirst(notice)}.`, 3);
  }
  add('closing', variant('close', CLOSINGS[tone](companyName)), 0);

  const chosen = select(sentences, LETTER_TARGET_WORDS[input.length]);
  const para = (...sections: Section[]) =>
    chosen
      .filter((s) => sections.includes(s.section))
      .map((s) => s.text)
      .join(' ');
  const body =
    tone === 'concise'
      ? [para('opening'), para('match', 'background'), para('notes'), para('closing')]
      : [para('opening'), para('match'), para('background'), para('notes'), para('closing')];

  const greeting = company ? GREETINGS[tone](company) : 'Dear hiring team,';
  const name = profile.personal.fullName.trim() || '[Your name]';
  return [greeting, ...body.filter(Boolean), `${SIGN_OFFS[tone]}\n${name}`].join('\n\n');
}

type Phrasings = (a: string, b: string) => string[];

const OPENERS: Record<LetterTone, Phrasings> = {
  professional: (title, company) => [
    `I'm applying for the ${title} role at ${company}.`,
    `Please consider me for the ${title} position at ${company}.`,
    `I would like to be considered for the ${title} role at ${company}.`,
  ],
  warm: (title, company) => [
    `I was glad to see the ${title} opening at ${company}, and I'd love to be considered.`,
    `I'm reaching out about the ${title} role at ${company}, and I'd be glad to tell you a little about myself.`,
    `When I came across the ${title} role at ${company}, I knew I wanted to get in touch.`,
  ],
  concise: (title, company) => [
    `I'm applying for the ${title} role at ${company}.`,
    `This is my application for the ${title} position at ${company}.`,
    `I'd like to apply for the ${title} role at ${company}.`,
  ],
  enthusiastic: (title, company) => [
    `I'm excited to apply for the ${title} role at ${company}.`,
    `The ${title} role at ${company} is exactly the kind of work I want to do next, so I'm thrilled to apply.`,
    `As soon as I read the ${title} posting at ${company}, I knew I wanted to apply.`,
  ],
};

const MATCHES: Record<LetterTone, Phrasings> = {
  professional: (list) => [
    `The role calls for ${list}, all of which are part of my skill set.`,
    `Your posting highlights ${list}, and those are skills I bring.`,
    `Several of your requirements line up with my background, including ${list}.`,
  ],
  warm: (list) => [
    `I was especially glad to see ${list} in the posting, since they are a big part of my skill set.`,
    `Reading the posting, I noticed how closely it lines up with my background, including ${list}.`,
    `It was great to see that the role calls for ${list}, because those are skills I bring.`,
  ],
  concise: (list) => [
    `My skills match your requirements, including ${list}.`,
    `I bring ${list}, which the role calls for.`,
    `The role needs ${list}; those are skills I have.`,
  ],
  enthusiastic: (list, company) => [
    `I was excited to see ${list} in the posting, since they are exactly the skills I bring.`,
    `The role calls for ${list}, and I'd be excited to put those skills to work at ${company}.`,
    `Your posting asks for ${list}, and I'm eager to bring those skills to ${company}.`,
  ],
};

const CLOSINGS: Record<LetterTone, (company: string) => string[]> = {
  professional: (company) => [
    `I'd welcome the chance to discuss how I could contribute at ${company}. Thank you for your time and consideration.`,
    `Thank you for considering my application; I'd be glad to talk through my experience in more detail.`,
    `I would appreciate the opportunity to discuss the role further. Thank you for your consideration.`,
  ],
  warm: (company) => [
    `Thank you for reading, and I'd love to talk about how I could help the ${company} team.`,
    `I'd really enjoy the chance to meet and learn more about the team. Thank you for your time.`,
    `Thanks so much for your consideration; I hope we can talk soon.`,
  ],
  concise: () => [
    `I'd welcome a conversation. Thank you for your consideration.`,
    `Thank you for your time; I look forward to hearing from you.`,
    `I'm happy to share more detail whenever suits you. Thank you.`,
  ],
  enthusiastic: (company) => [
    `I'd love the chance to show what I can bring to ${company}. Thank you for considering me!`,
    `I'm eager to talk about what I could contribute, and I hope to hear from you soon. Thank you!`,
    `Thank you for your consideration; I'd be delighted to discuss how I can help ${company} in this role.`,
  ],
};

const GREETINGS: Record<LetterTone, (company: string) => string> = {
  professional: (company) => `Dear ${company} hiring team,`,
  warm: (company) => `Hello ${company} team,`,
  concise: (company) => `Dear ${company} hiring team,`,
  enthusiastic: (company) => `Dear ${company} team,`,
};

const SIGN_OFFS: Record<LetterTone, string> = {
  professional: 'Sincerely,',
  warm: 'Warm regards,',
  concise: 'Regards,',
  enthusiastic: 'Best wishes,',
};
