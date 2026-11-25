/**
 * Deterministic skill extraction backed by the bundled skills dictionary
 * (loadReference('skills') from ../data).
 *
 * Engine: the text is tokenised once by a symbol-aware tokeniser ("C++" -> c + +, "Node.js" -> node . js,
 * "CI/CD" -> ci / cd, "R&D" -> r & d; hyphens are not tokens but are remembered as glue so that
 * "Objective-C" matches while "C-suite" does not) and walked against a token trie built from every
 * dictionary name and alias. Matching is greedy longest-match with no overlaps, so the cost is linear in
 * the text length whatever the dictionary size. Regular expressions only run for the rare candidates of
 * ambiguous entries, on a few dozen characters around them.
 */
import type { SkillSuggestion } from '../../shared/types';
import { loadReference } from '../data';
import type { SkillEntry } from '../data';
import { foldText } from './text';

// ---------------------------------------------------------------------------
// Curated tables
// ---------------------------------------------------------------------------

/**
 * Extra aliases for existing dictionary entries that the data file lacks. Each value must be an exact
 * canonical name in skills.json; entries whose target is missing are ignored. Terms listed in
 * EXACT_CASE_TERMS match only with exactly that casing.
 */
const EXTRA_ALIASES: Record<string, string[]> = {
  'Amazon S3': ['S3'],
  'RESTful APIs': ['REST', 'REST APIs', 'RESTful', 'REST services', 'RESTful API'],
  'Kubernetes': ['k8'],
  'PostgreSQL': ['Postgres'],
  'Microsoft Excel': ['MS-Excel'],
  'Machine Learning': ['ML'],
  'Large Language Models': ['LLMs', 'large language model'],
};

/** Terms (as spelled here) that must match with exactly this casing, without needing list context. */
const EXACT_CASE_TERMS = new Set([
  'S3', 'REST', 'SAP', 'CAD', 'VAT', 'OOH', 'ELL', 'SOX', 'PET', 'ART', 'CARE', 'AIM', 'ACE',
  // ordinary phrases in lower case ("we are a lean startup")
  'Lean Startup',
]);

/**
 * Single-word terms of entries flagged `ambiguous` that are nevertheless distinctive on their own
 * (not English words), so they match without list context (still case-insensitively).
 */
const DISTINCTIVE_AMBIGUOUS_TERMS = new Set([
  'golang', 'integromat', 'scss', 'rpgle', 'dotnet', 'hiveql', 'prestodb', 'tailwindcss', 'reactjs', 'expressjs',
  'saltstack', 'unity3d', 'objc', 'electronjs',
]);

/** Dictionary aliases too generic to index (they fire on ordinary prose: "translating needs into…"). */
const DISABLED_TERMS = new Set(['translating', 'calibration']);

/**
 * Terms of unflagged entries that collide with another common meaning and so get the ambiguous-entry
 * treatment (exact case + list/skill context): "CRO" is also a Contract Research Organization.
 */
const FORCE_CONTEXTUAL = new Set(['CRO']);

/**
 * Ambiguous entries that are also department names ("work with Sales, Finance and Legal"): the
 * delimited-list rule does not apply to them and only the strong introducing phrases count.
 */
const DEPARTMENT_LIKE = new Set(['Sales']);

/**
 * Boilerplate markers (EEO statements, privacy/fraud notices). Matches inside a sentence containing one
 * are ignored: "…national origin, disability, genetics…" is not a skill requirement.
 */
const BOILERPLATE_RE =
  /national origin|sexual orientation|gender identity|veteran status|equal (?:employment )?opportunity|without regard to|reasonable accommodation|privacy (?:policy|notice)|recruit(?:ment|ing) (?:fraud|scam)|e-verify|affirmative action|protected (?:class|characteristic|status|veteran)|pay transparency|(?:hiring|recruit(?:ment|ing)|application|interview) process|recruiting partner|request (?:an? )?(?:reasonable )?accommodation|accommodations? (?:due to|during)|total rewards package|benefits package|\beeo\b(?: is the law| policy| rights| employer| statement)|know your rights/gi;

