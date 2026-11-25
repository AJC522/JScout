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
import { escapeRegExp } from '../../lib/text';
import type { JobContext } from './context';
import {
  asSentence,
  firstPersonSummary,
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
  /** Posting skills the user has, most important first. */
  skills: string[];
  /** Other important posting terms the user's background covers ("payments", "patient care"). */
  themes: string[];
  /** Posting skills the user lacks: duties mentioning them are never quoted as a match. */
  missing: string[];
  /** Whether the job's location fits the user's preferences. */
  locationOk: boolean;
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

/** User notes are used verbatim; "mention that X" style instructions keep only X. */
function noteSentences(notes: string): string[] {
  return notes
    .split(/\n+/)
    .map((line) => stripEnd(line).replace(/^(please )?(mention|note|say|add|include|explain) that\s+/i, ''))
    .filter(Boolean)
    .map((line) => asSentence(upperFirst(line)));
}

/** Shorter letters leave out the least important sentences even when they would fit. */
const MAX_PRIORITY: Record<LetterLength, number> = { short: 3, medium: 5, long: Infinity };

function select(all: Sentence[], length: LetterLength): Sentence[] {
  const target = LETTER_TARGET_WORDS[length];
  const keep = new Set(all.filter((s) => s.priority === 0));
  // Greeting and sign-off take a handful of words.
  let total = 6 + [...keep].reduce((n, s) => n + wordCount(s.text), 0);
  const optional = all
    .filter((s) => s.priority > 0 && s.priority <= MAX_PRIORITY[length])
    .sort((a, b) => a.priority - b.priority);
  for (const s of optional) {
    const n = wordCount(s.text);
    if (total + n > target * 1.1) continue;
    keep.add(s);
    total += n;
  }
  return all.filter((s) => keep.has(s));
}

/** Bullets that state a requirement rather than describe the work. */
const REQUIREMENT_BULLET =
  /\b(required|requirements?|must|years?|degree|certifi\w*|licen[cs]\w*|experience|knowledge|familiarity|proficien\w*|ability|skills?|track record|background in|nice to have|bonus|plus)\b/i;

/**
 * Duties from the posting that name the user's strengths and none of the skills they lack,
 * best first. Requirement bullets and bullets with numbers ("5+ years") are skipped: quoting
 * them would read as a claim about the user.
 */
function matchingDuties(job: JobContext, strengths: string[], missing: string[]): Array<{ text: string; names: string[] }> {
  const mentions = (line: string, term: string) =>
    new RegExp(`(^|[^\\p{L}])${escapeRegExp(term)}($|[^\\p{L}])`, 'iu').test(line);
  const duties: Array<{ text: string; names: string[] }> = [];
  for (const line of job.descriptionText.split('\n')) {
    if (!line.startsWith('- ') || /\d/.test(line) || REQUIREMENT_BULLET.test(line)) continue;
    const text = stripEnd(line);
    if (text.split(/\s+/).length < 4 || missing.some((m) => mentions(text, m))) continue;
    const names = strengths.filter((s) => mentions(text, s));
    if (names.length > 0) duties.push({ text: lowerFirst(text), names });
  }
  return duties.sort((a, b) => b.names.length - a.names.length);
}

/** Shared state while the sentence pool for one letter is built. */
interface Draft {
  input: LetterInput;
  /** Skills the user has, else covered themes: what the letter leads with. */
  strengths: string[];
  experience: ExperienceEntry[];
  companyName: string;
  variant: (slot: string, options: readonly string[]) => string;
  add: (section: Section, text: string, priority: number) => void;
}

/** The role, then who the candidate is. */
function addOpening(d: Draft): void {
  const { profile, job, tone } = d.input;
  const work = profile.work;
  const recent = d.experience[0];
  const years = work.yearsExperience;
  const currentTitle = work.currentTitle.trim() || (recent?.current ? recent.title : '');
  const currentCompany = work.currentCompany.trim() || (recent?.current ? recent.company : '');
  const at = currentCompany ? ` at ${currentCompany}` : '';

  d.add('opening', d.variant('open', OPENERS[tone](job.title.trim() || '[Job title]', d.companyName)), 0);
  const currentRole = currentTitle
    ? d.variant('current', [
        `I currently work as ${withArticle(currentTitle)}${at}.`,
        `I'm currently ${withArticle(currentTitle)}${at}.`,
        `Right now I work as ${withArticle(currentTitle)}${at}.`,
      ])
    : undefined;
  const yearsPhrase = years ? `${years} year${years === 1 ? '' : 's'} of professional experience` : undefined;
  const yearsSentence = yearsPhrase && `I have ${yearsPhrase}.`;
  const summary = firstPersonSummary(work.summary);
  if (summary[0]) {
    d.add('opening', summary[0], 0);
    if (summary[1]) d.add('opening', summary[1], 3);
    if (currentRole && !(currentCompany && work.summary.includes(currentCompany))) d.add('opening', currentRole, 2);
    if (yearsSentence && !/\d/.test(work.summary)) d.add('opening', yearsSentence, 3);
  } else if (currentRole) {
    d.add('opening', yearsPhrase ? `${currentRole.slice(0, -1)}, with ${yearsPhrase}.` : currentRole, 0);
  } else if (yearsSentence) {
    d.add('opening', yearsSentence, 0);
  } else if (!recent) {
    d.add('opening', '[A sentence or two about your background and what makes you a fit for this role.]', 0);
  }
}

/** The posting's requirements the user meets, and duties that build on them. */
function addMatch(d: Draft): void {
  const { skills, themes, missing, tone, job } = d.input;
  if (d.strengths.length > 0) {
    d.add('match', d.variant('match', MATCHES[tone](listPhrase(d.strengths.slice(0, 3)), d.companyName)), 0);
  }
  if (skills.length > 3) d.add('background', `I also work with ${listPhrase(skills.slice(3, 6))}.`, 4);
  const extraThemes = skills.length > 0 ? themes.slice(0, 2) : themes.slice(3, 5);
  if (extraThemes.length > 0) {
    const list = listPhrase(extraThemes);
    d.add(
      'match',
      d.variant('themes', [
        `The posting's emphasis on ${list} is familiar ground for me.`,
        `I noticed how much the role involves ${list}, which my background covers.`,
        `My experience also covers ${list}, which the posting returns to more than once.`,
      ]),
      2,
    );
  }
  const [duty, secondDuty] = matchingDuties(job, [...skills, ...themes], missing);
  if (duty) {
    d.add('match', `The work you describe, “${duty.text}”, builds directly on my experience with ${listPhrase(duty.names)}.`, 3);
  }
  if (secondDuty) d.add('match', `Likewise, “${secondDuty.text}” draws on my background in ${listPhrase(secondDuty.names)}.`, 6);
}

/** The most recent role's highlights, earlier roles, education. */
function addExperience(d: Draft): void {
  const [recent, previous, older] = d.experience;
  if (recent) {
    const at = recent.company;
    if (!recent.current) d.add('match', `Most recently, I worked as ${withArticle(recent.title)} at ${at}.`, 1);
    const firstLead = recent.current
      ? [`At ${at}, I`, `In my work at ${at}, I`, `As part of my role at ${at}, I`]
      : [`At ${at}, I`, `During my time at ${at}, I`, `While at ${at}, I`];
    const highlights = relevantHighlights(recent, d.strengths);
    highlights.slice(0, 5).forEach((h, i) => {
      const lead = i === 0 ? d.variant('h0', firstLead) : d.variant(`h${i}`, ['I also', 'Beyond that, I', 'In addition, I']);
      const text = PAST_VERB.test(h)
        ? `${lead} ${lowerFirst(h)}.`
        : `${i === 0 ? `One highlight from ${at}` : 'Another highlight'}: ${asSentence(h)}`;
      d.add('match', text, [1, 2, 5, 6, 7][i]!);
    });
    if (highlights.length === 0 && recent.summary.trim()) {
      const s = stripEnd(splitSentences(recent.summary)[0] ?? '');
      if (PAST_VERB.test(s)) d.add('match', `${d.variant('h0', firstLead)} ${lowerFirst(s)}.`, 1);
      else if (/^(I|My)\b/.test(s)) d.add('match', asSentence(s), 1);
    }
  }
  if (previous) {
    const [h, more] = relevantHighlights(previous, d.strengths).filter((x) => PAST_VERB.test(x));
    const lead = d.variant('previous', ['Before that, I worked as', 'Previously, I worked as', 'Earlier in my career, I worked as']);
    d.add('background', `${lead} ${withArticle(previous.title)} at ${previous.company}${h ? `, where I ${lowerFirst(h)}` : ''}.`, 3);
    if (more) d.add('background', `There, I also ${lowerFirst(more)}.`, 6);
  }
  if (older) d.add('background', `I also spent time as ${withArticle(older.title)} at ${older.company}.`, 6);

  const edu = d.input.profile.education.find((e) => e.school.trim() && (e.degree.trim() || e.field.trim()));
  if (edu) {
    const degree = edu.degree.trim();
    const field = edu.field.trim();
    const school = edu.school.trim();
    d.add('background', degree ? `I hold ${withArticle(degree)}${field ? ` in ${field}` : ''} from ${school}.` : `I studied ${field} at ${school}.`, 4);
  }
  const { skills } = d.input;
  if (skills.length > 0 && recent) {
    const companies = listPhrase([...new Set(d.experience.slice(0, 2).map((e) => e.company))]);
    d.add('background', `In short, I'd bring ${listPhrase(skills.slice(0, 3))}, along with my experience at ${companies}.`, 5);
  }
}

/** Location fit, practicalities, and the closing line. */
function addClosing(d: Draft): void {
  const { profile, job, locationOk, tone } = d.input;
  const work = profile.work;
  const home = profile.personal.location.trim();
  if (locationOk && job.location.remote === 'remote' && profile.preferences.remote.includes('remote')) {
    d.add('closing', `The fully remote setup suits me well${home ? `, and I'm based in ${home}` : ''}.`, 4);
  } else if (locationOk && home && job.location.remote !== 'remote') {
    const arrangement = { hybrid: 'the hybrid arrangement', onsite: 'working on-site', unknown: 'the location' }[job.location.remote];
    d.add('closing', `I'm based in ${home}, so ${arrangement} works well for me.`, 4);
  }
  if (work.requiresSponsorship === false) d.add('closing', "I don't require visa sponsorship.", 6);

  const start = work.earliestStart.trim() ? startPhrase(work.earliestStart) : undefined;
  const notice = stripEnd(work.noticePeriod);
  if (start) d.add('closing', `I'm available to start ${start}.`, 3);
  else if (notice && !/^(none|no|n\/a|0)\b/i.test(notice) && notice.split(/\s+/).length <= 4) {
    d.add('closing', `My notice period is ${lowerFirst(notice)}.`, 3);
  }
  const recent = d.experience[0];
  if (recent) {
    const at = recent.company;
    d.add(
      'closing',
      d.variant('more', [
        `I'd be glad to share more about my work at ${at} in a conversation.`,
        `I'd be happy to walk you through my work at ${at} in more detail.`,
        `I can share more detail about my work at ${at} whenever it's useful.`,
      ]),
      5,
    );
  }
  d.add('closing', d.variant('close', CLOSINGS[tone](d.companyName)), 0);
}

export function templateLetter(input: LetterInput): string {
  const { job, profile, tone } = input;
  const sentences: Sentence[] = [];
  const company = job.company.trim();
  const draft: Draft = {
    input,
    strengths: input.skills.length > 0 ? input.skills : input.themes,
    experience: byRecency(profile.experience),
    companyName: company || '[Company]',
    variant: (slot, options) => pick(options, job.key, `${tone}:${slot}`),
    add: (section, text, priority) => sentences.push({ section, text, priority }),
  };
  addOpening(draft);
  addMatch(draft);
  addExperience(draft);
  for (const note of noteSentences(input.notes ?? '')) draft.add('notes', note, 0);
  addClosing(draft);

  const chosen = select(sentences, input.length);
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
