/**
 * The search engine: local full-text search over the job index with our own ranking,
 * de-duplication, location filtering, facets and broadening suggestions.
 *
 * Other services are available on `ctx.services` but may not exist yet while this factory
 * runs: they are read lazily inside methods, never at construction.
 */
import type { JobDetail, JobPosting, Place, Profile, ProfileFit, SearchInterpretation, SearchQuery, SearchResponse, SearchResultItem } from '../../shared/types';
import type { Db } from '../db';
import { POSTING_SELECT, type PostingRow, rowToPosting } from '../ingest/store-rows';
import { resolvePlace, suggestPlaces } from '../lib/location';
import { suggestSkills } from '../lib/skills';
import { foldText } from '../lib/text';
import type { AppContext, SearchService } from '../services';
import { broadenCandidates, rankSuggestions } from './broaden';
import { collapse, countPassing } from './collapse';
import { countClusters, countNewClusters, fetchCandidates, fetchMatchRows, fetchScoringRows } from './engine';
import { externalLinks } from './external';
import { createSearchHistory } from './history';
import { bestRank, type FitContext, type FitKey, fitKey, orderResults } from './order';
import { locationPieces } from './location-filter';
import { buildPlan, type CandidateRow, type PlanEnv, type SearchPlan } from './plan';
import { annualPay, buildMatchProfile, locationFit, locationPrefs, type MatchProfile, profileFit, profileMatch } from './profile-match';
import { queryFromPreferences, upstreamQuery } from './profile-query';
import { type LocationTarget, type ScoreContext, type ScoreInput, scorePosting } from './rank';
import { companyNames, companySuggestions, titleSuggestions } from './suggest';

/** Query fields that only narrow by facet: a patch touching only these keeps the base rows valid. */
const FACET_FIELDS = new Set<keyof SearchQuery>(['remote', 'employmentTypes', 'seniority', 'clearance', 'sources', 'companies', 'postedWithinDays']);
const DEFAULT_SUGGEST_LIMIT = 8;
/** Cached "Best match" sort keys before the cache starts over (several times a full index). */
const FIT_CACHE_MAX = 250_000;

type PageRow = PostingRow & { rid: number; title_core: string };

