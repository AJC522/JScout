/**
 * Deterministic fit analysis of a profile against one posting.
 *
 * Score weights (out of 100):
 *   skills 35   share of the posting's skills the profile has (keyword coverage when it lists none)
 *   keywords 15 weighted share of the posting's important terms the résumé/profile mentions
 *   title 20    exact 1 · synonym 0.9 · related 0.6 · partial 0.4 · none 0
 *   seniority 10, location 12, salary 8   0–1 factors from alignment.ts (unknowns are neutral-ish)
 * minus 5 per possible blocker (at most 20).
 */
import type { FitAnalysis } from '../../../shared/types';
import { foldText } from '../../lib/text';
import { locationAlignment, salaryAlignment, seniorityAlignment, titleAlignment } from './alignment';
import type { JobContext, ProfileContext } from './context';
import { detectFlags } from './flags';
import { type Keyword, extractKeywords } from './keywords';
import { containsPhrase, countPhrase, phraseKey, stemmedText } from './text';

const WEIGHTS = { skills: 35, keywords: 15, title: 20, seniority: 10, location: 12, salary: 8 } as const;
const FLAG_PENALTY = 5;
const MAX_FLAG_PENALTY = 20;
const MAX_SUGGESTIONS = 6;
const MAX_EXTRA_SKILLS = 15;

interface SkillSplit {
  matched: string[];
  missing: string[];
  extra: string[];
}

function splitSkills(job: JobContext, profile: ProfileContext, jobText: string): SkillSplit {
  const mine = new Set(profile.skills.map(foldText));
  const has = (skill: string) => mine.has(foldText(skill)) || containsPhrase(profile.corpus, phraseKey(skill));
  const jobSkills = new Set(job.skills.map(foldText));
  return {
    matched: job.skills.filter(has),
    missing: job.skills.filter((s) => !has(s)),
    extra: profile.skills
      .filter((s) => !jobSkills.has(foldText(s)) && !containsPhrase(jobText, phraseKey(s)))
      .slice(0, MAX_EXTRA_SKILLS),
  };
}

function coverage(keywords: Keyword[]): number {
  const total = keywords.reduce((sum, k) => sum + k.weight, 0);
  return total === 0 ? 0 : keywords.reduce((sum, k) => sum + (k.present ? k.weight : 0), 0) / total;
}

function band(score: number): string {
  if (score >= 75) return 'Strong fit';
  if (score >= 55) return 'Good fit';
  if (score >= 35) return 'Partial fit';
  return 'Weak fit';
}

const TITLE_PHRASE: Record<FitAnalysis['titleAlignment']['kind'], string> = {
  exact: 'the title matches your target',
  synonym: 'the title is the same role as your target',
  related: 'the title is related to your target',
  partial: 'the title partly overlaps your target',
  none: "the title doesn't match your targets",
};

function summarize(score: number, skills: SkillSplit, fit: Pick<FitAnalysis, 'titleAlignment' | 'flags'>, empty: boolean): string {
  if (empty) return `${band(score)} (${score}/100): add your skills or résumé to your profile for a meaningful comparison.`;
  const listed = skills.matched.length + skills.missing.length;
  const parts = [
    listed > 0 ? `you have ${skills.matched.length} of ${listed} listed skills` : 'the posting lists no specific skills',
    TITLE_PHRASE[fit.titleAlignment.kind],
  ];
  const n = fit.flags.length;
  const blockers = n > 0 ? `, but check ${n} possible blocker${n === 1 ? '' : 's'}` : '';
  return `${band(score)} (${score}/100): ${parts.join(' and ')}${blockers}.`;
}

/** Plain first paragraph of the posting (the opening block, at most ~600 characters). */
function openingText(text: string): string {
  const block = text.split(/\n\s*\n/).find((b) => b.trim().length > 40) ?? text;
  return block.slice(0, 600);
}