/** Words that may follow a hyphen after a skill without making it part of a compound ("Python-based"). */
const HYPHEN_SUFFIX_OK = new Set([
  'based', 'driven', 'powered', 'savvy', 'first', 'native', 'centric', 'focused', 'enabled', 'heavy', 'specific',
  'certified', 'trained', 'experienced', 'proficient', 'related', 'friendly', 'compatible', 'compliant', 'backed',
]);

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

/** How a token is attached to the previous one. */
const enum Sep {
  Start = 0,
  Space = 1,
  Hyphen = 2,
  Direct = 3,
  Break = 4,
}

interface Tok {
  /** Folded (lower-case, diacritic-free) text. */
  t: string;
  /** Original text (apostrophes removed). */
  o: string;
  s: number;
  e: number;
  sep: Sep;
  sym: boolean;
}

function isWordCode(c: number): boolean {
  if (c < 128) return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57);
  return WORD_RE.test(String.fromCharCode(c));
}
const WORD_RE = /[\p{L}\p{N}\p{M}]/u;
const NON_ASCII_RE = /[^\x00-\x7f]/;

function isApostrophe(c: number): boolean {
  return c === 39 || c === 0x2019;
}

/**
 * Symbol-aware tokeniser shared by dictionary terms and texts.
 *  - words: runs of letters/digits (apostrophes inside words are dropped: "driver's" -> drivers);
 *  - "+" and "#" right after a word ("C++", "C#", "Sec+") are tokens;
 *  - "." before a letter/digit (".NET", "Node.js", "2.0") is a token;
 *  - "/" and "&" between two words ("CI/CD", "R&D") are tokens; a free-standing "&" reads as "and";
 *  - a hyphen between words is not a token: it marks the next word as hyphen-glued;
 *  - any other punctuation (or a newline) is a hard break that multi-word matches may not cross.
 */
