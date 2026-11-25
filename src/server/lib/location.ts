/**
 * Location understanding, backed by the bundled gazetteer
 * (loadReference('gazetteer') from ../data). No network.
 *
 * Indexes are built lazily on first use (~100 ms); the autocomplete prefix index is built
 * separately on the first suggestPlaces() call.
 */
import type { JobLocation, Place, PlaceKind, RemoteMode } from '../../shared/types';
import { loadReference } from '../data';
import {
  ADMIN1_BEATS_CITY_COUNTRIES,
  ADMIN1_CODE_LABEL_COUNTRIES,
  BLOCKED_CODES,
  CITY_FIRST_KEYS,
  CITY_STATES,
  COMMON_WORD_CITIES,
  COUNTRY_SHORT,
  EXTRA_CITY_ALIASES,
  ISO_PREFERRED_CODES,
  LOWER_OK_SHORT_KEYS,
  STANDALONE_ADMIN1_COUNTRIES,
  UK_COUNTIES,
  WHOLE_STRING_CITIES,
} from './location-data';
import { foldText } from './text';

export interface LocationInput {
  /** Raw location strings from the source. */
  locations: string[];
  /** Explicit structured hint from the source, when it has one. */
  remote?: 'remote' | 'hybrid' | 'onsite';
  title?: string;
  /** Plain-text description; only used for remote/hybrid detection and remote scope. */
  descriptionText?: string;
  tags?: string[];
}

export interface ParsedLocation {
  location: JobLocation;
  /** Display string, e.g. "Austin, TX · Hybrid", "Remote (US, Canada)", "London, UK +2 more". */
  text: string;
}

// ---------------------------------------------------------------------------
// Keys and the lazily built index
// ---------------------------------------------------------------------------

/**
 * Canonical lookup key for a place name: folded (diacritics, case), apostrophes and dots dropped,
 * "&" read as "and", every other run of punctuation a single space.
 * "St. John's" -> "st johns", "Washington, D.C." -> "washington dc", "UK & Ireland" -> "uk and ireland".
 */