function suggestions(
  job: JobContext,
  profile: ProfileContext,
  skills: SkillSplit,
  keywords: Keyword[],
  jobText: string,
): string[] {
  const out: string[] = [];
  const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

  if (profile.skills.length === 0 && !profile.resumeText) {
    out.push('Add your skills and résumé to your profile so the comparison reflects your real experience.');
  } else if (!profile.resumeText) {
    out.push('Add your résumé text to your profile so keyword coverage reflects what employers will read.');
  }

  const missing = skills.missing
    .map((s) => ({ s, n: Math.max(1, countPhrase(jobText, phraseKey(s))) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  const yours = profile.resumeText ? 'Your résumé' : 'Your profile';
  for (const { s, n } of missing) {
    out.push(`${yours} doesn't mention ${s}, which the posting lists ${times(n)} — if you have used it, add it to your skills.`);
  }

  if (profile.resumeCorpus) {
    const unlisted = skills.matched.filter((s) => !containsPhrase(profile.resumeCorpus, phraseKey(s))).slice(0, 2);
    if (unlisted.length > 0) {
      const names = unlisted.join(' and ');
      out.push(`${names} ${unlisted.length === 1 ? 'is' : 'are'} in your profile but not your résumé text — if you send that résumé, show where you used ${unlisted.length === 1 ? 'it' : 'them'}.`);
    }
  }

  for (const k of keywords.filter((k) => k.kind !== 'skill' && !k.present && k.weight >= 0.4).slice(0, 2)) {
    out.push(`The posting emphasises “${k.term}”; if that reflects your experience, use the same wording in your résumé.`);
  }

  const opening = stemmedText(openingText(job.descriptionText));
  // Title words ("backend engineer") are in every opening; lead with what the work is about.
  const titleWords = new Set(phraseKey(job.title).split(' '));
  const lead = keywords.find(
    (k) => k.present && containsPhrase(opening, k.key) && !k.key.split(' ').every((t) => titleWords.has(t)),
  );
  if (lead) out.push(`Lead with your ${lead.term} experience; the posting mentions ${lead.term} in its opening paragraph.`);

  return out.slice(0, MAX_SUGGESTIONS);
}

export function analyzeFit(job: JobContext, profile: ProfileContext): FitAnalysis {
  const jobText = stemmedText(`${job.title}\n${job.descriptionText}`);
  const skills = splitSkills(job, profile, jobText);
  const keywords = extractKeywords(job, profile);
  const title = titleAlignment(job.title, profile.profile);
  const seniority = seniorityAlignment(job.seniority, profile.profile);
  const location = locationAlignment(job, profile.profile);
  const salary = salaryAlignment(job.salary, profile.profile);
  const flags = detectFlags(job, profile);

  const empty = profile.skills.length === 0 && !profile.resumeText && profile.profile.experience.length === 0;
  const keywordShare = coverage(keywords);
  const listed = skills.matched.length + skills.missing.length;
  const skillShare = empty ? 0 : listed > 0 ? skills.matched.length / listed : keywordShare;
  const raw =
    WEIGHTS.skills * skillShare +
    WEIGHTS.keywords * (empty ? 0 : keywordShare) +
    WEIGHTS.title * title.factor +
    WEIGHTS.seniority * seniority.factor +
    WEIGHTS.location * location.factor +
    WEIGHTS.salary * salary.factor -
    Math.min(flags.length * FLAG_PENALTY, MAX_FLAG_PENALTY);
  const score = Math.round(Math.min(100, Math.max(0, raw)));

  return {
    score,
    summary: summarize(score, skills, { titleAlignment: title.value, flags }, empty),
    skillsMatched: skills.matched,
    skillsMissing: skills.missing,
    skillsExtra: skills.extra,
    keywords: keywords.map(({ term, present, weight }) => ({ term, present, weight })),
    titleAlignment: title.value,
    seniorityAlignment: seniority.value,
    locationAlignment: location.value,
    salaryAlignment: salary.value,
    suggestions: suggestions(job, profile, skills, keywords, jobText),
    flags,
  };
}
