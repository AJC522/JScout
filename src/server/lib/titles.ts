/**
 * Job-title understanding backed by the bundled role taxonomy
 * (loadReference('roles') from ../data).
 *
 * analyzeTitle splits a posting title into segments (main title, team/specialisation segments,
 * parenthetical asides), drops the noise (locations, work arrangement, employment type, pay, shifts,
 * requisition ids, gender markers), strips seniority words and levels while recording them, and maps
 * what is left to a taxonomy role. Everything is token based and table driven; the indexes are built
 * lazily on first use.
 */
import type { EmploymentType, Seniority } from '../../shared/types';
import { loadReference } from '../data';
import { foldText, normalizeText } from './text';
import {
  ARRANGEMENT_WORDS,
  CITIES,
  COUNTRIES,
  CURATED_TITLE_ALIASES,
  EMPLOYMENT_WORDS,
  FIELD_TO_PRACTITIONER,
  FOREIGN_HEADS,
  GENERIC_HEADS,
  IC_MANAGER_MODIFIERS,
  IC_MANAGER_ROLE_IDS,
  LANGUAGE_NAMES,
  LEADING_FUNCTION_WORDS,
  LEADING_NOISE,
  NON_DIRECTOR_PHRASES,
  NO_SINGLE_HEAD_MAP,
  PEOPLE_MANAGER_ROLE_IDS,
  PLACE_FILLERS,
  PROMO_WORDS,
  PROTECTED_PHRASES,
  REGION_CODES,
  REGIONS,
  SEGMENT_ONLY_PLACES,
  SHIFT_WORDS,
  SPEAKER_WORDS,
  TITLE_ABBREVIATIONS,
  US_STATES,
} from './titles-data';

export interface RoleRef {
  id: string;
  title: string;
  familyId: string;
  family: string;
  aliases: string[];
  /** Ids of adjacent roles. */
  related: string[];
  skills: string[];
}

