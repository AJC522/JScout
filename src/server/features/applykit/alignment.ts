/**
 * How the posting's title, seniority, location and pay line up with the profile.
 * Each check returns the FitAnalysis field plus a 0–1 factor used by the score.
 */
import { SENIORITY_LABELS } from '../../../shared/constants';
import type { FitAnalysis, Profile, Salary, Seniority, TitleMatchKind } from '../../../shared/types';
import { matchPlace, resolvePlace } from '../../lib/location';
import { formatSalary } from '../../lib/salary';
import { type TitleInfo, analyzeTitle } from '../../lib/titles';
import { uniqueFolded } from '../../lib/text';
import type { JobContext } from './context';
import { STOPWORDS, formatMoney } from './text';

export interface Scored<T> {
  value: T;
  /** 0–1 contribution to the fit score. */
  factor: number;
}

export const TITLE_RANK: Record<TitleMatchKind, number> = { exact: 4, synonym: 3, related: 2, partial: 1, none: 0 };
export const TITLE_FACTOR: Record<TitleMatchKind, number> = { exact: 1, synonym: 0.9, related: 0.6, partial: 0.4, none: 0 };

function coreTokens(core: string): string[] {
  return core.split(' ').filter((t) => t && !STOPWORDS.has(t));
}

export function compareTitles(job: TitleInfo, mine: TitleInfo): TitleMatchKind {
  if (mine.core !== '' && mine.core === job.core) return 'exact';
  if (job.role && mine.role) {
    if (job.role.id === mine.role.id) return 'synonym';
    if (job.role.related.includes(mine.role.id) || mine.role.related.includes(job.role.id)) return 'related';
  }
  const a = coreTokens(job.core);
  const b = new Set(coreTokens(mine.core));
  const shared = a.filter((t) => b.has(t)).length;
  return shared > 0 && shared / Math.min(a.length, b.size) >= 0.5 ? 'partial' : 'none';
}

export function titleAlignment(jobTitle: string, profile: Profile): Scored<FitAnalysis['titleAlignment']> {
  const targets = uniqueFolded(profile.preferences.targetTitles);
  const current = profile.work.currentTitle.trim();
  const titles = uniqueFolded([...targets, current]);
  if (titles.length === 0) {
    return { value: { kind: 'none', detail: 'Add target titles to your profile to compare job titles.' }, factor: 0.3 };
  }
  const job = analyzeTitle(jobTitle);
  let best: { kind: TitleMatchKind; title: string } = { kind: 'none', title: '' };
  for (const title of titles) {
    const kind = compareTitles(job, analyzeTitle(title));
    if (TITLE_RANK[kind] > TITLE_RANK[best.kind]) best = { kind, title };
  }
  const which = best.title === current && !targets.includes(best.title) ? 'your current title' : 'your target';
  const details: Record<TitleMatchKind, string> = {
    exact: `Matches ${which} “${best.title}”.`,
    synonym: `“${jobTitle}” is the same role as ${which} “${best.title}”.`,
    related: `A role related to ${which} “${best.title}”.`,
    partial: `Partly overlaps ${which} “${best.title}”.`,
    none: `Doesn't match your titles (${titles.slice(0, 3).join(', ')}).`,
  };
  return { value: { kind: best.kind, detail: details[best.kind] }, factor: TITLE_FACTOR[best.kind] };
}

/** Typical years of experience for each level: [min, max]. */
const LEVEL_YEARS: Record<Exclude<Seniority, 'unknown'>, [number, number]> = {
  intern: [0, 1],
  entry: [0, 3],
  mid: [2, 6],
  senior: [5, 12],
  lead: [8, Infinity],
  manager: [5, Infinity],
  director: [10, Infinity],
  executive: [15, Infinity],
};

export function seniorityAlignment(job: Seniority, profile: Profile): Scored<FitAnalysis['seniorityAlignment']> {
  const result = (detail: string, factor: number) => ({ value: { job, detail }, factor });
  if (job === 'unknown') return result("The posting doesn't state a seniority level.", 0.7);
  const label = SENIORITY_LABELS[job];
  const preferred = profile.preferences.seniority;
  if (preferred.includes(job)) return result(`${label} role, one of your preferred levels.`, 1);
  const years = profile.work.yearsExperience;
  if (years === null) {
    return preferred.length > 0
      ? result(`${label} role, which isn't one of your preferred levels (${preferred.map((s) => SENIORITY_LABELS[s]).join(', ')}).`, 0.5)
      : result(`${label} role. Add your years of experience to compare.`, 0.7);
  }
  const [min, max] = LEVEL_YEARS[job];
  const yrs = `${years} year${years === 1 ? '' : 's'}`;
  if (years < min) {
    return min - years >= 3
      ? result(`${label} roles usually ask for ${min}+ years; with ${yrs} this would be a stretch.`, 0.2)
      : result(`${label} roles usually ask for about ${min}+ years; with ${yrs} you are close.`, 0.6);
  }
  if (years > max) return result(`${label} role; with ${yrs} you may be more senior than this level.`, 0.7);
  return result(`${label} role, in line with your ${yrs} of experience.`, 1);
}

