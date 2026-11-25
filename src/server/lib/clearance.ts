/**
 * What a posting says about a security clearance: whether one is needed at all, and if so whether
 * the applicant must already hold it ("active TS/SCI required"), the employer gets it for them
 * ("ability to obtain a Secret clearance"), or the posting doesn't say ("requires a Secret clearance").
 *
 * The posting is read clause by clause. Each clause that mentions a security clearance takes a
 * stance, and the strongest stance in the posting wins:
 *   active (bring one) > sponsored (they get it for you) > required (unclear) > preferred > none (stated)
 * so "Active Secret required, ability to obtain TS/SCI" is "must already hold a Secret", and
 * "Clearance Level Must Currently Possess: None / Must Be Able to Obtain: Secret" is "sponsored".
 *
 * The word "clearance" alone is not enough: it also means FDA, medical, customs, financial and
 * fingerprint clearances, case clearance rates and more. A clause counts only when it names a level
 * (Secret, TS/SCI, Public Trust, DOE Q/L), qualifies the clearance (security, government, active,
 * interim) or asks for one (obtain, hold, eligible for). A polygraph on its own (police hiring) is not
 * a clearance either; it is only noted alongside one.
 */
import type { ClearanceLevel, ClearanceRequirement, JobClearance, PolygraphKind } from '../../shared/types';
import { truncate } from './text';

export interface ClearanceInput {
  title: string;
  tags?: readonly string[];
  /** Plain-text description, one block per line (htmlToText output). */
  text: string;
  /**
   * The employer grants clearances to the people it hires (U.S. federal agencies): a clearance the
   * posting requires without saying more is one they process, not one you must bring.
   */
  sponsorsByDefault?: boolean;
}

type Stance = ClearanceRequirement;

/** Strongest first. */
const PRECEDENCE: readonly Stance[] = ['active', 'sponsored', 'required', 'preferred', 'none'];

/** Highest first; DOE Q is about a Top Secret, DOE L about a Secret. */
export const CLEARANCE_LEVEL_RANK: Readonly<Record<ClearanceLevel, number>> = {
  'ts-sci': 6,
  'top-secret': 5,
  'doe-q': 5,
  secret: 3,
  'doe-l': 3,
  confidential: 2,
  'public-trust': 1,
};

const LEVELS: Array<[ClearanceLevel, RegExp]> = [
  ['ts-sci', /\b(?:ts|top[- ]?secret)\s*(?:\/|-|\s|with|w\/)\s*sci\b|\bsci\s+(?:eligib\w*|access|clearance|indoc\w*)\b|\bsensitive compartmented information\b/i],
  ['top-secret', /\btop[- ]?secret\b/i],
  // "TS" in capitals only: lower-case "ts" is too often something else.
  ['top-secret', /\bTS\b/],
  ['doe-q', /\b(?:doe\s+)?q[- ]?(?:clearance|access authori[sz]ation|sensitive|non-?sensitive)\b/i],
  ['secret', /\bsecret\b/i],
  ['doe-l', /\b(?:doe\s+)?l[- ]?(?:clearance|access authori[sz]ation)\b/i],
  ['confidential', /\bconfidential\s+(?:(?:security|level)\s+)?clearance\b/i],
  ['public-trust', /\bpublic[- ]trust\b/i],
];

/**
 * Other things called a clearance, removed before a clause is read: medical, regulatory, legal,
 * financial, customs and school-employment clearances, aviation, construction and policing terms.
 */
const NON_SECURITY_SOURCE =
  String.raw`\b(?:customs|medical|tax|fingerprint|child abuse(?: history)?|abuse history|fbi|doj|live ?scan|background check|cjis(?:\s+security)?|` +
    String.raw`ground|rail|obstacle|site|land|snow|credit|financial|police|dental|health|tb|immuni[sz]ation|vaccination|case|crime|` +
    String.raw`criminal(?: history)?|export|import|trade|freight|shipment|drug|fda|510\s*\(k\)|regulatory|rights|music|conflicts?|patent|ethics|` +
    String.raw`publication|insurance|patient|electrical|working|tree|vegetation|mine|bomb|inventory|design|legal|aircraft|atc|airspace|` +
    String.raw`takeoff|route|ifr|vfr|athletic|sports?|physical|psychological|return[- ]to[- ]work|occupational|renal|creatinine|hepatic|` +
    String.raw`cardiac|surgical|pa|pennsylvania|state|act\s*\d+(?:\s*(?:,|and|&|\/)\s*(?:act\s*)?\d+)*)\s+clearances?(?:\s+(?:cards?|letters?|rates?))?\b` +
    String.raw`|\bclearances?\s+(?:cards?|rates?|sales?|letters?|center)\b|\bclearances?\s*\((?:pa\s+)?act\b|\bclearance (?:of|from) (?:a |the |your )?(?:physician|doctor|provider)\b`;
