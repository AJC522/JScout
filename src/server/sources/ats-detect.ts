/**
 * Recognising employer applicant-tracking-system boards (pure, no network).
 *
 * parseAtsUrl: a careers or posting URL a user pasted -> which ATS and which board token.
 * tokenCandidates: a company name -> the board tokens most likely to exist, for probing.
 */
import type { AtsKind } from '../../shared/types';
import { companyKey, foldText } from '../lib/text';

export interface AtsBoard {
  ats: AtsKind;
  token: string;
}

/** Board tokens as they appear in URL paths. */
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** First path segments on board hosts that are site pages, not boards. */
const GREENHOUSE_RESERVED = new Set(['embed', 'v1', 'jobs', 'api', 'static', 'assets', 'favicon.ico', 'robots.txt']);
const LEVER_RESERVED = new Set(['v0', 'v1', 'api', 'static', 'assets', 'favicon.ico', 'robots.txt']);
const ASHBY_RESERVED = new Set(['api', 'static', 'assets', 'favicon.ico', 'robots.txt']);
const SMARTRECRUITERS_RESERVED = new Set(['oneclick-ui', 'sr-jobs', 'api', 'static', 'assets', 'favicon.ico', 'robots.txt']);
const WORKABLE_RESERVED = new Set(['j', 'api', 'static', 'assets', 'careers', 'favicon.ico', 'robots.txt']);

/**
 * Recognise a careers/posting URL, with or without scheme:
 *  - Greenhouse: boards.greenhouse.io/{token}[/jobs/{id}], job-boards.greenhouse.io/{token}[...],
 *    boards.greenhouse.io/embed/job_board?for={token} (also embed/job_app?for=),
 *    boards-api.greenhouse.io/v1/boards/{token}/...
 *  - Lever: jobs.lever.co/{company}[/{id}[/apply]], api.lever.co/v0/postings/{company}[...]
 *  - Ashby: jobs.ashbyhq.com/{name}[/{id}[/application]], api.ashbyhq.com/posting-api/job-board/{name}
 *  - SmartRecruiters: jobs.smartrecruiters.com/{Company}[/...], careers.smartrecruiters.com/{Company},
 *    api.smartrecruiters.com/v1/companies/{Company}/...
 *  - Workable: apply.workable.com/{slug}[/j/{id}]
 * SmartRecruiters identifiers are case-sensitive and keep their case; the others are lower-cased.
 * Anything else (other hosts, EU-hosted boards, site pages without a board) is null.
 */
export function parseAtsUrl(input: string): AtsBoard | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const segments = url.pathname
    .split('/')
    .filter((s) => s !== '')
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  const first = segments[0];

  const make = (ats: AtsKind, token: string | null | undefined, keepCase = false): AtsBoard | null => {
    const t = token?.trim();
    if (!t || !TOKEN_RE.test(t)) return null;
    return { ats, token: keepCase ? t : t.toLowerCase() };
  };

  switch (host) {
    case 'boards.greenhouse.io':
    case 'job-boards.greenhouse.io': {
      if (first?.toLowerCase() === 'embed') return make('greenhouse', url.searchParams.get('for'));
      if (!first || GREENHOUSE_RESERVED.has(first.toLowerCase())) return null;
      return make('greenhouse', first);
    }
    case 'boards-api.greenhouse.io':
      if (first?.toLowerCase() === 'v1' && segments[1]?.toLowerCase() === 'boards') return make('greenhouse', segments[2]);
      return null;
    case 'jobs.lever.co':
      if (!first || LEVER_RESERVED.has(first.toLowerCase())) return null;
      return make('lever', first);
    case 'api.lever.co':
      if (first?.toLowerCase() === 'v0' && segments[1]?.toLowerCase() === 'postings') return make('lever', segments[2]);
      return null;
    case 'jobs.ashbyhq.com':
      if (!first || ASHBY_RESERVED.has(first.toLowerCase())) return null;
      return make('ashby', first);
    case 'api.ashbyhq.com':
      if (first?.toLowerCase() === 'posting-api' && segments[1]?.toLowerCase() === 'job-board') return make('ashby', segments[2]);
      return null;
    case 'jobs.smartrecruiters.com':
    case 'careers.smartrecruiters.com':
      if (first?.toLowerCase() === 'oneclick-ui' && segments[1]?.toLowerCase() === 'company') {
        return make('smartrecruiters', segments[2], true);
      }
      if (!first || SMARTRECRUITERS_RESERVED.has(first.toLowerCase())) return null;
      return make('smartrecruiters', first, true);
    case 'api.smartrecruiters.com':
      if (first?.toLowerCase() === 'v1' && segments[1]?.toLowerCase() === 'companies') {
        return make('smartrecruiters', segments[2], true);
      }
      return null;
    case 'apply.workable.com':
      if (!first || WORKABLE_RESERVED.has(first.toLowerCase())) return null;
      return make('workable', first);
    default:
      return null;
  }
}

const MAX_CANDIDATES = 6;

/** Words of a name with legal suffixes and a leading "the" kept (for the "full" variants). */
function words(s: string): string[] {
  return foldText(s.replace(/&/g, ' and '))
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '');
}

/**
 * Likely board tokens for a company name, most likely first, at most 6, de-duplicated.
 * "Acme Robotics, Inc." -> ["acmerobotics", "acme-robotics", "acme", "acmeroboticsinc", "acmeroboticshq"].
 * Legal suffixes and a leading "the" are dropped first (companyKey), "&" becomes "and",
 * diacritics are folded, apostrophes are removed ("Macy's" -> "macys") and other punctuation
 * separates words ("C3.ai" -> "c3ai").
 */
export function tokenCandidates(companyName: string): string[] {
  if (typeof companyName !== 'string') return [];
  const name = companyName.replace(/['‘’`´]/g, '');
  const core = words(companyKey(name));
  if (core.length === 0) return [];
  const full = words(name);

  const out: string[] = [];
  const add = (t: string) => {
    if (t && !out.includes(t) && out.length < MAX_CANDIDATES) out.push(t);
  };
  add(core.join(''));
  if (core.length > 1) add(core.join('-'));
  if (core.length > 1 && core[0]!.length >= 3) add(core[0]!);
  if (full.length > core.length) add(full.join(''));
  if (core.length >= 3) add(core.map((w) => w[0]).join(''));
  add(`${core.join('')}hq`);
  return out;
}
