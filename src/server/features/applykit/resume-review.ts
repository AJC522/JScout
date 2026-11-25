/**
 * Résumé review: how well the résumé itself (what an employer or applicant tracking system
 * reads) answers one posting, and what to change.
 *
 * Score weights (out of 100, renormalised over the categories that can be assessed):
 *   skills 25        share of the posting's listed skills the résumé names
 *   requirements 25  requirements met (1) or partly met (0.5); "nice to haves" and soft skills count half
 *   keywords 15      weighted share of the posting's other important terms the résumé uses
 *   title 10         résumé job titles vs the posting's title (most recent counts most)
 *   experience 10    years the résumé's dates cover vs the posting's "N+ years"
 *   quality 15       structure and wording checks that hold for any posting
 *
 * Everything is deterministic and honest: recommendations never suggest claiming a skill the
 * résumé and profile don't show; they say to add it only if it is true.
 */
import type {
  BulletReview,
  RequirementCheck,
  ResumeCategoryKey,
  ResumeCheck,
  ResumeRecommendation,
  ResumeReview,
  ResumeScoreCategory,
  TitleMatchKind,
} from '../../../shared/types';
import { extractSkills } from '../../lib/skills';
import { analyzeTitle } from '../../lib/titles';
import { foldText, truncate, uniqueFolded } from '../../lib/text';
import { TITLE_FACTOR, compareTitles } from './alignment';
import type { JobContext, ProfileContext } from './context';
import { requiredYears } from './flags';
import { GENERIC, type Keyword, extractKeywords } from './keywords';
import { EQUIVALENT_EXPERIENCE, type Requirement, degreeLevel, extractRequirements, itemYears, minDegreeLevel } from './requirements';
import { checkBullet, hasMetric, isWeakStart } from './resume-bullets';
import type { ResumeBullet, ResumeDoc } from './resume-doc';
import { STOPWORDS, containsPhrase, listPhrase, nearPhrase, stemmedText, words, phraseKey } from './text';

export const CATEGORY_WEIGHTS: Record<ResumeCategoryKey, number> = {
  skills: 25,
  requirements: 25,
  keywords: 15,
  title: 10,
  experience: 10,
  quality: 15,
};

const CATEGORY_LABELS: Record<ResumeCategoryKey, string> = {
  skills: 'Listed skills',
  requirements: 'Requirements',
  keywords: 'Posting keywords',
  title: 'Job title',
  experience: 'Years of experience',
  quality: 'Résumé basics',
};

const MAX_BULLETS = 40;
const MAX_RECOMMENDATIONS = 14;
const SHORT_DESCRIPTION_CHARS = 200;
/** A bullet must cover this much more of the posting than the first one before moving it up is suggested. */
export const REORDER_GAIN = 0.25;

/** Words in requirement lines that carry no content of their own ("strong", "proficiency", "years"). */
const REQUIREMENT_FILLER = new Set(
  (
    'hands production years year experience proficiency proficient familiarity familiar expertise background level least ' +
    'plus preferred required requirement requirements must nice have ideally bonus similar equivalent field fields related ' +
    'other etc including such like ability able excellent good great solid deep advanced basic strong demonstrated proven ' +
    'track record knowledge understanding working skills skill degree bachelor bachelors master masters certification ' +
    'certifications certified certificate license licence licensed licensure active valid current minimum comparable relevant practical ' +
    'professional combination area areas discipline closely preferably someone ideal candidate industry'
  ).split(' '),
);
const DEGREE_TOKEN = /^(bs|ba|ms|ma|bsc|msc|mba|phd|beng|meng|bsn|msn|mph|aa|as|aas)$/i;
const DEGREE_LABEL = ['', "an associate's degree", "a bachelor's degree", "a master's degree", 'a doctorate'] as const;

// --- facts read from the résumé -----------------------------------------------------------

export interface ResumeFacts {
  /** Years the résumé's dated jobs cover (the profile's figure when the dates can't be read). */
  years: number | null;
  yearsFromProfile: boolean;
  degreeLevel: number;
  /** Job titles, most recent first (the profile's when the résumé's can't be read). */
  titles: string[];
  titlesFromProfile: boolean;
}

