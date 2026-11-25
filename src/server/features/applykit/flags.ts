/**
 * Requirements in a posting that may rule the user out. Each check reads the posting
 * sentence by sentence and stays quiet when the profile already answers it.
 */
import { clearanceFit } from '../../../shared/clearance';
import { detectClearance } from '../../lib/clearance';
import { truncate } from '../../lib/text';
import type { JobContext, ProfileContext } from './context';
import { containsPhrase, phraseKey, splitSentences } from './text';

/** Statements that mention citizenship etc. only to say it does NOT matter (EEO boilerplate). */
const NEGATED_CONTEXT = /\b(regardless of|without regard|irrespective of|not discriminate|equal opportunity)\b/i;

const CITIZENSHIP = [
  /\b(must be|must hold|requires?|required|only)\b.{0,40}\bcitizen(s|ship)?\b/i,
  /\bcitizen(s|ship)?\b.{0,30}\b(is |are )?(required|only|a requirement|mandatory)\b/i,
];
/** Country mentions, short forms case-sensitive so the pronoun "us" is not read as the US. */
const COUNTRY_SHORT = /\b(U\.?S\.?A?|U\.?K|EU)\b/g;
const COUNTRY_LONG = /\b(united states|american|canad(?:a|ian)|british|european|australian?)\b/gi;
const COUNTRY_CODE: Array<[RegExp, string]> = [
  [/^(u\.?s\.?a?|united states|american)$/i, 'us'],
  [/^(u\.?k|british)$/i, 'uk'],
  [/^(eu|european)$/i, 'eu'],
  [/^canad/i, 'ca'],
  [/^australia/i, 'au'],
];

function countries(text: string): Set<string> {
  const found = [...(text.match(COUNTRY_SHORT) ?? []), ...(text.match(COUNTRY_LONG) ?? [])];
  return new Set(found.map((c) => COUNTRY_CODE.find(([re]) => re.test(c))?.[1] ?? c.toLowerCase()));
}

