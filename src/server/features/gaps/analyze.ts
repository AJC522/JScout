/**
 * Skill gaps: across a set of jobs (the ones the user is aiming for, their applications, or a search),
 * what the postings ask for that the user doesn't show, and what would raise their match the most.
 *
 * Everything is measured with the same profile match the search ranks by (search/profile-match.ts):
 *  - demand: how many of the jobs list each skill or certification, as a share of the jobs that list any;
 *  - impact: the match of every job re-computed as if the user had the skill. Gaps rank by the rise
 *    summed over the jobs, counting at most RANK_GAIN_CAP points per job: a posting that lists only
 *    two skills jumps by 50+ points for either one, and without the cap one such posting would
 *    outrank a skill that ten jobs ask for. Breadth comes first, then how much each job gains;
 *  - résumé gaps: skills the user has (profile, experience) that the jobs want but the résumé never names;
 *  - level: how the jobs' stated seniority compares with the user's.
 * Pure: no database, no clock.
 */
import { SENIORITY_LABELS, SENIORITY_ORDER } from '../../../shared/constants';
import type {
  GapAnalysis,
  GapItem,
  GapProjection,
  GapRecommendation,
  LevelFit,
  RecommendationPriority,
  Seniority,
  SkillDemand,
} from '../../../shared/types';
import { skillCategory } from '../../lib/skills';
import { classifySkill, levelGap, type MatchInput, type MatchProfile, matchBand, profileMatch } from '../../search/profile-match';

/** A match at or above this is a strong one. */
export const STRONG_MATCH = 70;
const MAX_SKILLS = 20;
const MAX_CERTS = 10;
const MAX_STRENGTHS = 12;
const MAX_RESUME_GAPS = 8;
/** Missing skills whose impact is simulated (the most-asked-for ones). */
const WHAT_IF_CANDIDATES = 40;
/** Missing skills and certifications combined in the "all together" projection. */
const PROJECTION_SIZE = 3;
/** Points one job can add to a gap's ranking score (about what one of four listed skills is worth). */
const RANK_GAIN_CAP = 10;
const SKILL_RECOMMENDATIONS = 5;
const CERT_RECOMMENDATIONS = 2;
const RESUME_GAP_NAMES = 5;

export type GapJob = MatchInput;

export interface GapFacts {
  hasResume: boolean;
  /** Folded names of the skills the résumé text names; undefined without a résumé. */
  resumeSkills?: ReadonlySet<string>;
  /** The jobs were found with the current title because no target titles are saved. */
  suggestTargets?: boolean;
}

export type GapFindings = Omit<GapAnalysis, 'scope' | 'basis' | 'blocker' | 'hasResume'>;

interface Tally {
  name: string;
  kind: 'skill' | 'certification';
  /** Indexes of the jobs listing it. */
  jobs: number[];
}

interface Simulated extends Tally {
  key: string;
  /** Sum of the match rise over the jobs, each capped at RANK_GAIN_CAP: the ranking key. */
  total: number;
  avgGain: number;
  tierUps: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : 0);

/** The user's side with extra skills, as if they had them. */
function withSkills(mp: MatchProfile, added: ReadonlyArray<{ key: string; name: string }>): MatchProfile {
  const skills = new Map(mp.skills);
  for (const a of added) skills.set(a.key, a.name);
  return { ...mp, skills, usable: true };
}