export function resumeFacts(doc: ResumeDoc, me: ProfileContext): ResumeFacts {
  const parsedYears = doc.analysis.yearsExperience;
  const profileYears = me.profile.work.yearsExperience;
  const educationLines = doc.entries.filter((e) => e.section === 'education').map((e) => e.text);
  const degree = Math.max(
    0,
    ...doc.analysis.education.map((e) => Math.max(degreeLevel(`${e.degree} degree`), degreeLevel(e.field))),
    ...educationLines.map(degreeLevel),
  );
  const parsedTitles = uniqueFolded(doc.analysis.titles.map((t) => t.title));
  const profileTitles = uniqueFolded([me.profile.work.currentTitle, ...me.profile.experience.map((e) => e.title)].filter((t) => t.trim()));
  return {
    years: parsedYears ?? profileYears,
    yearsFromProfile: parsedYears === null && profileYears !== null,
    degreeLevel: degree,
    titles: parsedTitles.length > 0 ? parsedTitles : profileTitles,
    titlesFromProfile: parsedTitles.length === 0 && profileTitles.length > 0,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const yearsText = (n: number) => plural(Math.floor(n), 'year');

// --- requirements ----------------------------------------------------------------------------

interface Term {
  label: string;
  /** Stem key; '' for terms checked another way (years, degree). */
  key: string;
  weight: number;
  present: boolean;
}

interface CheckedRequirement extends RequirementCheck {
  terms: Term[];
}

function requirementTerms(req: Requirement, doc: ResumeDoc, facts: ResumeFacts): { terms: Term[]; note?: string } {
  const terms: Term[] = [];
  let note: string | undefined;
  // A degree requirement is about the degree; the fields it names ("…or related field") count for less.
  const education = req.kind === 'education';
  const skills = education ? [] : extractSkills(req.text);
  const skillSet = new Set(skills.map(foldText));
  const skillStems = new Set<string>();
  for (const skill of skills) {
    const key = phraseKey(skill);
    for (const stem of key.split(' ')) skillStems.add(stem);
    terms.push({ label: skill, key, weight: 2, present: doc.skillSet.has(foldText(skill)) || containsPhrase(doc.stemmed, key) });
  }
  const years = itemYears(req.text);
  if (years !== undefined) {
    if (facts.years !== null) {
      terms.push({ label: `${years}+ years`, key: '', weight: 2, present: facts.years >= years });
      note = `Your ${facts.yearsFromProfile ? 'profile says' : 'résumé’s dates cover'} about ${yearsText(facts.years)}.`;
    } else {
      note = "JScout couldn't read how many years your résumé covers; give every job a date range.";
    }
  }
  const level = minDegreeLevel(req.text);
  if (level > 0) {
    const has = facts.degreeLevel >= level;
    const softened = EQUIVALENT_EXPERIENCE.test(req.text);
    terms.push({ label: DEGREE_LABEL[level]!.replace(/^an? /, ''), key: '', weight: softened && !has ? 1 : 2, present: has });
    if (!has && softened) note = 'The posting accepts equivalent experience instead of the degree.';
  }
  // "(does not include internships)" or "(e.g. Jira, Asana)": asides count only for the skills they name.
  const content = req.text.replace(/\(([^()]*)\)/g, (_m, inner: string) => (extractSkills(inner).length > 0 && !/\b(not|excluding|except)\b/i.test(inner) ? ` ${inner} ` : ' '));
  const seen = new Set<string>();
  for (const w of words(content)) {
    const acronym = /^\p{Lu}{2,}$/u.test(w.text);
    if ((!acronym && w.norm.length < 3) || /\d/.test(w.norm)) continue;
    if (STOPWORDS.has(w.norm) || GENERIC.has(w.norm) || REQUIREMENT_FILLER.has(w.norm)) continue;
    if (skillStems.has(w.stem) || seen.has(w.stem) || (level > 0 && DEGREE_TOKEN.test(w.norm))) continue;
    // A word that is itself an alias of a skill already counted ("ICU" for Critical Care).
    if (skills.length > 0 && extractSkills(w.text).some((s) => skillSet.has(foldText(s)))) continue;
    seen.add(w.stem);
    const label = acronym || (w.index > 0 && /^\p{Lu}/u.test(w.text)) ? w.text : w.norm;
    terms.push({ label, key: w.stem, weight: education ? 0.5 : 1, present: doc.stemSet.has(w.stem) });
  }
  return { terms, note };
}

/** The résumé line (bullet or other line) that shows most of the requirement's terms. */
function findEvidence(terms: Term[], candidates: Array<{ text: string; stemmed: string }>): string | undefined {
  const keys = terms.filter((t) => t.present && t.key).map((t) => t.key);
  if (keys.length === 0) return undefined;
  let best: string | undefined;
  let bestCount = 0;
  for (const c of candidates) {
    const n = keys.filter((k) => containsPhrase(c.stemmed, k)).length;
    if (n > bestCount) {
      best = c.text;
      bestCount = n;
    }
  }
  return best !== undefined && bestCount >= Math.min(2, keys.length) ? truncate(best, 180) : undefined;
}

function checkRequirements(requirements: Requirement[], doc: ResumeDoc, facts: ResumeFacts): CheckedRequirement[] {
  const candidates = [
    ...doc.bullets.map((b) => ({ text: b.text, stemmed: b.stemmed })),
    ...doc.entries.filter((e) => !e.heading && !e.bullet).map((e) => ({ text: e.text, stemmed: stemmedText(e.text) })),
  ];
  const out: CheckedRequirement[] = [];
  for (const req of requirements) {
    const { terms, note } = requirementTerms(req, doc, facts);
    const total = terms.reduce((s, t) => s + t.weight, 0);
    if (total === 0) continue;
    const share = terms.reduce((s, t) => s + (t.present ? t.weight : 0), 0) / total;
    const skillShown = terms.some((t) => t.weight === 2 && t.key !== '' && t.present);
    const status = share >= 0.7 ? 'met' : share >= 0.2 || skillShown ? 'partial' : 'missing';
    const evidence = status === 'missing' ? undefined : findEvidence(terms, candidates);
    out.push({
      text: req.text,
      level: req.level,
      kind: req.kind,
      status,
      matched: terms.filter((t) => t.present).map((t) => t.label).slice(0, 6),
      missing: terms.filter((t) => !t.present).map((t) => t.label).slice(0, 6),
      ...(evidence ? { evidence } : {}),
      ...(note ? { note } : {}),
      terms,
    });
  }
  return out;
}

const requirementWeight = (r: RequirementCheck) => (r.level === 'preferred' ? 0.5 : 1) * (r.kind === 'soft' ? 0.5 : 1);
const STATUS_VALUE = { met: 1, partial: 0.5, missing: 0 } as const;

// --- quality checks ----------------------------------------------------------------------------

const CHECK_POINTS = {
  email: 10,
  phone: 5,
  experience: 12,
  dates: 12,
  skills: 10,
  education: 5,
  summary: 4,
  bullets: 10,
  numbers: 12,
  verbs: 10,
  length: 5,
  voice: 5,
} as const;

const MIN_WORDS = 250;
const MAX_WORDS = 1100;

function qualityChecks(doc: ResumeDoc): { checks: ResumeCheck[]; score: number } {
  const bullets = doc.bullets;
  const withNumbers = bullets.filter((b) => hasMetric(b.text)).length;
  const weak = bullets.filter((b) => isWeakStart(b.text)).length;
  const firstPerson = bullets.filter((b) => checkBullet(b.text).issues.includes('first-person')).length;
  const { contact } = doc.analysis;
  const checks: Array<ResumeCheck & { points: number }> = [
    {
      key: 'email',
      label: 'Email address',
      ok: Boolean(contact.email),
      detail: contact.email ? `Found ${contact.email}.` : 'No email address was found near the top.',
      points: CHECK_POINTS.email,
    },
    {
      key: 'phone',
      label: 'Phone number',
      ok: Boolean(contact.phone),
      detail: contact.phone ? `Found ${contact.phone}.` : 'No phone number was found near the top.',
      points: CHECK_POINTS.phone,
    },
    {
      key: 'experience',
      label: 'Experience section',
      ok: doc.sections.has('experience'),
      detail: doc.sections.has('experience') ? 'Has a clearly headed experience section.' : 'No heading such as “Experience” or “Work history” was found.',
      points: CHECK_POINTS.experience,
    },
    {
      key: 'dates',
      label: 'Readable job dates',
      ok: doc.analysis.experience.length > 0,
      detail:
        doc.analysis.experience.length > 0
          ? `Read ${plural(doc.analysis.experience.length, 'dated job')}${doc.analysis.yearsExperience !== null ? `, about ${yearsText(doc.analysis.yearsExperience)} in all` : ''}.`
          : 'No jobs with date ranges (like “Mar 2021 – Present”) could be read.',
      points: CHECK_POINTS.dates,
    },
    {
      key: 'skills',
      label: 'Skills section',
      ok: doc.sections.has('skills'),
      detail: doc.sections.has('skills') ? 'Has a skills section.' : 'No skills section was found.',
      points: CHECK_POINTS.skills,
    },
    {
      key: 'education',
      label: 'Education section',
      ok: doc.sections.has('education'),
      detail: doc.sections.has('education') ? 'Has an education section.' : 'No education section was found.',
      points: CHECK_POINTS.education,
    },
    {
      key: 'summary',
      label: 'Summary',
      ok: doc.sections.has('summary'),
      detail: doc.sections.has('summary') ? 'Opens with a summary.' : 'No summary or profile section at the top.',
      points: CHECK_POINTS.summary,
    },
    {
      key: 'bullets',
      label: 'Bullet points',
      ok: bullets.length >= 3,
      detail: bullets.length >= 3 ? `${plural(bullets.length, 'bullet')} describe your work.` : 'Few or no bullet points describe your work.',
      points: CHECK_POINTS.bullets,
    },
    {
      key: 'numbers',
      label: 'Results in numbers',
      ok: bullets.length > 0 && withNumbers / bullets.length >= 0.4,
      detail: bullets.length > 0 ? `${withNumbers} of ${plural(bullets.length, 'bullet')} include a number.` : 'No bullets to check.',
      points: CHECK_POINTS.numbers,
    },
    {
      key: 'verbs',
      label: 'Action verbs',
      ok: bullets.length > 0 && weak / bullets.length <= 0.2,
      detail: weak > 0 ? `${plural(weak, 'bullet')} start${weak === 1 ? 's' : ''} with phrases like “Responsible for” or “Helped”.` : 'Bullets start with action verbs.',
      points: CHECK_POINTS.verbs,
    },
    {
      key: 'length',
      label: 'Length',
      ok: doc.words >= MIN_WORDS && doc.words <= MAX_WORDS,
      detail:
        doc.words < MIN_WORDS
          ? `${plural(doc.words, 'word')}: on the short side; most résumés run 400–800 words.`
          : doc.words > MAX_WORDS
            ? `${plural(doc.words, 'word')}: long; consider cutting older or less relevant detail.`
            : `${plural(doc.words, 'word')}.`,
      points: CHECK_POINTS.length,
    },
    {
      key: 'voice',
      label: 'No first person',
      ok: firstPerson === 0,
      detail: firstPerson === 0 ? 'Bullets avoid “I” and “my”.' : `${plural(firstPerson, 'bullet')} use${firstPerson === 1 ? 's' : ''} “I”, “my” or “me”.`,
      points: CHECK_POINTS.voice,
    },
  ];
  const total = checks.reduce((s, c) => s + c.points, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.points : 0), 0);
  return { checks: checks.map(({ points: _points, ...c }) => c), score: Math.round((got / total) * 100) };
}

// --- title -----------------------------------------------------------------------------------

const TITLE_DETAIL: Record<TitleMatchKind, string> = {
  exact: 'matches',
  synonym: 'is the same role as',
  related: 'is related to',
  partial: 'partly overlaps',
  none: "doesn't match",
};

function titleMatch(jobTitle: string, facts: ResumeFacts): { score: number; detail: string; kind: TitleMatchKind; title: string } | undefined {
  if (facts.titles.length === 0) return undefined;
  const job = analyzeTitle(jobTitle);
  let best = { factor: -1, kind: 'none' as TitleMatchKind, title: facts.titles[0]!, index: 0 };
  for (const [index, title] of facts.titles.slice(0, 5).entries()) {
    const kind = compareTitles(job, analyzeTitle(title));
    const factor = TITLE_FACTOR[kind] * (index === 0 ? 1 : 0.85);
    if (factor > best.factor) best = { factor, kind, title, index };
  }
  const whose = best.index === 0 ? 'Your most recent title' : 'Your earlier title';
  const source = facts.titlesFromProfile ? ' (from your profile: your résumé’s job titles couldn’t be read)' : '';
  return {
    score: Math.round(best.factor * 100),
    kind: best.kind,
    title: best.title,
    detail: `${whose} “${best.title}” ${TITLE_DETAIL[best.kind]} “${jobTitle}”${source}.`,
  };
}

// --- bullets -----------------------------------------------------------------------------------

export interface BulletInsight {
  bullet: ResumeBullet;
  review: BulletReview;
}

function reviewBullets(doc: ResumeDoc, keywords: Keyword[]): BulletInsight[] {
  const useful = keywords.filter((k) => k.weight >= 0.15);
  return doc.bullets.map((bullet) => {
    const stems = bullet.stemmed.trim().split(' ');
    const covers = useful.filter((k) => containsPhrase(bullet.stemmed, k.key) || (k.kind === 'phrase' && nearPhrase(stems, k.key, 4)));
    const weight = covers.reduce((s, k) => s + k.weight, 0);
    const { issues, rewrite } = checkBullet(bullet.text);
    return {
      bullet,
      review: {
        text: bullet.text,
        context: truncate(bullet.context, 90),
        relevance: Math.round(Math.min(1, weight / 1.5) * 100) / 100,
        covers: covers.map((k) => k.term).slice(0, 6),
        issues,
        ...(rewrite ? { rewrite } : {}),
      },
    };
  });
}

/** Runs of bullets under the same job, in résumé order. */
export function bulletGroups(insights: BulletInsight[]): BulletInsight[][] {
  const groups: BulletInsight[][] = [];
  for (const insight of insights) {
    const last = groups.at(-1);
    const prev = last?.at(-1);
    if (last && prev && prev.bullet.context === insight.bullet.context && prev.bullet.section === insight.bullet.section) last.push(insight);
    else groups.push([insight]);
  }
  return groups;
}

// --- summary line ------------------------------------------------------------------------------

/** A factual summary: the profile's own summary, or "<title> with N+ years of experience in <strengths>." */
export function draftSummary(facts: ResumeFacts, me: ProfileContext, strengths: string[]): string | undefined {
  const own = me.profile.work.summary.trim();
  if (own) return own;
  const title = facts.titles[0];
  if (!title) return undefined;
  const years = facts.years !== null && facts.years >= 1 ? `${Math.floor(facts.years)}+ years of experience` : 'experience';
  const list = listPhrase(strengths.slice(0, 3));
  return `${title} with ${years}${list ? ` in ${list}` : ''}.`;
}

// --- the review ----------------------------------------------------------------------------------

export interface ResumeAnalysisDetail {
  review: ResumeReview;
  facts: ResumeFacts;
  keywords: Keyword[];
  bullets: BulletInsight[];
  /** Posting skills the résumé already names (canonical spelling). */
  skillsMatched: string[];
}

function band(score: number): string {
  if (score >= 80) return 'Strong match';
  if (score >= 65) return 'Good match';
  if (score >= 45) return 'Fair match';
  return 'Needs work';
}

export function analyzeResume(job: JobContext, doc: ResumeDoc, me: ProfileContext, opts: { source: 'saved' | 'draft' }): ResumeAnalysisDetail {
  const facts = resumeFacts(doc, me);
  const resumeCtx: ProfileContext = {
    profile: me.profile,
    skills: doc.skills,
    resumeText: doc.text,
    corpus: doc.stemmed,
    corpusStems: doc.stems,
    resumeCorpus: doc.stemmed,
  };
  const keywords = extractKeywords(job, resumeCtx);
  const requirements = checkRequirements(extractRequirements(job.descriptionText), doc, facts);
  const quality = qualityChecks(doc);
  const bullets = reviewBullets(doc, keywords);

  // Skills.
  const shows = (skill: string) => doc.skillSet.has(foldText(skill)) || containsPhrase(doc.stemmed, phraseKey(skill));
  const skillsMatched = job.skills.filter(shows);
  const skillsMissing = job.skills.filter((s) => !shows(s));
  const profileSkills = new Set(me.skills.map(foldText));
  const skillsInProfileOnly = skillsMissing.filter((s) => profileSkills.has(foldText(s)));

  // Keywords other than the listed skills.
  const others = keywords.filter((k) => k.kind !== 'skill');
  const otherTotal = others.reduce((s, k) => s + k.weight, 0);
  const keywordShare = otherTotal > 0 ? others.reduce((s, k) => s + (k.present ? k.weight : 0), 0) / otherTotal : null;

  const reqTotal = requirements.reduce((s, r) => s + requirementWeight(r), 0);
  const reqShare = reqTotal > 0 ? requirements.reduce((s, r) => s + requirementWeight(r) * STATUS_VALUE[r.status], 0) / reqTotal : null;
  const required = requirements.filter((r) => r.level === 'required');
  const requiredMet = required.filter((r) => r.status === 'met').length;

  const title = titleMatch(job.title, facts);
  const neededYears = requiredYears(job.descriptionText);
  let experience: { score: number | null; detail: string };
  if (neededYears === undefined) experience = { score: null, detail: "The posting doesn't ask for a number of years." };
  else if (facts.years === null) experience = { score: 50, detail: `The posting asks for ${neededYears}+ years; JScout couldn't read your résumé's dates.` };
  else {
    const gap = neededYears - facts.years;
    const score = gap <= 0 ? 100 : gap <= 1 ? 70 : gap <= 2 ? 45 : 15;
    const whose = facts.yearsFromProfile ? 'your profile says' : 'your résumé covers about';
    experience = { score, detail: `The posting asks for ${neededYears}+ years; ${whose} ${yearsText(facts.years)}.` };
  }

  const categories: ResumeScoreCategory[] = [
    {
      key: 'skills',
      score: job.skills.length > 0 ? Math.round((skillsMatched.length / job.skills.length) * 100) : null,
      detail:
        job.skills.length > 0
          ? `Shows ${skillsMatched.length} of the ${plural(job.skills.length, 'skill')} the posting lists.`
          : 'The posting names no specific skills.',
    },
    {
      key: 'requirements',
      score: reqShare === null ? null : Math.round(reqShare * 100),
      detail:
        requirements.length > 0
          ? `${requiredMet} of ${plural(required.length, 'requirement')} clearly met${requirements.length > required.length ? `, plus ${requirements.filter((r) => r.level === 'preferred' && r.status === 'met').length} of ${requirements.length - required.length} nice-to-haves` : ''}.`
          : 'No requirements list was found in the posting.',
    },
    {
      key: 'keywords',
      score: keywordShare === null ? null : Math.round(keywordShare * 100),
      detail:
        keywordShare === null
          ? 'The posting has too little text to pick out keywords.'
          : `Uses ${others.filter((k) => k.present).length} of the posting's ${plural(others.length, 'other important term')}.`,
    },
    {
      key: 'title',
      score: title?.score ?? null,
      detail: title?.detail ?? 'No job titles could be read from your résumé or profile.',
    },
    { key: 'experience', ...experience },
    { key: 'quality', score: quality.score, detail: `${quality.checks.filter((c) => c.ok).length} of ${quality.checks.length} basics in place.` },
  ].map((c) => ({ ...c, key: c.key as ResumeCategoryKey, label: CATEGORY_LABELS[c.key as ResumeCategoryKey], weight: CATEGORY_WEIGHTS[c.key as ResumeCategoryKey] }));

  const assessed = categories.filter((c) => c.score !== null);
  const weightSum = assessed.reduce((s, c) => s + c.weight, 0);
  const score = weightSum > 0 ? Math.round(assessed.reduce((s, c) => s + c.weight * c.score!, 0) / weightSum) : 0;

  const warnings: string[] = [];
  if (job.descriptionText.trim().length < SHORT_DESCRIPTION_CHARS) {
    warnings.push('The posting has little or no description, so this review rests on its title and listed skills.');
  }
  warnings.push(...doc.analysis.warnings.filter((w) => !/experience section|jobs with date ranges/i.test(w)));

  // What the résumé demonstrably shares with the posting: listed skills, then multi-word terms and names.
  const strengths = uniqueFolded([...skillsMatched, ...others.filter((k) => k.present && k.weight >= 0.4 && k.kind !== 'word').map((k) => k.term)]);
  const recommendations = recommend({
    job,
    doc,
    me,
    facts,
    requirements,
    skillsInProfileOnly,
    skillsMissing,
    keywords,
    title,
    neededYears,
    bullets,
    checks: quality.checks,
    strengths,
  });

  const listed = job.skills.length > 0 ? ` and ${skillsMatched.length} of ${job.skills.length} listed skills` : '';
  const reqPart = required.length > 0 ? `shows ${requiredMet} of ${required.length} requirements${listed}` : `shows ${skillsMatched.length} of ${job.skills.length} listed skills`;
  const top = recommendations[0];
  const summary =
    job.skills.length === 0 && required.length === 0
      ? `${band(score)} (${score}/100) for ${job.title}.${top ? ` Start with: ${top.title.replace(/\.$/, '')}.` : ''}`
      : `${band(score)} (${score}/100): your résumé ${reqPart}.${top ? ` Start with: ${top.title.replace(/\.$/, '')}.` : ''}`;

  const review: ResumeReview = {
    score,
    band: band(score),
    summary,
    job: { title: job.title, company: job.company },
    source: opts.source,
    categories,
    requirements: requirements.map(({ terms: _terms, ...r }) => r),
    skillsMatched,
    skillsMissing,
    skillsInProfileOnly,
    keywords: keywords.map(({ term, present, weight }) => ({ term, present, weight })),
    recommendations,
    bullets: bullets.slice(0, MAX_BULLETS).map((b) => b.review),
    checks: quality.checks,
    stats: {
      words: doc.words,
      bullets: doc.bullets.length,
      bulletsWithNumbers: doc.bullets.filter((b) => hasMetric(b.text)).length,
      yearsExperience: facts.years,
    },
    warnings,
  };
  return { review, facts, keywords, bullets, skillsMatched };
}

export function reviewResume(job: JobContext, doc: ResumeDoc, me: ProfileContext, opts: { source: 'saved' | 'draft' }): ResumeReview {
  return analyzeResume(job, doc, me, opts).review;
}

// --- recommendations ------------------------------------------------------------------------------

interface RecommendInput {
  job: JobContext;
  doc: ResumeDoc;
  me: ProfileContext;
  facts: ResumeFacts;
  requirements: CheckedRequirement[];
  skillsInProfileOnly: string[];
  skillsMissing: string[];
  keywords: Keyword[];
  title: ReturnType<typeof titleMatch>;
  neededYears: number | undefined;
  bullets: BulletInsight[];
  checks: ResumeCheck[];
  strengths: string[];
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function recommend(input: RecommendInput): ResumeRecommendation[] {
  const { job, doc, me, facts, requirements, keywords, bullets, checks } = input;
  const out: ResumeRecommendation[] = [];
  const failed = (key: string) => checks.find((c) => c.key === key)?.ok === false;
  const addedSkills = new Set(input.skillsInProfileOnly.map(foldText));

  // Contact and structure: if these are missing, nothing else gets read.
  if (failed('email') || failed('phone')) {
    const missing = [failed('email') && 'an email address', failed('phone') && 'a phone number'].filter(Boolean) as string[];
    out.push({
      id: 'contact',
      priority: 'high',
      area: 'contact',
      title: `Add ${listPhrase(missing)} at the top`,
      detail: 'Recruiters and applicant tracking systems look for contact details in the first lines of a résumé.',
    });
  }
  if (failed('experience')) {
    out.push({
      id: 'structure',
      priority: 'high',
      area: 'format',
      title: 'Put your jobs under a clear “Experience” heading',
      detail: 'Applicant tracking systems find jobs by standard headings such as “Experience”, “Education” and “Skills”. Unusual or missing headings can leave your experience unread.',
    });
  }

  // Skills the profile lists but the résumé doesn't show.
  if (input.skillsInProfileOnly.length > 0) {
    const names = input.skillsInProfileOnly.slice(0, 5);
    out.push({
      id: `add-skills:${names.map(foldText).join(',')}`,
      priority: 'high',
      area: 'skills',
      title: `Add ${listPhrase(names)} to your résumé`,
      detail: `The posting asks for ${names.length === 1 ? 'it' : 'them'} and your profile lists ${names.length === 1 ? 'it' : 'them'}, but your résumé doesn't mention ${names.length === 1 ? 'it' : 'them'}. Name ${names.length === 1 ? 'it' : 'them'} in your skills section and, better still, in a bullet that shows where you used ${names.length === 1 ? 'it' : 'them'}.`,
    });
  }

  // Requirements that aren't shown.
  const gaps = requirements
    .filter((r) => r.level === 'required' && r.status !== 'met' && r.kind !== 'soft' && r.kind !== 'experience' && r.kind !== 'education')
    // Skip requirements whose only gap is a skill the "add skills" recommendation already covers.
    .filter((r) => r.terms.some((t) => !t.present && !(t.weight === 2 && t.key !== '' && addedSkills.has(foldText(t.label)))))
    .sort((a, b) => STATUS_VALUE[a.status] - STATUS_VALUE[b.status]);
  const named = new Set<string>();
  for (const r of gaps.slice(0, 3)) {
    for (const m of r.missing) named.add(phraseKey(m));
    const missing = r.missing.filter((m) => !addedSkills.has(foldText(m)));
    out.push({
      id: `requirement:${foldText(r.text).slice(0, 60)}`,
      priority: r.status === 'missing' ? 'high' : 'medium',
      area: 'requirements',
      title: r.status === 'missing' ? `Show “${truncate(r.text, 70)}”` : `Make “${truncate(r.text, 70)}” clearer`,
      detail:
        r.status === 'missing'
          ? "The posting requires this and your résumé doesn't show it. If you have this experience, add a bullet that says what you did and what came of it. If you don't, don't claim it: address the gap in your cover letter and lead with your strongest related experience."
          : `Your résumé shows ${listPhrase(r.matched.slice(0, 3))}${missing.length > 0 ? ` but not ${listPhrase(missing.slice(0, 3))}` : ''}. If that part is true of your work, say so in the bullet where it happened.`,
      ...(r.evidence ? { before: r.evidence } : {}),
    });
  }

  // Years of experience.
  if (input.neededYears !== undefined) {
    if (facts.years === null || failed('dates')) {
      out.push({
        id: 'dates',
        priority: 'high',
        area: 'experience',
        title: 'Give every job a date range',
        detail: `The posting asks for ${input.neededYears}+ years of experience. Write dates like “Mar 2021 – Present” on each job's line so employers and applicant tracking systems can count your years.`,
      });
    } else if (facts.years < input.neededYears) {
      out.push({
        id: 'years',
        priority: facts.years + 2 <= input.neededYears ? 'high' : 'medium',
        area: 'experience',
        title: `Account for the ${input.neededYears}+ years the posting asks for`,
        detail: `Your ${facts.yearsFromProfile ? 'profile says' : 'résumé’s dates cover'} about ${yearsText(facts.years)}. If you have relevant experience that isn't listed (freelance work, internships, earlier roles), add it with dates; otherwise lead with the results that show you work at this level.`,
      });
    }
  } else if (failed('dates')) {
    out.push({
      id: 'dates',
      priority: 'medium',
      area: 'experience',
      title: 'Give every job a date range',
      detail: 'No dated jobs could be read. Write dates like “Mar 2021 – Present” on each job’s line so your experience can be counted.',
    });
  }

  // Education.
  const degreeGap = requirements.find((r) => r.kind === 'education' && r.level === 'required' && r.status === 'missing');
  if (degreeGap) {
    out.push({
      id: 'education',
      priority: 'medium',
      area: 'requirements',
      title: `Check the education requirement: “${truncate(degreeGap.text, 70)}”`,
      detail: doc.sections.has('education')
        ? "Your education section doesn't show this degree. If you hold it, write the degree name in full (for example “Bachelor of Science in Computer Science”)."
        : 'Your résumé has no education section. If you hold this degree, add an “Education” section that names it in full.',
    });
  }

  // Keywords.
  // Terms already named by a requirement above aren't repeated, nor terms that share a word ("critically ill", "ill adults").
  const missingTerms: Keyword[] = [];
  for (const k of keywords) {
    if (k.kind === 'skill' || k.present || k.weight < 0.35 || missingTerms.length >= 4) continue;
    if ([...named].some((n) => n === k.key || ` ${k.key} `.includes(` ${n} `))) continue;
    const stems = k.key.split(' ');
    if (missingTerms.some((m) => m.key.split(' ').some((x) => stems.includes(x)))) continue;
    missingTerms.push(k);
  }
  if (missingTerms.length > 0) {
    out.push({
      id: 'keywords',
      priority: 'medium',
      area: 'keywords',
      title: `Use the posting's own words where they're true: ${listPhrase(missingTerms.map((k) => `“${k.term}”`))}`,
      detail: 'Applicant tracking systems and recruiters scan for the posting’s vocabulary. Where these describe work you have done, use the same words in your bullets or summary rather than a synonym.',
    });
  }

  // Title.
  const title = input.title;
  if (title && (title.kind === 'related' || title.kind === 'partial' || title.kind === 'none' || title.kind === 'synonym')) {
    const jobInfo = analyzeTitle(job.title);
    const mineCore = analyzeTitle(title.title).core;
    if (jobInfo.core && jobInfo.core !== mineCore) {
      // A short role name makes a usable example; a long posting title ("…, Developer & End-user Platform") does not.
      const role = jobInfo.role?.title ?? (jobInfo.core.split(' ').length <= 4 ? upperWords(jobInfo.core) : undefined);
      const example = role && foldText(role) !== foldText(title.title) ? ` (for example “${role} with …”)` : '';
      out.push({
        id: 'title',
        priority: title.kind === 'none' ? 'medium' : 'low',
        area: 'title',
        title: `Echo the posting's job title in your summary if it fits`,
        detail: `${title.detail} Keep your real job titles as they were, but if the work matches, use the posting's wording in a headline or summary line${example}.`,
      });
    }
  }

  // Summary and skills sections.
  if (failed('summary')) {
    const example = draftSummary(facts, me, input.strengths);
    out.push({
      id: 'summary',
      priority: 'medium',
      area: 'summary',
      title: 'Open with a two- or three-line summary aimed at this job',
      detail: 'A short summary under your name tells the reader in seconds which role you are after and why you fit. Name the role and your strongest matching skills.',
      ...(example ? { after: example } : {}),
    });
  }
  if (failed('skills')) {
    const list = uniqueFolded([...input.strengths.filter((s) => doc.skillSet.has(foldText(s))), ...input.skillsInProfileOnly, ...doc.skills]).slice(0, 12);
    out.push({
      id: 'skills-section',
      priority: 'medium',
      area: 'format',
      title: 'Add a “Skills” section',
      detail: 'Applicant tracking systems look for a skills section to match against the posting. List the tools and skills you actually use, most relevant first.',
      ...(list.length > 0 ? { after: `Skills: ${list.join(', ')}` } : {}),
    });
  }

  // Bullet order.
  let reorders = 0;
  for (const group of bulletGroups(bullets)) {
    if (group.length < 2 || reorders >= 2) continue;
    const best = group.reduce((a, b) => (b.review.relevance > a.review.relevance ? b : a));
    if (best !== group[0] && best.review.relevance - group[0]!.review.relevance >= REORDER_GAIN) {
      reorders++;
      out.push({
        id: `reorder:${foldText(best.bullet.context).slice(0, 40)}`,
        priority: 'medium',
        area: 'bullets',
        title: `Lead with your most relevant bullet${best.bullet.context ? ` under “${truncate(best.bullet.context, 60)}”` : ''}`,
        detail: `This bullet shows more of what the posting asks for (${listPhrase(best.review.covers.slice(0, 3))}) than the one you open with. Readers skim the first bullet of each job.`,
        before: group[0]!.review.text,
        after: best.review.text,
      });
    }
  }

  // Weak openers.
  const weak = bullets.filter((b) => b.review.issues.includes('weak-start'));
  if (weak.length > 0) {
    const example = weak.find((b) => b.review.rewrite) ?? weak[0]!;
    out.push({
      id: 'weak-openers',
      priority: weak.length >= 3 ? 'medium' : 'low',
      area: 'bullets',
      title: `Start ${weak.length === 1 ? 'a bullet' : `${weak.length} bullets`} with an action verb`,
      detail: '“Responsible for”, “Helped” and “Worked on” describe duties. A verb such as “Led”, “Built”, “Reduced” or “Launched” describes what you did.',
      before: example.review.text,
      ...(example.review.rewrite ? { after: example.review.rewrite } : {}),
    });
  }

  // Numbers.
  const unquantified = bullets.filter((b) => b.review.issues.includes('no-metric'));
  if (bullets.length > 0 && unquantified.length / bullets.length > 0.5) {
    const example = [...unquantified].sort((a, b) => b.review.relevance - a.review.relevance)[0]!;
    out.push({
      id: 'numbers',
      priority: 'low',
      area: 'bullets',
      title: 'Add numbers to more of your bullets',
      detail: `${unquantified.length} of ${plural(bullets.length, 'bullet')} have no number. Where you can, add the result: how much, how many, how fast, or what it saved. Only use figures you can stand behind.`,
      before: example.review.text,
      after: `${example.review.rewrite ?? example.review.text.replace(/[.;\s]+$/, '')}, [result: e.g. “cutting X by 30%” or “for 200 customers”]`,
    });
  }

  // Preferred qualifications the résumé could show.
  const preferred = requirements.filter((r) => r.level === 'preferred' && r.status !== 'met').slice(0, 3);
  if (preferred.length > 0) {
    out.push({
      id: 'nice-to-haves',
      priority: 'low',
      area: 'requirements',
      title: `Nice to have: ${listPhrase(preferred.map((r) => `“${truncate(r.text, 50)}”`))}`,
      detail: "These aren't required, but if you have any of them, a mention can set you apart from other applicants.",
    });
  }

  // Soft skills.
  const soft = requirements.filter((r) => r.kind === 'soft' && r.status === 'missing').slice(0, 3);
  if (soft.length > 0) {
    out.push({
      id: 'soft-skills',
      priority: 'low',
      area: 'requirements',
      title: 'Show soft skills through results, not adjectives',
      detail: `The posting asks for ${listPhrase(soft.map((r) => `“${truncate(r.text, 50)}”`))}. Rather than listing them, show them in a bullet: who you worked with and what came of it.`,
    });
  }

  // Length, voice, long bullets.
  if (failed('length')) {
    out.push({
      id: 'length',
      priority: 'low',
      area: 'format',
      title: doc.words < MIN_WORDS ? 'Add more detail about your work' : 'Trim your résumé',
      detail: doc.words < MIN_WORDS
        ? `At ${doc.words} words your résumé is brief. Add a bullet or two for each recent job about what you did and what it achieved.`
        : `At ${doc.words} words your résumé is long. Cut older or less relevant detail so the parts that match this posting stand out.`,
    });
  }
  const firstPerson = bullets.find((b) => b.review.issues.includes('first-person'));
  if (firstPerson) {
    out.push({
      id: 'first-person',
      priority: 'low',
      area: 'bullets',
      title: 'Drop “I” and “my” from your bullets',
      detail: 'Résumé bullets are conventionally written without pronouns: start straight with the verb.',
      before: firstPerson.review.text,
      ...(firstPerson.review.rewrite ? { after: firstPerson.review.rewrite } : {}),
    });
  }
  const long = bullets.filter((b) => b.review.issues.includes('too-long'));
  if (long.length > 0) {
    out.push({
      id: 'long-bullets',
      priority: 'low',
      area: 'bullets',
      title: `Shorten ${long.length === 1 ? 'a long bullet' : `${long.length} long bullets`}`,
      detail: 'Bullets over about 30 words get skimmed. Keep one idea per bullet: the action, then the result.',
      before: long[0]!.review.text,
    });
  }

  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => PRIORITY_ORDER[a.r.priority] - PRIORITY_ORDER[b.r.priority] || a.i - b.i)
    .map(({ r }) => r)
    .slice(0, MAX_RECOMMENDATIONS);
}

function upperWords(s: string): string {
  return s.replace(/(^|\s)(\p{L})/gu, (_m, sp: string, ch: string) => sp + ch.toUpperCase());
}