const NO_SPONSORSHIP = [
  /\b(unable to|cannot|can't|can’t|will not|won't|won’t|not able to|do not|does not|don't|don’t|no)\s+(provide |offer |support )?(visa |immigration |work )?sponsor/i,
  /\bsponsorship (is |will )?(not|n't) (be )?(available|offered|provided|possible)/i,
  /\bwithout (the need for |requiring )?(current or future |now or in the future )?(visa |employer )?sponsorship/i,
  /\bnot (eligible|able) to sponsor/i,
];

const ONSITE_ONLY = [
  /\b(on-?site|in[- ]office|in[- ]person)\b.{0,30}\b(only|required|mandatory|5 days|five days|full[- ]time)\b/i,
  /\b(this is )?not a remote (role|position|job)\b/i,
  /\b(no remote|remote work is not (available|possible|offered))\b/i,
];

/** Known licences/certifications: pattern, display name, and words that show the user holds it. */
const CREDENTIALS: Array<{ re: RegExp; name: string; evidence: string[] }> = [
  {
    re: /\b(RN|registered nurse) licen[cs]e\b|\blicen[cs]ed (as an? )?(RN|registered nurse)\b|\bactive RN\b/,
    name: 'an RN licence',
    evidence: ['RN', 'registered nurse'],
  },
  { re: /\b(LPN|LVN)\b/, name: 'an LPN/LVN licence', evidence: ['LPN', 'LVN', 'licensed practical nurse'] },
  { re: /\bBLS\b/, name: 'BLS certification', evidence: ['BLS', 'basic life support'] },
  { re: /\bACLS\b/, name: 'ACLS certification', evidence: ['ACLS', 'advanced cardiovascular life support'] },
  { re: /\bPALS\b/, name: 'PALS certification', evidence: ['PALS', 'pediatric advanced life support'] },
  { re: /\bCNA\b/, name: 'CNA certification', evidence: ['CNA', 'certified nursing assistant'] },
  { re: /\bCPA\b/, name: 'a CPA', evidence: ['CPA', 'certified public accountant'] },
  { re: /\bCFA\b/, name: 'the CFA charter', evidence: ['CFA'] },
  { re: /\bPMP\b/, name: 'PMP certification', evidence: ['PMP', 'project management professional'] },
  { re: /\bCDL\b/, name: 'a commercial driver’s licence (CDL)', evidence: ['CDL', 'commercial driver'] },
  { re: /\bCISSP\b/, name: 'CISSP certification', evidence: ['CISSP'] },
  { re: /\bSeries (7|63|65|66)\b/, name: 'a FINRA Series licence', evidence: ['series 7', 'series 63', 'series 65', 'series 66'] },
  { re: /\b(PE|professional engineer) licen[cs]e\b/, name: 'a PE licence', evidence: ['PE', 'professional engineer'] },
  { re: /\bbar admission\b|\badmitted to (the|practice)\b.{0,20}\bbar\b/i, name: 'bar admission', evidence: ['bar'] },
  {
    re: /\bdriver['’]?s licen[cs]e\b|\bdriving licen[cs]e\b/i,
    name: 'a valid driver’s licence',
    evidence: ['driver license', 'drivers license', 'driving licence', 'driving license', 'driver licence'],
  },
];
const REQUIRED_CONTEXT = /\b(required|requires?|must|mandatory|need(ed)?|essential|active|current|valid)\b/i;
const GENERIC_CREDENTIAL = /\b(licen[cs]e|licensure|certification)\b/i;

const YEARS = /\b(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?years?['’]?\s+(?:of\s+)?(?:[\w/+#.-]+\s+){0,5}?experience\b/gi;

/** The largest "N+ years of experience" minimum in the posting, or undefined. */
export function requiredYears(text: string): number | undefined {
  let max: number | undefined;
  for (const m of text.matchAll(YEARS)) {
    const n = Number(m[1]);
    if (n > 0 && n <= 25 && (max === undefined || n > max)) max = n;
  }
  return max;
}

function mentions(profile: ProfileContext, text: string): boolean {
  return containsPhrase(profile.corpus, phraseKey(text));
}

function quote(sentence: string): string {
  return `“${truncate(sentence, 120)}”`;
}

export function detectFlags(job: JobContext, profile: ProfileContext): string[] {
  const flags: string[] = [];
  const sentences = splitSentences(job.descriptionText).filter((s) => !NEGATED_CONTEXT.test(s));
  const find = (patterns: RegExp[]) => sentences.find((s) => patterns.some((p) => p.test(s)));
  const { work, preferences } = profile.profile;

  // Only what still stands in the way: a clearance they sponsor, or one the user holds, is no blocker.
  const asked = job.clearance ?? detectClearance({ title: job.title, text: job.descriptionText });
  const clearance = clearanceFit(asked, work.clearance);
  if (clearance.standing === 'short' || clearance.standing === 'ask') {
    flags.push(`Security clearance: ${clearance.note}${asked?.evidence ? ` ${quote(asked.evidence)}` : ''}`);
  }

  const citizenship = find(CITIZENSHIP);
  if (citizenship) {
    const required = countries(citizenship);
    const held = countries(work.workAuthorization);
    const satisfied =
      (/citizen/i.test(work.workAuthorization) && (required.size === 0 || [...required].some((c) => held.has(c)))) ||
      // "citizen or permanent resident" is met by a permanent resident.
      (/permanent resident/i.test(citizenship) && /permanent resident/i.test(work.workAuthorization));
    if (!satisfied) flags.push(`Citizenship requirement: ${quote(citizenship)}`);
  }

  const wantsOnlyRemoteOrHybrid = preferences.remote.length > 0 && !preferences.remote.includes('onsite');
  if (wantsOnlyRemoteOrHybrid) {
    const onsite = find(ONSITE_ONLY);
    if (onsite || job.location.remote === 'onsite') {
      flags.push(
        onsite
          ? `On-site only, but you prefer ${preferences.remote.join(' or ')} work: ${quote(onsite)}`
          : `The role is on-site, but you prefer ${preferences.remote.join(' or ')} work.`,
      );
    }
  }

  if (work.requiresSponsorship === true) {
    const noSponsor = find(NO_SPONSORSHIP);
    if (noSponsor) flags.push(`Visa sponsorship is not offered, and your profile says you need it: ${quote(noSponsor)}`);
  }

  const credentials = new Set<string>();
  const generic: string[] = [];
  const holdsSomeCredential = ['licence', 'license', 'licensed', 'certification', 'certified'].some((t) => mentions(profile, t));
  for (const s of sentences) {
    if (!REQUIRED_CONTEXT.test(s)) continue;
    const known = CREDENTIALS.filter((c) => c.re.test(s));
    for (const c of known) if (!c.evidence.some((e) => mentions(profile, e))) credentials.add(c.name);
    if (known.length === 0 && GENERIC_CREDENTIAL.test(s) && !holdsSomeCredential) generic.push(s);
  }
  for (const c of credentials) flags.push(`Requires ${c}, which your profile doesn't mention.`);
  // One quoted example is enough; listing every licence sentence would bury the other flags.
  if (generic[0] !== undefined) flags.push(`Licence or certification requirement: ${quote(generic[0])}`);

  const years = requiredYears(job.descriptionText);
  if (years !== undefined && work.yearsExperience !== null && years >= work.yearsExperience + 3) {
    flags.push(`Asks for ${years}+ years of experience; your profile says ${work.yearsExperience}.`);
  }
  return flags;
}
