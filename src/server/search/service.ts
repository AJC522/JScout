/**
 * The search engine: local full-text search over the job index with our own ranking,
 * de-duplication, location filtering, facets and broadening suggestions.
 *
 * Other services are available on `ctx.services` but may not exist yet while this factory
 * runs: they are read lazily inside methods, never at construction.
 */
import type { JobDetail, JobPosting, Place, Profile, SearchInterpretation, SearchQuery, SearchResponse, SearchResultItem } from '../../shared/types';
import type { Db } from '../db';
import { POSTING_SELECT, type PostingRow, rowToPosting } from '../ingest/store-rows';
import { resolvePlace, suggestPlaces } from '../lib/location';
import { suggestSkills } from '../lib/skills';
import { foldText } from '../lib/text';
import type { AppContext, SearchService } from '../services';
import { broadenCandidates, rankSuggestions } from './broaden';
import { collapse, countPassing } from './collapse';
import { countClusters, fetchCandidates, fetchScoringRows } from './engine';
import { externalLinks } from './external';
import { createSearchHistory } from './history';
import { bestRank, orderResults } from './order';
import { buildPlan, type CandidateRow, type PlanEnv, type SearchPlan } from './plan';
import { queryFromPreferences, upstreamQuery } from './profile-query';
import { type LocationTarget, type ScoreContext, type ScoreInput, scorePosting } from './rank';
import { companySuggestions, titleSuggestions } from './suggest';

/** Query fields that only narrow by facet: a patch touching only these keeps the base rows valid. */
const FACET_FIELDS = new Set<keyof SearchQuery>(['remote', 'employmentTypes', 'seniority', 'sources', 'companies', 'postedWithinDays']);
const DEFAULT_SUGGEST_LIMIT = 8;

type PageRow = PostingRow & { rid: number; title_core: string };

function loadPage(db: Db, rids: number[]): Map<number, PageRow> {
  const rows = db.all<PageRow>(
    `SELECT rid, title_core, ${POSTING_SELECT} FROM jobs WHERE rid IN (SELECT value FROM json_each(?))`,
    JSON.stringify(rids),
  );
  return new Map(rows.map((r) => [r.rid, r]));
}

function companyNames(db: Db, keys: string[]): Map<string, string> {
  const names = new Map<string, string>();
  if (keys.length === 0) return names;
  // The most common spelling of each company wins.
  for (const r of db.all<{ company_key: string; company: string }>(
    `SELECT company_key, company FROM jobs WHERE company_key IN (SELECT value FROM json_each(?))
     GROUP BY company_key, company ORDER BY COUNT(*) DESC`,
    JSON.stringify(keys),
  )) {
    if (!names.has(r.company_key)) names.set(r.company_key, r.company);
  }
  return names;
}

function scoreInputFromPosting(job: JobPosting, titleCore: string, rank: number | null): ScoreInput {
  return {
    title: job.title,
    titleCore,
    roleId: job.roleId,
    tags: job.tags,
    skills: job.skills,
    snippet: job.snippet,
    location: job.location,
    seniority: job.seniority,
    salary: job.salary,
    ts: job.postedAt ?? job.firstSeenAt,
    closed: job.closedAt !== undefined,
    rank,
  };
}

function interpretation(plan: SearchPlan): SearchInterpretation {
  const u = plan.understanding;
  const out: SearchInterpretation = { terms: u.terms, excluded: u.excluded, titles: u.titles, titleOnly: u.titleOnly };
  if (u.role) out.role = { id: u.role.id, title: u.role.title, family: u.role.family };
  const text = plan.query.location?.trim();
  if (plan.location.place) out.place = plan.location.place;
  else if (plan.location.placeUnresolved && text) {
    out.place = { kind: 'unknown', raw: text, label: text };
    out.placeUnresolved = true;
  }
  return out;
}