export interface TitleInfo {
  raw: string;
  /**
   * The title with noise removed and seniority stripped, in normalizeText form, keeping
   * specialisation/team words in their original order:
   *   "Sr. Software Engineer II (Remote) - Payments"  -> "software engineer payments"
   *   "Senior Software Engineer, Backend (Remote - US)" -> "software engineer backend"
   * Removed: seniority words and levels (I/II/III, L4, "level 2"), parenthetical/bracketed asides,
   * trailing location segments, work-arrangement and contract words (remote, hybrid, contract,
   * m/f/d, f/m/x, h/f, "all genders"), pay/shift decorations, requisition ids.
   * Kept: team and specialisation words, because "Software Engineer - Payments" and
   * "Software Engineer - Fraud" are different jobs and must not be merged as duplicates.
   * Used for de-duplication (same company + same core + same seniority + same place = same job)
   * and for title matching.
   */
  core: string;
  seniority: Seniority;
  /** Taxonomy role the core title maps to (by title or alias), when recognised. */
  role?: RoleRef;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const RANK: Record<Seniority, number> = {
  unknown: 0,
  intern: 0,
  entry: 1,
  mid: 2,
  senior: 3,
  lead: 4,
  manager: 5,
  director: 6,
  executive: 7,
};

const phraseSet = (list: string[]): Set<string> => new Set(list.map((w) => normalizeText(w)).filter(Boolean));
const maxWords = (set: Set<string>): number => {
  let m = 1;
  for (const p of set) m = Math.max(m, p.split(' ').length);
  return m;
};

interface PhraseTable {
  set: Set<string>;
  max: number;
  /** First word of each phrase -> the most words of any phrase starting with it. */
  first: Map<string, number>;
}
const table = (list: string[]): PhraseTable => {
  const set = phraseSet(list);
  const first = new Map<string, number>();
  for (const p of set) {
    const w = p.split(' ');
    first.set(w[0]!, Math.max(first.get(w[0]!) ?? 0, w.length));
  }
  return { set, max: maxWords(set), first };
};

/** Length (in tokens) of the longest phrase of `t` starting at tokens[i], or 0. */
function phraseAt(tokens: string[], i: number, t: PhraseTable, end = tokens.length): number {
  if (i >= end) return 0;
  const m = t.first.get(tokens[i]!);
  if (m === undefined) return 0;
  const lim = Math.min(m, end - i);
  let s = tokens[i]!;
  let best = t.set.has(s) ? 1 : 0;
  for (let k = 1; k < lim; k++) {
    s += ' ' + tokens[i + k]!;
    if (t.set.has(s)) best = k + 1;
  }
  return best;
}

const ASCII_RE = /^[\x00-\x7f]*$/;
const ASCII_NON_WORD_RE = /[^a-z0-9+#]+/g;

/** normalizeText with a fast path for plain-ASCII input (same result). */
function norm(s: string): string {
  if (ASCII_RE.test(s)) return s.toLowerCase().replace(ASCII_NON_WORD_RE, ' ').trim();
  return normalizeText(s);
}

// ---------------------------------------------------------------------------
// Static tables (built once)
// ---------------------------------------------------------------------------

interface Tables {
  strongPlaces: PhraseTable;
  segmentPlaces: PhraseTable;
  fillers: Set<string>;
  codes: Set<string>;
  arrangement: PhraseTable;
  employment: PhraseTable;
  shift: PhraseTable;
  promo: PhraseTable;
  protectedP: PhraseTable;
  nonDirector: PhraseTable;
  leadingNoise: PhraseTable;
  leadingFunction: Set<string>;
  languages: Set<string>;
  speakers: Set<string>;
}

let tables: Tables | undefined;
function getTables(): Tables {
  tables ??= {
    strongPlaces: table([...COUNTRIES, ...US_STATES, ...REGIONS, ...CITIES]),
    segmentPlaces: table([...COUNTRIES, ...US_STATES, ...REGIONS, ...CITIES, ...SEGMENT_ONLY_PLACES]),
    fillers: new Set(PLACE_FILLERS),
    codes: new Set(REGION_CODES),
    arrangement: table(ARRANGEMENT_WORDS),
    employment: table(EMPLOYMENT_WORDS),
    shift: table(SHIFT_WORDS),
    promo: table(PROMO_WORDS),
    protectedP: table(PROTECTED_PHRASES),
    nonDirector: table(NON_DIRECTOR_PHRASES),
    leadingNoise: table(LEADING_NOISE),
    leadingFunction: new Set(LEADING_FUNCTION_WORDS),
    languages: new Set(LANGUAGE_NAMES),
    speakers: new Set(SPEAKER_WORDS),
  };
  return tables;
}

// ---------------------------------------------------------------------------
// Taxonomy index (built lazily)
// ---------------------------------------------------------------------------

interface PhraseEntry {
  role: RoleRef;
  tokens: string[];
  isTitle: boolean;
}

interface SuggestEntry {
  display: string;
  norm: string;
  words: string[];
  role: RoleRef;
  canonical: boolean;
}

interface RoleIndex {
  roles: RoleRef[];
  byId: Map<string, RoleRef>;
  phrases: Map<string, PhraseEntry>;
  byFirst: Map<string, PhraseEntry[]>;
  suggest: SuggestEntry[];
  /** IDF of each typical skill over roles (lower-cased skill name). */
  idf: Map<string, number>;
  /** Sum of the IDF weights of each role's skills. */
  roleMass: Map<string, number>;
  buildMs: number;
}

let roleIndex: RoleIndex | undefined;

function phraseVariants(title: string): string[] {
  const out = new Set<string>();
  const base = normalizeText(title);
  if (!base) return [];
  out.add(base);
  // "Food & Beverage" is normalised to "food beverage"; "Food and Beverage" must meet it.
  const noAnd = base
    .split(' ')
    .filter((w) => w !== 'and')
    .join(' ');
  if (noAnd) out.add(noAnd);
  // "Back-End Engineer" -> "backend engineer"; "E-commerce" -> "ecommerce"
  if (/[\p{L}\p{N}]-[\p{L}\p{N}]/u.test(title)) {
    const joined = normalizeText(title.replace(/([\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, '$1'));
    if (joined) out.add(joined);
  }
  return [...out];
}

function buildRoleIndex(): RoleIndex {
  const t0 = performance.now();
  const data = loadReference('roles');
  const roles: RoleRef[] = [];
  const byId = new Map<string, RoleRef>();
  for (const f of data.families) {
    for (const r of f.roles) {
      const ref: RoleRef = Object.freeze({
        id: r.id,
        title: r.title,
        familyId: f.id,
        family: f.name,
        aliases: Object.freeze([...r.aliases]) as string[],
        related: Object.freeze([...r.related]) as string[],
        skills: Object.freeze([...r.skills]) as string[],
      });
      roles.push(ref);
      byId.set(ref.id, ref);
    }
  }
  const phrases = new Map<string, PhraseEntry>();
  const add = (text: string, role: RoleRef, isTitle: boolean): void => {
    for (const v of phraseVariants(text)) {
      const prev = phrases.get(v);
      // canonical titles win over aliases; otherwise first come first served
      if (!prev || (isTitle && !prev.isTitle)) phrases.set(v, { role, tokens: v.split(' '), isTitle });
    }
  };
  for (const r of roles) add(r.title, r, true);
  for (const r of roles) for (const a of r.aliases) add(a, r, false);
  for (const [phrase, id] of Object.entries(CURATED_TITLE_ALIASES)) {
    const r = byId.get(id);
    if (r && !phrases.has(phrase)) phrases.set(phrase, { role: r, tokens: phrase.split(' '), isTitle: false });
  }
  const byFirst = new Map<string, PhraseEntry[]>();
  for (const e of phrases.values()) {
    const k = e.tokens[0]!;
    const list = byFirst.get(k);
    if (list) list.push(e);
    else byFirst.set(k, [e]);
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);

  const suggest: SuggestEntry[] = [];
  for (const r of roles) {
    const n = normalizeText(r.title);
    suggest.push({ display: r.title, norm: n, words: n.split(' '), role: r, canonical: true });
  }
  for (const r of roles)
    for (const a of r.aliases) {
      const n = normalizeText(a);
      suggest.push({ display: a, norm: n, words: n.split(' '), role: r, canonical: false });
    }

  const df = new Map<string, number>();
  for (const r of roles) for (const s of new Set(r.skills.map((x) => x.toLowerCase()))) df.set(s, (df.get(s) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [s, n] of df) idf.set(s, Math.log((roles.length + 1) / n));
  const roleMass = new Map<string, number>();
  for (const r of roles) roleMass.set(r.id, r.skills.reduce((a, s) => a + (idf.get(s.toLowerCase()) ?? 0), 0));

  return { roles, byId, phrases, byFirst, suggest, idf, roleMass, buildMs: performance.now() - t0 };
}

function getRoleIndex(): RoleIndex {
  roleIndex ??= buildRoleIndex();
  return roleIndex;
}

/** Time spent building the role index (ms); builds it if needed. For diagnostics and tests. */
export function roleIndexBuildMs(): number {
  return getRoleIndex().buildMs;
}

function lookupPhrase(text: string): PhraseEntry | undefined {
  if (!text) return undefined;
  const idx = getRoleIndex();
  return idx.phrases.get(text) ?? (text.includes(' and ') ? idx.phrases.get(text.replace(/ and /g, ' ')) : undefined);
}

// ---------------------------------------------------------------------------
// Pre-cleaning of the raw title
// ---------------------------------------------------------------------------

const GENDER_RE =
  /\(?\s*\b[mwfdxh]\s*[/|,]\s*[mwfdxh](?:\s*[/|,]\s*(?:div(?:ers|erse)?\.?|[mwfdxh]))?\b\s*\)?|\(\s*(?:all|any)\s+genders?\s*\)|\b(?:all|any)\s+genders?\b|\(\s*gn\s*\)|\(\s*(?:mwd|mfd|fmd|wmd|dmw|fmx|mfx)\s*\)/giu;
/** Anything GENDER_RE or GENDER_SUFFIX_RE could match contains one of these. */
const GENDER_HINT_RE = /[/|,*:_]|gender|\(\s*(?:gn|mwd|mfd|fmd|wmd|dmw|fmx|mfx)\s*\)/i;
const DIGIT_RE = /\d/;
const GENDER_SUFFIX_RE = /(\p{L})(?:\*|:|_|\/-?)in(?:nen)?\b/gu;
const APOSTROPHE_RE = /(\p{L})['’](\p{L})/gu;
const UKI_RE = /\bUK\s*&\s*I\b/gi;
const REQ_RE =
  /\b(?:req(?:uisition)?|job|jr|ref(?:erence)?|position|posting|vacancy)\s*(?:id|no\.?|number|#)?\s*[:#-]?\s*[a-z]{0,4}[-_]?\d{3,}[\w-]*|#\s?\d{2,}[\w-]*|\b[a-z]{1,4}-?\d{4,}\b|\b\d{5,}\b/giu;
const PAY_SEG_RE =
  /[$€£₹¥]|\b\d+(?:[.,]\d+)?\s*k\b|\bper\s+(?:hour|hr|week|wk|month|year|annum|visit|shift|mile|day)\b|\/\s*(?:hr|hour|h|wk|week|yr|year|mo|month|day)\b|\b(?:hourly|weekly)\b|\bsalary\b|\b(?:usd|eur|gbp|cad|aud|chf)\b|\bote\b|\bstipend\b|\bcompensation\b/i;
const CURRENCY_RE = /(?:up to\s*)?[$€£₹¥]|\b(?:usd|eur|gbp)\s*\d/i;
const ASIDE_RE = /[([{]([^()[\]{}]*)[)\]}]/g;
const SPLIT_RE = /\s*[|•·–—―]\s*|(?<!\d)\s*[,;]\s*|\s*[,;]\s*(?!\d)|\s*:\s+|\s+-+\s*|\s*-+\s+|\s+\/\s+|\s+@\s+/;
const YEARS_RE = /(\d{1,2})\s*(?:\+|plus)\s*(?:years?|yrs?)|(\d{1,2})\s*(?:-|–|to)\s*\d{1,2}\s*(?:years?|yrs?)/i;

// ---------------------------------------------------------------------------
// Seniority vocabulary
// ---------------------------------------------------------------------------

const INTERN_WORDS = new Set([
  'intern', 'interns', 'internship', 'internships', 'coop', 'werkstudent', 'werkstudentin', 'werkstudierende',
  'werkstudenten', 'praktikant', 'praktikantin', 'praktikum', 'apprentice', 'apprentices', 'apprenticeship',
  'trainee', 'trainees', 'azubi', 'auszubildende', 'auszubildender', 'ausbildung', 'stagiaire', 'alternance',
  'alternant', 'alternante', 'lehrling', 'stagiair', 'practicante', 'pasante', 'becario', 'becaria', 'estagio', 'estagiario', 'estagiaria',
]);
const INTERN_PHRASES = table(['working student', 'co op', 'student worker', 'student assistant', 'student employee', 'student associate', 'summer student']);
const ENTRY_PHRASES = table([
  'entry level', 'entrylevel', 'new grad', 'new grads', 'new graduate', 'new graduates', 'recent grad', 'recent graduate',
  'recent graduates', 'university grad', 'university graduate', 'college grad', 'college graduate', 'early career',
  'early careers', 'early in career', 'new phd graduate', 'new phd graduates', 'new phd grad', 'recent phd graduate',
  'graduate program', 'graduate programme', 'graduate scheme', 'grad program',
]);
const MID_PHRASES = table(['mid level', 'midlevel', 'mid weight', 'midweight', 'intermediate', 'journeyman', 'journeyperson', 'journey level', 'journeyman level', 'pleno']);
const SENIOR_WORDS = new Set(['senior', 'sr', 'snr', 'sênior']);
const STAFF_TECH_NEXT = new Set([
  'engineer', 'engineering', 'developer', 'software', 'swe', 'sre', 'scientist', 'designer', 'architect', 'researcher',
  'product', 'ml', 'data', 'security', 'machine', 'infrastructure', 'platform', 'backend', 'frontend', 'full',
  'fullstack', 'mobile', 'ios', 'android', 'analyst', 'program', 'technical', 'research', 'ux', 'ui', 'applied',
  'site', 'systems', 'cloud', 'devops', 'firmware', 'hardware', 'embedded', 'quality', 'test', 'qa', 'solutions',
  'network', 'game', 'graphics', 'ai', 'analytics', 'design', 'web', 'application', 'applications', 'reliability',
  'performance', 'compiler', 'distributed', 'search', 'privacy', 'mechanical', 'electrical', 'manufacturing',
]);
const TEAM_LEAD_PREFIX = new Set(['team', 'shift', 'crew', 'store', 'department', 'dept', 'section', 'unit', 'group', 'floor', 'site', 'squad', 'pod']);
const MANAGER_WORDS = new Set(['manager', 'mgr', 'mngr', 'managers']);
const SUPERVISOR_WORDS = new Set([
  'supervisor', 'foreman', 'forewoman', 'foreperson', 'leiter', 'leiterin', 'teamleiter', 'teamleiterin', 'teamleitung',
  'abteilungsleiter', 'abteilungsleiterin', 'gruppenleiter', 'gruppenleiterin', 'filialleiter', 'filialleiterin',
  'leitung', 'responsable', 'gerente', 'jefe', 'jefa',
]);
const DIRECTOR_WORDS = new Set(['director', 'directors', 'directeur', 'directrice', 'directora', 'bereichsleiter', 'bereichsleiterin']);
const CXO = new Set([
  'ceo', 'coo', 'cfo', 'cto', 'cio', 'cmo', 'cro', 'cpo', 'chro', 'ciso', 'cso', 'cdo', 'cco', 'cno', 'cao', 'cco',
  'cxo', 'cbo', 'cgo', 'clo', 'cpto', 'geschaftsfuhrer', 'geschaftsfuhrerin', 'geschaeftsfuehrer',
]);
const PARTNER_EXEC_PREV = new Set(['managing', 'senior', 'equity', 'general', 'founding', 'name', 'salaried', 'non']);
const LEVEL_BLOCK_PREV = new Set([
  'grade', 'tier', 'class', 'type', 'phase', 'step', 'band', 'year', 'part', 'section', 'unit', 'room', 'building',
  'floor', 'area', 'district', 'region', 'zone', 'route', 'cdl', 'series', 'version', 'gen', 'generation', 'season',
  'cohort', 'batch', 'wave', 'level', 'lvl', 'shift', 'day', 'days', 'week', 'weeks', 'no', 'number', 'stage', 'world',
  'web', 'industry', 'pre', 'k', 'covid', 'chapter', 'title', 'ward', 'station', 'store', 'plant', 'team', 'squad',
]);
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
const LEVEL_STOP_NEXT = new Set(['support', 'helpdesk', 'help', 'service', 'customer', 'it', 'technical', 'desk']);
const RANK_STOP = new Set(['to', 'supporting', 'assisting']);
const SEASONS = new Set(['summer', 'fall', 'autumn', 'winter', 'spring']);

function levelFromNumber(n: number): Seniority {
  if (n <= 1) return 'entry';
  if (n === 2) return 'mid';
  if (n === 3) return 'senior';
  return 'lead';
}

function levelValue(tok: string): number | undefined {
  if (/^[1-9]$/.test(tok)) return Number(tok);
  return ROMAN[tok];
}

// ---------------------------------------------------------------------------
// Title parsing
// ---------------------------------------------------------------------------

interface Segment {
  tokens: string[];
  keep: boolean[];
  prot: boolean[];
  aside: boolean;
}

interface ParsedTitle {
  core: string;
  seniority: Seniority;
  role?: RoleRef;
  /** Employment type stated in the title ("Contract", "[Part-Time]", "Intern"), else 'unknown'. */
  employment: EmploymentType;
}

const EMPLOYMENT_PRIORITY: EmploymentType[] = ['internship', 'volunteer', 'freelance', 'contract', 'temporary', 'part-time', 'full-time'];

function employmentOfPhrase(p: string): EmploymentType {
  if (/^(?:full ?time|permanent|perm|vollzeit|cdi|unbefristet)$/.test(p)) return 'full-time';
  if (/^(?:part ?time|teilzeit|minijob)$/.test(p)) return 'part-time';
  if (/^(?:contract|contractor|contract to hire|contract to perm|c2h|w2|1099|c2c|corp to corp|fixed term|fixed term contract|befristet|cdd|1099 contractor)$/.test(p)) return 'contract';
  if (/^(?:temporary|temp|temp to hire|temp to perm|seasonal|locum|locum tenens)$/.test(p)) return 'temporary';
  if (/^(?:freelance|freelancer|freiberuflich)$/.test(p)) return 'freelance';
  return 'unknown';
}

function splitSegments(text: string): string[] {
  return text
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s && /[\p{L}\p{N}]/u.test(s));
}

function makeSegment(text: string, aside: boolean): Segment {
  const tokens = norm(text).split(' ').filter(Boolean);
  return { tokens, keep: tokens.map(() => true), prot: tokens.map(() => false), aside };
}

/** Place coverage of tokens[from..to): every token a place, a filler or (after a place) a region code. */
function isPlaceRun(tokens: string[], from: number, to: number, places: PhraseTable, afterPlace: boolean): { ok: boolean; strong: number } {
  const t = getTables();
  let strong = 0;
  let prevPlace = afterPlace;
  let i = from;
  while (i < to) {
    const k = phraseAt(tokens, i, places, to);
    if (k > 0) {
      strong++;
      prevPlace = true;
      i += k;
      continue;
    }
    const tok = tokens[i]!;
    if (t.codes.has(tok) && (prevPlace || (i > from && (tokens[i - 1] === 'remote' || tokens[i - 1] === 'based')))) {
      strong++;
      prevPlace = true;
      i++;
      continue;
    }
    if (t.fillers.has(tok) || /^\d+$/.test(tok)) {
      i++;
      continue;
    }
    return { ok: false, strong };
  }
  return { ok: true, strong };
}

/** Mark protected phrases and noise tokens in a segment; returns found employment markers. */
function markNoise(seg: Segment, employment: Set<EmploymentType>): void {
  const t = getTables();
  const { tokens, keep, prot } = seg;
  const n = tokens.length;
  for (let i = 0; i < n; ) {
    const k = phraseAt(tokens, i, t.protectedP);
    if (k > 0) {
      for (let j = i; j < i + k; j++) prot[j] = true;
      i += k;
    } else i++;
  }
  for (let i = 0; i < n; ) {
    if (prot[i]) {
      i++;
      continue;
    }
    const tok = tokens[i]!;
    // years and seasons ("Summer 2027")
    if (/^(?:19|20)\d\d$/.test(tok)) {
      keep[i] = false;
      if (i > 0 && SEASONS.has(tokens[i - 1]!)) keep[i - 1] = false;
      i++;
      continue;
    }
    if (SEASONS.has(tok) && ((i + 1 < n && (INTERN_WORDS.has(tokens[i + 1]!) || tokens[i + 1] === 'co')) || (i > 0 && INTERN_WORDS.has(tokens[i - 1]!)))) {
      keep[i] = false;
      i++;
      continue;
    }
    let k = phraseAt(tokens, i, t.arrangement);
    if (k > 0 && !(k === 1 && tok === 'flexible' && i + 1 < n)) {
      for (let j = i; j < i + k; j++) keep[j] = false;
      // "100% remote"
      if (i > 0 && tokens[i - 1] === '100') keep[i - 1] = false;
      i += k;
      continue;
    }
    k = phraseAt(tokens, i, t.employment);
    if (k > 0) {
      const p = tokens.slice(i, i + k).join(' ');
      const et = employmentOfPhrase(p);
      // "Contractor" as a head noun after a trade word stays ("Electrical Contractor" is protected above)
      if (et !== 'unknown') employment.add(et);
      if (!(p === 'prn' || p === 'per diem') || i === n - k) for (let j = i; j < i + k; j++) keep[j] = false;
      i += k;
      continue;
    }
    if (tok === 'volunteer' && (n === 1 || seg.aside)) employment.add('volunteer');
    i++;
  }
}

interface SeniorityHit {
  rank: Seniority;
}

/** Strip seniority words and levels from a segment, recording what was found. */
function markSeniority(seg: Segment, first: boolean, hits: Seniority[], managerAt: Array<[Segment, number]>, flags: { chiefOfStaff: boolean; generalManager: Array<[Segment, number]> }): void {
  const t = getTables();
  const { tokens, keep, prot } = seg;
  const n = tokens.length;
  let stopRanks = false;
  /** All tokens before i are already removed (prefix position). */
  const prefixPos = (i: number): boolean => {
    for (let j = 0; j < i; j++) if (keep[j]) return false;
    return true;
  };
  /** Index of the next kept token after i, or -1. */
  const nextKept = (i: number): number => {
    for (let j = i + 1; j < n; j++) if (keep[j]) return j;
    return -1;
  };
  for (let i = 0; i < n; i++) {
    const tok = tokens[i]!;
    if (prot[i]) {
      if (tok === 'chief' && tokens[i + 1] === 'of' && tokens[i + 2] === 'staff') flags.chiefOfStaff = true;
      continue;
    }
    if (!keep[i]) continue;
    if (i > 0 && RANK_STOP.has(tok)) stopRanks = true;
    if (i > 1 && tok === 'of' && tokens[i - 1] === 'office') stopRanks = true;
    // intern
    let k = phraseAt(tokens, i, INTERN_PHRASES);
    if (k > 0) {
      hits.push('intern');
      for (let j = i; j < i + k; j++) keep[j] = false;
      i += k - 1;
      continue;
    }
    if (INTERN_WORDS.has(tok)) {
      hits.push('intern');
      keep[i] = false;
      continue;
    }
    k = phraseAt(tokens, i, ENTRY_PHRASES);
    if (k > 0) {
      hits.push('entry');
      for (let j = i; j < i + k; j++) keep[j] = false;
      i += k - 1;
      continue;
    }
    if (tok === 'junior' || tok === 'jr' || tok === 'jnr') {
      hits.push('entry');
      keep[i] = false;
      continue;
    }
    if ((tok === 'graduate' || tok === 'grad') && (prefixPos(i) || nextKept(i) < 0) && n > 1) {
      hits.push('entry');
      keep[i] = false;
      continue;
    }
    if (tok === 'associate' && first && prefixPos(i) && nextKept(i) >= 0) {
      const nx = tokens[nextKept(i)]!;
      if (!['director', 'professor', 'dean', 'partner', 'vice', 'principal', 'general', 'counsel'].includes(nx)) {
        hits.push('entry');
        keep[i] = false;
      }
      continue;
    }
    if (tok === 'mid' && tokens[i + 1] === 'senior') {
      hits.push('senior');
      keep[i] = keep[i + 1] = false;
      i++;
      continue;
    }
    k = phraseAt(tokens, i, MID_PHRASES);
    if (k > 0) {
      hits.push('mid');
      for (let j = i; j < i + k; j++) keep[j] = false;
      i += k - 1;
      continue;
    }
    if (SENIOR_WORDS.has(tok)) {
      // "Senior" alone (e.g. a "- Senior" segment) is still a level
      hits.push('senior');
      keep[i] = false;
      continue;
    }
    if (tok === 'lead' || tok === 'leader' || tok === 'leads') {
      const prev = i > 0 ? tokens[i - 1]! : '';
      const nk = nextKept(i);
      if (TEAM_LEAD_PREFIX.has(prev)) {
        if (!stopRanks) hits.push('manager');
      } else if (tok === 'lead' && prefixPos(i) && nk >= 0) {
        hits.push('lead');
        keep[i] = false;
      } else hits.push('lead');
      continue;
    }
    // "Staff Software Engineer", "Senior Staff Brand Designer" (staff after senior is always a level)
    if (tok === 'staff' && prefixPos(i) && nextKept(i) >= 0 && (STAFF_TECH_NEXT.has(tokens[nextKept(i)]!) || (i > 0 && SENIOR_WORDS.has(tokens[i - 1]!)))) {
      hits.push('lead');
      keep[i] = false;
      continue;
    }
    if (tok === 'principal' && prefixPos(i) && nextKept(i) >= 0) {
      hits.push('lead');
      keep[i] = false;
      continue;
    }
    if (tok === 'distinguished' && nextKept(i) >= 0) {
      hits.push('lead');
      keep[i] = false;
      continue;
    }
    if (tok === 'fellow' && i > 0 && ['technical', 'distinguished', 'senior', 'engineering', 'principal'].includes(tokens[i - 1]!)) {
      hits.push('lead');
      continue;
    }
    if (tok === 'head') {
      if (tokens[i + 1] === 'of') {
        if (!stopRanks) hits.push('director');
      } else if (prefixPos(i) && nextKept(i) >= 0) hits.push('lead');
      continue;
    }
    if (stopRanks) continue;
    if (MANAGER_WORDS.has(tok)) {
      managerAt.push([seg, i]);
      if (tok === 'manager' && i > 0 && tokens[i - 1] === 'general') flags.generalManager.push([seg, i]);
      continue;
    }
    if (SUPERVISOR_WORDS.has(tok)) {
      hits.push('manager');
      continue;
    }
    if (DIRECTOR_WORDS.has(tok)) {
      const prev = i > 0 ? tokens[i - 1]! : '';
      if (prev === 'managing' || prev === 'executive') hits.push('executive');
      else if (!(i > 0 && phraseAt(tokens, i - 1, t.nonDirector) === 2)) hits.push('director');
      continue;
    }
    if (tok === 'vp' || tok === 'svp' || tok === 'evp' || tok === 'vps') {
      hits.push('executive');
      continue;
    }
    if (tok === 'avp') {
      hits.push('director');
      continue;
    }
    if (tok === 'vice' && tokens[i + 1] === 'president') {
      hits.push(i > 0 && tokens[i - 1] === 'assistant' ? 'director' : 'executive');
      i++;
      continue;
    }
    if (tok === 'president' || tok === 'chief' || tok === 'founder' || tok === 'cofounder' || CXO.has(tok)) {
      hits.push('executive');
      continue;
    }
    if (tok === 'co' && tokens[i + 1] === 'founder') {
      hits.push('executive');
      i++;
      continue;
    }
    if (tok === 'partner' && (n === 1 || (i > 0 && PARTNER_EXEC_PREV.has(tokens[i - 1]!)))) {
      hits.push('executive');
      continue;
    }
  }
  // levels: "level 2", "L5", "IC4" anywhere; I/II/III or 1/2/3 at the end
  for (let i = 0; i < n; i++) {
    if (!keep[i] || prot[i]) continue;
    const tok = tokens[i]!;
    if ((tok === 'level' || tok === 'lvl') && i + 1 < n) {
      const v = levelValue(tokens[i + 1]!);
      if (v !== undefined && !(i + 2 < n && LEVEL_STOP_NEXT.has(tokens[i + 2]!))) {
        hits.push(levelFromNumber(v));
        keep[i] = keep[i + 1] = false;
        i++;
      }
      continue;
    }
    let m = /^l(\d{1,2})$/.exec(tok);
    if (m) {
      const v = Number(m[1]);
      hits.push(v <= 3 ? 'entry' : v === 4 ? 'mid' : v === 5 ? 'senior' : 'lead');
      keep[i] = false;
      continue;
    }
    m = /^ic(\d)$/.exec(tok);
    if (m) {
      const v = Number(m[1]);
      hits.push(v <= 2 ? 'entry' : v === 3 ? 'mid' : v === 4 ? 'senior' : 'lead');
      keep[i] = false;
    }
  }
  // trailing level marker
  let last = -1;
  for (let j = n - 1; j >= 0; j--)
    if (keep[j]) {
      last = j;
      break;
    }
  if (last > 0) {
    const v = levelValue(tokens[last]!);
    let prevKept = -1;
    for (let j = last - 1; j >= 0; j--)
      if (keep[j]) {
        prevKept = j;
        break;
      }
    const prev = prevKept >= 0 ? tokens[prevKept]! : '';
    if (v !== undefined && prevKept >= 0 && !LEVEL_BLOCK_PREV.has(prev) && !/^\d+$/.test(prev) && levelValue(prev) === undefined) {
      hits.push(levelFromNumber(v));
      keep[last] = false;
    }
  } else if (last === 0 && seg.aside && n === 1 && levelValue(tokens[0]!) !== undefined && /^[iv]+$/.test(tokens[0]!)) {
    hits.push(levelFromNumber(levelValue(tokens[0]!)!));
    keep[0] = false;
  }
}

/** Drop trailing shift/promo words and trailing places from a segment. */
function trimTrailing(seg: Segment, allowEmpty: boolean): void {
  const t = getTables();
  const { tokens, keep, prot } = seg;
  const kept = (): number[] => tokens.map((_, i) => i).filter((i) => keep[i]);
  for (let guard = 0; guard < 8; guard++) {
    const idx = kept();
    if (idx.length === 0 || (idx.length === 1 && !allowEmpty)) return;
    let changed = false;
    // shift / promo phrases at the end (up to 4 tokens); a non-first segment may go entirely
    for (let len = Math.min(4, allowEmpty ? idx.length : idx.length - 1); len >= 1 && !changed; len--) {
      const tail = idx.slice(idx.length - len);
      if (tail.some((i) => prot[i])) continue;
      const words = tail.map((i) => tokens[i]!);
      const k1 = phraseAt(words, 0, t.shift);
      const k2 = phraseAt(words, 0, t.promo);
      if (k1 === len || k2 === len) {
        for (const i of tail) keep[i] = false;
        changed = true;
      }
    }
    if (changed) continue;
    // trailing places ("… Commercial Hunter Japan", "… Sales Manager New York")
    if (idx.length <= 1) return;
    const words = idx.map((i) => tokens[i]!);
    for (let start = 1; start < words.length && !changed; start++) {
      const before = words[start - 1]!;
      if (before === 'of' || before === 'for' || before === 'to' || before === 'the' || before === 'and') continue;
      const first = words[start]!;
      if (t.fillers.has(first) && first !== 'in' && first !== 'based' && first !== 'remote') continue;
      const run = isPlaceRun(words, start, words.length, t.strongPlaces, false);
      if (run.ok && run.strong > 0 && idx.slice(start).every((i) => !prot[i])) {
        for (const i of idx.slice(start)) keep[i] = false;
        changed = true;
      }
    }
    if (!changed) return;
  }
}

function keptTokens(seg: Segment): string[] {
  const out: string[] = [];
  for (let i = 0; i < seg.tokens.length; i++) if (seg.keep[i]) out.push(seg.tokens[i]!);
  return out;
}

/** A language-requirement segment: language names with a speaker word, optionally with places ("Spanish speakers in Spain"). */
function isLanguageSegment(seg: Segment): boolean {
  const t = getTables();
  let lang = false;
  let speaker = false;
  const rest: string[] = [];
  for (const w of seg.tokens) {
    if (t.languages.has(w)) lang = true;
    else if (t.speakers.has(w)) speaker = true;
    else rest.push(w);
  }
  if (!lang || !speaker) return false;
  return rest.length === 0 || isPlaceRun(rest, 0, rest.length, t.segmentPlaces, true).ok;
}

/** Is this whole (non-first) segment a location / arrangement / noise segment? */
function isPlaceSegment(seg: Segment, prevWasPlace: boolean): boolean {
  const t = getTables();
  const run = isPlaceRun(seg.tokens, 0, seg.tokens.length, t.segmentPlaces, prevWasPlace);
  return run.ok && (run.strong > 0 || seg.tokens.some((w) => w === 'remote' || w === 'hybrid'));
}

function headIndex(tokens: string[]): number {
  for (let i = 1; i < tokens.length; i++) {
    const w = tokens[i]!;
    if (w === 'of' || w === 'for' || w === 'in' || w === 'to' || w === 'at' || w === 'with' || w === 'de') return i - 1;
  }
  return tokens.length - 1;
}

/** Longest taxonomy phrase contained in tokens (single words only at the head, never generic heads). */
function containedRole(tokens: string[], allowSingle: boolean): PhraseEntry | undefined {
  const idx = getRoleIndex();
  const head = headIndex(tokens);
  let best: PhraseEntry | undefined;
  let bestEnd = -1;
  for (let i = 0; i < tokens.length; i++) {
    const list = idx.byFirst.get(tokens[i]!);
    if (!list) continue;
    for (const e of list) {
      const len = e.tokens.length;
      if (best && len < best.tokens.length) break;
      if (i + len > tokens.length) continue;
      let ok = true;
      for (let k = 1; k < len; k++)
        if (tokens[i + k] !== e.tokens[k]) {
          ok = false;
          break;
        }
      if (!ok) continue;
      // "Talent Operations Specialist" is not the generic "Operations Specialist"
      if (i > 0 && e.tokens[0] === 'operations') continue;
      if (len === 1) {
        const w = e.tokens[0]!;
        if (!allowSingle || GENERIC_HEADS.has(w)) continue;
        if (tokens.length > 1 && (i !== head || NO_SINGLE_HEAD_MAP.has(w))) continue;
      }
      const end = i + len - 1;
      if (!best || len > best.tokens.length || (len === best.tokens.length && ((e.isTitle && !best.isTitle) || (e.isTitle === best.isTitle && end > bestEnd)))) {
        best = e;
        bestEnd = end;
      }
      break;
    }
  }
  return best;
}

function expandAbbreviations(tokens: string[]): string[] | undefined {
  let changed = false;
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i]!;
    const x = TITLE_ABBREVIATIONS[w];
    if (x && !(w === 'tech' && (tokens[i + 1] === 'lead' || i < tokens.length - 1))) {
      out.push(...x.split(' '));
      changed = true;
    } else out.push(w);
  }
  return changed ? out : undefined;
}

const OF_HEADS = new Set(['vp', 'svp', 'evp', 'head', 'director']);

function mapRole(main: string[], all: string[], teams: string[][]): RoleRef | undefined {
  const exact = lookupPhrase(all.join(' ')) ?? lookupPhrase(main.join(' '));
  if (exact) return exact.role;
  // "VP Sales", "VP, Sales", "Head, Design" -> "vp of sales"
  const lead = main[0]!;
  if (OF_HEADS.has(lead) && main[1] !== 'of') {
    const rest = main.length > 1 ? main.slice(1) : (teams[0] ?? []);
    if (rest.length > 0) {
      const e = lookupPhrase([lead, 'of', ...rest].join(' '));
      if (e) return e.role;
    }
  }
  // inverted titles: "Manager, Sales Recruiting" -> "sales recruiting manager"
  if (main.length === 1 && GENERIC_HEADS.has(main[0]!) && teams.length > 0 && teams[0]!.length > 0) {
    const inv = [...teams[0]!, main[0]!];
    const e = lookupPhrase(inv.join(' ')) ?? containedRole(inv, false);
    if (e && e.tokens[e.tokens.length - 1] === main[0]) return e.role;
  }
  const inMain = containedRole(main, true);
  if (inMain) return inMain.role;
  const inAll = all.length > main.length ? containedRole(all, false) : undefined;
  if (inAll) return inAll.role;
  const exp = expandAbbreviations(main);
  if (exp) {
    const e = lookupPhrase(exp.join(' ')) ?? containedRole(exp, true);
    if (e) return e.role;
  }
  // "Head of Design" / "Head, Design" -> "director of design" / "design director"
  if (lead === 'head') {
    const rest = main[1] === 'of' ? main.slice(2) : main.length > 1 ? main.slice(1) : (teams[0] ?? []);
    if (rest.length > 0) {
      const e = lookupPhrase(['director', 'of', ...rest].join(' ')) ?? lookupPhrase([...rest, 'director'].join(' '));
      if (e) return e.role;
    }
  }
  // "Data Science (Intern)" -> "data scientist"
  const practitioner = FIELD_TO_PRACTITIONER[main[main.length - 1]!];
  if (practitioner) {
    const swapped = [...main.slice(0, -1), practitioner];
    const e = lookupPhrase(swapped.join(' ')) ?? (swapped.length > 1 ? containedRole(swapped, true) : undefined);
    if (e) return e.role;
  }
  // "Développeur Full Stack" -> "full stack developer"
  const foreign = FOREIGN_HEADS[lead];
  if (foreign && main.length > 1) {
    const moved = [...main.slice(1).filter((w) => w !== 'de' && w !== 'des' && w !== 'del' && w !== 'da' && w !== 'do'), foreign];
    const e = lookupPhrase(moved.join(' ')) ?? containedRole(moved, true);
    if (e) return e.role;
  }
  return undefined;
}

function isPeopleManagerRole(r: RoleRef): boolean {
  if (PEOPLE_MANAGER_ROLE_IDS.has(r.id)) return true;
  if (IC_MANAGER_ROLE_IDS.has(r.id)) return false;
  return r.skills.includes('People Management');
}

/** Seniority of a "… Manager" occurrence: 'manager', 'executive' (general manager) or 'unknown' (IC). */
function managerRank(seg: Segment, at: number): Seniority {
  const toks = seg.tokens;
  // "Manager, X" / "Senior Manager": a bare manager is a people manager
  let start = at;
  while (start > 0 && seg.keep[start - 1]) start--;
  if (start === at) return 'manager';
  // longest taxonomy phrase ending at this token
  for (let s = start; s < at; s++) {
    const e = lookupPhrase(toks.slice(s, at + 1).join(' '));
    if (!e) continue;
    if (e.role.familyId === 'executive-leadership' && toks[at - 1] === 'general' && s === at - 1) {
      return start < at - 1 && ['assistant', 'deputy', 'associate'].includes(toks[at - 2]!) ? 'manager' : 'executive';
    }
    if (s > start && ['assistant', 'deputy'].includes(toks[s - 1]!) && isPeopleManagerRole(e.role)) return 'manager';
    return isPeopleManagerRole(e.role) ? 'manager' : 'unknown';
  }
  const prev = toks[at - 1]!;
  if (IC_MANAGER_MODIFIERS.has(prev)) return 'unknown';
  return 'manager';
}

function emptyParsed(raw: string): ParsedTitle {
  return { core: normalizeText(raw), seniority: 'unknown', employment: 'unknown' };
}

function parseTitle(raw: string): ParsedTitle {
  if (typeof raw !== 'string' || !raw.trim()) return emptyParsed(typeof raw === 'string' ? raw : '');
  let s = raw;
  // cheap guards first: most titles have no digits, gender markers or apostrophes
  if (GENDER_HINT_RE.test(s)) s = s.replace(GENDER_SUFFIX_RE, '$1').replace(GENDER_RE, ' ');
  if (s.includes("'") || s.includes('’')) s = s.replace(APOSTROPHE_RE, '$1$2');
  if (s.includes('&')) s = s.replace(UKI_RE, 'UKI');
  if (DIGIT_RE.test(s)) s = s.replace(REQ_RE, ' ');
  // asides
  const asides: string[] = [];
  for (let guard = 0; guard < 6; guard++) {
    let found = false;
    s = s.replace(ASIDE_RE, (_m, inner: string) => {
      found = true;
      asides.push(inner);
      return ' , ';
    });
    if (!found) break;
  }
  // unclosed bracket: the rest is an aside
  const open = s.search(/[([{]/);
  if (open >= 0) {
    asides.push(s.slice(open + 1));
    s = s.slice(0, open);
  }
  s = s.replace(/[)\]}]/g, ' ');

  const segTexts = splitSegments(s);
  const employment = new Set<EmploymentType>();
  const hits: Seniority[] = [];
  const managerAt: Array<[Segment, number]> = [];
  const flags = { chiefOfStaff: false, generalManager: [] as Array<[Segment, number]> };

  // classify segments
  const segs: Segment[] = [];
  let prevPlace = false;
  for (let k = 0; k < segTexts.length; k++) {
    let text = segTexts[k]!;
    const isFirst = segs.length === 0;
    if (PAY_SEG_RE.test(text)) {
      if (!isFirst) continue;
      const c = text.search(CURRENCY_RE);
      if (c > 0) text = text.slice(0, c);
      else if (c === 0) continue;
    }
    const seg = makeSegment(text, false);
    if (seg.tokens.length === 0) continue;
    if (!isFirst && (isLanguageSegment(seg) || (seg.tokens.length === 2 && seg.tokens[0] === 'independent' && seg.tokens[1] === 'contractor'))) {
      if (seg.tokens[1] === 'contractor') employment.add('freelance');
      continue;
    }
    if (!isFirst || segTexts.length > 1) {
      if (isPlaceSegment(seg, prevPlace)) {
        prevPlace = true;
        // arrangement words in a dropped segment still say something about the job
        markNoise(seg, employment);
        continue;
      }
    }
    prevPlace = false;
    segs.push(seg);
  }
  const asideSegs = asides.map((a) => makeSegment(a, true)).filter((x) => x.tokens.length > 0);

  for (const seg of segs) markNoise(seg, employment);
  for (const seg of asideSegs) markNoise(seg, employment);
  segs.forEach((seg, k) => markSeniority(seg, k === 0, hits, managerAt, flags));
  for (const seg of asideSegs) {
    const before = hits.length;
    const scratch: Array<[Segment, number]> = [];
    markSeniority(seg, false, hits, scratch, { chiefOfStaff: false, generalManager: [] });
    // only explicit levels count from asides: "(Senior)", "(L6)", "(Intern)" — not "(reporting to the VP)"
    for (let i = hits.length - 1; i >= before; i--) {
      const h = hits[i]!;
      if (!(h === 'intern' || h === 'entry' || h === 'mid' || h === 'senior' || h === 'lead')) hits.splice(i, 1);
    }
  }
  segs.forEach((seg, k) => trimTrailing(seg, k > 0));

  // assemble the core from kept segments
  const kept = segs.map(keptTokens).filter((x) => x.length > 0);
  const head = kept[0];
  if (head) {
    const t = getTables();
    for (let guard = 0; guard < 4 && head.length > 1; guard++) {
      const k = phraseAt(head, 0, t.leadingNoise);
      if (k > 0 && k < head.length) {
        head.splice(0, k);
        if (head.length > 1 && (head[0] === 'a' || head[0] === 'an')) head.shift();
      } else if (t.leadingFunction.has(head[0]!)) head.shift();
      else break;
    }
  }
  let main = kept[0] ?? [];
  let all = kept.flat();
  if (all.length === 0) {
    // everything was noise or seniority ("Intern", "Senior Associate"?): fall back to the bare words
    const fallback = segs.flatMap((x) => x.tokens.filter((_, i) => x.prot[i] || !/^(?:19|20)\d\d$/.test(x.tokens[i]!)));
    all = fallback.length > 0 ? fallback : normalizeText(raw).split(' ').filter(Boolean);
    main = all;
  }
  const role = all.length > 0 ? mapRole(main, all, kept.slice(1)) : undefined;

  // manager words: people manager or IC "manager"?
  for (const [seg, at] of managerAt) {
    const r = managerRank(seg, at);
    if (r !== 'unknown') hits.push(r);
  }
  if (all.includes('architect') && (!role || role.familyId !== 'architecture-planning')) hits.push('lead');

  let seniority: Seniority = 'unknown';
  if (hits.includes('intern')) seniority = 'intern';
  else {
    for (const h of hits) if (RANK[h] > RANK[seniority]) seniority = h;
    if (seniority === 'unknown' && flags.chiefOfStaff) seniority = 'lead';
  }
  if (seniority === 'unknown') {
    const m = YEARS_RE.exec(asides.join(' ; ') + ' ; ' + raw);
    if (m) seniority = yearsToSeniority(Number(m[1] ?? m[2]));
  }
  let emp: EmploymentType = 'unknown';
  for (const e of EMPLOYMENT_PRIORITY)
    if (employment.has(e)) {
      emp = e;
      break;
    }
  if (emp === 'unknown' && hits.includes('intern') && /\b(?:intern|internship|co-?op|werkstudent\w*|praktik\w*|stagiaire)\b/i.test(foldText(raw))) emp = 'internship';
  return { core: all.join(' '), seniority, role, employment: emp };
}

function yearsToSeniority(n: number): Seniority {
  if (n >= 5) return 'senior';
  if (n >= 3) return 'mid';
  return 'entry';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyse a posting title. Pure function of the string; safe to call for every posting at ingest.
 * Decisions worth knowing:
 *  - "Senior Associate, Audit" is senior (an explicit level word wins; "associate" as the head noun is
 *    not a level). "Associate Product Manager" is entry; "Associate Director" is director.
 *  - "General Manager" is executive when it is the taxonomy's corporate General Manager role and not
 *    preceded by assistant/deputy; restaurant/hotel/store general managers map to their own
 *    hospitality/retail roles and are manager.
 *  - "Chief of Staff" is lead (a senior IC role in the taxonomy), not executive.
 *  - "X Manager" is manager seniority only for people-manager roles: taxonomy roles whose typical
 *    skills include "People Management" (plus a small curated list); "Product Manager",
 *    "Customer Success Manager", "Account Manager"… are IC titles and get no seniority from "Manager".
 */
export function analyzeTitle(raw: string): TitleInfo {
  const p = parseTitle(raw);
  const info: TitleInfo = { raw, core: p.core, seniority: p.seniority };
  if (p.role) info.role = p.role;
  return info;
}

/**
 * Seniority from the title, falling back to an explicit source value, then (conservatively) to
 * the description ("8+ years of experience" -> senior; "new grad" -> entry). Title rules:
 *  intern: intern, internship, co-op, working student, werkstudent, apprentice, trainee
 *  entry: junior, jr, entry level, graduate, new grad, associate (when leading and not "associate director"), I / 1
 *  mid: II / 2, mid-level, intermediate
 *  senior: senior, sr, III / 3
 *  lead: lead, staff, principal, distinguished, fellow, architect (as a level), IV+ / tech lead
 *  manager: manager, head of (team-level), supervisor, team lead when managing people ("engineering manager")
 *  director: director, senior director, head of <function>
 *  executive: vp, vice president, svp, evp, chief …, cXO, president, founder, partner, managing director, general manager
 * "Product Manager"/"Project Manager"/"Account Manager"/"Program Manager"/"Community Manager" etc. are
 * individual-contributor titles, NOT manager seniority; the taxonomy tells which titles those are.
 *
 * Description fallback: the largest "N+ years of … experience" requirement (5+ -> senior, 3-4 -> mid,
 * 0-2 -> entry; company-history sentences such as "we have 10 years of experience" are ignored), else
 * "new grad"/"entry-level"/"recent graduate" -> entry, else "this is an internship" -> intern.
 */
export function detectSeniority(title: string, sourceValue?: string, descriptionText?: string): Seniority {
  const fromTitle = parseTitle(title ?? '').seniority;
  if (fromTitle !== 'unknown') return fromTitle;
  const fromSource = sourceSeniority(sourceValue);
  if (fromSource !== 'unknown') return fromSource;
  return descriptionSeniority(descriptionText);
}

const SOURCE_SENIORITY: Array<[RegExp, Seniority]> = [
  [/\b(?:intern|internship|trainee|apprentice\w*|werkstudent\w*|praktik\w*|student)\b/, 'intern'],
  [/\bmid senior\b/, 'senior'],
  [/\b(?:entry|junior|jr|graduate|new grad|beginner|associate|early career)\b/, 'entry'],
  [/\b(?:mid|middle|intermediate|midweight|experienced|pleno)\b/, 'mid'],
  [/\b(?:senior|sr)\b/, 'senior'],
  [/\b(?:lead|staff|principal|expert|distinguished)\b/, 'lead'],
  [/\b(?:manager|management|supervisor)\b/, 'manager'],
  [/\b(?:director|head)\b/, 'director'],
  [/\b(?:executive|vp|vice president|c level|chief|cxo|president)\b/, 'executive'],
];

function sourceSeniority(v: string | undefined): Seniority {
  if (!v) return 'unknown';
  const s = normalizeText(v);
  if (!s) return 'unknown';
  let best: Seniority = 'unknown';
  let bestAt = Infinity;
  for (const [re, sen] of SOURCE_SENIORITY) {
    const m = re.exec(s);
    if (m && m.index < bestAt) {
      best = sen;
      bestAt = m.index;
    }
  }
  return best;
}

const DESC_YEARS_RE =
  /(?:(?:minimum|min\.?|at least)\s+(?:of\s+)?)?\b(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*\+?\s*)?(?:years?|yrs?)\.?\s*(?:of\s+)?(?:[\w-]+\s+){0,4}?(?:experience|exp\b)|experience\s*[:\-–]\s*(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?(?:years?|yrs?)/gi;
const COMPANY_HISTORY_RE = /\b(?:we have|we've|we bring|our (?:team|company|firm|founders?)|company has|has over|have over|for over|in business|founded|established)\b[^.\n]{0,40}$/i;
const ENTRY_DESC_RE = /\b(?:new grad(?:uate)?s?|recent (?:college |university )?graduates?|entry[- ]level|no (?:prior |previous )?experience (?:is )?(?:required|necessary|needed))\b/i;
const INTERN_DESC_RE = /\bthis is an? (?:paid |unpaid |summer |\d+[- ]month )?internship\b/i;

function descriptionSeniority(text: string | undefined): Seniority {
  if (!text) return 'unknown';
  let best = -1;
  DESC_YEARS_RE.lastIndex = 0;
  for (let m = DESC_YEARS_RE.exec(text); m; m = DESC_YEARS_RE.exec(text)) {
    const n = Number(m[1] ?? m[3]);
    if (!Number.isFinite(n) || n > 30) continue;
    const before = text.slice(Math.max(0, m.index - 60), m.index);
    if (COMPANY_HISTORY_RE.test(before)) continue;
    best = Math.max(best, n);
  }
  if (best >= 0) return yearsToSeniority(best);
  if (ENTRY_DESC_RE.test(text)) return 'entry';
  if (INTERN_DESC_RE.test(text)) return 'intern';
  return 'unknown';
}

const SOURCE_EMPLOYMENT: Array<[RegExp, EmploymentType]> = [
  [/\b(?:volunteer\w*|ehrenamt\w*|benevolat)\b/, 'volunteer'],
  [/\b(?:intern|interns|internship|praktikum|praktikant\w*|werkstudent\w*|working student|stage|stagiaire|apprentice\w*|ausbildung|co op|coop)\b/, 'internship'],
  [/\b(?:freelance\w*|freiberuf\w*|self employed|independent contractor)\b/, 'freelance'],
  [/\b(?:contract\w*|c2c|corp to corp|w2|1099|cdd|befristet|fixed term|contrat|contrato)\b/, 'contract'],
  [/\b(?:temporary|temp|temps|seasonal|interim|aushilfe|saisonal\w*|locum)\b/, 'temporary'],
  [/\b(?:part time|parttime|teilzeit|minijob|temps partiel|medio tiempo|meio periodo)\b/, 'part-time'],
  [/\b(?:full time|fulltime|permanent|regular|vollzeit|cdi|unbefristet|festanstellung|temps plein|tiempo completo|tempo integral|salaried)\b/, 'full-time'],
];

function sourceEmployment(v: string | undefined): EmploymentType {
  if (!v) return 'unknown';
  const s = foldText(v)
    .replace(/[_\-/]+/g, ' ')
    .replace(/([a-z])(time)\b/g, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!s) return 'unknown';
  let best: EmploymentType = 'unknown';
  let bestAt = Infinity;
  for (const [re, et] of SOURCE_EMPLOYMENT) {
    const m = re.exec(s);
    if (m && m.index < bestAt) {
      best = et;
      bestAt = m.index;
    }
  }
  return best;
}

const DESC_EMPLOYMENT: Array<[RegExp, EmploymentType]> = [
  [/\b(?:this|it) (?:is|will be) an? (?:permanent,? |regular,? |salaried,? |exempt,? )?full[- ]time\b(?! (?:students?|equivalent|study))/i, 'full-time'],
  [/\b(?:employment|job|position|contract|work|role|schedule) type\s*[:\-–]\s*full[- ]?time\b/i, 'full-time'],
  [/\bfull[- ]time,? (?:permanent |salaried |exempt )?(?:position|role|job|employment|opportunity)\b/i, 'full-time'],
  [/\b(?:hiring|seeking|looking for) an? full[- ]time\b(?! (?:students?|equivalent))/i, 'full-time'],
  [/\b(?:in vollzeit|\(vollzeit\)|vollzeitstelle|festanstellung in vollzeit)\b/i, 'full-time'],
  [/\b(?:this|it) (?:is|will be) an? (?:permanent,? |regular,? )?part[- ]time\b(?! students?)/i, 'part-time'],
  [/\b(?:employment|job|position|work|role|schedule) type\s*[:\-–]\s*part[- ]?time\b/i, 'part-time'],
  [/\bpart[- ]time,? (?:position|role|job|employment|opportunity)\b/i, 'part-time'],
  [/\b(?:in teilzeit|\(teilzeit\)|teilzeitstelle)\b/i, 'part-time'],
  [/\b\d{1,2}[- ](?:to[- ]\d{1,2}[- ])?months?\s+(?:fixed[- ]term\s+)?contract\b/i, 'contract'],
  [/\bcontract[- ]to[- ](?:hire|perm)\b/i, 'contract'],
  [/\b(?:this|it) (?:is|will be) an? (?:\w+ )?contract(?:or)? (?:position|role|assignment|engagement|opportunity)\b/i, 'contract'],
  [/\b(?:employment|job|position|work|role) type\s*[:\-–]\s*contract/i, 'contract'],
  [/\bcontract (?:position|role|assignment|engagement)\b/i, 'contract'],
  [/\bfixed[- ]term contract\b/i, 'contract'],
  [/\b(?:this|it) (?:is|will be) an? (?:\w+ )?temporary (?:position|role|assignment|job|contract)\b/i, 'temporary'],
  [/\btemporary (?:position|role|assignment)\b/i, 'temporary'],
  [/\b(?:employment|job|position|work|role) type\s*[:\-–]\s*(?:temporary|seasonal)\b/i, 'temporary'],
  [/\bseasonal (?:position|role|job|employment)\b/i, 'temporary'],
  [/\b(?:this|it) (?:is|will be) an? (?:paid |unpaid |summer |\d{1,2}[- ]month |\w+ )?internship\b/i, 'internship'],
  [/\b(?:employment|job|position|work|role) type\s*[:\-–]\s*intern(?:ship)?\b/i, 'internship'],
  [/\b(?:on a freelance basis|freelance (?:position|role|basis|project|opportunity|contract))\b/i, 'freelance'],
  [/\b(?:employment|job|position|work|role) type\s*[:\-–]\s*freelance\b/i, 'freelance'],
  [/\b(?:this|it) (?:is|will be) an? (?:unpaid )?volunteer (?:position|role|opportunity)\b/i, 'volunteer'],
];

function descriptionEmployment(text: string | undefined): EmploymentType {
  if (!text) return 'unknown';
  const found = new Set<EmploymentType>();
  for (const [re, et] of DESC_EMPLOYMENT) if (re.test(text)) found.add(et);
  if (found.size === 1) return [...found][0]!;
  return 'unknown';
}

/**
 * Map a source's employment-type value (and, failing that, the title/description) to our enum.
 * Handles: "Full-time", "FULL_TIME", "Permanent", "Part time", "Contract", "Contractor", "C2C", "W2",
 * "Temporary", "Temp", "Seasonal", "Intern", "Internship", "Freelance", "Volunteer", "Vollzeit", "Teilzeit", "CDI", "CDD".
 * Returns 'unknown' rather than guessing.
 *
 * The title counts only on explicit markers ("Contract", "[Contract]", "Part-Time", "Intern", "Temporary",
 * "Freelance", "Seasonal"); the description only on unambiguous statements ("This is a full-time
 * position", "6-month contract", "Employment type: Full-time"), and only when they agree.
 * CDD (fixed-term) maps to contract.
 */
export function detectEmploymentType(sourceValue: string | undefined, title: string, descriptionText?: string): EmploymentType {
  const fromSource = sourceEmployment(sourceValue);
  if (fromSource !== 'unknown') return fromSource;
  const fromTitle = parseTitle(title ?? '').employment;
  if (fromTitle !== 'unknown') return fromTitle;
  return descriptionEmployment(descriptionText);
}

/** Find the taxonomy role for user-typed text or a posting title (title or alias; seniority ignored). */
export function findRole(text: string): RoleRef | undefined {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const direct = lookupPhrase(normalizeText(text));
  if (direct) return direct.role;
  return parseTitle(text).role;
}

export function getRole(id: string): RoleRef | undefined {
  if (typeof id !== 'string') return undefined;
  return getRoleIndex().byId.get(id);
}

export interface TitleExpansion {
  role?: RoleRef;
  /** Same-meaning titles (the role's canonical title and aliases), excluding the input itself. */
  synonyms: string[];
  /** Adjacent roles worth offering as opt-in broadening. */
  related: RoleRef[];
}

/**
 * Expand a user-typed title for broadened searching. Unknown titles expand to nothing.
 * Synonyms are the role's canonical title then its aliases, without the input itself and without the
 * input's seniority-free core (compared case- and diacritic-insensitively); related roles are resolved
 * in the order the taxonomy lists them.
 */
export function expandTitle(text: string): TitleExpansion {
  const role = findRole(text);
  if (!role) return { synonyms: [], related: [] };
  const exclude = new Set<string>([normalizeText(text)]);
  const core = parseTitle(text).core;
  if (core) exclude.add(core);
  const seen = new Set<string>();
  const synonyms: string[] = [];
  for (const t of [role.title, ...role.aliases]) {
    const k = normalizeText(t);
    if (!k || exclude.has(k) || seen.has(k)) continue;
    seen.add(k);
    synonyms.push(t);
  }
  const idx = getRoleIndex();
  const related: RoleRef[] = [];
  for (const id of role.related) {
    const r = idx.byId.get(id);
    if (r && r.id !== role.id && !related.includes(r)) related.push(r);
  }
  return { role, synonyms, related };
}

/**
 * Autocomplete for the "what" box: canonical titles and aliases starting with (then containing)
 * the query, best first; canonical titles outrank aliases; diacritic- and case-insensitive.
 * Tiers: canonical-title prefix, alias prefix, word-prefix matches anywhere ("eng" -> "Software
 * Engineer"; every query word must start a title word, in order), then plain substring. Within a tier
 * canonical titles come first, then shorter titles. De-duplicated by display title.
 */
export function suggestTitles(query: string, limit = 8): Array<{ title: string; roleId: string; family: string }> {
  const q = normalizeText(String(query ?? ''));
  if (!q || limit <= 0) return [];
  const qWords = q.split(' ');
  const tiers: SuggestEntry[][] = [[], [], [], []];
  for (const e of getRoleIndex().suggest) {
    if (e.norm.startsWith(q)) tiers[e.canonical ? 0 : 1]!.push(e);
    else if (wordPrefixMatch(e.words, qWords)) tiers[2]!.push(e);
    else if (e.norm.includes(q)) tiers[3]!.push(e);
  }
  const out: Array<{ title: string; roleId: string; family: string }> = [];
  const seen = new Set<string>();
  for (const tier of tiers) {
    tier.sort((a, b) => Number(b.canonical) - Number(a.canonical) || a.display.length - b.display.length || a.display.localeCompare(b.display));
    for (const e of tier) {
      const k = foldText(e.display);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ title: e.display, roleId: e.role.id, family: e.role.family });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function wordPrefixMatch(words: string[], q: string[]): boolean {
  let j = 0;
  for (let i = 0; i < words.length && j < q.length; i++) if (words[i]!.startsWith(q[j]!)) j++;
  return j === q.length;
}

/**
 * Roles whose typical skills overlap most with the given skills (for suggesting target titles from a résumé).
 * Score = sum of the IDF weights (over roles) of the overlapping skills / sqrt(the role's total IDF mass),
 * so rare, specific skills count more than generic ones. A role needs at least 2 overlapping skills (1 when
 * it lists fewer than 4). Selection is greedy with a 0.8 penalty per role already chosen from the same
 * family, so the list is not six variants of one role.
 */
export function rolesForSkills(skills: string[], limit = 6): RoleRef[] {
  if (!Array.isArray(skills) || skills.length === 0 || limit <= 0) return [];
  const idx = getRoleIndex();
  const have = new Set(skills.filter((s) => typeof s === 'string').map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (have.size === 0) return [];
  const scored: Array<{ r: RoleRef; score: number }> = [];
  for (const r of idx.roles) {
    let overlap = 0;
    let w = 0;
    for (const s of r.skills) {
      const k = s.toLowerCase();
      if (have.has(k)) {
        overlap++;
        w += idx.idf.get(k) ?? 0;
      }
    }
    const need = r.skills.length < 4 ? 1 : 2;
    if (overlap < need) continue;
    scored.push({ r, score: w / Math.sqrt(Math.max(1e-9, idx.roleMass.get(r.id) ?? 1)) });
  }
  scored.sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title));
  const out: RoleRef[] = [];
  const familyCount = new Map<string, number>();
  const pool = scored.slice(0, Math.max(limit * 6, 30));
  while (out.length < limit && pool.length > 0) {
    let bi = 0;
    let bv = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i]!;
      const v = c.score * Math.pow(0.8, familyCount.get(c.r.familyId) ?? 0);
      if (v > bv) {
        bv = v;
        bi = i;
      }
    }
    const [pick] = pool.splice(bi, 1);
    out.push(pick!.r);
    familyCount.set(pick!.r.familyId, (familyCount.get(pick!.r.familyId) ?? 0) + 1);
  }
  return out;
}