export function locationAlignment(job: JobContext, profile: Profile): Scored<FitAnalysis['locationAlignment']> {
  const result = (ok: boolean | null, detail: string) => ({
    value: { ok, detail },
    factor: ok === true ? 1 : ok === null ? 0.6 : 0,
  });
  const prefs = profile.preferences;
  const mode = job.location.remote;
  const wantsRemote = prefs.remote.includes('remote');
  const remoteOnly = prefs.remote.length > 0 && prefs.remote.every((m) => m === 'remote');
  const home = profile.personal.location.trim() ? resolvePlace(profile.personal.location) : undefined;
  const targets = (prefs.locations.length > 0 ? prefs.locations : [profile.personal.location])
    .filter((t) => t.trim())
    .map((t) => resolvePlace(t))
    .filter((p) => p !== undefined);
  const where = job.locationText || 'the stated location';

  if (mode === 'remote') {
    if (prefs.remote.length > 0 && !wantsRemote) return result(false, `Fully remote, but you're looking for ${prefs.remote.join(' or ')} work.`);
    const base = home ?? targets[0];
    if (!base) {
      return job.location.remoteScope.length === 0
        ? result(true, 'Remote with no stated location restriction.')
        : result(null, `Remote within ${where}; add your location to check you're eligible.`);
    }
    return matchPlace(job.location, base, { includeRemote: true }).kind === 'none'
      ? result(false, `Remote, but limited to ${where}, which doesn't include ${base.label}.`)
      : result(true, `Remote role you can do from ${base.label}.`);
  }
  if (remoteOnly && (mode === 'onsite' || mode === 'hybrid')) {
    return result(false, `${mode === 'onsite' ? 'On-site' : 'Hybrid'} in ${where}; you're looking for remote work only.`);
  }
  if (job.location.places.length === 0) return result(null, "The posting doesn't say where the job is based.");
  if (targets.length === 0) return result(null, 'Add preferred locations to your profile to check the location.');
  for (const place of targets) {
    const m = matchPlace(job.location, place, {
      radiusKm: prefs.radiusKm,
      includeRemote: wantsRemote || prefs.remote.length === 0,
    });
    if (m.kind === 'city') return result(true, `In ${place.label}, one of your preferred locations.`);
    if (m.kind === 'radius') {
      return result(true, `About ${Math.round(m.distanceKm ?? 0)} km from ${place.label}, within your ${prefs.radiusKm} km radius.`);
    }
    if (m.kind === 'area') return result(true, `Within ${place.label}, one of your preferred locations.`);
    if (m.kind === 'remote') return result(true, `Can be done remotely from ${place.label}.`);
  }
  if (remoteOnly && mode === 'unknown') return result(null, `Based in ${where}; the posting doesn't say whether remote work is possible.`);
  return result(false, `${where} is outside your preferred locations (${targets.map((p) => p.label).join(', ')}).`);
}

export function salaryAlignment(salary: Salary | undefined, profile: Profile): Scored<FitAnalysis['salaryAlignment']> {
  const result = (ok: boolean | null, detail: string) => ({
    value: { ok, detail },
    factor: ok === true ? 1 : ok === null ? 0.6 : 0.2,
  });
  const { salaryMin, salaryCurrency } = profile.preferences;
  if (salaryMin === null) return result(null, 'Set a minimum salary in your preferences to compare pay.');
  if (!salary) return result(null, "The posting doesn't list a salary.");
  const listed = formatSalary(salary);
  if (salary.currency && salary.currency !== salaryCurrency) {
    return result(null, `Pays ${listed}, in ${salary.currency}; your minimum is in ${salaryCurrency}, so it wasn't compared.`);
  }
  const top = salary.annualMax ?? salary.annualMin;
  if (top === undefined) return result(null, `Pay is listed as ${listed}, which couldn't be compared to a yearly minimum.`);
  const min = formatMoney(salaryMin, salaryCurrency);
  if (top < salaryMin) return result(false, `Pays ${listed}, below your minimum of ${min}.`);
  return (salary.annualMin ?? top) >= salaryMin
    ? result(true, `Pays ${listed}, at or above your minimum of ${min}.`)
    : result(true, `Pays ${listed}; the top of the range reaches your minimum of ${min}.`);
}