function tokenizeSkills(text: string): Tok[] {
  const toks: Tok[] = [];
  const n = text.length;
  let sep: Sep = Sep.Start;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (isWordCode(c)) {
      const s = i;
      let hasApos = false;
      i++;
      while (i < n) {
        const d = text.charCodeAt(i);
        if (isWordCode(d)) i++;
        else if (isApostrophe(d) && i + 1 < n && isWordCode(text.charCodeAt(i + 1))) {
          hasApos = true;
          i++;
        } else break;
      }
      let o = text.slice(s, i);
      if (hasApos) o = o.replace(/['’]/g, '');
      const t = NON_ASCII_RE.test(o) ? foldText(o) : o.toLowerCase();
      toks.push({ t, o, s, e: i, sep: toks.length === 0 ? Sep.Start : sep, sym: false });
      sep = Sep.Space;
      continue;
    }
    const prevWord = i > 0 && isWordCode(text.charCodeAt(i - 1));
    const nextCode = i + 1 < n ? text.charCodeAt(i + 1) : 0;
    const nextWord = i + 1 < n && isWordCode(nextCode);
    const prevChar = i > 0 ? text.charCodeAt(i - 1) : 0;
    if (c === 43 /* + */ || c === 35 /* # */) {
      if (prevWord || prevChar === 43 || prevChar === 35) {
        toks.push({ t: text[i]!, o: text[i]!, s: i, e: i + 1, sep: Sep.Direct, sym: true });
        sep = Sep.Space;
      } else sep = Sep.Break;
      i++;
      continue;
    }
    if (c === 46 /* . */) {
      if (nextWord) {
        toks.push({ t: '.', o: '.', s: i, e: i + 1, sep: prevWord ? Sep.Direct : toks.length === 0 ? Sep.Start : sep, sym: true });
        sep = Sep.Direct;
      } else sep = Sep.Break;
      i++;
      continue;
    }
    if (c === 47 /* / */ || c === 38 /* & */) {
      const prevOk = prevWord || prevChar === 43 || prevChar === 35;
      if (prevOk && (nextWord || (c === 47 && nextCode === 46))) {
        toks.push({ t: text[i]!, o: text[i]!, s: i, e: i + 1, sep: Sep.Direct, sym: true });
        sep = Sep.Direct;
      } else if (c === 38 && (prevChar === 32 || prevChar === 160) && (nextCode === 32 || nextCode === 160)) {
        toks.push({ t: 'and', o: '&', s: i, e: i + 1, sep: toks.length === 0 ? Sep.Start : sep, sym: false });
        sep = Sep.Space;
      } else sep = Sep.Break;
      i++;
      continue;
    }
    if (c === 45 /* - */ || c === 0x2010 || c === 0x2011) {
      sep = prevWord && nextWord ? Sep.Hyphen : Sep.Break;
      i++;
      continue;
    }
    if (c === 32 || c === 9 || c === 160) {
      if (sep !== Sep.Break) sep = Sep.Space;
      i++;
      continue;
    }
    if (isApostrophe(c)) {
      // stray apostrophe / quote: soft separator
      if (sep !== Sep.Break) sep = Sep.Space;
      i++;
      continue;
    }
    sep = Sep.Break;
    i++;
  }
  return toks;
}

// ---------------------------------------------------------------------------
// Dictionary index (built lazily)
// ---------------------------------------------------------------------------

interface Term {
  skill: number;
  /** Original-case token texts, for exact-case comparison. */
  orig: string[];
  /** Needs list/skill context (single plain word of an ambiguous entry); implies exact case. */
  contextual: boolean;
  exactCase: boolean;
  /** One word token of at most two characters ("R", "Go", "RN"): no hyphen gluing allowed. */
  short: boolean;
  /** Generated spelling variant (lower priority than a real name/alias at the same trie node). */
  variant: boolean;
}

interface TrieNode {
  next: Map<string, TrieNode> | undefined;
  terms: Term[] | undefined;
}

interface SkillIndex {
  entries: SkillEntry[];
  root: TrieNode;
  /** Lookup key (folded tokens joined by a space) -> entry index. */
  byKey: Map<string, number>;
  /** Folded canonical name -> entry index. */
  byName: Map<string, number>;
  /** Number of taxonomy roles listing each entry as a typical skill. */
  popularity: Int32Array;
  suggest: Array<{ i: number; name: string; aliases: string[]; words: string[]; rank: number }>;
  buildMs: number;
}

let index: SkillIndex | undefined;

function lookupKey(s: string): string {
  return tokenizeSkills(s.trim())
    .map((t) => t.t)
    .join(' ');
}

const CAMEL_RE = /[a-z][A-Z]/;
const DIGIT_RE = /\d/;
const ALL_CAPS_RE = /^[A-Z]{2,}$/;

function buildIndex(): SkillIndex {
  const t0 = performance.now();
  const entries = loadReference('skills').skills;
  const root: TrieNode = { next: undefined, terms: undefined };
  const byKey = new Map<string, number>();
  const byName = new Map<string, number>();
  const nameToIndex = new Map<string, number>();
  entries.forEach((e, i) => nameToIndex.set(e.name, i));

  const insert = (toks: Tok[], term: Term): void => {
    let node = root;
    for (const tk of toks) {
      node.next ??= new Map();
      let child = node.next.get(tk.t);
      if (!child) {
        child = { next: undefined, terms: undefined };
        node.next.set(tk.t, child);
      }
      node = child;
    }
    if (!node.terms) node.terms = [term];
    else if (!node.terms.some((x) => x.skill === term.skill && x.exactCase === term.exactCase && x.contextual === term.contextual)) {
      // real names/aliases before generated variants; exact-case terms before case-insensitive ones
      node.terms.push(term);
      node.terms.sort((a, b) => Number(a.variant) - Number(b.variant) || Number(b.exactCase) - Number(a.exactCase));
    }
  };

  const addTerm = (raw: string, i: number, ambiguous: boolean, variant: boolean): void => {
    if (DISABLED_TERMS.has(raw.toLowerCase())) return;
    const toks = tokenizeSkills(raw);
    if (toks.length === 0) return;
    const words = toks.filter((t) => !t.sym);
    const single = toks.length === 1 && words.length === 1;
    const w0 = words[0]?.o ?? '';
    const contextual =
      FORCE_CONTEXTUAL.has(raw) ||
      (ambiguous && single && !DIGIT_RE.test(w0) && !CAMEL_RE.test(w0) && !DISTINCTIVE_AMBIGUOUS_TERMS.has(w0.toLowerCase()));
    const short = single && w0.length <= 2;
    const exactCase =
      contextual ||
      EXACT_CASE_TERMS.has(raw) ||
      // two-letter acronyms ("RN", "QA", "AI") collide with words and names when lower-cased
      (short && ALL_CAPS_RE.test(w0));
    const term: Term = { skill: i, orig: toks.map((t) => t.o), contextual, exactCase, short, variant };
    insert(toks, term);
    const key = toks.map((t) => t.t).join(' ');
    if (!byKey.has(key)) byKey.set(key, i);
    if (variant || toks.length < 2) return;
    // Spelling variants: hyphen- or dot-joined words written solid ("Back-End" -> backend,
    // "Node.js" -> nodejs, "ASP.NET" -> aspnet), and "x.js" written "x js".
    const solid: Tok[] = [];
    let changed = false;
    for (let k = 0; k < toks.length; k++) {
      const tk = toks[k]!;
      const last = solid[solid.length - 1];
      const nx = toks[k + 1];
      if (tk.t === '.' && last && !last.sym && nx && !nx.sym && /[a-z]/.test(last.t) && /[a-z]/.test(nx.t)) {
        solid[solid.length - 1] = { ...last, t: last.t + nx.t, o: last.o + nx.o };
        k++;
        changed = true;
      } else if (last && !last.sym && !tk.sym && tk.sep === Sep.Hyphen) {
        solid[solid.length - 1] = { ...last, t: last.t + tk.t, o: last.o + tk.o };
        changed = true;
      } else solid.push(tk);
    }
    const variants: Tok[][] = [];
    if (changed) variants.push(solid);
    const n = toks.length;
    if (n >= 3 && toks[n - 2]!.t === '.' && toks[n - 1]!.t === 'js' && !toks[n - 3]!.sym) {
      variants.push([...toks.slice(0, n - 2), toks[n - 1]!]);
    }
    for (const v of variants) {
      insert(v, { ...term, orig: v.map((x) => x.o), variant: true, short: false });
      const vkey = v.map((x) => x.t).join(' ');
      if (!byKey.has(vkey)) byKey.set(vkey, i);
    }
  };

  entries.forEach((e, i) => {
    byName.set(foldText(e.name), i);
    addTerm(e.name, i, !!e.ambiguous, false);
    for (const a of e.aliases) addTerm(a, i, !!e.ambiguous, false);
  });
  for (const [name, aliases] of Object.entries(EXTRA_ALIASES)) {
    const i = nameToIndex.get(name);
    if (i === undefined) continue;
    for (const a of aliases) addTerm(a, i, false, false);
  }

  const popularity = new Int32Array(entries.length);
  try {
    for (const f of loadReference('roles').families)
      for (const r of f.roles)
        for (const s of r.skills) {
          const i = nameToIndex.get(s);
          if (i !== undefined) popularity[i]!++;
        }
  } catch {
    // roles data is optional for skills
  }
  const suggest = entries.map((e, i) => ({
    i,
    name: foldText(e.name),
    aliases: e.aliases.map((a) => foldText(a)),
    words: foldText(e.name).split(/[^\p{L}\p{N}+#.]+/u).filter(Boolean),
    rank: e.name.length - 4 * Math.log(1 + popularity[i]!),
  }));
  return { entries, root, byKey, byName, popularity, suggest, buildMs: performance.now() - t0 };
}

function getIndex(): SkillIndex {
  index ??= buildIndex();
  return index;
}

/** Time spent building the dictionary index (ms); builds it if needed. For diagnostics and tests. */
export function skillIndexBuildMs(): number {
  return getIndex().buildMs;
}

// ---------------------------------------------------------------------------
// Context rule for ambiguous entries
// ---------------------------------------------------------------------------

/** Phrases that introduce skills; the candidate must follow one directly (optionally after a qualifier). */
const INTRO_RE = new RegExp(
  '(?:' +
    [
      'experience (?:with|in|using|of)',
      'experienced (?:with|in)',
      'proficien(?:t|cy) (?:in|with|at)',
      'knowledge of',
      'familiar(?:ity)? with',
      'expertise (?:in|with)',
      'expert in',
      'skilled (?:in|with)',
      'skills? in',
      'background in',
      'fluen(?:t|cy) in',
      'hands-on (?:experience )?with',
      'work(?:ing)? with',
      'using',
      'use of',
      'written in',
      'built (?:with|in|on)',
      '(?:develop(?:ing|ment)?|program(?:ming)?|coding|code|writing|scripting) in',
      'such as',
      'including',
      'e\\.g\\.?,?',
      '(?:languages?|frameworks?|tools?|technologies|platforms?|databases?|stacks?) (?:like|such as|including)',
      '(?:skills|tech(?:nology)? stack|stack|languages|tools|technologies|frameworks|tooling|platforms|requirements)\\s*:',
    ].join('|') +
    ')\\s*\\(?\\s*(?:the |both |either |modern |strong |solid |advanced |basic |native |professional |deep |good )?$',
  'i',
);

/** The stricter subset of INTRO_RE used for department-like entries ("experience in Sales", not "work with Sales"). */
const STRONG_INTRO_RE =
  /(?:experience (?:with|in)|experienced in|proficien(?:t|cy) in|knowledge of|expertise in|background in|skills? in|skills\s*:)\s*(?:the |strong |solid |proven )?$/i;

/** A line that starts with a skills-style heading ("Skills: …", "Tech stack – …", "• Tools: …"). */
const HEADING_RE =
  /^\s*(?:[-*•·>]\s*)?(?:(?:technical|tech|core|key|required|preferred|relevant|our|the|primary|programming|nice to have)\s+)?(?:skills?|skill set|tech(?:nology|nical)?\s*stack|stack|technolog(?:y|ies)|tools?|tooling|languages?|frameworks?|platforms?|competenc(?:y|ies)|keywords|tags|software)\b[^\n:–—-]{0,12}[:–—-]/i;

/** What may separate two items of a delimited list. */
const LIST_SEP_RE = /^[\s,;|/•·*&+()[\]–—-]*(?:\b(?:and|or|as well as|plus|und|oder|et|ou)\b)?[\s,;|/•·*&+()[\]–—-]*$/i;
const HAS_DELIM_RE = /[,;|/•·*&+–—-]|\b(?:and|or|as well as|plus|und|oder|et|ou)\b/i;

interface Match {
  skill: number;
  s: number;
  e: number;
  contextual: boolean;
  ok: boolean;
}

function listAdjacent(text: string, a: Match, b: Match): boolean {
  const gap = text.slice(a.e, b.s);
  if (gap.length > 14) return false;
  if (!LIST_SEP_RE.test(gap)) return false;
  if (HAS_DELIM_RE.test(gap)) return true;
  return false;
}

/** The candidate is alone on its line (a bullet item), so a neighbouring line's skill counts as adjacent. */
function aloneOnLine(text: string, m: Match): boolean {
  let ls = text.lastIndexOf('\n', m.s - 1) + 1;
  let le = text.indexOf('\n', m.e);
  if (le < 0) le = text.length;
  const before = text.slice(ls, m.s);
  const after = text.slice(m.e, le);
  ls = 0;
  return /^[\s\-*•·>\d.)]*$/.test(before) && /^[\s,;.]*$/.test(after);
}

function introduced(text: string, m: Match, strong: boolean): boolean {
  const from = Math.max(0, m.s - 60);
  const before = text.slice(from, m.s);
  if ((strong ? STRONG_INTRO_RE : INTRO_RE).test(before)) return true;
  const ls = text.lastIndexOf('\n', m.s - 1) + 1;
  return HEADING_RE.test(text.slice(ls, m.s));
}

/** Sentence/line spans that contain boilerplate markers. */
function boilerplateSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  BOILERPLATE_RE.lastIndex = 0;
  for (let m = BOILERPLATE_RE.exec(text); m; m = BOILERPLATE_RE.exec(text)) {
    const at = m.index;
    const s = Math.max(text.lastIndexOf('. ', at), text.lastIndexOf('\n', at)) + 1;
    let e1 = text.indexOf('. ', at);
    let e2 = text.indexOf('\n', at);
    if (e1 < 0) e1 = text.length;
    if (e2 < 0) e2 = text.length;
    const e = Math.min(e1, e2);
    const last = spans[spans.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else spans.push([s, e]);
    BOILERPLATE_RE.lastIndex = Math.max(BOILERPLATE_RE.lastIndex, e);
  }
  return spans;
}

function resolveContext(text: string, matches: Match[], entries: SkillEntry[]): void {
  for (const m of matches) {
    if (!m.contextual) m.ok = true;
    else m.ok = introduced(text, m, DEPARTMENT_LIKE.has(entries[m.skill]!.name));
  }
  // propagate through delimited lists until nothing changes
  let changed = true;
  for (let pass = 0; changed && pass < 8; pass++) {
    changed = false;
    for (let k = 0; k < matches.length; k++) {
      const m = matches[k]!;
      if (m.ok) continue;
      const prev = matches[k - 1];
      const next = matches[k + 1];
      if (DEPARTMENT_LIKE.has(entries[m.skill]!.name)) continue;
      if ((prev && prev.ok && listAdjacent(text, prev, m)) || (next && next.ok && listAdjacent(text, m, next))) {
        m.ok = true;
        changed = true;
        continue;
      }
      // bullet lists: one skill per line
      if (aloneOnLine(text, m)) {
        const near = (o: Match | undefined): boolean =>
          !!o && o.ok && aloneOnLine(text, o) && !/\n\s*\n/.test(text.slice(Math.min(o.e, m.e), Math.max(o.s, m.s)));
        if (near(prev) || near(next)) {
          m.ok = true;
          changed = true;
        }
      }
    }
  }
  // a run of three or more list-adjacent dictionary matches is a skills list even with no anchor
  // ("Microsoft Office products (Excel, Word, Teams and Outlook)")
  let runStart = 0;
  for (let k = 1; k <= matches.length; k++) {
    if (k < matches.length && listAdjacent(text, matches[k - 1]!, matches[k]!)) continue;
    if (k - runStart >= 3)
      for (let r = runStart; r < k; r++) {
        const m = matches[r]!;
        if (!m.ok && !DEPARTMENT_LIKE.has(entries[m.skill]!.name)) m.ok = true;
      }
    runStart = k;
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function caseOk(term: Term, toks: Tok[], i: number): boolean {
  if (!term.exactCase) return true;
  for (let k = 0; k < term.orig.length; k++) if (toks[i + k]!.o !== term.orig[k]) return false;
  return true;
}

function startOk(term: Term, toks: Tok[], i: number): boolean {
  const tk = toks[i]!;
  switch (tk.sep) {
    case Sep.Start:
    case Sep.Space:
    case Sep.Break:
      return true;
    case Sep.Hyphen:
      return !term.contextual && !term.short;
    case Sep.Direct:
      return i > 0 && toks[i - 1]!.t === '/';
  }
}

function endOk(term: Term, toks: Tok[], j: number): boolean {
  const nx = toks[j + 1];
  if (!nx) return true;
  switch (nx.sep) {
    case Sep.Start:
    case Sep.Space:
    case Sep.Break:
      return true;
    case Sep.Hyphen:
      if (term.short && term.orig.length === 1 && term.orig[0]!.length === 1) return false;
      if (HYPHEN_SUFFIX_OK.has(nx.t)) return true;
      return !term.contextual && !term.short;
    case Sep.Direct:
      return nx.t === '/' && !!toks[j + 2] && toks[j + 2]!.sep === Sep.Direct && !toks[j + 2]!.sym;
  }
}

function findMatches(text: string): Match[] {
  const { root } = getIndex();
  const toks = tokenizeSkills(text);
  const out: Match[] = [];
  const n = toks.length;
  let i = 0;
  while (i < n) {
    const first = root.next?.get(toks[i]!.t);
    if (!first) {
      i++;
      continue;
    }
    // walk the trie, remembering every node that ends a term
    let node: TrieNode | undefined = first;
    let j = i;
    let ends: Array<[number, TrieNode]> | undefined;
    let lastEnd: [number, TrieNode] | undefined;
    while (node) {
      if (node.terms) {
        if (lastEnd) (ends ??= []).push(lastEnd);
        lastEnd = [j, node];
      }
      const nj = j + 1;
      if (nj >= n || !node.next) break;
      const nt = toks[nj]!;
      if (nt.sep === Sep.Break) break;
      node = node.next.get(nt.t);
      j = nj;
    }
    let matched: Match | undefined;
    let endTok = -1;
    for (let cand = lastEnd; cand; cand = ends?.pop()) {
      const [ej, nd] = cand;
      for (const term of nd.terms!) {
        if (!caseOk(term, toks, i) || !startOk(term, toks, i) || !endOk(term, toks, ej)) continue;
        matched = { skill: term.skill, s: toks[i]!.s, e: toks[ej]!.e, contextual: term.contextual, ok: false };
        endTok = ej;
        break;
      }
      if (matched) break;
    }
    if (matched) {
      out.push(matched);
      i = endTok + 1;
    } else i++;
  }
  return out;
}

/**
 * Find dictionary skills mentioned in free text (a résumé or job description).
 * Returns canonical names, most prominent first (earlier and more frequent mentions rank higher).
 *  - Case-insensitive whole-token matching of names and aliases, including multi-word skills and
 *    names with symbols ("C++", "C#", ".NET", "Node.js", "CI/CD", "A/B testing", "Objective-C").
 *  - Entries flagged `ambiguous` (Go, R, C, Swift, Excel, …) match only case-sensitively AND in a
 *    list-like or skill-like context (comma/slash/bullet-separated lists, after "experience with",
 *    "proficient in", "using", "knowledge of", in a "Skills:" line …), never as an ordinary word
 *    ("go to market", "excel at", "R&D").
 *  - Longest match wins ("Java" must not fire inside "JavaScript"; "SQL" not inside "MySQL";
 *    "React Native" yields React Native, not React).
 * Must stay fast: one pass over the text, usable on thousands of descriptions per second.
 *
 * Concretely, a single-word name/alias of an ambiguous entry ("Go", "Excel", "Spark", "Teams") must be
 * written in exactly the dictionary's casing AND (a) sit in a delimited list (comma, slash, pipe, bullet,
 * "and"/"or") next to another accepted skill, or (b) directly follow a skill-introducing phrase
 * ("experience with", "proficient in", "knowledge of", "using", "written in", "skills:", …), or (c) be on
 * a line that starts with a skills-style heading ("Skills:", "Tech stack:", "Tools:"). Multi-word aliases
 * of those entries ("Microsoft Excel", "Apache Spark", "Golang") match like any other term.
 * Ranking: prominence = (1 - firstPosition / textLength) + 0.25 * ln(count); ties by first position.
 */
export function extractSkills(text: string, opts: { limit?: number } = {}): string[] {
  if (!text) return [];
  const { entries } = getIndex();
  let matches = findMatches(text);
  if (matches.length === 0) return [];
  const spans = boilerplateSpans(text);
  if (spans.length > 0) matches = matches.filter((m) => !spans.some(([a, b]) => m.s >= a && m.e <= b));
  if (matches.some((m) => m.contextual)) resolveContext(text, matches, entries);
  else for (const m of matches) m.ok = true;
  const first = new Map<number, number>();
  const count = new Map<number, number>();
  for (const m of matches) {
    if (!m.ok) continue;
    if (!first.has(m.skill)) first.set(m.skill, m.s);
    count.set(m.skill, (count.get(m.skill) ?? 0) + 1);
  }
  const len = Math.max(1, text.length);
  const ranked = [...first.keys()].map((k) => {
    const pos = first.get(k)!;
    return { k, pos, score: 1 - pos / len + 0.25 * Math.log(count.get(k)!) };
  });
  ranked.sort((a, b) => b.score - a.score || a.pos - b.pos);
  const limit = opts.limit !== undefined && opts.limit >= 0 ? Math.floor(opts.limit) : ranked.length;
  return ranked.slice(0, limit).map((r) => entries[r.k]!.name);
}

/** Canonical name for a skill name or alias (case-insensitive), or undefined when unknown. */
export function canonicalSkill(name: string): string | undefined {
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const { entries, byKey, byName } = getIndex();
  const direct = byName.get(foldText(trimmed));
  if (direct !== undefined) return entries[direct]!.name;
  const i = byKey.get(lookupKey(trimmed));
  return i === undefined ? undefined : entries[i]!.name;
}

/**
 * Canonicalise and de-duplicate a user-entered skill list, keeping unknown skills as typed.
 * Known skills become their canonical name ("js" -> "JavaScript", "k8s" -> "Kubernetes"); unknown ones
 * are kept trimmed with their original casing; duplicates (case- and diacritic-insensitive, after
 * canonicalisation) are dropped, keeping the first; order is preserved.
 */
export function normalizeSkillList(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const v = canonicalSkill(t) ?? t;
    const k = foldText(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * Autocomplete: skills whose name or alias starts with (then contains) the query.
 * Order: name prefix, alias prefix (the canonical name is returned once), word prefix inside the name,
 * then substring of name or alias. Within a tier, shorter and more common names (listed by more
 * taxonomy roles) come first.
 */
export function suggestSkills(query: string, limit = 8): SkillSuggestion[] {
  const q = foldText(String(query ?? '')).trim().replace(/\s+/g, ' ');
  if (!q || limit <= 0) return [];
  const { entries, suggest } = getIndex();
  const tiers: Array<Array<{ i: number; rank: number }>> = [[], [], [], []];
  for (const s of suggest) {
    let tier = -1;
    if (s.name.startsWith(q)) tier = 0;
    else if (s.aliases.some((a) => a.startsWith(q))) tier = 1;
    else if (s.words.some((w) => w.startsWith(q))) tier = 2;
    else if (s.name.includes(q) || s.aliases.some((a) => a.includes(q))) tier = 3;
    if (tier >= 0) tiers[tier]!.push({ i: s.i, rank: s.rank });
  }
  const out: SkillSuggestion[] = [];
  for (const tier of tiers) {
    tier.sort((a, b) => a.rank - b.rank || entries[a.i]!.name.localeCompare(entries[b.i]!.name));
    for (const { i } of tier) {
      if (out.length >= limit) return out;
      const e = entries[i]!;
      out.push({ name: e.name, category: e.category });
    }
  }
  return out;
}

/** Dictionary category for a canonical skill, or undefined. Aliases are accepted too. */
export function skillCategory(name: string): string | undefined {
  const c = canonicalSkill(name);
  if (c === undefined) return undefined;
  const { entries, byName } = getIndex();
  const i = byName.get(foldText(c));
  return i === undefined ? undefined : entries[i]!.category;
}