const NON_SECURITY = new RegExp(NON_SECURITY_SOURCE, 'gi');
const IS_NON_SECURITY = new RegExp(NON_SECURITY_SOURCE, 'i');

/** A security clearance named outright, or by its level. */
const MENTION: RegExp[] = [
  /\b(?:security|government|federal|national security|personnel security|dod|dhs|doe|nato|u\.?\s?s\.?|us government)\s+(?:(?:security|government)\s+)?clearances?\b/i,
  /\b(?:top[- ]?secret|ts|secret|confidential|sci|q|l|public[- ]trust)\s*(?:\/\s*sci\s*)?(?:level\s+)?(?:security\s+)?clearances?\b/i,
  /\b(?:ts|top[- ]?secret)\s*[/-]\s*sci\b/i,
  /\btop[- ]?secret\b/i,
  /\bsci\s+(?:eligib\w*|access)\b/i,
  /\bsensitive compartmented information\b/i,
  /\b(?:active|current|interim|final|existing|dod|doe|dhs)\s+(?:dod\s+|u\.?s\.?\s+)?(?:secret|ts)\b/i,
  /\bsecret\s+(?:or\s+(?:higher|above|better)|level|eligib\w*)\b/i,
  /\bpublic[- ]trust\s+(?:clearance|position|background|investigation|level|suitability|eligib\w*|determination)\b/i,
  /\b(?:obtain|active|current|hold|maintain|possess|a|an)\s+public[- ]trust\b/i,
  /\bcleared\s+(?:candidates?|applicants?|individuals?|professionals?|personnel|engineers?|developers?|analysts?|resources?|staff|positions?)\b/i,
  /\bmust\s+(?:be|currently be|already be)\s+cleared\b/i,
  /\baccess to classified (?:information|material|data)\b/i,
  /\b(?:government\s+)?security investigation\b/i,
  /\b(?:sf[- ]?86|e-?qip)\b/i,
  // A clearance described by what it takes, without a level.
  /\b(?:active|current|interim|final|existing|valid|in[- ]scope)\s+(?:\w+\s+){0,2}clearances?\b/i,
  /\b(?:obtain|acquire|maintain|hold|possess|sponsor|eligib\w*)\b(?:\s+and\s+maintain)?\s+(?:an?\s+|the\s+(?:required\s+)?|your\s+)?(?:\w+\s+){0,2}clearances?\b(?!\s+(?:from|for|to)\b)/i,
  /\bclearances?\s+(?:is\s+|are\s+)?(?:required|requirements?|preferred|eligib\w*|sponsor\w*|holders?|level|investigation|process)\b/i,
  /\bclearance\s+sponsorship\b/i,
];