export function placeKey(s: string): string {
  const ascii = /^[\x20-\x7e]*$/.test(s);
  const f = ascii ? s.toLowerCase() : foldText(s);
  return f
    .replace(/['’‘`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\./g, '')
    .replace(ascii ? /[^a-z0-9]+/g : /[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

interface Entry {
  /** City rows (alias targets first, then by population). */
  c?: number[];
  /** Admin1 indices. */
  a?: number[];
  /** Country indices. */
  k?: number[];
  /** Region indices. */
  r?: number[];
  /** Admin1 indices usable only as a city qualifier (UK counties). */
  q?: number[];
}

interface CountryRec {
  code: string;
  name: string;
  region: string;
}
interface Admin1Rec {
  country: string;
  code: string;
  name: string;
  /** Postal abbreviation used in labels (US code, Canadian "ON"). */
  abbr?: string;
}
interface RegionRec {
  name: string;
  countries: string[];
}
type CityRow = [string, string, string, string, number, number, number];

interface Index {
  cities: CityRow[];
  countries: CountryRec[];
  countryByCode: Map<string, number>;
  admin1: Admin1Rec[];
  admin1ById: Map<string, number>;
  regions: RegionRec[];
  keys: Map<string, Entry>;
  /** Keys that came from the city alias table (abbreviations like "LA", "SF", "DC"). */
  aliasKeys: Set<string>;
  buildMs: number;
}

let INDEX: Index | undefined;

function addEntry(keys: Map<string, Entry>, key: string, field: keyof Entry, idx: number): void {
  if (!key) return;
  let e = keys.get(key);
  if (!e) {
    e = {};
    keys.set(key, e);
  }
  const arr = e[field];
  if (!arr) e[field] = [idx];
  else if (!arr.includes(idx)) arr.push(idx);
}

const KEY_VARIANTS: Array<[RegExp, string]> = [
  [/^st /, 'saint '],
  [/^saint /, 'st '],
  [/^ste /, 'sainte '],
  [/^sainte /, 'ste '],
  [/^fort /, 'ft '],
  [/^ft /, 'fort '],
  [/^mount /, 'mt '],
  [/^mt /, 'mount '],
];

function index(): Index {
  if (INDEX) return INDEX;
  const t0 = performance.now();
  const g = loadReference('gazetteer');
  const keys = new Map<string, Entry>();
  const aliasKeys = new Set<string>();

  const countries: CountryRec[] = [];
  const countryByCode = new Map<string, number>();
  g.countries.forEach((c, i) => {
    countries.push({ code: c.code, name: c.name, region: c.region });
    countryByCode.set(c.code, i);
    addEntry(keys, placeKey(c.name), 'k', i);
    addEntry(keys, c.code.toLowerCase(), 'k', i);
    for (const al of c.aliases) addEntry(keys, placeKey(al), 'k', i);
  });

  const admin1: Admin1Rec[] = [];
  const admin1ById = new Map<string, number>();
  g.admin1.forEach((a, i) => {
    const rec: Admin1Rec = { country: a.country, code: a.code, name: a.name };
    if (a.country === 'US') rec.abbr = a.code;
    else if (a.country === 'CA') {
      const ab = (a.aliases ?? []).find((x) => /^[A-Z]{2}$/.test(x));
      if (ab) rec.abbr = ab;
    }
    admin1.push(rec);
    admin1ById.set(`${a.country}|${a.code}`, i);
    addEntry(keys, placeKey(a.name), 'a', i);
    if (a.country === 'US') addEntry(keys, a.code.toLowerCase(), 'a', i);
    for (const al of a.aliases ?? []) addEntry(keys, placeKey(al), 'a', i);
  });
  for (const [county, code] of Object.entries(UK_COUNTIES)) {
    const ai = admin1ById.get(`GB|${code}`);
    if (ai !== undefined) addEntry(keys, county, 'q', ai);
  }

  const cities = g.cities as CityRow[];
  const cityById = new Map<string, number>();
  for (let i = 0; i < cities.length; i++) {
    const r = cities[i]!;
    const k1 = placeKey(r[0]);
    const k2 = r[1] === r[0] ? k1 : placeKey(r[1]);
    for (const k of k1 === k2 ? [k1] : [k1, k2]) {
      addCity(keys, k, i);
      for (const [re, rep] of KEY_VARIANTS) if (re.test(k)) addCity(keys, k.replace(re, rep), i);
    }
    const id = `${r[0]}|${r[2]}|${r[3]}`;
    if (!cityById.has(id)) cityById.set(id, i);
  }
  const addAlias = (alias: string, city: string, a1: string, country: string) => {
    const row = cityById.get(`${city}|${a1}|${country}`);
    if (row === undefined) return;
    const k = placeKey(alias);
    if (!k) return;
    aliasKeys.add(k);
    let e = keys.get(k);
    if (!e) {
      e = {};
      keys.set(k, e);
    }
    e.c = [row, ...(e.c ?? []).filter((x) => x !== row)];
  };
  for (const al of g.aliases) addAlias(al.alias, al.city, al.admin1, al.country);
  for (const [al, city, a1, country] of EXTRA_CITY_ALIASES) addAlias(al, city, a1, country);

  const regions: RegionRec[] = [];
  g.regions.forEach((r, i) => {
    regions.push({ name: r.name, countries: r.countries });
    addEntry(keys, placeKey(r.name), 'r', i);
    for (const al of r.aliases) addEntry(keys, placeKey(al), 'r', i);
  });

  INDEX = {
    cities,
    countries,
    countryByCode,
    admin1,
    admin1ById,
    regions,
    keys,
    aliasKeys,
    buildMs: 0,
  };
  INDEX.buildMs = performance.now() - t0;
  return INDEX;
}

function addCity(keys: Map<string, Entry>, key: string, row: number): void {
  if (!key) return;
  let e = keys.get(key);
  if (!e) {
    e = {};
    keys.set(key, e);
  }
  if (!e.c) e.c = [row];
  else if (e.c[e.c.length - 1] !== row) e.c.push(row);
}

/** Milliseconds the main index took to build (builds it if needed). For diagnostics and tests. */
export function locationIndexStats(): { buildMs: number; keys: number; cities: number } {
  const ix = index();
  return { buildMs: ix.buildMs, keys: ix.keys.size, cities: ix.cities.length };
}

/**
 * How strictly short tokens are matched. Strict: location strings from sources (2–3 letter codes only
 * when written in capitals). Relaxed: user-typed text (any case). Desc: like Strict, and "us" is never the country.
 */
const Mode = { Strict: 0, Relaxed: 1, Desc: 2 } as const;
type Mode = (typeof Mode)[keyof typeof Mode];

function isAllUpper(letters: string): boolean {
  return letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** Look a text up, applying the letter-case rules for short keys. */
function lookup(text: string, mode: Mode): { key: string; e: Entry } | undefined {
  const key = placeKey(text);
  if (!key) return undefined;
  const e = index().keys.get(key);
  if (!e) return undefined;
  const compact = key.replace(/ /g, '');
  if (compact.length > 3 || mode === Mode.Relaxed) return { key, e };
  if (LOWER_OK_SHORT_KEYS.has(key) && !(mode === Mode.Desc && key === 'us')) return { key, e };
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (isAllUpper(letters)) return { key, e };
  // "Ufa", "Zug", "Rio": a capitalised three-letter word may be a city, never a code.
  if (compact.length === 3 && /^\p{Lu}\p{Ll}+$/u.test(letters) && e.c && !COMMON_WORD_CITIES.has(key)) {
    return { key, e: { c: e.c } };
  }
  return undefined;
}

function keyExists(text: string): boolean {
  const k = placeKey(text);
  return k.length > 3 && index().keys.has(k);
}

// ---------------------------------------------------------------------------
// Place construction and labels
// ---------------------------------------------------------------------------

function countryRec(code: string | undefined): CountryRec | undefined {
  if (!code) return undefined;
  const ix = index();
  const i = ix.countryByCode.get(code.toUpperCase());
  return i === undefined ? undefined : ix.countries[i];
}

/** English country name for an ISO alpha-2 code. */
export function countryName(code: string): string | undefined {
  return countryRec(code)?.name;
}

/** Short country form used after a city and in remote-scope lists: "US", "UK", "UAE", "Germany". */
export function countryShortName(code: string): string | undefined {
  const c = code.toUpperCase();
  return COUNTRY_SHORT[c] ?? countryName(c);
}

function admin1Rec(country: string | undefined, code: string | undefined): Admin1Rec | undefined {
  if (!country || !code) return undefined;
  const ix = index();
  const i = ix.admin1ById.get(`${country}|${code}`);
  return i === undefined ? undefined : ix.admin1[i];
}

function cityDisplayName(city: string, country: string | undefined): string {
  return city === 'New York City' && country === 'US' ? 'New York' : city;
}

function cityStyleLabel(city: string, admin1: string | undefined, country: string | undefined, admin1Name?: string): string {
  const name = cityDisplayName(city, country);
  if (!country) return name;
  if (CITY_STATES.has(country)) return name;
  if (ADMIN1_CODE_LABEL_COUNTRIES.has(country)) {
    const abbr = admin1Rec(country, admin1)?.abbr ?? (admin1 && /^[A-Z]{2}$/.test(admin1) ? admin1 : undefined);
    if (abbr) return `${name}, ${abbr}`;
  }
  void admin1Name;
  return `${name}, ${countryShortName(country) ?? country}`;
}

/** Short display label for a place: "Austin, TX", "Ontario, Canada", "Germany", "EMEA", "Anywhere". */
export function placeLabel(place: Omit<Place, 'label'>): string {
  switch (place.kind) {
    case 'anywhere':
      return 'Anywhere';
    case 'region':
      return place.region ?? place.raw.trim();
    case 'city':
      return place.city ? cityStyleLabel(place.city, place.admin1, place.country, place.admin1Name) : place.raw.trim();
    case 'admin1': {
      if (place.city) return cityStyleLabel(place.city, place.admin1, place.country, place.admin1Name);
      const name = place.admin1Name ?? admin1Rec(place.country, place.admin1)?.name ?? place.admin1;
      if (!name) return place.raw.trim();
      return place.country ? `${name}, ${countryShortName(place.country) ?? place.country}` : name;
    }
    case 'country': {
      if (place.city && place.country) return `${place.city}, ${countryShortName(place.country) ?? place.country}`;
      return place.countryName ?? (place.country ? countryName(place.country) : undefined) ?? place.raw.trim();
    }
    default:
      return place.raw.replace(/\s+/g, ' ').trim();
  }
}

function finish(p: Omit<Place, 'label'>): Place {
  return { ...p, label: placeLabel(p) };
}

function cityPlace(row: number, raw: string): Place {
  const ix = index();
  const r = ix.cities[row]!;
  const p: Omit<Place, 'label'> = { kind: 'city', raw, city: r[0], country: r[3] };
  if (r[2]) {
    p.admin1 = r[2];
    const a = admin1Rec(r[3], r[2]);
    if (a) p.admin1Name = a.name;
  }
  const cn = countryName(r[3]);
  if (cn) p.countryName = cn;
  p.lat = r[4];
  p.lon = r[5];
  p.population = r[6];
  return finish(p);
}

function admin1Place(i: number, raw: string, locality?: string): Place {
  const a = index().admin1[i]!;
  const p: Omit<Place, 'label'> = { kind: 'admin1', raw, admin1: a.code, admin1Name: a.name, country: a.country };
  const cn = countryName(a.country);
  if (cn) p.countryName = cn;
  if (locality) p.city = locality;
  return finish(p);
}

function countryPlace(i: number, raw: string, locality?: string): Place {
  const c = index().countries[i]!;
  const p: Omit<Place, 'label'> = { kind: 'country', raw, country: c.code, countryName: c.name };
  if (locality) p.city = locality;
  return finish(p);
}

function regionPlace(i: number, raw: string): Place {
  const r = index().regions[i]!;
  return finish({ kind: 'region', raw, region: r.name, countries: [...r.countries] });
}

function anywherePlace(raw: string): Place {
  return finish({ kind: 'anywhere', raw });
}

function unknownPlace(raw: string): Place {
  return finish({ kind: 'unknown', raw: raw.replace(/\s+/g, ' ').trim() });
}

// ---------------------------------------------------------------------------
// Phrase tables
// ---------------------------------------------------------------------------

const F_REMOTE = 1;
const F_HYBRID = 2;
const F_ONSITE = 4;
const F_ANYWHERE = 8;
const F_WANT_ADMIN = 16;
const F_WANT_CITY = 32;
const F_NOISE = 64;
const F_TZ = 128;
/** Atom picked out of free text (never the locality of a qualifier). */
const F_SCAN = 256;
const MARKERS = F_REMOTE | F_HYBRID | F_ONSITE | F_ANYWHERE;

const TZ_ABBR = 'est|edt|pst|pdt|cst|cdt|mst|mdt|akst|hst|cet|cest|gmt|utc|bst|ist|aest|aedt|awst|eet|eest|wet|sgt|jst|kst|hkt|brt';

const REMOTE_PHRASE =
  /^(?:(?:fully|100%|100 %|completely|full[\s-]?time|permanently|primarily|mostly)\s+)?(?:remote(?:ly)?|remote[\s-]+(?:first|friendly|ok|only|eligible|job|jobs|position|work|working|role|opportunity|possible|available|option|based|anywhere\s+in\s+country)|wfh|work(?:ing)?\s+from\s+home|work\s+at\s+home|home[\s-]?office|home[\s-]?based|telecommut\w*|telework\w*|virtual|virtually|distributed|remote\s+work\s+from\s+home)(?:\s+(?:ok|only|possible|available|eligible|friendly|first))?$/;
const HYBRID_PHRASE =
  /^(?:(?:flexible|flex)\s+)?hybrid(?:[\s-](?:remote|work|working|role|model|position|office|schedule|setup))?$|^(?:partially|partly|part[\s-]time|occasionally)\s+remote$|^remote[\s-]+hybrid$|^hybrid[\s-]+remote$/;
const ONSITE_PHRASE = /^(?:on[\s-]?site|in[\s-]office|in[\s-]person|office[\s-]based|on[\s-]premises?|onsite\s+only|on[\s-]site\s+only|in[\s-]office\s+only)$/;
const ANYWHERE_PHRASE =
  /^(?:(?:fully\s+)?remote\s*[-,:]?\s*)?(?:anywhere|worldwide|world[\s-]?wide|global(?:ly)?|anywhere\s+in\s+the\s+world|anywhere\s+on\s+earth|work\s+from\s+anywhere|location[\s-]independent|everywhere|planet\s+earth|earth|all\s+countries|any\s+country|any\s+location|anywhere\s+in\s+the\s+globe|around\s+the\s+world)(?:\s*[-,:]?\s*(?:remote|ok|only))?$/;
const NOISE_PHRASE = new RegExp(
  [
    '^(?:multiple|various|several|many|numerous|all|other|any|select(?:ed)?|eligible|approved|different|flexible)(?:\\s+(?:us\\s+)?(?:locations?|cities|sites|offices|states|countries|regions|areas))?$',
    '^(?:nationwide|national|countrywide|statewide|international(?:ly)?|hq|headquarters|head\\s+office|main\\s+office|corporate(?:\\s+office)?|offices?|tbd|tba|tbc|n\\s*/?\\s*a|na|none|null|undefined|unknown|unspecified|not\\s+specified|field(?:[\\s-]based)?|in\\s+the\\s+field|mobile|flex(?:ible)?(?:\\s+location)?|location\\s+flexible|see\\s+(?:job\\s+)?description|to\\s+be\\s+(?:determined|confirmed|decided)|travel(?:ing|ling)?|local|in\\s+person|location|locations|area|region|city|state|country|more|others?|and\\s+more|etc|industry|enterprise|media|normal|home)$',
    '^\\+?\\s*\\d+\\s*(?:more|others?|locations?|cities|offices)?$',
    '^(?:and\\s+)?\\d+\\s+(?:more|other)(?:\\s+(?:locations?|cities|offices))?$',
  ].join('|'),
);
const TZ_PHRASE = new RegExp(
  `^(?:(?:${TZ_ABBR})(?:\\s*[+±-]\\s*\\d+(?::\\d+)?)?(?:\\s*(?:time\\s*zones?|timezones?|hours|tz|time|overlap))?|(?:eastern|pacific|central|mountain|atlantic)\\s+(?:time(?:\\s*zones?)?|timezones?|standard\\s+time|hours)|(?:us|european|european\\s+union)\\s+time\\s*zones?|time\\s*zones?|timezones?|[+±-]?\\s*\\d+\\s*(?:hours?|hrs?)|utc\\s*[+±-]\\s*\\d+(?:\\s*(?:to|-)\\s*(?:utc)?\\s*[+±-]\\s*\\d+)?)$`,
);

/** Leading decorations: [regex, flag]. Each must leave something behind. */
const LEAD: Array<[RegExp, number]> = [
  [/^(?:(?:fully|100%|completely|partially)\s+)?remote(?:[\s-](?:first|friendly|ok|only))?(?:\s*[-–—:,|]\s*|\s+(?:in|within|from|across|based\s+in|only\s+in)\s+(?:the\s+)?|\s+)/i, F_REMOTE],
  [/^(?:wfh|work(?:ing)?\s+from\s+home|home[\s-]?office|home[\s-]?based|telecommute|telework(?:ing)?|distributed|virtual)(?:\s*[-–—:,|]\s*|\s+(?:in|within|from)\s+(?:the\s+)?|\s+)/i, F_REMOTE],
  [/^(?:hybrid(?:[\s-]remote)?)(?:\s*[-–—:,|]\s*|\s+(?:in|within|from|near|at)\s+(?:the\s+)?|\s+)/i, F_HYBRID],
  [/^(?:on[\s-]?site|in[\s-]office|in[\s-]person|office[\s-]based)(?:\s*[-–—:,|]\s*|\s+(?:in|at|near)\s+(?:the\s+)?|\s+)/i, F_ONSITE],
  [/^(?:work\s+from\s+)?anywhere\s+(?:in|within|across)\s+(?:the\s+)?/i, F_REMOTE],
  [
    /^(?:(?:must|should|need\s+to)\s+(?:be\s+)?(?:reside|resident|residing|live|living|based|located)|resid(?:e|ing|ents?)|living|located|based|candidates?|applicants?|open\s+to(?:\s+(?:candidates|applicants|residents))?|eligible|hiring|select\s+locations|locations?|offices?|within|in|from|near|around|across|throughout|only|the)(?:\s+(?:in|within|from|of|near|across))?(?:\s+the)?\s+/i,
    0,
  ],
  [/^(?:greater|metro(?:politan)?|downtown|inner|central)\s+/i, F_WANT_CITY],
  [/^(?:upstate|downstate|northern|southern|eastern|western|north|south|east|west|coastal|rural)\s+/i, F_WANT_ADMIN],
  [new RegExp(`^(?:${TZ_ABBR})\\b[\\s,/-]*`, 'i'), 0],
];

/** Trailing decorations: [regex, flag]. Must not match at index 0. */
const TRAIL: Array<[RegExp, number]> = [
  [/(?:\s*[-–—:,|(]\s*|\s+)(?:fully\s+)?remote(?:[\s-](?:ok|only|first|friendly|eligible|possible))?\)?$/i, F_REMOTE],
  [/(?:\s*[-–—:,|]\s*|\s+)(?:or|and|\+|&)\s+remote$/i, F_REMOTE],
  [/(?:\s*[-–—:,|(]\s*|\s+)hybrid\)?$/i, F_HYBRID],
  [/(?:\s*[-–—:,|(]\s*|\s+)(?:on[\s-]?site|in[\s-]office)\)?$/i, F_ONSITE],
  [/[\s-]+(?:only|exclusively)$/i, 0],
  [/\s+(?:locations?|offices?|hq|headquarters|head\s+office|campus|hub|site|branch|centre|center)$/i, 0],
  [/\s+(?:(?:metro(?:politan)?\s+)?area|metro(?:politan)?|metroplex|region|vicinity|(?:and\s+)?surrounding\s+areas?|area\s+only)$/i, 0],
  [/[\s-]+based$/i, 0],
  [/\s+state$/i, F_WANT_ADMIN],
  [/\s+(?:province|prefecture|shi|municipality|governorate|oblast|voivodeship)$/i, F_WANT_ADMIN],
  [/\s+city$/i, F_WANT_CITY],
  [new RegExp(`[\\s,(/-]+(?:${TZ_ABBR})(?:\\s*[+±-]\\s*\\d+)?(?:\\s*(?:time\\s*zones?|timezones?|hours|tz))?$`, 'i'), 0],
  [/\s+(?:time\s*zones?|timezones?|hours)$/i, 0],
];

function normLow(s: string): string {
  return foldText(s).replace(/\s+/g, ' ').trim();
}

function trimPunct(s: string): string {
  return s.replace(/^[\s"'“”‘’()[\]{}<>*•·,:;!?\-–—_#~=]+|[\s"'“”‘’()[\]{}<>*•·,:;!?\-–—_#~=]+$/g, '');
}

/** Flags a whole (folded) phrase carries when it is only a marker, or 0. */
function phraseFlags(low: string): number {
  if (ANYWHERE_PHRASE.test(low)) return F_ANYWHERE | F_REMOTE;
  if (REMOTE_PHRASE.test(low)) return F_REMOTE;
  if (HYBRID_PHRASE.test(low)) return F_HYBRID;
  if (ONSITE_PHRASE.test(low)) return F_ONSITE;
  if (NOISE_PHRASE.test(low)) return F_NOISE;
  if (TZ_PHRASE.test(low)) return F_TZ;
  return 0;
}

// ---------------------------------------------------------------------------
// Atoms: the comma/dash-separated pieces of one place expression
// ---------------------------------------------------------------------------

interface Atom {
  text: string;
  key: string;
  e?: Entry;
  /** Separator before this atom: ',' or '-' ('' for the first). */
  sep: string;
  flags: number;
}

function markerAtom(flags: number, sep: string): Atom {
  return { text: '', key: '', sep, flags };
}

function isMarkerAtom(a: Atom): boolean {
  return !a.text;
}

/** Build atoms from one comma/dash piece, stripping decorations and splitting fused forms. */
function makeAtoms(raw: string, sep: string, mode: Mode, depth = 0): Atom[] {
  let cur = trimPunct(raw.replace(/\s+/g, ' '));
  if (!cur) return [];
  const pf = phraseFlags(normLow(cur));
  if (pf) {
    // "Mobile", "Normal", "Media": filler alone, a city when qualified ("Mobile, AL").
    const h = pf === F_NOISE ? lookup(cur, mode) : undefined;
    if (h?.e.c) return [{ text: cur, key: h.key, e: { c: h.e.c }, sep, flags: F_NOISE }];
    const key = placeKey(cur);
    if (pf === F_NOISE && COMMON_WORD_CITIES.has(key)) return [{ text: cur, key, sep, flags: F_NOISE }];
    return [markerAtom(pf, sep)];
  }
  let flags = 0;
  let hit = lookup(cur, mode);
  for (let n = 0; n < 8 && !hit; n++) {
    const before = cur;
    for (const [re, f] of LEAD) {
      const m = re.exec(cur);
      if (m && m[0].length < cur.length) {
        cur = cur.slice(m[0].length);
        flags |= f;
        break;
      }
    }
    if (cur === before) {
      for (const [re, f] of TRAIL) {
        const m = re.exec(cur);
        if (m && m.index > 0) {
          cur = cur.slice(0, m.index);
          flags |= f;
          break;
        }
      }
    }
    if (cur === before) break;
    cur = trimPunct(cur);
    if (!cur) break;
    const f2 = phraseFlags(normLow(cur));
    if (f2) {
      flags |= f2;
      cur = '';
      break;
    }
    hit = lookup(cur, mode);
  }
  if (hit) return [{ text: cur, key: hit.key, e: hit.e, sep, flags }];
  if (!cur) return [markerAtom(flags, sep)];
  // Function words ("in", "or", "of") are never places; their capitalised forms ("IN", "OR") were looked up above.
  if (/^(?:of|the|and|or|in|at|on|to|by|for|with|near|from)$/i.test(cur)) return [markerAtom(flags | F_NOISE, sep)];

  // "Austin TX", "London UK", "Berlin Germany": a qualifier fused onto the name.
  const split = splitFusedQualifier(cur, mode);
  if (split) {
    const [name, q] = split;
    return [
      { text: name.text, key: name.key, e: name.e, sep, flags },
      { text: q.text, key: q.key, e: q.e, sep: ',', flags: 0 },
    ];
  }

  // "US-SF-HQ", "USA-NY-New York": dash-fused hierarchy (only when every piece is meaningful).
  if (depth === 0 && /\S-\S/.test(cur)) {
    const subs = cur.split('-').flatMap((x, i) => makeAtoms(x, i === 0 ? sep : '-', mode, 1));
    if (subs.length > 1 && subs.every((a) => a.e || isMarkerAtom(a)) && subs.some((a) => a.e)) {
      subs[0]!.flags |= flags;
      subs[0]!.sep = sep;
      return subs;
    }
  }

  // Free text ("3 days/week in Chicago"): pick out capitalised place names.
  if (cur.includes(' ')) {
    const found = scanPlaces(cur, mode);
    if (found.length) {
      found[0]!.flags |= flags;
      found[0]!.sep = sep;
      return found;
    }
  }
  return [{ text: cur, key: placeKey(cur), sep, flags }];
}

function splitFusedQualifier(text: string, mode: Mode): [{ text: string; key: string; e: Entry }, { text: string; key: string; e: Entry }] | undefined {
  const words = text.split(' ');
  if (words.length < 2) return undefined;
  for (let q = Math.min(3, words.length - 1); q >= 1; q--) {
    const qText = words.slice(words.length - q).join(' ');
    const qHit = lookup(qText, mode);
    if (!qHit || !(qHit.e.a || qHit.e.k)) continue;
    const nText = words.slice(0, words.length - q).join(' ');
    const nHit = lookup(nText, mode);
    if (!nHit?.e.c) continue;
    // The name must really sit in that qualifier.
    const ix = index();
    const ok = nHit.e.c.some((row) => qualPri(qHit.e, ix.cities[row]!) >= 0);
    if (!ok) continue;
    return [
      { text: nText, key: nHit.key, e: nHit.e },
      { text: qText, key: qHit.key, e: qHit.e },
    ];
  }
  return undefined;
}

const SCAN_CONNECTORS = new Set(['of', 'de', 'del', 'la', 'le', 'do', 'da', 'am', 'an', 'der', 'upon', 'on', 'sur', 'en', 'y', 'and']);

/** Find capitalised place names inside free text. Conservative: full names only, no short codes. */
function scanPlaces(text: string, mode: Mode): Atom[] {
  const words = text.split(/[\s,;/()]+/).filter(Boolean);
  const out: Atom[] = [];
  const ix = index();
  const cap = (w: string) => /^\p{Lu}/u.test(w) || mode === Mode.Relaxed;
  for (let i = 0; i < words.length; ) {
    let matched = 0;
    if (cap(words[i]!)) {
      for (let n = Math.min(4, words.length - i); n >= 1; n--) {
        const span = words.slice(i, i + n);
        if (!cap(span[span.length - 1]!)) continue;
        if (span.some((w, j) => j > 0 && j < n - 1 && !cap(w) && !SCAN_CONNECTORS.has(w.toLowerCase()))) continue;
        const t = span.join(' ');
        const key = placeKey(t);
        if (key.replace(/ /g, '').length <= 3 && !LOWER_OK_SHORT_KEYS.has(key)) continue;
        const hit = lookup(t, mode);
        if (!hit) continue;
        const e = hit.e;
        let ok = Boolean(e.k || e.r);
        if (!ok && e.a) ok = e.a.some((ai) => STANDALONE_ADMIN1_COUNTRIES.includes(ix.admin1[ai]!.country));
        if (!ok && e.c && !COMMON_WORD_CITIES.has(key)) ok = (ix.cities[e.c[0]!]?.[6] ?? 0) >= 100_000 || ix.aliasKeys.has(key);
        if (!ok) continue;
        out.push({ text: t, key, e, sep: ',', flags: F_SCAN });
        matched = n;
        break;
      }
    }
    i += matched || 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resolution of atoms into places
// ---------------------------------------------------------------------------

interface Ctx {
  /** Countries of places resolved without ambiguity. */
  countries: Set<string>;
  /** Countries of unambiguous city/admin1-level places ("NY", "Austin, TX"). */
  sub: Set<string>;
}

interface Item {
  place: Place;
  /** A choice was made between different countries; a context pass may change it. */
  amb: boolean;
  /** Came from a dash-separated atom (neighbourhood/office decorations when unresolved). */
  dash?: boolean;
}

/** Priority of `e` as a qualifier of city row `row`: 0 US state, 1 CA province, 2 country, 3 other admin1; -1 none. */
function qualPri(e: Entry, row: CityRow): number {
  const ix = index();
  let best = -1;
  for (const ai of e.q ?? []) {
    const a = ix.admin1[ai]!;
    if (a.country === row[3] && a.code === row[2]) best = 3;
  }
  if (e.a) {
    for (const ai of e.a) {
      const a = ix.admin1[ai]!;
      if (a.country === row[3] && a.code === row[2]) {
        const p = a.country === 'US' ? 0 : a.country === 'CA' ? 1 : 3;
        if (best < 0 || p < best) best = p;
      }
    }
  }
  if (e.k && (best < 0 || best > 2)) {
    for (const ki of e.k) if (ix.countries[ki]!.code === row[3]) best = 2;
  }
  return best;
}

function rawOf(atoms: Atom[], i: number, n: number): string {
  return atoms
    .slice(i, i + n)
    .map((a) => a.text)
    .filter(Boolean)
    .join(', ');
}

function isProperName(text: string, mode: Mode): boolean {
  if (!/\p{L}/u.test(text) || /[@;:/]/.test(text)) return false;
  if (text.split(' ').length > 5) return false;
  if (normLow(text) && phraseFlags(normLow(text))) return false;
  return mode === Mode.Relaxed || /^[\p{Lu}\d]/u.test(text);
}

interface Hier {
  item: Item;
  consumed: number;
  score: number;
}

/** "City, Admin1, Country" (or with unknown sub-divisions in between), "Admin1, Country", "Locality, ST". */
function interpretHier(atoms: Atom[], i: number, mode: Mode): Hier | undefined {
  const ix = index();
  const a = atoms[i]!;
  const e = a.e;
  if (!atoms[i + 1]) return undefined;
  if (e?.c) {
    let best: { row: number; matched: number; pri: number; consumed: number } | undefined;
    const rows = e.c.length > 400 ? e.c.slice(0, 400) : e.c;
    for (const row of rows) {
      const r = ix.cities[row]!;
      let matched = 0;
      let pri = 9;
      let consumed = 1;
      let skipped = 0;
      for (let j = i + 1; j < atoms.length && j <= i + 5; j++) {
        const q = atoms[j]!;
        if (!q.e) {
          if (skipped < 2 && q.text) {
            skipped++;
            continue;
          }
          break;
        }
        const p = qualPri(q.e, r);
        if (p < 0) break;
        if (matched === 0) pri = p;
        matched++;
        consumed = j - i + 1;
      }
      if (matched > 0 && (!best || matched > best.matched || (matched === best.matched && pri < best.pri))) {
        best = { row, matched, pri, consumed };
      }
    }
    if (best) {
      return { item: { place: cityPlace(best.row, rawOf(atoms, i, best.consumed)), amb: false }, consumed: best.consumed, score: 1 + 2 * best.matched };
    }
  }
  const q = atoms[i + 1]!;
  if (e?.a && q.e?.k) {
    for (const ai of e.a) {
      const ad = ix.admin1[ai]!;
      if (q.e.k.some((ki) => ix.countries[ki]!.code === ad.country)) {
        return { item: { place: admin1Place(ai, rawOf(atoms, i, 2)), amb: false }, consumed: 2, score: 3 };
      }
    }
  }
  // A locality the gazetteer lacks (or a same-named town elsewhere): "Smallville, TX", "Paris, Ontario".
  const nameLike = a.flags & F_NOISE ? /^\p{Lu}/u.test(a.text) : isProperName(a.text, mode) && !(a.flags & F_SCAN);
  // "London, Berlin" is two cities, not a London in the state of Berlin (US/CA/AU state names excepted: "Paris, Ontario").
  const listOfCities = Boolean(e?.c && q.e?.c && !(q.e.a ?? []).some((ai) => ADMIN1_BEATS_CITY_COUNTRIES.has(ix.admin1[ai]!.country)) && !q.e.k);
  if ((!e || (e.c && !e.k && !e.r && !e.a)) && a.text && nameLike && !listOfCities && q.e && (q.e.a || q.e.k)) {
    const opts: Array<{ kind: 'a' | 'k'; i: number; country: string; pri: number }> = [];
    for (const ai of q.e.a ?? []) {
      const ad = ix.admin1[ai]!;
      opts.push({ kind: 'a', i: ai, country: ad.country, pri: ad.country === 'US' ? 0 : ad.country === 'CA' ? 1 : 3 });
    }
    for (const ki of q.e.k ?? []) opts.push({ kind: 'k', i: ki, country: ix.countries[ki]!.code, pri: 2 });
    const cityCountries = new Set((e?.c ?? []).map((row) => ix.cities[row]![3]));
    opts.sort((x, y) => Number(cityCountries.has(y.country)) - Number(cityCountries.has(x.country)) || x.pri - y.pri);
    const o = opts[0];
    if (o) {
      let consumed = 2;
      const q2 = atoms[i + 2];
      if (o.kind === 'a' && q2?.e?.k?.some((ki) => ix.countries[ki]!.code === o.country)) consumed = 3;
      const place = o.kind === 'a' ? admin1Place(o.i, rawOf(atoms, i, consumed), a.text) : countryPlace(o.i, rawOf(atoms, i, consumed), a.text);
      return { item: { place, amb: false }, consumed, score: consumed };
    }
  }
  return undefined;
}

/** Pick among same-named cities: most populous, or the context country's when it is not much smaller. */
function pickCity(rows: number[], ctx: Ctx | undefined): { row: number; amb: boolean } {
  const ix = index();
  const top = rows[0]!;
  const topRow = ix.cities[top]!;
  const amb = rows.some((r) => ix.cities[r]![3] !== topRow[3]);
  if (amb && ctx && ctx.countries.size === 1) {
    const [c] = [...ctx.countries];
    if (c && topRow[3] !== c) {
      const alt = rows.find((r) => ix.cities[r]![3] === c && ix.cities[r]![6] >= topRow[6] * 0.1);
      if (alt !== undefined) return { row: alt, amb };
    }
  }
  return { row: top, amb };
}

/** A two/three-letter code on its own: "CA", "IN", "DE", "GA", "NSW", "USA". */
function resolveCode(a: Atom, ctx: Ctx | undefined): Item | undefined {
  const ix = index();
  const e = a.e!;
  const upper = a.key.toUpperCase();
  if (BLOCKED_CODES.has(upper)) return undefined;
  if (e.c && ix.aliasKeys.has(a.key)) return { place: cityPlace(e.c[0]!, a.text), amb: false };
  const admins = (e.a ?? []).map((i) => ({ i, rec: ix.admin1[i]! }));
  const us = admins.find((x) => x.rec.country === 'US');
  const ca = admins.find((x) => x.rec.country === 'CA');
  const ki = e.k?.[0];
  const country = ki === undefined ? undefined : ix.countries[ki]!;
  const ctxUS = ctx?.sub.has('US') ?? false;
  const ctxCA = ctx?.sub.has('CA') ?? false;
  const cityState = (k: number): Item => {
    const row = cityStateRow(ix.countries[k]!.code);
    if (row !== undefined) return { place: cityPlace(row, a.text), amb: false };
    return { place: countryPlace(k, a.text), amb: Boolean(us || ca) };
  };
  if (us && ctxUS) return { place: admin1Place(us.i, a.text), amb: true };
  if (ca && ctxCA) return { place: admin1Place(ca.i, a.text), amb: true };
  if (country && ki !== undefined) {
    if (us && !ISO_PREFERRED_CODES.has(upper)) return { place: admin1Place(us.i, a.text), amb: true };
    return cityState(ki);
  }
  if (us) return { place: admin1Place(us.i, a.text), amb: false };
  if (ca) return { place: admin1Place(ca.i, a.text), amb: false };
  if (e.r) return { place: regionPlace(e.r[0]!, a.text), amb: false };
  // Other countries' abbreviations ("NSW", "VIC", "NRW"): three letters, or two with a matching context.
  const other = admins.find((x) => upper.length === 3 || ctx?.sub.has(x.rec.country));
  if (other) return { place: admin1Place(other.i, a.text), amb: false };
  return undefined;
}

const CITY_STATE_ROWS = new Map<string, number | undefined>();

/** The city row standing for a city-state country ("SG" -> Singapore), if any. */
function cityStateRow(code: string): number | undefined {
  if (!CITY_STATES.has(code)) return undefined;
  if (!CITY_STATE_ROWS.has(code)) {
    const ix = index();
    // The most populous city of the country (rows are sorted by population).
    const row = ix.cities.findIndex((r) => r[3] === code);
    CITY_STATE_ROWS.set(code, row < 0 ? undefined : row);
  }
  return CITY_STATE_ROWS.get(code);
}

/** One atom with no qualifier. */
function resolveStandalone(a: Atom, ctx: Ctx | undefined, single: boolean, mode: Mode): Item | undefined {
  const ix = index();
  const e = a.e;
  if (!e) return undefined;
  if (e.r && !(a.flags & F_WANT_CITY)) return { place: regionPlace(e.r[0]!, a.text), amb: false };
  const code = /^[a-z]{2,3}$/.test(a.key) && (mode === Mode.Relaxed || isAllUpper(a.text.replace(/[^\p{L}]/gu, '')));
  if (code && !LOWER_OK_SHORT_KEYS.has(a.key) && !ix.aliasKeys.has(a.key)) return resolveCode(a, ctx);
  if (code && ix.aliasKeys.has(a.key) && e.c) return { place: cityPlace(e.c[0]!, a.text), amb: false };
  const common = COMMON_WORD_CITIES.has(a.key);
  const cities = common && !(single && WHOLE_STRING_CITIES.has(a.key)) ? [] : (e.c ?? []);
  const wantAdmin = Boolean(a.flags & F_WANT_ADMIN);
  const wantCity = Boolean(a.flags & F_WANT_CITY);

  if ((CITY_FIRST_KEYS.has(a.key) || ix.aliasKeys.has(a.key)) && cities.length && !wantAdmin) return { place: cityPlace(cities[0]!, a.text), amb: false };

  const usAdmin = (e.a ?? []).find((i) => ix.admin1[i]!.country === 'US');
  if (e.k && !wantCity) {
    const ki = e.k[0]!;
    const c = ix.countries[ki]!;
    if (usAdmin !== undefined && (ctx?.sub.has('US') || wantAdmin)) return { place: admin1Place(usAdmin, a.text), amb: true };
    const row = cityStateRow(c.code);
    if (row !== undefined) return { place: cityPlace(row, a.text), amb: false };
    return { place: countryPlace(ki, a.text), amb: usAdmin !== undefined };
  }

  let admins = (e.a ?? []).filter((i) => {
    const c = ix.admin1[i]!.country;
    return STANDALONE_ADMIN1_COUNTRIES.includes(c) || ctx?.sub.has(c) || wantAdmin;
  });
  if (admins.length) {
    const order = (i: number) => {
      const c = ix.admin1[i]!.country;
      if (ctx?.countries.has(c)) return -1;
      const k = STANDALONE_ADMIN1_COUNTRIES.indexOf(c);
      return k < 0 ? 99 : k;
    };
    admins = [...admins].sort((x, y) => order(x) - order(y));
    const ai = admins[0]!;
    const ad = ix.admin1[ai]!;
    if (!wantAdmin) {
      const inside = cities.find((r) => ix.cities[r]![3] === ad.country && ix.cities[r]![2] === ad.code);
      if (inside !== undefined && (!ADMIN1_BEATS_CITY_COUNTRIES.has(ad.country) || wantCity)) {
        return { place: cityPlace(inside, a.text), amb: false };
      }
      if (wantCity && cities.length) {
        const p = pickCity(cities, ctx);
        return { place: cityPlace(p.row, a.text), amb: p.amb };
      }
    }
    const amb = new Set(admins.map((i) => ix.admin1[i]!.country)).size > 1;
    return { place: admin1Place(ai, a.text), amb };
  }
  if (cities.length) {
    const p = pickCity(cities, ctx);
    return { place: cityPlace(p.row, a.text), amb: p.amb };
  }
  if (e.k) return { place: countryPlace(e.k[0]!, a.text), amb: false };
  return undefined;
}

function chainOnce(atoms: Atom[], ctx: Ctx | undefined, single: boolean, mode: Mode): { items: Item[]; score: number } {
  const items: Item[] = [];
  let score = 0;
  for (let i = 0; i < atoms.length; ) {
    const a = atoms[i]!;
    const h = interpretHier(atoms, i, mode);
    if (h) {
      items.push(h.item);
      score += h.score;
      i += h.consumed;
      continue;
    }
    const s = a.flags & F_NOISE ? undefined : resolveStandalone(a, ctx, single, mode);
    if (s) {
      items.push(s);
      score += s.amb ? 0.5 : 1;
    } else if (a.flags & F_NOISE) {
      // filler word that was not part of a "City, ST" pair
    } else {
      items.push({ place: unknownPlace(a.text), amb: false, dash: a.sep === '-' || atoms[i + 1]?.sep === '-' });
      score -= 1;
    }
    i++;
  }
  return { items, score };
}

/** Parse the atoms of one piece, trying "City, ST, Country" order and the ATS "Country - ST - City" order. */
function chainParse(atoms: Atom[], ctx: Ctx | undefined, single: boolean, mode: Mode): Item[] {
  const little = chainOnce(atoms, ctx, single, mode);
  // Big-endian only for dash-joined forms ("US - CA - San Francisco"); "US, CA" is a list of two countries.
  if (atoms.length < 2 || !atoms.some((a) => a.sep === '-')) return little.items;
  const big = chainOnce([...atoms].reverse(), ctx, single, mode);
  return big.score > little.score ? big.items.reverse() : little.items;
}

// ---------------------------------------------------------------------------
// Strings -> pieces -> atoms
// ---------------------------------------------------------------------------

function fixMojibake(s: string): string {
  if (!/[ÃÂ][\u0080-¿]/.test(s) || !/^[\u0000-ÿ]*$/.test(s)) return s;
  const d = Buffer.from(s, 'latin1').toString('utf8');
  return d.includes('�') ? s : d;
}

function cleanRaw(s: string): string {
  return fixMojibake(s)
    .replace(/\s*[\r\n]+\s*/g, ' | ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200B}-\u{200D}\u{2060}]/gu, ' ')
    .replace(/\s*\(?\s*\+\s*\d+\s*(?:more|others?|locations?)?\s*\)?\s*$/i, '')
    .replace(/\s*,?\s*(?:and|&)\s+\d+\s+(?:more|others?)(?:\s+(?:locations?|cities|offices))?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STRONG_SEP = /\s*(?:[;|•·\n\t]|\s+(?:or|Or|and|And|AND)\s+|(?<!,)\s+OR\s+|\s+&\s+|\s+\+\s+|\s*\/\s*)\s*/g;

/** Split on list separators at bracket depth 0, re-joining names that contain one ("Trinidad and Tobago"). */
function splitStrong(s: string): string[] {
  const masked = s.replace(/\([^()]*\)|\[[^[\]]*\]/g, (m) => '\u0001'.repeat(m.length));
  const pieces: string[] = [];
  const seps: string[] = [];
  let last = 0;
  for (const m of masked.matchAll(STRONG_SEP)) {
    const at = m.index ?? 0;
    pieces.push(s.slice(last, at));
    seps.push(s.slice(at, at + m[0].length));
    last = at + m[0].length;
  }
  pieces.push(s.slice(last));
  // Re-join across a separator when the words around it form a known name.
  for (let i = 0; i < pieces.length - 1; ) {
    const tail = pieces[i]!.split(/,|\s[-–—]\s/).pop() ?? '';
    const head = pieces[i + 1]!.split(/,|\s[-–—]\s/)[0] ?? '';
    const whole = `${pieces[i]}${seps[i]}${pieces[i + 1]}`;
    if ((tail.trim() && head.trim() && keyExists(`${tail}${seps[i]}${head}`)) || keyExists(whole)) {
      pieces.splice(i, 2, `${pieces[i]}${seps[i]}${pieces[i + 1]}`);
      seps.splice(i, 1);
    } else i++;
  }
  return pieces.map((p) => p.trim()).filter(Boolean);
}

const WEAK_SEP = /\s*,\s*|\s+[-–—]\s+|\s*[–—]\s*|\s*:\s*/g;

interface PieceOut {
  items: Item[];
  flags: number;
}

function parsePiece(text: string, ctx: Ctx | undefined, single: boolean, mode: Mode, depth: number): PieceOut {
  const parens: string[] = [];
  let outer = text.replace(/\(([^()]*)\)|\[([^[\]]*)\]/g, (_m, p1: string | undefined, p2: string | undefined) => {
    parens.push(p1 ?? p2 ?? '');
    return ' ';
  });
  outer = outer.replace(/[()[\]]/g, ' ').trim();
  let flags = 0;
  const atoms: Atom[] = [];
  let last = 0;
  const pushAtoms = (seg: string, sep: string) => {
    for (const a of makeAtoms(seg, sep, mode)) {
      flags |= a.flags & (MARKERS | F_NOISE | F_TZ);
      if (!isMarkerAtom(a)) atoms.push(a);
    }
  };
  const segs: string[] = [];
  const segSeps: string[] = [];
  for (const m of outer.matchAll(WEAK_SEP)) {
    const at = m.index ?? 0;
    segs.push(outer.slice(last, at));
    segSeps.push(m[0]);
    last = at + m[0].length;
  }
  segs.push(outer.slice(last));
  // Names that contain a comma: "Virgin Islands, British", "Korea, Republic of".
  for (let i = 0; i < segs.length - 1; ) {
    if (segSeps[i]!.includes(',') && keyExists(`${segs[i]}${segSeps[i]}${segs[i + 1]}`)) {
      segs.splice(i, 2, `${segs[i]}${segSeps[i]}${segs[i + 1]}`);
      segSeps.splice(i, 1);
    } else i++;
  }
  segs.forEach((seg, i) => pushAtoms(seg, i === 0 ? '' : segSeps[i - 1]!.includes(',') ? ',' : '-'));
  const items = chainParse(atoms, ctx, single && atoms.length === 1 && parens.length === 0, mode);
  const outerResolved = items.some((it) => it.place.kind !== 'unknown');
  for (const p of parens) {
    const low = normLow(p);
    const pf = phraseFlags(low);
    if (pf) {
      flags |= pf & (MARKERS | F_NOISE | F_TZ);
      continue;
    }
    if (depth > 1) continue;
    const sub = parsePieces(p, ctx, false, mode, depth + 1);
    flags |= sub.flags & MARKERS;
    // After a resolved place, a bracket only adds areas ("Austin (US)"), never neighbourhoods ("San Francisco (SoMa)").
    for (const it of sub.items) if (it.place.kind !== 'unknown' && !(outerResolved && it.place.kind === 'city')) items.push(it);
  }
  // "Anywhere (US)", "Anywhere, Canada": anywhere within the named area.
  if (flags & F_ANYWHERE && items.some((it) => it.place.kind === 'country' || it.place.kind === 'region' || it.place.kind === 'admin1')) {
    flags &= ~F_ANYWHERE;
  }
  // Unresolved dash-separated words next to a resolved place are neighbourhoods/office names.
  const resolved = items.some((it) => it.place.kind !== 'unknown');
  return { items: resolved ? items.filter((it) => !(it.place.kind === 'unknown' && it.dash)) : items, flags };
}

function parsePieces(s: string, ctx: Ctx | undefined, single: boolean, mode: Mode, depth: number): PieceOut {
  const pieces = splitStrong(s);
  const out: PieceOut = { items: [], flags: 0 };
  for (const p of pieces) {
    const r = parsePiece(p, ctx, single && pieces.length === 1, mode, depth);
    out.items.push(...r.items);
    out.flags |= r.flags;
  }
  return out;
}

interface StringOut {
  items: Item[];
  flags: number;
}

/** Parse one raw location string. */
function parseLocationString(raw: string, ctx: Ctx | undefined, mode: Mode): StringOut {
  const s = cleanRaw(raw);
  if (!s) return { items: [], flags: 0 };
  const pf = phraseFlags(normLow(s));
  if (pf & (MARKERS | F_NOISE)) return { items: [], flags: pf };
  if (pf & F_TZ) return { items: [{ place: unknownPlace(s), amb: false }], flags: 0 };
  const r = parsePieces(s, ctx, true, mode, 0);
  const known = r.items.filter((it) => it.place.kind !== 'unknown');
  if (!known.length && !(r.flags & MARKERS)) {
    // Nothing recognised: keep the whole string once, unless it was only filler words.
    const onlyNoise = r.items.length === 0 && (r.flags & F_NOISE) !== 0 && (r.flags & F_TZ) === 0;
    const raw = s.replace(/^[\s,;:|/\-–—]+|[\s,;:|/\-–—]+$/g, '');
    return { items: onlyNoise || !/\p{L}/u.test(s) ? [] : [{ place: unknownPlace(raw), amb: false }], flags: r.flags };
  }
  return r;
}

const PARSE_CACHE = new Map<string, StringOut>();

function parseCached(raw: string): StringOut {
  let r = PARSE_CACHE.get(raw);
  if (!r) {
    r = parseLocationString(raw, undefined, Mode.Strict);
    if (PARSE_CACHE.size > 20_000) PARSE_CACHE.clear();
    PARSE_CACHE.set(raw, r);
  }
  return r;
}

function contextOf(outs: StringOut[]): Ctx {
  const ctx: Ctx = { countries: new Set(), sub: new Set() };
  for (const o of outs) {
    for (const it of o.items) {
      if (it.amb || !it.place.country) continue;
      ctx.countries.add(it.place.country);
      if (it.place.kind === 'city' || it.place.kind === 'admin1') ctx.sub.add(it.place.country);
    }
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Remote / hybrid detection outside the location strings
// ---------------------------------------------------------------------------

const TITLE_REMOTE =
  /(?:^|[\s([\-–—|,/:])(?:fully[\s-]+|100%[\s-]*)?remote(?=$|[\s)\]\-–—|,/:!])(?![\s-]+(?:sensing|monitoring|support|access|operations?|patient|pilot|control|desktop|device|systems?|technician|services?|network|infrastructure|vehicles?|camera|management|maintenance|diagnostics|it\b|help|assistance|troubleshooting|sales\s+support))/i;
const TITLE_HYBRID =
  /(?:^|[\s([\-–—|,/:])hybrid(?=$|[\s)\]\-–—|,/:!])(?![\s-]+(?:cloud|apps?|applications?|mobile|vehicles?|systems?|infrastructure|it\b|integration|work\s*force|events?|learning|cars?|solutions?|identity|networks?|environments?|storage|platforms?|testing|electric|powertrain|energy|seeds?))/i;
const TITLE_ONSITE = /[([]\s*(?:on[\s-]?site|in[\s-]office|in[\s-]person)\s*[)\]]|[-–—|]\s*(?:on[\s-]?site|in[\s-]office)\s*$/i;

function modeFromTitle(title: string | undefined): RemoteMode | undefined {
  if (!title) return undefined;
  if (TITLE_REMOTE.test(title)) return 'remote';
  if (TITLE_HYBRID.test(title)) return 'hybrid';
  if (TITLE_ONSITE.test(title)) return 'onsite';
  return undefined;
}

function modeFromTags(tags: string[] | undefined): RemoteMode | undefined {
  if (!tags?.length) return undefined;
  let hybrid = false;
  let onsite = false;
  for (const t of tags) {
    const low = normLow(t);
    if (/^(?:fully\s+)?remote(?:[\s-](?:job|jobs|work|first|friendly|ok|only))?$|^(?:wfh|work from home|telecommute|anywhere|worldwide|100% remote)$/.test(low)) return 'remote';
    if (/^hybrid(?:[\s-]remote)?$/.test(low)) hybrid = true;
    if (/^(?:on[\s-]?site|in[\s-]office)$/.test(low)) onsite = true;
  }
  return hybrid ? 'hybrid' : onsite ? 'onsite' : undefined;
}

const DESC_NOT_REMOTE =
  /\b(?:not\s+(?:a\s+)?(?:fully\s+)?remote|non[\s-]remote|no\s+remote|not\s+(?:open\s+to|eligible\s+for|offering)\s+remote|remote\s+(?:work\s+)?is\s+not\s+(?:available|possible|an\s+option|offered)|cannot\s+be\s+(?:done\s+|performed\s+)?remote(?:ly)?|unable\s+to\s+(?:offer|support)\s+remote)\b/i;
const DESC_REMOTE =
  /\b(?:(?:this|the)\s+(?:role|position|job|opportunity)\s+is\s+(?:a\s+)?(?:fully\s+|100%\s+|entirely\s+|completely\s+|permanently\s+)?remote\b|(?:this|it)\s+is\s+an?\s+(?:fully\s+|100%\s+|entirely\s+|completely\s+|permanently\s+)?remote\s+(?:role|position|job|opportunity)\b|(?:fully|100%|entirely|completely)\s+remote\s+(?:role|position|job|opportunity|team|company|work)\b|(?:you\s+can|you\s+will|you'll)\s+work\s+(?:fully\s+)?remote(?:ly)?\b|work\s+from\s+anywhere\b|remote\s+(?:role|position|job|opportunity)\s+(?:based\s+)?(?:in|within|from|across|open)\b)/i;
const DESC_HYBRID =
  /\b(?:(?:this|the)\s+(?:role|position|job)\s+is\s+(?:a\s+)?hybrid\b|(?:this|it)\s+is\s+a\s+hybrid\s+(?:role|position|job|opportunity)\b|hybrid\s+(?:work(?:ing)?\s+)?(?:role|position|model|arrangement|schedule|setup|policy)\b|(?:\d|one|two|three|four)\s+days?\s+(?:a|per|each)\s+week\s+(?:in|at)\s+(?:the|our)\s+office\b)/i;

function modeFromDescription(text: string | undefined): RemoteMode | undefined {
  if (!text) return undefined;
  if (DESC_REMOTE.test(text) && !DESC_NOT_REMOTE.test(text)) return 'remote';
  if (DESC_HYBRID.test(text)) return 'hybrid';
  return undefined;
}

// ---------------------------------------------------------------------------
// Remote scope from description text
// ---------------------------------------------------------------------------

interface ScopeOut {
  codes: string[];
  labels: string[];
  anywhere: boolean;
}

const DESC_SCOPE_TRIGGER =
  /\b(?:(?:must|should|need\s+to|needs\s+to|required\s+to|have\s+to|has\s+to)\s+(?:be\s+)?(?:currently\s+|physically\s+|permanently\s+)?(?:based|located|residing|reside|live|living)|(?:candidates?|applicants?|you)\s+(?:must\s+|should\s+|will\s+need\s+to\s+)?(?:be\s+)?(?:currently\s+|physically\s+)?(?:based|located|residing|living)|(?:open|available)\s+(?:only\s+)?to\s+(?:candidates|applicants|residents|people|those|anyone|individuals|talent|professionals)(?:\s+(?:who\s+(?:are|live)\s+)?(?:based|located|residing|living))?|(?:only\s+)?(?:hiring|accepting\s+applications|recruiting)(?:\s+(?:candidates|applicants|talent))?|(?:work(?:ing)?\s+)?remote(?:ly)?|(?:work\s+)?from\s+anywhere|anywhere)\s+(?:in|within|from|across)\s+(?:the\s+)?([^.;:!?\n()]{2,80})/gi;
const DESC_SCOPE_PAIRED =
  /\b(?:based|located|reside|residing|live|living)\s+in\s+and\s+(?:be\s+)?(?:legally\s+)?(?:authori[sz]ed|eligible|able)\s+to\s+work\s+in\s+(?:the\s+)?([^.;:!?\n()]{2,80})/gi;
const DESC_SCOPE_ONLY = /\b((?:[A-Z][A-Za-z.]*)(?:[\s-][A-Z][A-Za-z.]*){0,2})(?:[\s-]+(?:residents|candidates|applicants|citizens|based))?[\s(-]+(?:only|ONLY|Only)\b/g;
const DESC_SCOPE_BASED =
  /\b([A-Z][A-Za-z.]*(?:\s[A-Z][A-Za-z.]*)?)[-\s]based\s+(?:candidates|applicants|talent|professionals|individuals|team\s+members|employees|contractors|only|position|role)\b|\b(?:role|position|job|opportunity)\s+is\s+(?:(?:fully\s+)?remote\s+(?:and\s+)?)?([A-Z][A-Za-z.]*)[-\s]based\b|\b(?:must|should)\s+be\s+([A-Z][A-Za-z.]*)[-\s]based\b/g;
const DESC_ANYWHERE = /\banywhere\s+in\s+the\s+world\b|\b(?:work|working)\s+from\s+anywhere\b(?!\s+(?:in|within|across)\s+(?!the\s+world))|\bopen\s+to\s+(?:candidates|applicants)\s+worldwide\b/i;

/** A strict country/region/state name for scope purposes; undefined when it is anything else. */
function scopeItem(text: string): { codes: string[]; label: string } | undefined {
  const t = text
    .trim()
    .replace(/^(?:the|any)\s+/i, '')
    .replace(/\s+(?:only|time\s*zones?|timezones?|region|area)$/i, '')
    .trim();
  if (!t) return undefined;
  const hit = lookup(t, Mode.Desc);
  if (!hit) return undefined;
  const ix = index();
  const e = hit.e;
  if (e.r) {
    const r = ix.regions[e.r[0]!]!;
    return { codes: r.countries, label: r.name };
  }
  if (e.k) {
    const c = ix.countries[e.k[0]!]!;
    // "Georgia" in a description is as likely the state as the country: too risky either way.
    if (e.a?.length) return undefined;
    return { codes: [c.code], label: countryShortName(c.code) ?? c.name };
  }
  if (e.a && hit.key.length > 3) {
    const a = e.a.map((i) => ix.admin1[i]!).find((x) => x.country === 'US' || x.country === 'CA');
    if (a && !e.c?.some((row) => ix.cities[row]![3] !== a.country)) return { codes: [a.country], label: countryShortName(a.country) ?? a.country };
  }
  return undefined;
}

function scopeFromSegment(seg: string): ScopeOut | undefined {
  let s = seg
    .split(/\s(?:who|with|that|which|to|for|at|during|as|while|but|so|if|because|where|when|in\s+order|and\s+(?:be|have|are|must|will|can|should|hold|possess|eligible|legally|authori[sz]ed|able)|or\s+(?:be|have))\b|\s[-–—]\s|\(/i)[0]!
    .trim();
  s = s.replace(/^(?:anywhere|any\s+(?:state|country|location|city))\s+(?:in|within|across)\s+(?:the\s+)?/i, '');
  if (/^(?:the\s+)?(?:world|globe)\b/i.test(s)) return { codes: [], labels: [], anywhere: true };
  const parts = s.split(/\s*(?:,|\/|\bor\b|\band\b|&)\s*/i).filter(Boolean).slice(0, 10);
  const out: ScopeOut = { codes: [], labels: [], anywhere: false };
  for (const p of parts) {
    const it = scopeItem(p);
    if (!it) break;
    out.codes.push(...it.codes);
    out.labels.push(it.label);
  }
  return out.codes.length ? out : undefined;
}

function scopeFromDescription(text: string): ScopeOut | undefined {
  if (DESC_ANYWHERE.test(text)) return { codes: [], labels: [], anywhere: true };
  const out: ScopeOut = { codes: [], labels: [], anywhere: false };
  const add = (r: ScopeOut | undefined) => {
    if (!r) return;
    if (r.anywhere) out.anywhere = true;
    out.codes.push(...r.codes);
    out.labels.push(...r.labels);
  };
  for (const m of text.matchAll(DESC_SCOPE_TRIGGER)) add(scopeFromSegment(m[1] ?? ''));
  for (const m of text.matchAll(DESC_SCOPE_PAIRED)) add(scopeFromSegment(m[1] ?? ''));
  for (const m of text.matchAll(DESC_SCOPE_ONLY)) {
    const words = (m[1] ?? '').split(/[\s-]+/);
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      const it = scopeItem(words.slice(words.length - n).join(' '));
      if (it) {
        add({ codes: it.codes, labels: [it.label], anywhere: false });
        break;
      }
    }
  }
  for (const m of text.matchAll(DESC_SCOPE_BASED)) {
    const it = scopeItem(m[1] ?? m[2] ?? m[3] ?? '');
    if (it) add({ codes: it.codes, labels: [it.label], anywhere: false });
  }
  if (out.anywhere) return { codes: [], labels: [], anywhere: true };
  return out.codes.length ? out : undefined;
}

// ---------------------------------------------------------------------------
// parseJobLocation
// ---------------------------------------------------------------------------

function placeIdentity(p: Place): string {
  return `${p.kind}|${p.country ?? ''}|${p.admin1 ?? ''}|${p.city ?? ''}|${p.region ?? ''}|${p.kind === 'unknown' ? normLow(p.raw) : ''}`;
}

function listLabel(labels: string[], max = 3): string {
  const uniq = [...new Set(labels)];
  if (uniq.length <= max) return uniq.join(', ');
  return `${uniq.slice(0, max).join(', ')} +${uniq.length - max} more`;
}

/**
 * Turn a source's location strings into structured places plus a work-arrangement.
 *
 * Each raw string may hold several places and remote markers, e.g.
 *   "New York, NY", "NYC or Remote (US)", "San Francisco Bay Area", "London, UK / Berlin, Germany",
 *   "Remote - EMEA", "Remote, USA", "United States", "Anywhere", "Worldwide", "München",
 *   "Austin, TX; Denver, CO; Remote", "Hybrid - Toronto, ON", "US-Remote", "Remote (PST hours)",
 *   "Bengaluru, Karnataka, India", "Singapore", "Washington, D.C.", "Cambridge, MA" vs "Cambridge, UK".
 * Rules:
 *  - Split on the separators sources really use ("/", ";", "|", " or ", " and ", " • ", newlines), but
 *    never split "City, ST" or "City, Country" pairs.
 *  - Resolve each part with the gazetteer: prefer exact city+admin1+country, then city+country, then alias,
 *    then city alone (most populous; but if the string also names an admin1/country, it must agree).
 *    Country-only and admin1-only strings become kind 'country' / 'admin1'. Named hiring regions become kind
 *    'region' with their member countries. Unresolvable text becomes kind 'unknown' (kept for display/search).
 *  - Remote: source hint wins; otherwise detect from the location strings first ("remote", "work from home",
 *    "WFH", "distributed", "anywhere", "telecommute"), then the title, then (conservatively) the description
 *    ("this is a fully remote role" yes; "remote-first culture" alone or "no remote" no). "hybrid" likewise.
 *    When physical places are given and nothing indicates remote/hybrid, the mode is 'onsite' ONLY if the
 *    source hint says so; otherwise 'unknown' — never guess on-site.
 *  - remoteScope: countries a remote worker may be in, from "Remote (US)", "Remote - EMEA", "US only",
 *    "must be based in Canada", etc. A remote job whose only place is a country/region is scoped to it.
 *    "Anywhere"/"Worldwide" -> empty scope. Places that are purely a remote scope should not also be listed
 *    as physical places.
 *
 * Decisions beyond the rules above (all tested):
 *  - Ambiguous city names alone go to the most populous ("Cambridge" -> Cambridge, UK; "Portland" -> Oregon),
 *    unless every other unambiguous place of the job is in one country that has the name and its candidate
 *    has at least 10% of the top population ("Cambridge" next to "Boston, MA" -> Cambridge, MA).
 *  - "City, XX": US state, then Canadian province, then ISO country, then another country's division, among
 *    those that really contain such a city. A locality the gazetteer lacks keeps its name in `city` with kind
 *    'admin1'/'country' and no coordinates ("Smallville, TX").
 *  - A lone two-letter code means the US state when the job's other places are US cities/states; otherwise
 *    the ISO country for CA, DE, IN, ID, AR, CO, MA, IL and the US state for the rest (GA, PA, ME, ...).
 *    "LA" alone is Los Angeles. "Washington" alone is the state; "Washington, DC" / "DC" the city.
 *    "New York" alone is the city; "New York State" / "Upstate New York" the state. "Georgia" alone is the
 *    country unless the job's other places are in the US.
 *  - City-states (Singapore, Hong Kong, Macau, Monaco) resolve to their city row.
 *  - Remote jobs: countries, regions and admin1s (as their country) become remoteScope, not places; cities stay
 *    places. Hybrid/on-site/unknown jobs keep everything as places and an empty scope. The description is read
 *    for scope only when the locations gave none (patterns like "must be based in", "open to candidates in",
 *    "US only", "UK-based candidates"; bare work-authorisation boilerplate is ignored). "Anywhere" anywhere
 *    wins over restrictions.
 *  - A location-string marker "Onsite"/"In office" counts as the source saying so; descriptions never set onsite.
 */
export function parseJobLocation(input: LocationInput): ParsedLocation {
  const raws = input.locations.filter((s) => typeof s === 'string' && s.trim());
  let outs = raws.map(parseCached);
  if (outs.some((o) => o.items.some((it) => it.amb))) {
    const ctx = contextOf(outs);
    if (ctx.countries.size || ctx.sub.size) outs = raws.map((s) => parseLocationString(s, ctx, Mode.Strict));
  }
  let flags = 0;
  const items: Item[] = [];
  for (const o of outs) {
    flags |= o.flags;
    items.push(...o.items);
  }

  let mode: RemoteMode;
  if (input.remote) mode = input.remote;
  else if (flags & (F_REMOTE | F_ANYWHERE)) mode = 'remote';
  else if (flags & F_HYBRID) mode = 'hybrid';
  else if (flags & F_ONSITE) mode = 'onsite';
  else {
    const t = modeFromTitle(input.title) ?? modeFromTags(input.tags);
    mode = t ?? modeFromDescription(input.descriptionText) ?? 'unknown';
  }

  const places: Place[] = [];
  const seen = new Set<string>();
  const scope = new Set<string>();
  const scopeLabels: string[] = [];
  let anywhere = mode === 'remote' && (flags & F_ANYWHERE) !== 0;
  for (const it of items) {
    const p = it.place;
    const cityState = p.kind === 'city' && p.country !== undefined && CITY_STATES.has(p.country);
    if (mode === 'remote' && (((p.kind === 'country' || p.kind === 'admin1' || p.kind === 'region') && !p.city) || cityState)) {
      if (p.kind === 'region') {
        for (const c of p.countries ?? []) scope.add(c);
        scopeLabels.push(p.region ?? p.label);
      } else if (p.country) {
        scope.add(p.country);
        scopeLabels.push(cityState ? p.label : (countryShortName(p.country) ?? p.country));
      }
      continue;
    }
    const id = placeIdentity(p);
    if (seen.has(id)) continue;
    seen.add(id);
    places.push(p);
  }
  if (mode === 'remote' && !anywhere && scope.size === 0 && input.descriptionText) {
    const d = scopeFromDescription(input.descriptionText);
    if (d?.anywhere) anywhere = true;
    else if (d) {
      for (const c of d.codes) scope.add(c);
      scopeLabels.push(...d.labels);
    }
  }
  const remoteScope = anywhere ? [] : [...scope].sort();

  // Display text.
  const first = places.find((p) => p.kind !== 'unknown') ?? places[0];
  const placesText = first ? `${first.label}${places.length > 1 ? ` +${places.length - 1} more` : ''}` : '';
  let text: string;
  if (mode === 'remote') {
    const scopeText = anywhere ? 'Anywhere' : remoteScope.length ? listLabel(scopeLabels) : '';
    if (placesText) text = `${placesText} · Remote${scopeText ? ` (${scopeText})` : ''}`;
    else text = `Remote${scopeText ? ` · ${scopeText}` : ''}`;
  } else if (mode === 'hybrid') text = placesText ? `${placesText} · Hybrid` : 'Hybrid';
  else if (mode === 'onsite') text = placesText ? `${placesText} · On-site` : 'On-site';
  else {
    text = placesText;
    if (!text) {
      const fallback = raws
        .map((s) => cleanRaw(s))
        .filter((s) => s && !/^(?:n\s*\/?\s*a|none|null|undefined|tbd|tba|unknown|-+)$/i.test(s));
      text = fallback.length ? truncateText(fallback.join('; '), 80) : '';
    }
  }
  return { location: { places, remote: mode, remoteScope }, text };
}

function truncateText(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// resolvePlace
// ---------------------------------------------------------------------------

/** Resolve user-typed location text ("austin tx", "NYC", "Germany", "EMEA", "remote") to a single Place. */
export function resolvePlace(text: string): Place | undefined {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  const low = normLow(t);
  const pf = phraseFlags(low);
  if (pf & (F_ANYWHERE | F_REMOTE) && !(pf & F_NOISE)) return anywherePlace(t);
  if (pf) return undefined;
  // Whole text as one piece first so "portland or" stays together, then as a list.
  const one = parsePiece(trimPunct(t), undefined, true, Mode.Relaxed, 0);
  const hit = one.items.find((it) => it.place.kind !== 'unknown');
  if (hit) return { ...hit.place, raw: t };
  const all = parsePieces(t, undefined, true, Mode.Relaxed, 0);
  const h2 = all.items.find((it) => it.place.kind !== 'unknown');
  if (h2) return { ...h2.place, raw: t };
  if (all.flags & F_ANYWHERE) return anywherePlace(t);
  return undefined;
}

// ---------------------------------------------------------------------------
// suggestPlaces
// ---------------------------------------------------------------------------

interface SuggestEntry {
  key: string;
  /** 'c' city row, 'a' admin1, 'k' country, 'r' region. */
  t: 'c' | 'a' | 'k' | 'r';
  i: number;
  /** Ranking weight: population (a country/state: its cities' population), scaled down for aliases. */
  w: number;
}

const ALIAS_WEIGHT = 0.25;

interface SuggestIndex {
  entries: SuggestEntry[];
  keys: string[];
  buildMs: number;
}

let SUGGEST: SuggestIndex | undefined;

function suggestIndex(): SuggestIndex {
  if (SUGGEST) return SUGGEST;
  const t0 = performance.now();
  const ix = index();
  const g = loadReference('gazetteer');
  const countryPop = new Map<string, number>();
  const admin1Pop = new Map<string, number>();
  for (const r of ix.cities) {
    countryPop.set(r[3], (countryPop.get(r[3]) ?? 0) + r[6]);
    const k = `${r[3]}|${r[2]}`;
    admin1Pop.set(k, (admin1Pop.get(k) ?? 0) + r[6]);
  }
  const entries: SuggestEntry[] = [];
  const push = (name: string, t: SuggestEntry['t'], i: number, w: number) => {
    const key = placeKey(name);
    if (key.length < 2) return;
    entries.push({ key, t, i, w });
  };
  g.countries.forEach((c, i) => {
    const w = countryPop.get(c.code) ?? 0;
    push(c.name, 'k', i, w);
    for (const al of c.aliases) {
      // Native names ("Deutschland", "España") rank like the name; other aliases lower.
      const native = /[^\x00-\x7f]/.test(al) || /^[A-Z][a-z]+$/.test(al);
      if (al.length > 3 || al === al.toUpperCase()) push(al, 'k', i, w * (native ? 0.9 : ALIAS_WEIGHT));
    }
  });
  g.admin1.forEach((a, i) => {
    const w = (admin1Pop.get(`${a.country}|${a.code}`) ?? 0) * (STANDALONE_ADMIN1_COUNTRIES.includes(a.country) ? 0.35 : 0.05);
    push(a.name, 'a', i, w);
    for (const al of a.aliases ?? []) if (al.length > 3) push(al, 'a', i, w * ALIAS_WEIGHT);
  });
  g.regions.forEach((r, i) => {
    const w = r.countries.reduce((s, c) => s + (countryPop.get(c) ?? 0), 0) * 0.05;
    push(r.name, 'r', i, w);
    for (const al of r.aliases) if (al.length > 3 && !/[,/]/.test(al)) push(al, 'r', i, w * ALIAS_WEIGHT);
  });
  ix.cities.forEach((r, i) => {
    push(r[0], 'c', i, r[6]);
    if (r[1] !== r[0]) push(r[1], 'c', i, r[6]);
  });
  for (const al of g.aliases) {
    const k = placeKey(al.alias);
    const row = ix.keys.get(k)?.c?.[0];
    if (row !== undefined) entries.push({ key: k, t: 'c', i: row, w: ix.cities[row]![6] * ALIAS_WEIGHT });
  }
  entries.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : y.w - x.w));
  SUGGEST = { entries, keys: entries.map((e) => e.key), buildMs: 0 };
  SUGGEST.buildMs = performance.now() - t0;
  return SUGGEST;
}

/** Milliseconds the autocomplete index took to build (builds it if needed). */
export function suggestIndexStats(): { buildMs: number; entries: number } {
  const s = suggestIndex();
  return { buildMs: s.buildMs, entries: s.entries.length };
}

function lowerBound(arr: string[], q: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < q) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function suggestionPlace(e: SuggestEntry): Place {
  const raw = '';
  let p: Place;
  if (e.t === 'c') p = cityPlace(e.i, raw);
  else if (e.t === 'a') p = admin1Place(e.i, raw);
  else if (e.t === 'k') {
    const c = index().countries[e.i]!;
    const row = cityStateRow(c.code);
    p = row !== undefined ? cityPlace(row, raw) : countryPlace(e.i, raw);
  } else p = regionPlace(e.i, raw);
  return { ...p, raw: p.label };
}

/**
 * Autocomplete for the location box: cities (by population), admin1s, countries and
 * regions whose name or alias starts with (or, failing that, contains) the query. Diacritic-insensitive.
 *
 * Ranking: exact name matches first, then prefix matches, then names with a word starting with the
 * query, then substring matches; within a tier by population (a country/state weighs the population of
 * its cities, halved for states). "city qualifier" queries ("austin tx", "portland, me") filter the city by
 * its state/country.
 */
export function suggestPlaces(query: string, limit = 8): Place[] {
  const q = placeKey(query);
  if (!q || limit <= 0) return [];
  const sx = suggestIndex();
  // Prefix matches, an exact name counting double.
  const prefix: Array<SuggestEntry & { s: number }> = [];
  const lo = lowerBound(sx.keys, q);
  for (let i = lo; i < sx.keys.length; i++) {
    const k = sx.keys[i]!;
    if (!k.startsWith(q)) break;
    const e = sx.entries[i]!;
    prefix.push({ ...e, s: e.w * (k === q ? 2 : 1) });
  }
  const out: Place[] = [];
  const seen = new Set<string>();
  const take = (list: Array<SuggestEntry & { s?: number }>) => {
    list.sort((x, y) => (y.s ?? y.w) - (x.s ?? x.w));
    for (const e of list) {
      if (out.length >= limit) return;
      const id = `${e.t}${e.i}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const p = suggestionPlace(e);
      const pid = `${placeIdentity(p)}|${p.label}`;
      if (seen.has(pid) || seen.has(p.label)) continue;
      seen.add(pid);
      seen.add(p.label);
      out.push(p);
    }
  };
  if ('anywhere'.startsWith(q) || 'worldwide'.startsWith(q) || (q.length >= 3 && 'remote'.startsWith(q))) {
    out.push(anywherePlace('Anywhere'));
    seen.add('anywhere');
  }
  take(prefix);
  if (out.length < limit && q.includes(' ')) {
    // "austin tx", "portland me", "cambridge uk"
    const words = q.split(' ');
    for (let n = 1; n < words.length && out.length < limit; n++) {
      const cityQ = words.slice(0, words.length - n).join(' ');
      const qualQ = words.slice(words.length - n).join(' ');
      const e = index().keys.get(cityQ);
      if (!e?.c) continue;
      const rows = e.c.filter((row) => qualifierPrefixMatches(index().cities[row]!, qualQ));
      take(rows.map((row) => ({ key: cityQ, t: 'c' as const, i: row, w: index().cities[row]![6] })));
    }
  }
  if (out.length < limit && q.length >= 3) {
    const word: SuggestEntry[] = [];
    const sub: SuggestEntry[] = [];
    const wq = ` ${q}`;
    for (let i = 0; i < sx.keys.length; i++) {
      const k = sx.keys[i]!;
      if (k.startsWith(q)) continue;
      if (k.includes(wq)) word.push(sx.entries[i]!);
      else if (k.includes(q)) sub.push(sx.entries[i]!);
    }
    take(word);
    take(sub);
  }
  return out.slice(0, limit);
}

function qualifierPrefixMatches(row: CityRow, qual: string): boolean {
  const ix = index();
  const a = admin1Rec(row[3], row[2]);
  const c = countryRec(row[3]);
  const cands = [
    a?.abbr,
    a?.name,
    a && row[3] === 'US' ? a.code : undefined,
    c?.code,
    c?.name,
    COUNTRY_SHORT[row[3]],
  ];
  const ci = ix.countryByCode.get(row[3]);
  if (ci !== undefined) cands.push(...loadReference('gazetteer').countries[ci]!.aliases);
  return cands.some((x) => x !== undefined && placeKey(x).startsWith(qual));
}

// ---------------------------------------------------------------------------
// Distance and matching
// ---------------------------------------------------------------------------

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PlaceMatchKind =
  | 'city' // same city
  | 'radius' // within the radius of the target city
  | 'area' // target is an admin1/country/region and the job is inside it
  | 'remote' // remote job that may be done from the target
  | 'none';

export interface PlaceMatch {
  kind: PlaceMatchKind;
  distanceKm?: number;
}

const MATCH_RANK: Record<PlaceMatchKind, number> = { city: 4, radius: 3, area: 2, remote: 1, none: 0 };

function sameCity(p: Place, t: Place): boolean {
  if (!p.city || !t.city || p.country !== t.country) return false;
  if (normLow(p.city) === normLow(t.city) && (p.admin1 ?? '') === (t.admin1 ?? '')) return true;
  if (p.lat !== undefined && p.lon !== undefined && t.lat !== undefined && t.lon !== undefined) {
    return normLow(p.city) === normLow(t.city) && distanceKm({ lat: p.lat, lon: p.lon }, { lat: t.lat, lon: t.lon }) < 2;
  }
  return false;
}

/** Does place `p` (admin1/country/region) contain the target's location? */
function contains(p: Place, t: Place): boolean {
  if (p.kind === 'country') return Boolean(p.country && (p.country === t.country || (t.kind === 'region' && t.countries?.includes(p.country))));
  if (p.kind === 'admin1') return Boolean(p.country && p.country === t.country && p.admin1 && (t.kind === 'city' || t.kind === 'admin1') && p.admin1 === t.admin1);
  if (p.kind === 'region') return Boolean(t.country && p.countries?.includes(t.country));
  return false;
}

/**
 * Does a job's location satisfy a target place?
 *  - target city:    job has that city, or a city within `radiusKm` (when > 0). A job listed only as an
 *                    admin1/country that contains the city does NOT match as on-site (too vague) unless it is remote.
 *  - target admin1:  job has a place in that admin1.
 *  - target country: job has a place in that country.
 *  - target region:  job has a place in any member country.
 *  - remote jobs (`includeRemote`): match when remoteScope is empty or includes the target's country
 *    (for a region: intersects its countries). A remote job with no scope matches any target.
 * Returns the best match kind.
 *
 * Details: the radius is inclusive (distance <= radiusKm) and measured between city coordinates; a city-state
 * listed as its country (e.g. "Singapore" as kind 'country') counts as the city. Unknown places never match.
 * Hybrid/on-site jobs match by place only. Target kind 'anywhere' (the user typed "remote"/"anywhere") puts
 * no geographic constraint: remote jobs match as 'remote', every other job as 'area'. Target kind 'unknown'
 * never matches. `includeRemote` defaults to false. Best match order: city > radius (nearest) > area > remote.
 */
export function matchPlace(
  job: JobLocation,
  target: Place,
  opts: { radiusKm?: number; includeRemote?: boolean } = {},
): PlaceMatch {
  if (target.kind === 'unknown') return { kind: 'none' };
  if (target.kind === 'anywhere') return { kind: job.remote === 'remote' ? 'remote' : 'area' };
  const radius = opts.radiusKm ?? 0;
  let best: PlaceMatch = { kind: 'none' };
  const consider = (m: PlaceMatch) => {
    const better =
      MATCH_RANK[m.kind] > MATCH_RANK[best.kind] ||
      (m.kind === 'radius' && best.kind === 'radius' && (m.distanceKm ?? Infinity) < (best.distanceKm ?? Infinity));
    if (better) best = m;
  };
  const targetCountries = target.kind === 'region' ? new Set(target.countries ?? []) : undefined;
  for (const p of job.places) {
    if (p.kind === 'unknown' || p.kind === 'anywhere') continue;
    switch (target.kind) {
      case 'city': {
        if (p.kind === 'city') {
          if (sameCity(p, target)) consider({ kind: 'city', distanceKm: 0 });
          else if (radius > 0 && p.lat !== undefined && p.lon !== undefined && target.lat !== undefined && target.lon !== undefined) {
            const d = distanceKm({ lat: p.lat, lon: p.lon }, { lat: target.lat, lon: target.lon });
            if (d <= radius) consider({ kind: 'radius', distanceKm: Math.round(d * 10) / 10 });
          }
        } else if (p.kind === 'country' && !p.city && p.country && CITY_STATES.has(p.country) && p.country === target.country) {
          consider({ kind: 'city', distanceKm: 0 });
        }
        break;
      }
      case 'admin1':
        if ((p.kind === 'city' || p.kind === 'admin1') && p.country === target.country && p.admin1 === target.admin1) consider({ kind: 'area' });
        break;
      case 'country':
        if ((p.kind === 'city' || p.kind === 'admin1' || p.kind === 'country') && p.country === target.country) consider({ kind: 'area' });
        break;
      case 'region':
        if (p.kind === 'region') {
          if (p.countries?.length && p.countries.every((c) => targetCountries?.has(c))) consider({ kind: 'area' });
        } else if (p.country && targetCountries?.has(p.country)) consider({ kind: 'area' });
        break;
    }
  }
  if (opts.includeRemote && job.remote === 'remote' && MATCH_RANK[best.kind] < MATCH_RANK.remote) {
    const scope = job.remoteScope;
    let ok: boolean;
    if (!scope.length) ok = true;
    else if (target.kind === 'region') ok = scope.some((c) => targetCountries?.has(c));
    else ok = Boolean(target.country && scope.includes(target.country));
    // A remote job listed only as an admin1/country containing the target.
    if (!ok) ok = job.places.some((p) => contains(p, target));
    if (ok) consider({ kind: 'remote' });
  }
  return best;
}

/** Re-exported for callers that build places by hand (tests, fixtures). */
export function makePlace(p: Omit<Place, 'label'> & { kind: PlaceKind }): Place {
  return finish(p);
}