function loadPage(db: Db, rids: number[]): Map<number, PageRow> {
  const rows = db.all<PageRow>(
    `SELECT rid, title_core, ${POSTING_SELECT} FROM jobs WHERE rid IN (SELECT value FROM json_each(?))`,
    JSON.stringify(rids),
  );
  return new Map(rows.map((r) => [r.rid, r]));
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

/** The profile match of one posting, explained. */
function fitFor(job: JobPosting, titleCore: string, fit: FitContext): ProfileFit {
  const match = profileMatch({ title: job.title, titleCore, roleId: job.roleId, skills: job.skills, seniority: job.seniority }, fit.profile);
  return profileFit(match, locationFit(job.location, fit.location), annualPay(job.salary, fit.currency), fit.currency);
}

export function createSearchService(ctx: AppContext): SearchService {
  const { db } = ctx;
  const history = createSearchHistory(db, () => ctx.now());
  // The user's side of the profile match, rebuilt when the profile changes (it reads the résumé).
  let matchProfile: { key: string; value: MatchProfile } | undefined;
  // "Best match" sort keys by posting, for one profile and location context: browsing every posting
  // computes tens of thousands, and each filter change searches again. Postings can change content
  // in place when a feed syncs, so syncs that change the index clear it.
  let fitKeyCache: { context: string; keys: Map<number, FitKey> } | undefined;
  ctx.events?.subscribe((event) => {
    const changed = event.type === 'index-changed' || event.type === 'sync-finished' || (event.type === 'feed-finished' && event.added + event.updated > 0);
    if (changed) fitKeyCache = undefined;
  });

  function getMatchProfile(profile: Profile): { key: string; value: MatchProfile } {
    const skills = ctx.services.profile.effectiveSkills();
    const key = `${profile.updatedAt}\u0000${skills.join('\u0000')}`;
    if (matchProfile?.key !== key) matchProfile = { key, value: buildMatchProfile(profile, skills, ctx.now()) };
    return matchProfile;
  }

  function fitKeys(reps: CandidateRow[], fit: FitContext): FitKey[] {
    const loc = fit.location;
    const context = JSON.stringify([matchProfile?.key, loc.places.map((p) => p.label), loc.radiusKm, loc.acceptsRemote, [...loc.countries], fit.currency]);
    if (fitKeyCache?.context !== context || fitKeyCache.keys.size > FIT_CACHE_MAX) fitKeyCache = { context, keys: new Map() };
    const { keys } = fitKeyCache;
    const missing = reps.filter((r) => !keys.has(r.rid));
    if (missing.length) {
      const rows = fetchMatchRows(db, missing.map((r) => r.rid));
      for (const r of missing) keys.set(r.rid, fitKey(r, rows.get(r.rid), fit));
    }
    return reps.map((r) => keys.get(r.rid)!);
  }

  /** What "Best match" compares with; undefined when the profile is off for this search or holds nothing to compare. */
  function fitContext(plan: SearchPlan, profile: Profile): FitContext | undefined {
    if (!plan.opts.useProfile) return undefined;
    const mp = getMatchProfile(profile).value;
    if (!mp.usable) return undefined;
    const location = locationPrefs({
      searchPlaces: plan.location.places,
      searchRadiusKm: plan.opts.radiusKm,
      searchRemote: plan.query.remote,
      profile,
      useSavedPlaces: !plan.location.placeUnresolved,
    });
    return { profile: mp, location, currency: plan.salaryCurrency };
  }

  function env(profile: Profile): PlanEnv {
    return {
      now: ctx.now(),
      maxPostingAgeDays: ctx.services.settings.getApp().maxPostingAgeDays,
      defaultCurrency: profile.preferences.salaryCurrency || 'USD',
      hideRemovedFeeds: ctx.services.jobs.removingFeeds?.() ?? false,
    };
  }

  function scoreContext(plan: SearchPlan, profile: Profile, best: number | null): ScoreContext {
    const useProfile = plan.opts.useProfile;
    const skills = useProfile ? ctx.services.profile.effectiveSkills() : [];
    let location: LocationTarget | undefined;
    const place = plan.location.place;
    if (place && place.kind !== 'anywhere') {
      const others = plan.location.places.slice(1);
      location = { place, ...(others.length ? { others } : {}), radiusKm: plan.opts.radiusKm, includeRemote: plan.opts.includeRemote };
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

  function items(page: CandidateRow[], score: ScoreContext, fit: FitContext | undefined): SearchResultItem[] {
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
        ...(fit ? { fit: fitFor(job, row.title_core, fit) } : {}),
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
    const fit = fitContext(plan, profile);
    const ordered = orderResults(reps, plan, score, (rids) => fetchScoringRows(db, rids), fit ? (r) => fitKeys(r, fit) : undefined);
    if (ordered.beyondCap > 0) ctx.log.debug('search: rescoring cap reached', { results: total, orderedByCheapScore: ordered.beyondCap });
    const page = ordered.rows.slice(plan.opts.offset, plan.opts.offset + plan.opts.limit);

    const countPatched = (patch: Partial<SearchQuery>): number => {
      const patched = buildPlan({ ...query, ...patch }, planEnv);
      const facetOnly = (Object.keys(patch) as Array<keyof SearchQuery>).every((k) => FACET_FIELDS.has(k));
      return facetOnly ? countPassing(rows, patched) : countClusters(db, patched);
    };

    const response: Omit<SearchResponse, 'tookMs'> = {
      query,
      total,
      items: items(page, score, fit),
      interpretation: interpretation(plan),
      facets,
      suggestions: rankSuggestions(broadenCandidates(query, plan, planEnv.maxPostingAgeDays), total, countPatched),
      externalLinks: externalLinks(plan.understanding.parsed, locationPieces(query.location)[0], plan.location.place),
      index: ctx.services.sync.summary(),
    };
    return { ...response, tookMs: Math.round((performance.now() - started) * 10) / 10 };
  }

  return {
    search,

    count(query, opts) {
      const plan = buildPlan(query, env(ctx.services.profile.get()));
      return opts?.firstSeenAfter ? countNewClusters(db, plan, opts.firstSeenAfter) : countClusters(db, plan);
    },

    jobDetail(id, query) {
      const job = ctx.services.jobs.getPosting(id);
      if (!job) return undefined;
      const profile = ctx.services.profile.get();
      const plan = buildPlan(query ?? queryFromPreferences(profile), env(profile));
      const titleCore = db.scalar<string>('SELECT title_core FROM jobs WHERE id = ?', id) ?? '';
      const scored = scorePosting(scoreInputFromPosting(job, titleCore, null), scoreContext(plan, profile, null));
      const fit = fitContext(plan, profile);
      const detail: JobDetail = {
        job,
        score: scored.score,
        match: scored.match,
        ...(fit ? { fit: fitFor(job, titleCore, fit) } : {}),
        duplicates: ctx.services.jobs.clusterLinks(job.clusterKey).filter((l) => l.jobId !== job.id),
        userState: ctx.services.userState.forCluster(job.clusterKey),
        descriptionHtml: ctx.services.jobs.getDescriptionHtml(id),
      };
      const liveness = ctx.services.jobs.getLiveness(id);
      if (liveness) detail.liveness = liveness;
      return detail;
    },

    queryFromProfile: () => queryFromPreferences(ctx.services.profile.get()),

    sampleJobs(query, limit) {
      const profile = ctx.services.profile.get();
      // Relevance, not best match: a sample ordered by how well the user already fits would hide the gaps.
      const plan = buildPlan({ ...query, sort: 'relevance', offset: 0 }, env(profile));
      const { reps } = collapse(fetchCandidates(db, plan), plan, { companyNames: (keys) => companyNames(db, keys) });
      const ordered = orderResults(reps, plan, scoreContext(plan, profile, bestRank(reps)), (rids) => fetchScoringRows(db, rids));
      const page = ordered.rows.slice(0, Math.max(0, limit));
      const rows = loadPage(db, page.map((r) => r.rid));
      return page.flatMap((c) => {
        const row = rows.get(c.rid);
        if (!row) return [];
        const job = rowToPosting(row);
        return [{ id: job.id, title: job.title, titleCore: row.title_core, roleId: job.roleId, skills: job.skills, seniority: job.seniority }];
      });
    },
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
