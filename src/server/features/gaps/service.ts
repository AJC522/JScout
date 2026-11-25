/**
 * Skill gaps service: picks the jobs to look at (the ones the profile aims for, the active
 * applications, or a search), then analyses them against the profile (analyze.ts).
 */
import { ACTIVE_STATUSES } from '../../../shared/constants';
import type { GapAnalysis, GapRequest, SearchQuery } from '../../../shared/types';
import { extractSkills } from '../../lib/skills';
import { foldText } from '../../lib/text';
import { analyzeTitle } from '../../lib/titles';
import { LOCATION_SEPARATOR } from '../../search/location-filter';
import { buildMatchProfile } from '../../search/profile-match';
import type { AppContext, GapService } from '../../services';
import { resolveJob } from '../applykit/context';
import { analyzeGaps, type GapJob } from './analyze';

/** Jobs sampled from a search: enough for stable shares, few enough to answer at once. */
export const GAP_SAMPLE_SIZE = 250;

const pieces = (text: string | undefined, separator: string) =>
  (text ?? '')
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean);

/** "Security Analyst, Crime Analyst near Honolulu, HI or Hilo, HI (remote)". */
export function describeQuery(query: SearchQuery): string {
  const titles = pieces(query.q, ',');
  const places = pieces(query.location, LOCATION_SEPARATOR);
  const what = titles.length ? titles.join(', ') : 'All jobs';
  const where = places.length ? ` near ${places.join(' or ')}` : '';
  const remote = query.remote?.length === 1 && query.remote[0] === 'remote' ? ' (remote)' : '';
  return `${what}${where}${remote}`;
}

export function createGapService(ctx: AppContext): GapService {
  return {
    analyze(request: GapRequest): GapAnalysis {
      const { profile: profiles, search, applications } = ctx.services;
      const profile = profiles.get();
      const resumeText = profiles.resumeText();
      const hasResume = resumeText.trim().length > 0;
      const mp = buildMatchProfile(profile, profiles.effectiveSkills(), ctx.now());
      const facts = {
        hasResume,
        ...(hasResume ? { resumeSkills: new Set(extractSkills(resumeText).map(foldText)) } : {}),
      };
      const nothing = (blocker: NonNullable<GapAnalysis['blocker']>, basis: string): GapAnalysis => ({
        scope: request.scope,
        basis,
        blocker,
        hasResume,
        ...analyzeGaps([], mp, facts),
      });

      if (request.scope === 'applications') {
        const active = applications.list().filter((app) => ACTIVE_STATUSES.includes(app.status));
        const basis = `Your ${active.length === 1 ? 'active application' : `${active.length} active applications`}`;
        if (active.length === 0) return nothing('no-applications', 'Your active applications');
        const jobs: GapJob[] = active.map((app) => {
          // The tracked snapshot, with skills read from its description when it lists none.
          const job = resolveJob(ctx.services, { applicationId: app.id });
          const title = analyzeTitle(job.title);
          return { title: job.title, titleCore: title.core, roleId: title.role?.id, skills: job.skills, seniority: job.seniority };
        });
        return { scope: request.scope, basis, hasResume, ...analyzeGaps(jobs, mp, facts) };
      }

      let query: SearchQuery;
      let suggestTargets = false;
      if (request.scope === 'search') {
        query = request.query ?? { q: '' };
      } else {
        query = search.queryFromProfile();
        if (!query.q?.trim()) {
          // Without target titles, the job the user does now is the best guess at what they look for.
          const current = profile.work.currentTitle.replace(/[,|"]/g, ' ').replace(/\s+/g, ' ').trim();
          if (!current) return nothing('no-targets', 'The jobs you are aiming for');
          query = { ...query, q: current };
          suggestTargets = true;
        }
      }
      const basis = describeQuery(query);
      const jobs = search.sampleJobs(query, GAP_SAMPLE_SIZE);
      if (jobs.length === 0) return nothing('no-jobs', basis);
      return { scope: request.scope, basis, hasResume, ...analyzeGaps(jobs, mp, { ...facts, suggestTargets }) };
    },
  };
}