function matchOf(job: GapJob, mp: MatchProfile): number | null {
  return profileMatch(job, mp, { explain: false }).percent;
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function levelFit(jobs: readonly GapJob[], mp: MatchProfile): LevelFit {
  const fit: LevelFit = { below: 0, at: 0, above: 0, wellAbove: 0, unknown: 0, yours: [...mp.levels], years: mp.years };
  for (const job of jobs) {
    const gap = levelGap(job.seniority, mp.levels);
    if (gap === undefined) fit.unknown++;
    else if (gap < 0) fit.below++;
    else if (gap === 0) fit.at++;
    else {
      fit.above++;
      if (gap >= 2) fit.wellAbove++;
    }
  }
  fit.yours.sort((a, b) => SENIORITY_ORDER.indexOf(a) - SENIORITY_ORDER.indexOf(b));
  return fit;
}

export function analyzeGaps(jobs: readonly GapJob[], mp: MatchProfile, facts: GapFacts): GapFindings {
  const base = jobs.map((job) => matchOf(job, mp));

  // Demand: each job counts once per skill, however often it names it.
  const missing = new Map<string, Tally>();
  const having = new Map<string, Tally>();
  let jobsWithSkills = 0;
  jobs.forEach((job, i) => {
    const seen = new Set<string>();
    for (const name of job.skills) {
      const { key, kind } = classifySkill(name);
      if (kind === 'ignored' || !key || seen.has(key)) continue;
      seen.add(key);
      const into = mp.skills.has(key) ? having : missing;
      let tally = into.get(key);
      if (!tally) into.set(key, (tally = { name: mp.skills.get(key) ?? name, kind, jobs: [] }));
      tally.jobs.push(i);
    }
    if (seen.size > 0) jobsWithSkills++;
  });
  // In a handful of jobs one mention is a signal; in hundreds it is noise.
  const minJobs = jobsWithSkills >= 20 ? 2 : 1;
  const share = (n: number) => percentOf(n, jobsWithSkills);

  // Impact. Without any skills on file, adding one would introduce the skills part of the match for every
  // job (mostly at 0%), which says nothing useful; then only demand is reported.
  const canSimulate = mp.skills.size > 0;
  const candidates = [...missing.entries()]
    .filter(([, t]) => t.jobs.length >= minJobs)
    .sort((a, b) => b[1].jobs.length - a[1].jobs.length || a[1].name.localeCompare(b[1].name))
    .slice(0, WHAT_IF_CANDIDATES);
  const simulated: Simulated[] = candidates.map(([key, tally]) => {
    let total = 0;
    let gain = 0;
    let counted = 0;
    let tierUps = 0;
    if (canSimulate) {
      // Only the jobs that list the skill can change.
      const mp2 = withSkills(mp, [{ key, name: tally.name }]);
      for (const i of tally.jobs) {
        const before = base[i];
        const after = matchOf(jobs[i]!, mp2);
        if (before === null || before === undefined || after === null) continue;
        const rise = after - before;
        gain += rise;
        total += Math.min(rise, RANK_GAIN_CAP);
        counted++;
        if (matchBand(after) > matchBand(before)) tierUps++;
      }
    }
    return { ...tally, key, total, avgGain: counted ? round1(gain / counted) : 0, tierUps };
  });
  simulated.sort((a, b) => b.total - a.total || b.tierUps - a.tierUps || b.jobs.length - a.jobs.length || a.name.localeCompare(b.name));

  const toItem = (s: Simulated): GapItem => {
    const category = skillCategory(s.name);
    return {
      name: s.name,
      kind: s.kind,
      ...(category ? { category } : {}),
      jobs: s.jobs.length,
      share: share(s.jobs.length),
      avgGain: s.avgGain,
      tierUps: s.tierUps,
    };
  };
  const missingSkills = simulated.filter((s) => s.kind === 'skill').slice(0, MAX_SKILLS).map(toItem);
  const missingCerts = simulated.filter((s) => s.kind === 'certification').slice(0, MAX_CERTS).map(toItem);

  const demand = (t: Tally): SkillDemand => ({ name: t.name, kind: t.kind, jobs: t.jobs.length, share: share(t.jobs.length) });
  const byDemand = [...having.entries()].sort((a, b) => b[1].jobs.length - a[1].jobs.length || a[1].name.localeCompare(b[1].name));
  const strengths = byDemand.slice(0, MAX_STRENGTHS).map(([, t]) => demand(t));
  const resumeSkills = facts.hasResume ? facts.resumeSkills : undefined;
  const resumeGaps = resumeSkills
    ? byDemand
        .filter(([key, t]) => !resumeSkills.has(key) && t.jobs.length >= minJobs)
        .slice(0, MAX_RESUME_GAPS)
        .map(([, t]) => demand(t))
    : [];

  const matched = base.filter((p): p is number => p !== null);
  const avg = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  const tiers = Array.from({ length: 10 }, (_, band) => ({ low: band * 10, count: matched.filter((p) => matchBand(p) === band).length }));

  let projection: GapProjection | undefined;
  const top = simulated.filter((s) => s.total > 0).slice(0, PROJECTION_SIZE);
  if (canSimulate && top.length > 0 && matched.length > 0) {
    const mp2 = withSkills(mp, top);
    const after = jobs.map((job, i) => (base[i] === null ? null : matchOf(job, mp2))).filter((p): p is number => p !== null);
    projection = { added: top.map((s) => s.name), avgMatch: avg(after) ?? 0, strongJobs: after.filter((p) => p >= STRONG_MATCH).length };
  }

  const level = levelFit(jobs, mp);
  const findings: GapFindings = {
    jobs: jobs.length,
    jobsWithSkills,
    jobsMatched: matched.length,
    avgMatch: avg(matched),
    strongJobs: matched.filter((p) => p >= STRONG_MATCH).length,
    strongThreshold: STRONG_MATCH,
    tiers,
    missingSkills,
    missingCerts,
    strengths,
    resumeGaps,
    level,
    ...(projection ? { projection } : {}),
    recommendations: [],
  };
  const statedLevels = jobs.filter((job) => job.seniority !== 'unknown').length;
  findings.recommendations = recommend(findings, { simulated, mp, facts, having, statedLevels });
  return findings;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<RecommendationPriority, number> = { high: 0, medium: 1, low: 2 };

const levelName = (s: Seniority) => SENIORITY_LABELS[s].toLowerCase();

/** "mid level (4 years of experience)". */
function yourLevel(level: LevelFit): string {
  const names = level.yours.map(levelName);
  const text = names.length > 2 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names.join(' or ');
  const years = level.years !== null ? ` (${level.years} year${level.years === 1 ? '' : 's'} of experience)` : '';
  return `${text}${years}`;
}

function demandPhrase(items: readonly SkillDemand[]): string {
  const [first, ...rest] = items;
  if (!first) return '';
  const tail = rest.map((d) => `${d.name} by ${d.share}%`);
  return `${first.name} is listed by ${first.share}% of these jobs${tail.length ? `, ${listNames(tail)}` : ''}`;
}

function missingPriority(item: GapItem, jobsMatched: number): RecommendationPriority {
  if (item.share >= 25 || item.tierUps >= Math.max(3, jobsMatched * 0.1)) return 'high';
  if (item.share >= 10) return 'medium';
  return 'low';
}

interface RecommendInput {
  simulated: readonly Simulated[];
  mp: MatchProfile;
  facts: GapFacts;
  having: ReadonlyMap<string, Tally>;
  /** Jobs that state a level. */
  statedLevels: number;
}

function recommend(f: GapFindings, { simulated, mp, facts, having, statedLevels }: RecommendInput): GapRecommendation[] {
  const out: GapRecommendation[] = [];

  if (!facts.hasResume) {
    out.push({
      id: 'add-resume',
      kind: 'add-resume',
      priority: 'high',
      title: 'Add your résumé',
      detail:
        'JScout reads your skills, past job titles and years of experience from it, which makes every match and gap here more accurate, and it is what employers judge you on. Upload it once on your profile: it is kept for every search, review and application.',
    });
  }

  if (mp.skills.size === 0 && f.jobsWithSkills > 0) {
    out.push({
      id: 'add-skills',
      kind: 'add-skills',
      priority: 'high',
      title: 'Add your skills',
      detail: `${percentOf(f.jobsWithSkills, f.jobs)}% of these jobs list specific skills, but your profile and résumé name none that JScout recognises, so that part of your match can't be scored and the impact of each gap can't be estimated. Add them on your profile.`,
    });
  }

  const resumeGaps = f.resumeGaps.slice(0, RESUME_GAP_NAMES);
  if (resumeGaps.length > 0 && resumeGaps[0]!.share >= 10) {
    const names = resumeGaps.map((d) => d.name);
    const them = names.length === 1 ? 'it' : 'them';
    out.push({
      id: 'resume-skills',
      kind: 'resume-skills',
      priority: resumeGaps[0]!.share >= 25 ? 'high' : 'medium',
      title: `Put ${listNames(names)} on your résumé`,
      detail: `${demandPhrase(resumeGaps.slice(0, 3))}. Your profile says you have ${them}, but your résumé never mentions ${them}, and employers and applicant tracking systems only see the résumé. Name ${names.length === 1 ? 'it' : 'each one'} in your skills section and, better still, in a bullet that shows where you used ${them}.`,
      skills: names,
    });
  }

  // Skills you already have in the same field as a gap, to say what it builds on: the ones these jobs
  // ask for first, then the rest of yours.
  const byCategory = new Map<string, string[]>();
  for (const name of new Set([...[...having.values()].map((t) => t.name), ...mp.skills.values()])) {
    const category = skillCategory(name);
    if (!category || category === 'certification-license') continue;
    const list = byCategory.get(category) ?? [];
    list.push(name);
    byCategory.set(category, list);
  }
  const addMissing = (item: GapItem) => {
    const cert = item.kind === 'certification';
    const related = item.category ? (byCategory.get(item.category) ?? []).slice(0, 2) : [];
    const effect =
      item.avgGain > 0
        ? ` Having it would raise your match on those jobs by about ${Math.max(1, Math.round(item.avgGain))} points${item.tierUps > 0 ? `, moving ${item.tierUps} of them up a tier` : ''}.`
        : '';
    const near = !cert && related.length ? ` It sits next to skills you already have (${listNames(related)}).` : '';
    out.push({
      id: `${cert ? 'get-certification' : 'learn-skill'}:${item.name}`,
      kind: cert ? 'get-certification' : 'learn-skill',
      priority: missingPriority(item, f.jobsMatched),
      title: cert ? `Get ${item.name}, or add it if you already hold it` : `Learn ${item.name}, or add it if you already have it`,
      detail: `Listed by ${item.jobs} of the ${f.jobsWithSkills} jobs that name skills (${item.share}%).${effect}${near}`,
      skills: [item.name],
      ...(item.avgGain > 0 ? { impact: `+${Math.max(1, Math.round(item.avgGain))} on ${item.jobs} job${item.jobs === 1 ? '' : 's'}` } : {}),
    });
  };
  // The most impactful gaps, worth naming only when a fair share of the jobs ask for them: more than one
  // job (unless there are only a handful), and 5% of them once there are enough jobs to tell.
  const minJobs = f.jobsWithSkills >= 5 ? 2 : 1;
  const worth = (item: GapItem) => item.jobs >= minJobs && (item.share >= 5 || f.jobsWithSkills < 20);
  const skills = f.missingSkills.filter(worth).slice(0, SKILL_RECOMMENDATIONS);
  const certs = f.missingCerts.filter(worth).slice(0, CERT_RECOMMENDATIONS);
  // Keep the simulated ranking across both kinds.
  const rank = new Map(simulated.map((s, i) => [s.name, i]));
  for (const item of [...skills, ...certs].sort((a, b) => (rank.get(a.name) ?? 0) - (rank.get(b.name) ?? 0))) addMissing(item);

  const lv = f.level;
  const known = lv.below + lv.at + lv.above;
  const minKnown = f.jobs >= 30 ? 10 : 3;
  if (lv.yours.length === 0) {
    // With no level of yours every job counts as unknown in LevelFit; what matters is how many state one.
    if (statedLevels >= minKnown) {
      out.push({
        id: 'add-experience',
        kind: 'add-experience',
        priority: 'medium',
        title: 'Add your years of experience',
        detail: `Many of these jobs state the level they hire at, but JScout can't tell yours, so level doesn't count toward your match. Add your years of experience (or your past jobs with dates) on your profile.`,
      });
    }
  } else if (known >= minKnown) {
    const above = percentOf(lv.above, known);
    const below = percentOf(lv.below, known);
    if (above >= 50) {
      out.push({
        id: 'level-above',
        kind: 'level-above',
        priority: percentOf(lv.wellAbove, known) >= 35 ? 'high' : 'medium',
        title: 'Most of these jobs ask for more seniority than your profile shows',
        detail: `${above}% of the jobs that state a level are above ${yourLevel(lv)}. If that undersells you, update your years of experience and add earlier roles, freelance work or the leadership you've done. If it's accurate, aim at roles at your level: filter searches by seniority, or add target titles at your level.`,
      });
    } else if (below >= 50) {
      out.push({
        id: 'level-below',
        kind: 'level-below',
        priority: 'low',
        title: 'Many of these jobs are below your level',
        detail: `${below}% of the jobs that state a level are below ${yourLevel(lv)}. Filter your searches by seniority to see roles that use your experience.`,
      });
    }
  }

  if (facts.suggestTargets) {
    out.push({
      id: 'add-targets',
      kind: 'add-targets',
      priority: 'medium',
      title: 'Add the job titles you are aiming for',
      detail: 'These jobs were found with your current job title. Add target titles on your profile to see the gaps for the jobs you want next.',
    });
  }

  // Stable: within a priority, the order above (cheap fixes, then the gaps by impact, then level).
  return out.map((r, i) => ({ r, i })).sort((a, b) => PRIORITY_ORDER[a.r.priority] - PRIORITY_ORDER[b.r.priority] || a.i - b.i).map(({ r }) => r);
}
