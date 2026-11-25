/** Working out which ATS board(s) a company name or careers URL refers to. */
import type { AtsKind, CompanyDetection } from '../../../shared/types';
import type { Logger } from '../../services';
import { parseAtsUrl, tokenCandidates } from '../../sources/ats-detect';
import type { JobSource, SourceContext } from '../../sources/types';

/** ATSs probed when the user typed a name; most companies with a public board use one of these. */
const NAME_PROBE_ATS: readonly AtsKind[] = ['greenhouse', 'lever', 'ashby'];
/** Each probe is a real request to someone else's API: keep a name lookup to a handful. */
const MAX_PROBES = 12;
const MAX_HITS = 2;

export interface DetectDeps {
  /** The adapter for an ATS (undefined when JScout has none). */
  sourceFor(ats: AtsKind): JobSource | undefined;
  /** A context for one probe (with its own timeout). */
  context(source: JobSource): SourceContext;
  /** Name of a board already in the registry, used when the probe gives none. */
  knownName(ats: AtsKind, token: string): string | undefined;
  log: Logger;
}

export async function detectBoards(input: string, deps: DetectDeps): Promise<CompanyDetection[]> {
  const text = input.trim();
  if (!text) return [];

  const board = parseAtsUrl(text);
  if (board) {
    const found = await probe(board.ats, board.token, deps);
    if (!found) return [];
    const name = found.name ?? deps.knownName(board.ats, board.token) ?? board.token;
    return [{ ats: board.ats, token: board.token, name, jobs: found.jobs }];
  }

  const companyName = nameFromWebsite(text) ?? text;
  const hits: CompanyDetection[] = [];
  let probes = 0;
  // Sequential on purpose: stop as soon as enough boards are found instead of firing every request.
  outer: for (const token of tokenCandidates(companyName)) {
    for (const ats of NAME_PROBE_ATS) {
      if (probes >= MAX_PROBES || hits.length >= MAX_HITS) break outer;
      if (!deps.sourceFor(ats)?.probeBoard) continue;
      probes++;
      const found = await probe(ats, token, deps);
      if (found) hits.push({ ats, token, name: found.name ?? companyName, jobs: found.jobs });
    }
  }
  return hits;
}

async function probe(ats: AtsKind, token: string, deps: DetectDeps): Promise<{ jobs: number; name?: string } | null> {
  const source = deps.sourceFor(ats);
  if (!source?.probeBoard) return null;
  try {
    const found = await source.probeBoard(deps.context(source), token);
    if (!found) return null;
    const name = found.name?.trim();
    return { jobs: Math.max(0, Math.floor(found.jobs) || 0), ...(name ? { name } : {}) };
  } catch (err) {
    // A failed probe is a miss, not an error: the user can still add the board by URL.
    deps.log.debug('company detect: probe failed', { ats, token, reason: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** "https://www.acme.com/careers" -> "acme": a company website is a better source of tokens than the raw URL. */
function nameFromWebsite(text: string): string | undefined {
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text);
  if (!looksLikeUrl) return undefined;
  try {
    const host = new URL(text.includes('://') ? text : `https://${text}`).hostname.toLowerCase();
    const label = host.replace(/^(www|careers|jobs)\./, '').split('.')[0];
    return label || undefined;
  } catch {
    return undefined;
  }
}