export function createSearchService(ctx: AppContext): SearchService {
  const { db } = ctx;
  const history = createSearchHistory(db, () => ctx.now());

  function env(profile: Profile): PlanEnv {
    return {
      now: ctx.now(),
      maxPostingAgeDays: ctx.services.settings.getApp().maxPostingAgeDays,
      defaultCurrency: profile.preferences.salaryCurrency || 'USD',
    };
  }

  function scoreContext(plan: SearchPlan, profile: Profile, best: number | null): ScoreContext {
    const useProfile = plan.opts.useProfile;
    const skills = useProfile ? ctx.services.profile.effectiveSkills() : [];
    let location: LocationTarget | undefined;
    const place = plan.location.place;
    if (place && place.kind !== 'anywhere') {
      location = { place, radiusKm: plan.opts.radiusKm, includeRemote: plan.opts.includeRemote };
    } else if (useProfile && !plan.location.placeUnresolved) {
      const preferred = profile.preferences.locations.map((l) => resolvePlace(l)).find((p): p is Place => p !== undefined && p.kind !== 'anywhere' && p.kind !== 'unknown');
      if (preferred) location = { place: preferred, radiusKm: profile.preferences.radiusKm, includeRemote: true };
    }
    return {
      understanding: plan.understanding,
      bestRank: best,
      profileSkills: skills.length ? new Map(skills.map((s) => [foldText(s), s])) : undefined,
      preferredSeniority: useProfile ? profile.preferences.seniority : [],
      location,
      now: plan.now,
    };
  }

  function items(page: CandidateRow[], score: ScoreContext): SearchResultItem[] {
    const rows = loadPage(db, page.map((r) => r.rid));
    const states = ctx.services.userState.forClusters(page.map((r) => r.clusterKey));
    const out: SearchResultItem[] = [];
    for (const c of page) {
      const row = rows.get(c.rid);
      if (!row) continue;
      const job = rowToPosting(row);
      const s = scorePosting(scoreInputFromPosting(job, row.title_core, c.rank), score);
      out.push({
        job,
        score: s.score,
        match: s.match,
        duplicates: ctx.services.jobs.clusterLinks(job.clusterKey).filter((l) => l.jobId !== job.id),
        userState: states.get(job.clusterKey) ?? { hidden: false },
      });
    }
    return out;
  }

  function search(query: SearchQuery): SearchResponse {
    const started = performance.now();
    const profile = ctx.services.profile.get();
    const planEnv = env(profile);
    const plan = buildPlan(query, planEnv);
    const rows = fetchCandidates(db, plan);
    const { reps, facets } = collapse(rows, plan, { companyNames: (keys) => companyNames(db, keys) });
    const total = reps.length;
    const score = scoreContext(plan, profile, bestRank(reps));
    const ordered = orderResults(reps, plan, score, (rids) => fetchScoringRows(db, rids));
    if (ordered.beyondCap > 0) ctx.log.debug('search: rescoring cap reached', { results: total, orderedByCheapScore: ordered.beyondCap });
    const page = ordered.rows.slice(plan.opts.offset, plan.opts.offset + plan.opts.limit);

    const countPatched = (patch: Partial<SearchQuery>): number => {
      const patched = buildPlan({ ...query, ...patch }, planEnv);
      const facetOnly = (Object.keys(patch) as Array<keyof SearchQuery>).every((k) => FACET_FIELDS.has(k));
      return facetOnly ? countPassing(rows, patched) : countClusters(db, patched);
    };

    return {
      query,
      total,
      items: items(page, score),
      tookMs: Math.round((performance.now() - started) * 10) / 10,
      interpretation: interpretation(plan),
      facets,
      suggestions: rankSuggestions(broadenCandidates(query, plan, planEnv.maxPostingAgeDays), total, countPatched),
      externalLinks: externalLinks(plan.understanding.parsed, query.location, plan.location.place),
      index: ctx.services.sync.summary(),
    };
  }

  return {
    search,

    count(query, opts) {
      const plan = buildPlan(query, env(ctx.services.profile.get()));
      const extra = opts?.firstSeenAfter ? [{ sql: 'j.first_seen_at > ?', params: [opts.firstSeenAfter] }] : [];
      return countClusters(db, plan, extra);
    },

    jobDetail(id, query) {
      const job = ctx.services.jobs.getPosting(id);
      if (!job) return undefined;
      const profile = ctx.services.profile.get();
      const plan = buildPlan(query ?? queryFromPreferences(profile), env(profile));
      const titleCore = db.scalar<string>('SELECT title_core FROM jobs WHERE id = ?', id) ?? '';
      const scored = scorePosting(scoreInputFromPosting(job, titleCore, null), scoreContext(plan, profile, null));
      const detail: JobDetail = {
        job,
        score: scored.score,
        match: scored.match,
        duplicates: ctx.services.jobs.clusterLinks(job.clusterKey).filter((l) => l.jobId !== job.id),
        userState: ctx.services.userState.forCluster(job.clusterKey),
        descriptionHtml: ctx.services.jobs.getDescriptionHtml(id),
      };
      const liveness = ctx.services.jobs.getLiveness(id);
      if (liveness) detail.liveness = liveness;
      return detail;
    },

    queryFromProfile: () => queryFromPreferences(ctx.services.profile.get()),
    toUpstreamQuery: upstreamQuery,
    suggestTitles: (q, limit = DEFAULT_SUGGEST_LIMIT) => titleSuggestions(db, q, limit),
    suggestLocations: (q, limit = DEFAULT_SUGGEST_LIMIT) => suggestPlaces(q, limit),
    suggestSkills: (q, limit = DEFAULT_SUGGEST_LIMIT) => suggestSkills(q, limit),
    suggestCompanies: (q, limit = DEFAULT_SUGGEST_LIMIT) => companySuggestions(db, q, limit),
    history: (limit) => history.list(limit),
    recordHistory: (query, total) => history.record(query, total),
    clearHistory: () => history.clear(),
  };
}