const NOT_REQUIRED = [
  /\b(?:no|not|n['’]t|without)\b[^.;]{0,30}\bclearances?\b[^.;]{0,15}\b(?:required|needed|necessary|requirement)\b/i,
  /\bclearances?\b[^.;]{0,20}\b(?:is\s+|are\s+)?not\s+(?:required|needed|necessary)\b/i,
  /\b(?:does|do|will)\s+not\s+require\s+(?:an?\s+|any\s+)?(?:\w+\s+){0,2}clearances?\b/i,
  /\bno\s+(?:\w+\s+){0,2}clearances?\s+(?:is\s+)?(?:required|needed|necessary)\b/i,
];
const NONE_VALUE = /^(?:none|no|n\/a|na|not (?:required|applicable|needed)|not req\w*)\b/i;

const PREFERRED =
  /\b(?:preferred|desired|desirable|nice[- ]to[- ]have|bonus|advantage(?:ous)?|ideally|beneficial|highly (?:desired|valued)|helpful|encouraged to apply|welcome|an? (?:big |huge |definite |strong )?plus|is a plus|optional)\b/i;
const REQUIRED = /\b(?:required|requires?|requirement|must|mandatory|need(?:ed|s)?|necessary|essential)\b/i;

/** The employer gets you the clearance: you only need to be eligible for one. */
const SPONSOR =
  /\b(?:obtain\w*|acquire|be granted|receive)\b|\b(?:ability|able|eligib\w*|willing\w*|capable|qualify|qualified)\s+(?:to|for)\b|\bsponsor\w*|\bsubject to\b[^.;]{0,40}\b(?:investigation|adjudication)|\bundergo\w*\b[^.;]{0,40}\b(?:investigation|background)|\bsecurity investigation\b|\badjudicat\w*|\bwe(?:'ll| will) (?:get|help) you\b/i;
/** "We cannot sponsor a clearance": you must bring one. */
const NO_SPONSOR = /\b(?:not|n['’]t|unable to|cannot|no)\s+(?:\w+\s+){0,2}sponsor\w*/i;
const VISA = /\b(?:visa|immigration|work authori[sz]ation|h-?1b|green card)\b/i;

/** You must already hold one. */
const ACTIVE =
  /\b(?:active|current(?:ly)?|existing|interim|in[- ]scope)\b|\bmust\s+(?:already\s+)?(?:hold|possess|have)\b|\b(?:hold|holds|holding|possess|possesses|possessing|possession of)\b|\bcleared\b|\btransfer(?:r?able)?\b|\breinstat\w*|\bat (?:the )?time of (?:hire|application|applying|start|offer)\b|\bprior to (?:start(?:ing)?|hire|employment)\b|\bon day (?:one|1)\b|\bto start\b/i;
/** "without an active clearance": not a demand to hold one. */
const NEGATED_ACTIVE = /\b(?:without|lack(?:ing)?|no|not (?:currently )?(?:hold|have|possess)|(?:do|does|don['’]t|doesn['’]t) not? ?(?:currently )?(?:hold|have|possess))\s+(?:an?\s+)?(?:active|current|existing)\b/gi;

const POLYGRAPH: Array<[PolygraphKind, RegExp]> = [
  ['full-scope', /\b(?:full[- ]?scope|fsp|fs|lifestyle)\s*(?:poly(?:graph)?)\b|\b(?:ts\s*\/\s*sci|sci)\s*(?:\/|w\/|with)\s*(?:fsp?|full[- ]?scope)\b/i],
  ['ci', /\b(?:ci|counter[- ]?intelligence)\s*(?:poly(?:graph)?)\b|\b(?:ts\s*\/\s*sci|sci)\s*(?:\/|w\/|with)\s*ci\b/i],
  ['polygraph', /\bpoly(?:graph)?\b/i],
];
const NOT_POLYGRAPH = /\bcal poly\b|\bpoly(?:mer|ester|nomial|technic)/i;

const PREFERRED_HEADING =
  /\b(?:nice[- ]to[- ]haves?|preferred|bonus|pluses|desired|desirable|ideally|good to have|extra credit|not required|optional|would be great)\b/i;
const REQUIRED_HEADING =
  /\b(?:requirements?|qualifications?|what you(?:'|’)?ll (?:bring|need|have)|what you bring|looking for|must[- ]haves?|you have|you bring|about you|who you are|skills|essential|competencies|minimum|basic)\b/i;

type Section = 'required' | 'preferred' | 'other';

interface Clause {
  /** The sentence it came from (shown as evidence). */
  sentence: string;
  text: string;
  section: Section;
  /** A bullet, a short line, the title or a tag: a clearance named there is asked for even without "required". */
  listed: boolean;
  title?: boolean;
}

const LABEL = /^((?:[\w/().-]+\s+){0,6}?(?:clearances?|poly(?:graph)?)(?:\s+[\w/().-]+){0,6}?)\s*[:–—-]\s+(\S.*)$/i;

function isHeading(line: string): boolean {
  if (line.length > 80) return false;
  if (line.endsWith(':')) return true;
  return !/[.!?,;]$/.test(line) && line.split(/\s+/).length <= 8;
}

/** Words ending in a full stop that do not end a sentence ("U.S. Secret clearance", "e.g. TS/SCI"). */
const ABBREVIATION = /(?:\b(?:[A-Za-z]\.){1,3}|\b(?:e\.g|i\.e|etc|inc|corp|co|jr|sr|mr|mrs|ms|dr|no|vs|approx|dept|govt|gov|min|max|yrs?)\.)$/i;

function sentences(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of line.matchAll(/[.!?]+\s+(?=[A-Z0-9"“(])/g)) {
    const end = m.index + m[0].trimEnd().length;
    if (ABBREVIATION.test(line.slice(start, end))) continue;
    out.push(line.slice(start, end));
    start = m.index + m[0].length;
  }
  out.push(line.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Clauses of a sentence: split at semicolons and "but", and before "and/with/plus the ability to…",
 * so "Active Secret required with ability to obtain TS/SCI" reads as two demands. "Or" is kept
 * inside a clause: "active clearance or the ability to obtain one" is one, lower, demand.
 */
function clauses(sentence: string): string[] {
  return sentence
    .split(/\s*;\s*|\s*,?\s+but\s+|,\s*however\b|\s*,?\s+(?:and|with|plus|w\/)\s+(?=(?:the\s+|an?\s+)?(?:ability|able|eligib\w*|willing\w*|obtain\w*|capable)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clean(text: string): string {
  return text.replace(NON_SECURITY, ' ');
}

function mentions(text: string): boolean {
  return MENTION.some((re) => re.test(text));
}

function levelOf(text: string): ClearanceLevel | undefined {
  let best: ClearanceLevel | undefined;
  for (const [level, re] of LEVELS) {
    if (re.test(text) && (best === undefined || CLEARANCE_LEVEL_RANK[level] > CLEARANCE_LEVEL_RANK[best])) best = level;
  }
  return best;
}

function polygraphOf(text: string): PolygraphKind | undefined {
  if (NOT_POLYGRAPH.test(text) && !/\bpolygraph\b/i.test(text.replace(NOT_POLYGRAPH, ''))) return undefined;
  return POLYGRAPH.find(([, re]) => re.test(text))?.[0];
}

/** What one clause asks for; undefined when it does not mention a security clearance. */
function stanceOf(clause: Clause): Stance | undefined {
  const label = LABEL.exec(clause.text);
  if (label && /clearance/i.test(label[1]!) && !IS_NON_SECURITY.test(label[1]!)) {
    const value = label[2]!.trim();
    if (NONE_VALUE.test(value)) return 'none';
    // "Clearance Level Must Currently Possess: Secret" reads with its label; "Security Clearance: Yes" is a requirement.
    return stanceOfText(`${label[1]} ${value}`, clause, true);
  }
  return stanceOfText(clause.text, clause, false);
}

/** "Cleared Network Engineer": a title that says the hire holds a clearance. */
const CLEARED_TITLE = /\bcleared\b/i;
/** "…requires a Secret clearance. You must be able to obtain it." */
const REFERENCE = /\b(?:obtain|maintain|hold|possess|get|keep|transfer|reinstate)\s+(?:and\s+maintain\s+)?(?:it|one|this(?: clearance)?|such(?: an?)? clearance|the clearance)\b/i;

function stanceOfText(raw: string, clause: Clause, labelled: boolean): Stance | undefined {
  const text = clean(raw);
  if (clause.title && CLEARED_TITLE.test(text)) return 'active';
  if (!labelled && !mentions(text)) return undefined;
  if (NOT_REQUIRED.some((re) => re.test(text)) && !SPONSOR.test(text)) return 'none';

  const unnegated = text.replace(NEGATED_ACTIVE, ' ');
  const required = REQUIRED.test(text);
  if ((PREFERRED.test(text) || clause.section === 'preferred') && !required) return 'preferred';

  // "We are unable to sponsor clearances": bring your own (a visa they won't sponsor is another matter).
  if (NO_SPONSOR.test(text) && !VISA.test(text)) return 'active';
  const sponsor = SPONSOR.exec(unnegated);
  const active = ACTIVE.exec(unnegated);
  if (sponsor && active) {
    // "Able to obtain and maintain an active Secret": the active clearance is the one they get you.
    if (sponsor.index < active.index) return 'sponsored';
    // "Active Secret or the ability to obtain one": either will do.
    if (/\bor\b/i.test(unnegated.slice(active.index, sponsor.index))) return 'sponsored';
    return 'active';
  }
  if (active) return 'active';
  if (sponsor) return 'sponsored';
  // Prose that only mentions clearances ("our cleared customers") asks nothing of the applicant.
  if (required || labelled || clause.listed || clause.section === 'required') return 'required';
  return undefined;
}

function* readClauses(input: ClearanceInput): Generator<Clause> {
  const title = input.title.trim();
  if (title) {
    for (const text of clauses(title)) yield { sentence: title, text, section: 'required', listed: true, title: true };
  }
  for (const tag of input.tags ?? []) {
    if (tag.trim()) yield { sentence: tag, text: tag, section: 'required', listed: true };
  }
  let section: Section = 'other';
  for (const rawLine of input.text.split('\n')) {
    let line = rawLine.trim();
    if (!line) continue;
    const bullet = /^(?:[-*•·▪◦‣●○]|\d{1,2}[.)])\s+/.exec(line);
    if (bullet) line = line.slice(bullet[0].length).trim();
    else if (isHeading(line) && !mentions(clean(line)) && !LABEL.test(line)) {
      section = PREFERRED_HEADING.test(line) ? 'preferred' : REQUIRED_HEADING.test(line) ? 'required' : 'other';
      continue;
    }
    const short = line.split(/\s+/).length <= 12;
    for (const sentence of sentences(line)) {
      for (const text of clauses(sentence)) yield { sentence, text, section, listed: Boolean(bullet) || short };
    }
  }
}

const EVIDENCE_CHARS = 220;

/** The posting's clearance requirement; undefined when it doesn't mention one. */
export function detectClearance(input: ClearanceInput): JobClearance | undefined {
  // Cheap gate: most postings never come near the subject.
  const haystack = `${input.title}\n${(input.tags ?? []).join('\n')}\n${input.text}`;
  if (!/clearance|secret|public[- ]trust|ts\s*[/-]\s*sci|cleared|classified|security investigation|sf[- ]?86|e-?qip/i.test(haystack)) return undefined;

  const found: Array<{ clause: Clause; stance: Stance; level?: ClearanceLevel }> = [];
  let previous: { clause: Clause; stance: Stance } | undefined;
  for (const clause of readClauses(input)) {
    let stance = stanceOf(clause);
    let level: ClearanceLevel | undefined;
    // A clause right after a clearance demand that refers back to it ("You must be able to obtain it").
    if (!stance && previous && previous.stance !== 'none' && REFERENCE.test(clause.text)) {
      stance = stanceOfText(clause.text, clause, true);
      level = levelOf(clean(previous.clause.text));
    }
    if (stance) {
      found.push({ clause, stance, ...(level ? { level } : {}) });
      previous = { clause, stance };
    } else previous = undefined;
  }
  if (found.length === 0) return undefined;

  let stance = PRECEDENCE.find((s) => found.some((f) => f.stance === s))!;
  if (stance === 'required' && input.sponsorsByDefault) stance = 'sponsored';
  const deciding = found.filter((f) => f.stance === stance || (stance === 'sponsored' && input.sponsorsByDefault && f.stance === 'required'));
  const out: JobClearance = { requirement: stance };
  if (stance === 'none') {
    out.evidence = truncate(deciding[0]!.clause.sentence, EVIDENCE_CHARS);
    return out;
  }

  // The level of the deciding clauses ("active Secret … ability to obtain TS/SCI" asks you to bring a Secret),
  // else the highest level any other demand names.
  const pick = (list: typeof found): ClearanceLevel | undefined =>
    list.map((f) => f.level ?? levelOf(clean(f.clause.text))).reduce<ClearanceLevel | undefined>(
      (best, l) => (l && (!best || CLEARANCE_LEVEL_RANK[l] > CLEARANCE_LEVEL_RANK[best]) ? l : best),
      undefined,
    );
  const level = pick(deciding) ?? pick(found.filter((f) => f.stance !== 'preferred' && f.stance !== 'none'));
  if (level) out.level = level;

  // A polygraph alongside the clearance: anywhere in the posting, unless only as a nice-to-have.
  const kinds: PolygraphKind[] = [];
  for (const clause of readClauses(input)) {
    const text = clean(clause.text);
    const kind = polygraphOf(text);
    if (!kind) continue;
    if (clause.section === 'preferred' || (PREFERRED.test(text) && !REQUIRED.test(text))) continue;
    if (NOT_REQUIRED.some((re) => re.test(text)) || /\bpoly(?:graph)?\s*[:–—-]\s*(?:none|no|n\/a)\b/i.test(text)) continue;
    kinds.push(kind);
  }
  const polygraph = (['full-scope', 'ci', 'polygraph'] as const).find((k) => kinds.includes(k));
  if (polygraph) out.polygraph = polygraph;

  out.evidence = truncate(deciding[0]!.clause.sentence, EVIDENCE_CHARS);
  return out;
}
