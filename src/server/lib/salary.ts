import type { Salary, SalaryPeriod } from '../../shared/types';
import type { RawSalary } from '../sources/types';

export interface SalaryOptions {
  /** ISO alpha-2 country of the job, used to disambiguate "$" (USD/CAD/AUD/…) and bare numbers. */
  country?: string;
}

/** Hours/weeks used to annualise: hour x 2080, day x 260, week x 52, month x 12. */
export function annualize(amount: number, period: SalaryPeriod): number {
  switch (period) {
    case 'hour':
      return amount * 2080;
    case 'day':
      return amount * 260;
    case 'week':
      return amount * 52;
    case 'month':
      return amount * 12;
    case 'year':
      return amount;
  }
}

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

const MIN_ANNUAL = 5_000;
const MAX_ANNUAL = 5_000_000;

/**
 * Rough units per US dollar for currencies whose unit is worth far less than a dollar.
 * The documented 5,000–5,000,000 bounds are scaled by this so that real salaries such as
 * ₹1.2 Cr or ¥8,000,000 a year are not rejected (no FX conversion is done anywhere).
 */
const LOW_VALUE_UNITS: Readonly<Record<string, number>> = {
  JPY: 150, KRW: 1400, INR: 85, IDR: 16000, VND: 25000, CNY: 7, HKD: 7.8, SEK: 10.5, NOK: 10.8, DKK: 6.9,
  ZAR: 18, MXN: 18, PHP: 58, THB: 35, TWD: 32, CZK: 23, HUF: 360, RUB: 90, UAH: 41, TRY: 34, ARS: 1000,
  CLP: 950, COP: 4000, PKR: 280, BDT: 120, LKR: 300, NPR: 135, NGN: 1500, KES: 130, EGP: 49, BRL: 5.5,
  ISK: 140, RSD: 108, MAD: 10, UYU: 40, GHS: 15,
};

function unitFactor(currency: string | undefined): number {
  return (currency && LOW_VALUE_UNITS[currency]) || 1;
}

/** Plausible annual salary bounds in the given currency. */
function annualBounds(currency: string | undefined): [number, number] {
  const f = unitFactor(currency);
  return [MIN_ANNUAL * Math.max(1, f / 5), MAX_ANNUAL * f];
}

const ISO_CODES = new Set([
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'INR', 'JPY', 'CNY', 'CHF', 'SEK', 'NOK', 'DKK',
  'ISK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'RSD', 'UAH', 'RUB', 'TRY', 'ILS', 'AED', 'SAR', 'QAR',
  'KWD', 'BHD', 'OMR', 'EGP', 'ZAR', 'NGN', 'KES', 'GHS', 'MAD', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN',
  'UYU', 'KRW', 'TWD', 'PHP', 'IDR', 'MYR', 'THB', 'VND', 'PKR', 'BDT', 'LKR', 'NPR',
]);

const EURO_COUNTRIES = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];
const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  US: 'USD', CA: 'CAD', GB: 'GBP', UK: 'GBP', AU: 'AUD', NZ: 'NZD', IN: 'INR', JP: 'JPY', CN: 'CNY', CH: 'CHF',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', RS: 'RSD',
  UA: 'UAH', TR: 'TRY', IL: 'ILS', AE: 'AED', SA: 'SAR', QA: 'QAR', EG: 'EGP', ZA: 'ZAR', NG: 'NGN', KE: 'KES',
  GH: 'GHS', MA: 'MAD', BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', UY: 'UYU', KR: 'KRW',
  TW: 'TWD', PH: 'PHP', ID: 'IDR', MY: 'MYR', TH: 'THB', VN: 'VND', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR',
  SG: 'SGD', HK: 'HKD',
  ...Object.fromEntries(EURO_COUNTRIES.map((c) => [c, 'EUR'])),
};
const DOLLAR_BY_COUNTRY: Readonly<Record<string, string>> = { US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', MX: 'MXN' };
const KRONA_BY_COUNTRY: Readonly<Record<string, string>> = { SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK' };
const RUPEE_BY_COUNTRY: Readonly<Record<string, string>> = { PK: 'PKR', LK: 'LKR', NP: 'NPR' };
const SYMBOL_CODES: Readonly<Record<string, string>> = {
  US$: 'USD', CA$: 'CAD', C$: 'CAD', AU$: 'AUD', A$: 'AUD', NZ$: 'NZD', SG$: 'SGD', S$: 'SGD', HK$: 'HKD',
  MX$: 'MXN', R$: 'BRL', '£': 'GBP', '€': 'EUR', '₹': 'INR', '₩': 'KRW', '₱': 'PHP', '₺': 'TRY', '₪': 'ILS',
  '₫': 'VND', '₦': 'NGN', zł: 'PLN', RMB: 'CNY',
};

function countryCode(country: string | undefined): string | undefined {
  return country ? country.trim().toUpperCase() : undefined;
}

function countryDefault(country: string | undefined): string | undefined {
  const c = countryCode(country);
  return c ? COUNTRY_CURRENCY[c] : undefined;
}

/**
 * Resolve a currency marker as written next to an amount.
 * Returns the ISO code, null for a money marker whose currency is unknown ("kr" without a
 * Nordic country), or undefined when the marker is not a currency at all.
 */
function resolveMarker(marker: string, country: string | undefined): string | null | undefined {
  const c = countryCode(country);
  const m = marker.replace(/\s+/g, '');
  if (m === '$') return (c && DOLLAR_BY_COUNTRY[c]) || 'USD';
  if (m === '¥') return c === 'CN' ? 'CNY' : 'JPY';
  if (/^kr\.?$/i.test(m)) return (c && KRONA_BY_COUNTRY[c]) || null;
  if (/^rs\.?$/i.test(m)) return (c && RUPEE_BY_COUNTRY[c]) || 'INR';
  if (m === 'R') return c === 'ZA' ? 'ZAR' : undefined;
  const sym = SYMBOL_CODES[m] ?? SYMBOL_CODES[m.toUpperCase()];
  if (sym) return sym;
  const code = m.replace(/\$$/, '').toUpperCase();
  if (code === 'RMB') return 'CNY';
  return ISO_CODES.has(code) ? code : undefined;
}

/** Normalise a structured currency value ("usd", "$", "€"). */
function normalizeCurrency(value: string | undefined, country: string | undefined): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const r = resolveMarker(value.trim(), country);
  return r ?? undefined;
}

// ---------------------------------------------------------------------------
// Amount scanning
// ---------------------------------------------------------------------------

interface Tok {
  /** Span including currency markers, multiplier and suffix currency. */
  start: number;
  end: number;
  /** The number as written, before the multiplier. */
  num: number;
  mult: number;
  value: number;
  grouped: boolean;
  /** A currency marker (symbol or code) was attached. */
  money: boolean;
  currency?: string;
  /** Written with "LPA" (lakh per annum). */
  lpa: boolean;
  /** Followed by "+" meaning "or more" (not "+ equity"). */
  plus: boolean;
}

const PREFIX_CUR_RE =
  /(?:^|[^A-Za-z])(US\$|USD\s?\$|CA\$|CAD\s?\$|C\$|AU\$|AUD\s?\$|A\$|NZ\$|NZD\s?\$|SG\$|SGD\s?\$|S\$|HK\$|HKD\s?\$|MX\$|MXN\s?\$|R\$|\$|£|€|¥|₹|₩|₱|₺|₪|₫|₦|Rs\.?|[A-Za-z]{3}|kr\.?|zł|R)\s?$/;
const SUFFIX_CUR_RE = /^\s?(US\$|\$|£|€|¥|₹|zł|kr\.?(?![A-Za-z])|[A-Za-z]{3}(?![A-Za-z]))/;
const MULT_RE =
  /^\s?(thousand|k|K|million|mil|mn|mm|MM|m|M|lakhs?|lacs?|LPA|lpa|L|crores?|cr|Cr|billion|bn|B)(?![A-Za-z])/;
const EXTRA_WORDS =
  String.raw`bonus(?:es)?|sign[- ]?on|signing|equity|stock|rsus?|options|stipends?|allowances?|reimburse\w*|relocation|commissions?|tips|budget|credits?|per\s+diem|referral|401\s*\(?k\)?|match(?:ing)?|grants?|discounts?|perks?|benefits?|wellness|learning|tuition|insurance|coverage|savings|retirement|pension|contributions?|super(?:annuation)?`;
const EXTRA_AFTER_RE = new RegExp(String.raw`^\s*(?:[a-z][\w-]*\s+){0,3}?(?:${EXTRA_WORDS})\b`, 'i');
const EXTRA_BEFORE_RE =
  /\b(?:bonus(?:es)?|sign[- ]?on|signing|equity|stock|rsus?|stipends?|allowances?|relocation|commissions?|referral|budget|reimbursement|per\s+diem|grants?|match(?:ing)?)\b[^\d$€£¥₹]{0,15}$/i;
const PLUS_EXTRA = String.raw`${EXTRA_WORDS}|ote|uncapped\s+commission`;
/**
 * "+" meaning "or more". Not when it adds a benefit: "$150K + equity", and with a spaced " + " also
 * "$120,000 + annual bonus" (a glued "$90k+ with equity" still means "or more").
 */
const PLUS_RE = new RegExp(String.raw`^(?:\+(?!\s*(?:${PLUS_EXTRA})\b)|\s+\+(?!\s*(?:[a-z][\w-]*\s+){0,2}(?:${PLUS_EXTRA})\b))`, 'i');
const UNIT_WORD_RE =
  /^\s*\+?\s*(?:employees|people|persons|staff|users|customers|clients|members|engineers|developers|countries|offices|locations|years?|yrs?|months?|hours?|hrs?|days?|weeks?|students|downloads|installs|companies|businesses|partners|teams|times|x\b|%)/i;

function multiplierOf(word: string): number {
  const w = word.toLowerCase();
  if (w === 'k' || w === 'thousand') return 1e3;
  if (w === 'm' || w === 'mm' || w === 'mil' || w === 'mn' || w === 'million') return 1e6;
  if (w.startsWith('lakh') || w.startsWith('lac') || w === 'l' || w === 'lpa') return 1e5;
  if (w.startsWith('crore') || w === 'cr') return 1e7;
  return 1e9;
}

interface NumRead {
  value: number;
  len: number;
  grouped: boolean;
}

/** Read a number at `i`: "120,000", "120.000", "120 000", "120'000", "12,34,567", "45.50", "35,3". */
function readNumber(s: string, i: number): NumRead | undefined {
  const rest = s.slice(i, i + 40);
  const indian = /^\d{1,2}(?:,\d{2})+,\d{3}(?![\d,])/.exec(rest);
  if (indian) return { value: Number(indian[0].replace(/,/g, '')), len: indian[0].length, grouped: true };
  const g = /^(\d{1,3})((?:,\d{3})+|(?:\.\d{3})+|(?:[    ]\d{3})+|(?:['’]\d{3})+)(?![\d%])/.exec(rest);
  if (g) {
    const sep = g[2]?.[0] ?? ',';
    let len = g[0].length;
    let value = Number(`${g[1]}${(g[2] ?? '').replace(/[^\d]/g, '')}`);
    const dec = /^([.,])(\d{1,2})(?!\d)/.exec(rest.slice(len));
    if (dec && dec[1] !== sep) {
      value += Number(`0.${dec[2]}`);
      len += dec[0].length;
    }
    return { value, len, grouped: true };
  }
  const p = /^(\d+)(?:[.,](\d{1,2})(?![\d]))?/.exec(rest);
  if (!p || (p[1]?.length ?? 0) > 12) return undefined;
  return { value: Number(`${p[1]}${p[2] ? `.${p[2]}` : ''}`), len: p[0].length, grouped: false };
}

function isLowerCaseCode(marker: string): boolean {
  return /^[A-Za-z]{3}$/.test(marker) && marker !== marker.toUpperCase();
}

/** Find every amount-like token, skipping dates, times, fractions, percentages, versions and identifiers. */
function scanAmounts(text: string, country: string | undefined): Tok[] {
  const toks: Tok[] = [];
  const digit = /\d+/g;
  let m: RegExpExecArray | null;
  while ((m = digit.exec(text))) {
    const start = m.index;
    const runEnd = start + m[0].length;
    const n = readNumber(text, start);
    if (!n) continue;
    let end = start + n.len;
    digit.lastIndex = Math.max(end, runEnd);
    const prev = text[start - 1] ?? '';
    const prev2 = text[start - 2] ?? '';
    const next = text[end] ?? '';
    const next2 = text[end + 1] ?? '';
    // Glued to another number: "24/7", "1.2.3", "9:30", "2026/11/23".
    if ((prev === '/' || prev === '.' || prev === ':') && /\d/.test(prev2)) continue;
    if ((next === '/' || next === ':' || next === '.') && /\d/.test(next2)) continue;
    if (next === '%' || /^\s%/.test(text.slice(end, end + 2))) continue;
    // Retirement plan names, not money.
    if ((n.value === 401 || n.value === 403 || n.value === 457) && /^\s?\(?[kb]\)?/i.test(text.slice(end, end + 4))) continue;

    const before = text.slice(Math.max(0, start - 10), start);
    const pre = PREFIX_CUR_RE.exec(before);
    let marker = pre?.[1];
    // In free text a three-letter code only counts in capitals ("USD 100k", not "try 100 times").
    if (marker && isLowerCaseCode(marker)) marker = undefined;
    let resolved = marker ? resolveMarker(marker, country) : undefined;
    if (marker && resolved === undefined) marker = undefined;
    // Digits glued to letters ("Q4", "H1B", "B2B") are identifiers unless the letters are a currency.
    if (/[A-Za-z0-9_]/.test(prev) && !marker) continue;
    const tokStart = marker ? start - before.length + before.lastIndexOf(marker) : start;

    let mult = 1;
    let lpa = false;
    const mu = MULT_RE.exec(text.slice(end, end + 10));
    if (mu?.[1]) {
      mult = multiplierOf(mu[1]);
      lpa = /^lpa$/i.test(mu[1]);
      end += mu[0].length;
    } else if (/[A-Za-z]/.test(next) && !/^[A-Za-z]{3}(?![A-Za-z])/.test(text.slice(end, end + 4))) {
      // "3rd", "5G", "2x": a number glued to a word.
      if (!/^(?:kr|zł|lpa)/i.test(text.slice(end, end + 3))) continue;
    }
    const suf = SUFFIX_CUR_RE.exec(text.slice(end, end + 8));
    if (suf?.[1] && !isLowerCaseCode(suf[1])) {
      const r = resolveMarker(suf[1], country);
      if (r !== undefined) {
        if (resolved === undefined || resolved === null) resolved = r;
        marker ??= suf[1];
        end += suf[0].length;
      }
    }
    const plus = PLUS_RE.test(text.slice(end, end + 30));
    toks.push({
      start: tokStart,
      end,
      num: n.value,
      mult,
      value: round2(n.value * mult),
      grouped: n.grouped,
      money: marker !== undefined,
      ...(resolved ? { currency: resolved } : {}),
      lpa,
      plus,
    });
  }
  return toks;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Tokens that cannot be a salary on their own merits (years, headcounts, durations). */
function isJunk(text: string, t: Tok): boolean {
  if (!t.money && t.mult === 1 && !t.grouped && Number.isInteger(t.num) && t.num >= 1900 && t.num <= 2100) return true;
  if (!t.money && UNIT_WORD_RE.test(text.slice(t.end, t.end + 16))) return true;
  return false;
}

/** Bonus, equity, stipend, allowance, … amounts. */
function isExtra(text: string, t: Tok): boolean {
  let after = text.slice(t.end, t.end + 48);
  // "$150k including equity" / "incl. bonus": the words describe what the amount covers, not what it is.
  const cut = after.search(/[+,;(|\n]|\band\b|\bplus\b|\bwith\b|\bincl(?:uding|usive|\.)?|\bexcl(?:uding|usive|\.)?|\.\s/i);
  if (cut >= 0) after = after.slice(0, cut);
  if (EXTRA_AFTER_RE.test(after)) return true;
  let before = text.slice(Math.max(0, t.start - 48), t.start);
  const b = Math.max(before.lastIndexOf('. '), before.lastIndexOf(';'), before.lastIndexOf('\n'));
  if (b >= 0) before = before.slice(b + 1);
  return EXTRA_BEFORE_RE.test(before);
}

/** A rate per piece of work ("$100 per video", "$0.10/word"), not a salary. */
function isPieceRate(text: string, end: number): boolean {
  return /^\s*(?:\/|per\s+)(?!(?:hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mos?|m|years?|yrs?|y|annum|anum|calendar\s+month)\b)[\w-]/i.test(
    text.slice(end, end + 24),
  );
}

// ---------------------------------------------------------------------------
// Periods and qualifiers
// ---------------------------------------------------------------------------

const PERIOD_G =
  /\/\s*(hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mos?|m|years?|yrs?|y|annum)\b|\b(?:per|a|an|each|every)\s+(hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?|annum|calendar\s+month)\b|\b(hourly|daily|day\s+rate|(?<!bi-?|semi-?)weekly|(?<!bi-?|semi-?)monthly|yearly|annually|annual|p\.\s?a\b|pa|p\/a|pcm|ph|p\/h|lpa|ote|on[- ]target\s+earnings)\b/gi;
/** A period word that qualifies a benefit ("a monthly wellness stipend", "annual bonus"), not the pay. */
const QUALIFIES_EXTRA_RE = new RegExp(String.raw`^(?:[\s-]+[a-z]+)?[\s-]+(?:${EXTRA_WORDS})\b`, 'i');

function periodOfWord(word: string): SalaryPeriod {
  const w = word.toLowerCase().replace(/\s+/g, ' ');
  if (/^(?:hours?|hrs?|h|hourly|ph|p\/h)$/.test(w)) return 'hour';
  if (/^(?:days?|d|daily|day rate)$/.test(w)) return 'day';
  if (/^(?:weeks?|wks?|w|weekly)$/.test(w)) return 'week';
  if (/^(?:months?|mos?|m|monthly|pcm|calendar month)$/.test(w)) return 'month';
  return 'year';
}

const L = String.raw`(?<![\p{L}])`;
const R = String.raw`(?![\p{L}])`;
/** Pay periods written in German, French, Spanish, Portuguese, Italian, Dutch, Nordic languages and Polish. */
const FOREIGN_PERIODS: ReadonlyArray<readonly [SalaryPeriod, RegExp]> = [
  ['hour', new RegExp(String.raw`${L}(?:pro\s+stunde|pro\s+std\.?|stündlich|par\s+heure|de\s+l['’]heure|por\s+hora|all['’]ora|per\s+uur|i\s+timmen|za\s+godzinę|na\s+godzinę)${R}|\/\s*(?:std|stunde|heure|hora|ora|uur|tim|godz)\.?${R}`, 'iu')],
  ['day', new RegExp(String.raw`${L}(?:pro\s+tag|tagessatz|par\s+jour|por\s+d[ií]a|al\s+giorno|per\s+dag|dziennie)${R}|\/\s*(?:tag|jour|d[ií]a|giorno|dag)${R}`, 'iu')],
  ['week', new RegExp(String.raw`${L}(?:pro\s+woche|wöchentlich|par\s+semaine|por\s+semana|a\s+settimana|tygodniowo)${R}|\/\s*(?:woche|semaine|semana|settimana)${R}`, 'iu')],
  ['month', new RegExp(String.raw`${L}(?:monatlich|pro\s+monat|im\s+monat|mensuel(?:le)?|par\s+mois|por\s+mes|al\s+mes|mensual(?:es)?|por\s+m[eê]s|mensa(?:l|is)|al\s+mese|mensil[ei]|per\s+maand|per\s+m[aå]nad|i\s+m[aå]naden|m[aå]nedlig|miesięcznie|měsíčně)${R}|\/\s*(?:monat|mois|mes|mês|mese|maand|m[aå]n|mnd|mies|měs)\.?${R}`, 'iu')],
  ['year', new RegExp(String.raw`${L}(?:jährlich|pro\s+jahr|im\s+jahr|par\s+an|annuel(?:le)?|por\s+a[ñn]o|al\s+a[ñn]o|anual(?:es)?|all['’]anno|annu[oi]|lordi\s+annui|per\s+jaar|per\s+år|årlig|rocznie|ročně)${R}|\/\s*(?:jahr|an|año|ano|anno|jaar|år|rok)${R}`, 'iu')],
];

/** First (leftmost) explicit pay period in `scope`. */
function findPeriod(scope: string): SalaryPeriod | undefined {
  let best: SalaryPeriod | undefined;
  let at = Infinity;
  for (const m of scope.matchAll(PERIOD_G)) {
    const end = m.index + m[0].length;
    if (QUALIFIES_EXTRA_RE.test(scope.slice(end, end + 40))) continue;
    best = periodOfWord(m[1] ?? m[2] ?? m[3] ?? 'year');
    at = m.index;
    break;
  }
  for (const [period, re] of FOREIGN_PERIODS) {
    const f = re.exec(scope);
    if (f && f.index < at) {
      best = period;
      at = f.index;
    }
  }
  return best;
}

/** Nouns naming the pay itself, which a period word before an amount has to qualify. */
const PAY_NOUNS = String.raw`salary|salaries|compensation|comp|pay|wages?|rates?|range|earnings|income|remuneration|ote|base|gross|gehalt|vergütung|lohn|salaire|rémunération|salario|sueldo|retribuzione|stipendio|salaris|lønn|lön|løn|wynagrodzenie`;
/** "monthly salary", "annual base salary", "Hourly:", "(monthly):" — read after the period word. */
const PAY_NOUN_AFTER_RE = new RegExp(String.raw`^(?:\s*\)?\s*:|(?:[\s-]+\p{L}+){0,2}?[\s-]+(?:${PAY_NOUNS})${R})`, 'iu');
/** "salary per month", "salaire mensuel", "Gehalt pro Monat" — read before the period word. */
const PAY_NOUN_BEFORE_RE = new RegExp(String.raw`${L}(?:${PAY_NOUNS})(?:[\s-]+\p{L}+){0,2}?[\s-]+$`, 'iu');
/**
 * English period words that can stand before an amount. Abbreviations ("pa", "ph") and "a year" are left
 * out: before an amount they are usually something else ("Pittsburgh, PA: $25").
 */
const BEFORE_PERIOD_G =
  /\b(?:(hourly|daily|day(?=\s+rate)|(?<!bi-?|semi-?)weekly|(?<!bi-?|semi-?)monthly|yearly|annual|annually)|per\s+(hour|day|week|month|year|annum))\b/gi;
const FOREIGN_PERIODS_G = FOREIGN_PERIODS.map(([period, re]) => [period, new RegExp(re.source, 'giu')] as const);

/**
 * The pay period named before an amount in `clause` (the text from the start of its clause up to the
 * amount): the nearest period word that qualifies the pay ("The monthly salary range for this position
 * is $6,500", "Hourly rate of $25", "Salaire mensuel : 3 500 €"). Period words about something else in
 * the same clause ("weekly demos, and the salary is", "annual bonus and a salary of") do not count.
 */
function periodBefore(clause: string): SalaryPeriod | undefined {
  let best: SalaryPeriod | undefined;
  let at = -1;
  const consider = (period: SalaryPeriod, index: number, end: number): void => {
    if (index <= at) return;
    const after = clause.slice(end, end + 60);
    if (QUALIFIES_EXTRA_RE.test(after)) return;
    if (!PAY_NOUN_AFTER_RE.test(after) && !PAY_NOUN_BEFORE_RE.test(clause.slice(Math.max(0, index - 60), index))) return;
    best = period;
    at = index;
  };
  for (const m of clause.matchAll(BEFORE_PERIOD_G)) consider(periodOfWord(m[1] ?? m[2] ?? 'year'), m.index, m.index + m[0].length);
  for (const [period, re] of FOREIGN_PERIODS_G) {
    for (const m of clause.matchAll(re)) consider(period, m.index, m.index + m[0].length);
  }
  return best;
}

/** Documented magnitude rule: < 500 -> hour, < 2,000 -> day unless a k-suffix was used, otherwise year. */
function inferPeriod(value: number | undefined, kUsed: boolean): SalaryPeriod {
  const v = value ?? 0;
  if (v < 500) return 'hour';
  if (v < 2000 && !kUsed) return 'day';
  return 'year';
}

const MAX_QUALIFIER_RE =
  /(?:up\s*to|upto|max(?:imum)?\.?|not\s+(?:to\s+)?exceed(?:ing)?|no\s+more\s+than|as\s+much\s+as|at\s+most|≤|<)\s*:?\s*$/i;
const MIN_QUALIFIER_RE =
  /(?:\bfrom|starting\s+(?:at|from)|starts?\s+(?:at|from)|\bmin(?:imum)?\.?|at\s+least|no\s+less\s+than|\bover|\babove|more\s+than|in\s+excess\s+of|≥|>)\s*:?\s*$/i;
const RANGE_GAP_RE = /^\s*(?:-|–|—|‒|−|~|to|and|until|till|through|thru|bis|à|a)\s*$/i;

/** Text between two tokens that makes them a range ("–", "to", "between … and …"). */
function isRangeGap(text: string, a: Tok, b: Tok): boolean {
  if (b.start - a.end > 40) return false;
  const gap = text
    .slice(a.end, b.start)
    .replace(/(?:\/\s*|\b(?:per|a|an)\s+)(?:hours?|hrs?|h|days?|weeks?|months?|mos?|years?|yrs?|annum)\b/gi, '')
    .replace(/\b(?:gross|brutto|net|base)\b/gi, '');
  if (!RANGE_GAP_RE.test(gap)) return false;
  if (/^\s*and\s*$/i.test(gap)) return /\bbetween\s*$/i.test(text.slice(Math.max(0, a.start - 12), a.start));
  return true;
}

// ---------------------------------------------------------------------------
// Building a Salary
// ---------------------------------------------------------------------------

interface Draft {
  min?: number;
  max?: number;
  currency?: string;
  period: SalaryPeriod;
  text?: string;
}

/** Fill annual figures and apply the plausibility bounds; undefined when implausible. */
function finish(d: Draft): Salary | undefined {
  const [lo, hi] = annualBounds(d.currency);
  const out: Salary = {};
  if (d.min !== undefined) out.min = round2(d.min);
  if (d.max !== undefined) out.max = round2(d.max);
  if (out.min === undefined && out.max === undefined) return undefined;
  if (d.currency) out.currency = d.currency;
  out.period = d.period;
  for (const key of ['min', 'max'] as const) {
    const v = out[key];
    if (v === undefined) continue;
    const annual = round2(annualize(v, d.period));
    if (!Number.isFinite(annual) || annual < lo || annual > hi) return undefined;
    if (key === 'min') out.annualMin = annual;
    else out.annualMax = annual;
  }
  if (d.text) out.text = d.text;
  return out;
}

interface Pick {
  a: Tok;
  b?: Tok;
}

/** Turn one or two tokens into a salary. The first defined entry of `periods` is the explicit period. */
function fromTokens(
  text: string,
  pick: Pick,
  periods: ReadonlyArray<SalaryPeriod | undefined>,
  opts: SalaryOptions,
  salaryText: string | undefined,
): Salary | undefined {
  const { a, b } = pick;
  let lo = a.value;
  let hi = b?.value;
  if (b && hi !== undefined) {
    // "120-150k", "₹18-25 LPA", "$90k-120": a multiplier written once applies to both bounds.
    if (a.mult === 1 && b.mult > 1 && !a.grouped && a.num < 1000) lo = round2(a.num * b.mult);
    if (b.mult === 1 && a.mult > 1 && !b.grouped && b.num < 1000) hi = round2(b.num * a.mult);
  }
  let min: number | undefined;
  let max: number | undefined;
  if (hi !== undefined) {
    min = Math.min(lo, hi);
    max = Math.max(lo, hi);
    // "Level 3 - $120,000", "$1 - $100,000": not a real range.
    if (max > min * 10) return undefined;
  } else {
    const before = text.slice(Math.max(0, a.start - 30), a.start);
    if (a.plus || MIN_QUALIFIER_RE.test(before)) min = lo;
    else if (MAX_QUALIFIER_RE.test(before)) max = lo;
    else min = max = lo;
  }
  const kUsed = a.mult > 1 || (b?.mult ?? 1) > 1;
  const period = a.lpa || b?.lpa ? 'year' : periods.find((p) => p !== undefined);
  const money = a.money || Boolean(b?.money);
  // A bare number is only a salary with some supporting evidence.
  if (!money && !period && !kUsed && !a.grouped && !b?.grouped && Math.max(lo, hi ?? 0) < 1000) return undefined;
  const currency = a.currency ?? b?.currency ?? (money ? undefined : findCurrencyAnywhere(text, opts.country)) ?? countryDefault(opts.country);
  return finish({
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(currency ? { currency } : {}),
    period: period ?? inferPeriod(max ?? min, kUsed),
    ...(salaryText ? { text: salaryText } : {}),
  });
}

const ANY_CURRENCY_RE =
  /(?:^|[^A-Za-z])(US\$|CA\$|C\$|AU\$|A\$|NZ\$|SG\$|S\$|HK\$|MX\$|R\$|£|€|₹|₩|₱|₺|₪|₫|₦|zł|[A-Z]{3})(?![A-Za-z])/g;

function findCurrencyAnywhere(text: string, country: string | undefined): string | undefined {
  for (const m of text.matchAll(ANY_CURRENCY_RE)) {
    const r = resolveMarker(m[1] ?? '', country);
    if (r) return r;
  }
  return undefined;
}

function prepare(text: string): string {
  return text.normalize('NFKC').replace(/[    ]/g, ' ');
}

/** For each token: where the previous money amount ends (0 if none) and where the next one starts (Infinity if none). */
function moneyNeighbours(toks: readonly Tok[]): { prevEnd: number[]; nextStart: number[] } {
  const prevEnd: number[] = [];
  const nextStart: number[] = [];
  let end = 0;
  toks.forEach((t, k) => {
    prevEnd[k] = end;
    if (t.money) end = t.end;
  });
  let start = Infinity;
  for (let k = toks.length - 1; k >= 0; k--) {
    nextStart[k] = start;
    const t = toks[k];
    if (t?.money) start = t.start;
  }
  return { prevEnd, nextStart };
}

/**
 * Text after an amount (from `end`, at most up to `limit`) that can still say what the amount is. Words
 * after the next amount belong to it, and so does that amount's lead-in after the last clause break:
 * in "$6,500 - $9,500 (annual $78,000 - $114,000)" the first range's scope ends at the "(".
 */
function scopeAfter(text: string, end: number, nextStart: number, limit: number): string {
  if (nextStart > limit) return text.slice(end, limit);
  const scope = text.slice(end, nextStart);
  let cut = -1;
  for (const m of scope.matchAll(/[(),;|]|\s\/(?=\s)/g)) cut = m.index;
  return cut >= 0 ? scope.slice(0, cut) : scope;
}

/**
 * Parse a free-text salary. Must handle, at least:
 *   "$120k – $150k", "$120,000-$150,000 a year", "USD 100,000+", "up to £65,000 per annum",
 *   "€60-70K", "60.000 € – 75.000 €" (European thousands separators), "CA$95,000", "A$120k", "₹18-25 LPA",
 *   "$45/hr", "$40 - $55 per hour", "£450 per day", "$8,000/month", "120k-150k" (no currency),
 *   "$150K + equity + bonus", "From $90,000", "Competitive" (-> undefined).
 * Period defaults: explicit unit wins; otherwise infer from magnitude (< 500 -> hour, < 2,000 -> day
 * unless a k-suffix was used, otherwise year). Reject nonsense (min > max is swapped; annualised
 * values outside 5,000–5,000,000 return undefined; a lone year like "2026" or a headcount is not a salary).
 * Always fills annualMin/annualMax when min/max and period are known, and keeps `text`.
 *
 * Details: a single amount gives min = max; "+"/"from"/"starting at"/"min" give min only and
 * "up to"/"max" give max only. Bonus/equity/stipend amounts are skipped. The bounds are scaled up
 * for currencies whose unit is worth much less than a dollar (JPY, INR, KRW, …). The explicit unit
 * is looked for after the amount (up to the next amount), then before it in the same clause
 * ("Monthly: $6,500 - $9,500"); a period word that describes a benefit ("plus a monthly stipend") is ignored.
 */
export function parseSalaryText(text: string, opts: SalaryOptions = {}): Salary | undefined {
  if (typeof text !== 'string') return undefined;
  const original = text.trim();
  if (!original || !/\d/.test(original) || original.length > 2000) return undefined;
  const s = prepare(original);
  const toks = scanAmounts(s, opts.country).filter((t) => !isJunk(s, t) && !isExtra(s, t));
  const { prevEnd, nextStart } = moneyNeighbours(toks);
  for (let i = 0; i < toks.length && i < 8; i++) {
    const a = toks[i];
    if (!a) break;
    const next = toks[i + 1];
    const b = next && isRangeGap(s, a, next) ? next : undefined;
    const last = b ?? a;
    if (isPieceRate(s, last.end)) return undefined;
    const after = s.slice(a.start, last.end) + scopeAfter(s, last.end, nextStart[b ? i + 1 : i] ?? Infinity, s.length);
    // A salary field is short and on topic, so any period word in the clause counts ("Monthly $6,500").
    const before = clauseBefore(s, a.start, prevEnd[i] ?? 0);
    const salary = fromTokens(s, { a, b }, [findPeriod(after), findPeriod(before)], opts, original);
    if (salary) return salary;
    // A range that failed is not retried from its upper bound ("$1 - $100,000" stays rejected).
    if (b && a.money) i++;
  }
  return undefined;
}

/** A positive finite number; numeric strings ("120000", " 85000.50 ") from loosely typed APIs are accepted. */
function positive(n: unknown): number | undefined {
  const v = typeof n === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(n) ? Number(n) : n;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

const PERIODS = new Set<SalaryPeriod>(['year', 'month', 'week', 'day', 'hour']);
/** Amounts at or above these (per currency unit factor) are yearly figures in a mislabelled field. */
const MISLABELLED_YEARLY: Readonly<Record<SalaryPeriod, number>> = { hour: 1_000, day: 5_000, week: 20_000, month: 50_000, year: Infinity };

/**
 * Normalise what a source gave in structured form. Uses numbers when present
 * (filling currency/period from `raw.text` or the country when missing), otherwise
 * parses `raw.text`. Returns undefined when nothing usable is present.
 *
 * Numbers are not trusted blindly: 0 means "not stated"; min > max is swapped; a missing
 * period is taken from the text or inferred from magnitude (as parseSalaryText); a "year"
 * figure too small for a year is read as hourly (< 200) or monthly, and an hour/day/week/month
 * figure that is clearly a yearly amount is read as yearly. If the numbers are still
 * implausible, the parsed text is used, else undefined.
 */
export function normalizeSalary(raw: RawSalary | undefined, opts: SalaryOptions = {}): Salary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const text = typeof raw.text === 'string' && raw.text.trim() ? raw.text.trim() : undefined;
  const parsed = text ? parseSalaryText(text, opts) : undefined;
  let min = positive(raw.min);
  let max = positive(raw.max);
  if (min === undefined && max === undefined) return parsed;
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];

  const currency = normalizeCurrency(raw.currency, opts.country) ?? parsed?.currency ?? countryDefault(opts.country);
  const declared = raw.period && PERIODS.has(raw.period) ? raw.period : undefined;
  let period: SalaryPeriod = declared ?? parsed?.period ?? inferPeriod(max ?? min, false);
  const ref = max ?? min ?? 0;
  const f = unitFactor(currency);
  const [lo, hi] = annualBounds(currency);
  if (period === 'year' && ref < lo) period = ref < 200 * f ? 'hour' : 'month';
  else if (period !== 'year' && ref >= MISLABELLED_YEARLY[period] * f && ref <= hi) period = 'year';

  const out = finish({
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(currency ? { currency } : {}),
    period,
    ...(text ? { text } : {}),
  });
  return out ?? parsed;
}

// ---------------------------------------------------------------------------
// Extraction from descriptions
// ---------------------------------------------------------------------------

const PAY_WORDS_RE =
  /\b(?:salary|salaries|compensation|comp|pay|paid(?!\s+(?:media|social|search|ads?|advertising|acquisition|channels?|campaigns?|marketing|traffic)\b)|pays|paying|wages?|earn|earns|earning|earnings?|remuneration|ote|on[- ]target|base|income|hourly|annual(?:ly)?|per\s+(?:hour|year|annum|month)|gehalt|vergütung|lohn|salaire|rémunération|salario|sueldo|retribuzione|stipendio|salaris|lønn|lön|løn|wynagrodzenie)\b/i;
const PAY_WORDS_G = new RegExp(PAY_WORDS_RE.source, 'gi');
/** Pay vocabulary that names the amount itself; a single amount (not a range) needs one in its sentence. */
const STRONG_PAY_RE =
  /\b(?:salary|salaries|compensation|comp|pay|paid(?!\s+(?:media|social|search|ads?|advertising|acquisition|channels?|campaigns?|marketing|traffic)\b)|pays|paying|wages?|earn|earns|earning|earnings?|remuneration|ote|on[- ]target|base|income|hourly|rate|gehalt|vergütung|lohn|salaire|rémunération|salario|sueldo|retribuzione|stipendio|salaris|lønn|lön|løn|wynagrodzenie)\b/i;
/** Words that make an amount something other than pay when they come after the last pay word before it. */
const NOT_PAY_G =
  /\b(?:raised?|raising|funding|funded|financing|series\s+[a-f]|seed\s+round|valuation|valued|investors?|investments?|backed|revenue|arr|mrr|gmv|turnover|market\s+cap|under\s+management|aum|ipo|acquired|acquisition|loans?|donat\w*|fundrais\w*|prizes?|spend|spent|price[ds]?|pricing|fees?|costs?)\b/gi;
/** Weak signals that only count right before the amount ("our customers save $150,000"). */
const NOT_PAY_JUST_BEFORE_RE =
  /\b(?:sales|bookings|customers?|clients?|users|members|partners)\s+(?:of|reached|hit|grew(?:\s+to)?|totall?ing|exceed(?:ing|ed)?|over|save[ds]?|saving|spend|spent|worth|generated?|pay|pays|paid|paying)\s*(?:about|around|over|more\s+than|up\s+to)?\s*$/i;
/** Amounts immediately followed by these are business figures ("$120M ARR", "$2B in payments"). */
const NOT_PAY_AFTER_RE =
  /^[\s,)(-]{0,3}(?:in\s+|of\s+)?(?:(?:annual|annually|recurring|total|new|seed|series\s+[a-f])\s+)?(?:funding|financing|revenue|arr|mrr|gmv|valuation|sales|bookings|turnover|investments?|capital|assets|aum|raised|round|seed|series\s+[a-f]|users|customers|clients|downloads|market\s+cap|transactions|payments|savings|in\s+savings|under\s+management)\b/i;

/** Index where the sentence holding `start` begins (newline, ";" or ". " boundary, at most 200 chars back). */
function sentenceStart(text: string, start: number): number {
  const from = Math.max(0, start - 200);
  const left = text.slice(from, start);
  const cut = Math.max(left.lastIndexOf('\n'), left.lastIndexOf(';'), left.search(/\.\s+[^.]*$/));
  return from + cut + 1;
}

function lastMatchIndex(re: RegExp, s: string): number {
  let at = -1;
  re.lastIndex = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) at = m.index;
  return at;
}

/** Funding, revenue, prices, customer savings, …: an amount whose context says it is not pay. */
function isBusinessFigure(text: string, start: number, end: number): boolean {
  const left = text.slice(sentenceStart(text, start), start).replace(/\bcost\s+of\s+living\b/gi, ' ');
  if (lastMatchIndex(NOT_PAY_G, left) > lastMatchIndex(PAY_WORDS_G, left)) return true;
  if (NOT_PAY_JUST_BEFORE_RE.test(left)) return true;
  return NOT_PAY_AFTER_RE.test(text.slice(end, end + 60));
}

function cutAtSentence(s: string): string {
  const i = s.search(/[\n;]|\.\s+[A-Z]/);
  return i >= 0 ? s.slice(0, i) : s;
}

/** Like cutAtSentence, but also ends at a conjunction that starts another clause ("$25 – $30 and the monthly salary …"). */
function cutAtClause(s: string): string {
  const i = s.search(/[\n;]|\.\s+[A-Z]|\b(?:and|but|while|whereas)\b/i);
  return i >= 0 ? s.slice(0, i) : s;
}

/** Move a sentence start that follows a line break up to a short heading line directly above it ("Compensation\n$120,000"). */
function withHeadingLine(text: string, from: number): number {
  if (from <= 0 || text[from - 1] !== '\n') return from;
  let p = from - 1;
  while (p > 0 && /\s/.test(text[p - 1] ?? '')) p--;
  const lineStart = text.lastIndexOf('\n', p - 1) + 1;
  return p - lineStart <= 80 ? lineStart : from;
}

/** The sentence around an amount, plus a short heading line directly above it ("Compensation\n$120,000"). */
function payContext(text: string, start: number, end: number): string {
  const from = withHeadingLine(text, sentenceStart(text, start));
  return text.slice(from, end) + cutAtSentence(text.slice(end, end + 60));
}

/**
 * The clause before an amount: from the previous amount (`floor`), a line or ";" break, or the end of the
 * previous sentence, plus a short heading line above. Unlike sentenceStart, a "." only ends a sentence
 * before a capital letter, so "Monthly salary approx. $6,500" stays one clause.
 */
function clauseBefore(text: string, start: number, floor: number): string {
  const from = Math.max(0, floor, start - 200);
  const left = text.slice(from, start);
  const sentenceEnd = /^[\s\S]*[.!?]\s+(?=\p{Lu})/u.exec(left);
  const cut = Math.max(left.lastIndexOf('\n'), left.lastIndexOf(';'), sentenceEnd ? sentenceEnd[0].length - 1 : -1);
  return text.slice(Math.max(floor, withHeadingLine(text, from + cut + 1)), start);
}

/**
 * Find a salary range stated in a description. Must be conservative: only accept
 * amounts with a currency symbol/code that sit near pay vocabulary ("salary", "compensation",
 * "pay range", "base", "per year", "OTE", "/hr" …); ignore funding amounts ("raised $50M"),
 * revenue, benefits stipends ("$1,000 home office stipend"), and sign-on bonuses.
 * The result has `inferred: true`.
 *
 * Details: a range needs a currency on at least one bound ("SGD 96,000 – 132,000") and pay
 * vocabulary nearby or an explicit period; a single amount needs pay vocabulary ("salary", "pay",
 * "OTE", "rate", …) in its own sentence or in a heading line right above. Ranges win over single
 * amounts. Several ranges (split by location, zone or level): the first range is
 * taken, widened by every later range in the same currency and period that overlaps it, so
 * "Zone 1: $150k–$200k; Zone 2: $135k–$180k" gives $135k–$200k while "Base $90k–$110k,
 * OTE $150k–$180k" gives $90k–$110k. Without any range, the first qualifying single amount is
 * used. `text` holds the matched amounts.
 *
 * The period is the one written right after the amount ("per month", "/hr"; words after the next
 * amount are that amount's), else one written before it in the same clause when it qualifies the pay
 * ("The monthly salary range … is $6,500 to $9,500", "Hourly rate of $25–$30", "Salaire mensuel :"),
 * else inferred from magnitude. Period words of another sentence or about something else
 * ("weekly demos", "a monthly wellness stipend") are ignored.
 */
export function extractSalaryFromText(descriptionText: string, opts: SalaryOptions = {}): Salary | undefined {
  if (typeof descriptionText !== 'string' || !/\d/.test(descriptionText)) return undefined;
  const s = prepare(descriptionText.slice(0, 200_000));
  const toks = scanAmounts(s, opts.country).filter((t) => !isJunk(s, t) && !isExtra(s, t));
  interface Found {
    salary: Salary;
    range: boolean;
    start: number;
    end: number;
  }
  const found: Found[] = [];
  const { prevEnd, nextStart } = moneyNeighbours(toks);
  /** Considers toks[i] alone, or as a range with b = toks[i + 1]. */
  const consider = (i: number, a: Tok, b: Tok | undefined): boolean => {
    const last = b ?? a;
    if (!a.money && !b?.money) return false;
    if (isPieceRate(s, last.end) || isBusinessFigure(s, a.start, last.end)) return false;
    const afterPeriod = findPeriod(cutAtClause(scopeAfter(s, last.end, nextStart[b ? i + 1 : i] ?? Infinity, last.end + 40)));
    const beforePeriod = afterPeriod ? undefined : periodBefore(clauseBefore(s, a.start, prevEnd[i] ?? 0));
    const gap = b ? s.slice(a.end, b.start) : '';
    const near = s.slice(Math.max(0, a.start - 150), Math.min(s.length, last.end + 60));
    if (!PAY_WORDS_RE.test(near) && !afterPeriod && !beforePeriod) return false;
    // A lone amount ("up to $1,000 per month for coworking") needs pay vocabulary in its own sentence.
    if (!b && !STRONG_PAY_RE.test(payContext(s, a.start, last.end))) return false;
    const salary = fromTokens(s, { a, b }, [afterPeriod, findPeriod(gap), beforePeriod], opts, undefined);
    if (!salary) return false;
    found.push({ salary, range: Boolean(b), start: a.start, end: last.end });
    return true;
  };
  for (let i = 0; i < toks.length && found.length < 50; i++) {
    const a = toks[i];
    if (!a) continue;
    const next = toks[i + 1];
    const b = next && isRangeGap(s, a, next) ? next : undefined;
    if (b) {
      // A range that is a business figure or piece rate takes both of its bounds with it.
      if (isPieceRate(s, b.end) || isBusinessFigure(s, a.start, b.end) || consider(i, a, b)) {
        i++;
        continue;
      }
    }
    if (a.money) consider(i, a, undefined);
  }
  const ranges = found.filter((f) => f.range);
  const first = ranges[0] ?? found[0];
  if (!first) return undefined;
  let min = first.salary.min;
  let max = first.salary.max;
  const used = [first];
  if (first.range && min !== undefined && max !== undefined) {
    for (const f of ranges.slice(1)) {
      const r = f.salary;
      if (r.currency !== first.salary.currency || r.period !== first.salary.period) continue;
      if (r.min === undefined || r.max === undefined || r.min > max || r.max < min) continue;
      min = Math.min(min, r.min);
      max = Math.max(max, r.max);
      used.push(f);
    }
  }
  const merged = finish({
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(first.salary.currency ? { currency: first.salary.currency } : {}),
    period: first.salary.period ?? 'year',
    text: used
      .slice(0, 4)
      .map((f) => s.slice(f.start, f.end).trim())
      .join('; '),
  });
  return merged ? { ...merged, inferred: true } : undefined;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const DISPLAY_SYMBOL: Readonly<Record<string, string>> = {
  USD: '$', GBP: '£', EUR: '€', JPY: '¥', CNY: 'CN¥', INR: '₹', CAD: 'CA$', AUD: 'A$', NZD: 'NZ$', SGD: 'S$',
  HKD: 'HK$', MXN: 'MX$', BRL: 'R$', KRW: '₩', PHP: '₱', ILS: '₪', VND: '₫', NGN: '₦', TRY: '₺',
};
const PERIOD_SUFFIX: Readonly<Record<SalaryPeriod, string>> = { year: '/yr', month: '/mo', week: '/wk', day: '/day', hour: '/hr' };

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** 142000 -> "142k", 63800 -> "63.8k", 1800000 -> "1.8M", 28.5 -> "28.50", 45 -> "45". */
function compact(n: number): string {
  if (n >= 999_950) return `${trimZeros((n / 1e6).toFixed(2))}M`;
  if (n >= 1000) return `${trimZeros((n / 1000).toFixed(1))}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Indian rupee amounts read in lakh/crore: 1800000 -> "18L", 12000000 -> "1.2Cr". */
function compactInr(n: number): string {
  if (n >= 9_995_000) return `${trimZeros((n / 1e7).toFixed(2))}Cr`;
  if (n >= 99_950) return `${trimZeros((n / 1e5).toFixed(1))}L`;
  return compact(n);
}

/**
 * Short display string, e.g. "$120k–$150k/yr", "£450/day", "From €60k/yr", "Up to $45/hr".
 *
 * Details: well-known currencies use their symbol ("CA$", "A$", "₹"), others the ISO code
 * ("CHF 120k–140k/yr"); amounts are compact ("142k", "63.8k", "1.2M", "28.50"), INR in lakh/crore
 * ("₹18L–₹25L/yr"). Missing or invalid numbers fall back to `text`, else "" — never "NaN"/"undefined".
 */
export function formatSalary(salary: Salary): string {
  if (!salary || typeof salary !== 'object') return '';
  const min = positive(salary.min);
  const max = positive(salary.max);
  const code = typeof salary.currency === 'string' && /^[A-Za-z]{3}$/.test(salary.currency) ? salary.currency.toUpperCase() : undefined;
  const sym = code ? DISPLAY_SYMBOL[code] : undefined;
  const prefix = !sym && code ? `${code} ` : '';
  const amount = (n: number): string => `${sym ?? ''}${code === 'INR' ? compactInr(n) : compact(n)}`;
  const suffix = salary.period && PERIODS.has(salary.period) ? PERIOD_SUFFIX[salary.period] : '';
  if (min !== undefined && max !== undefined) {
    const a = amount(min);
    const b = amount(max);
    return `${prefix}${a === b ? a : `${a}–${b}`}${suffix}`;
  }
  if (min !== undefined) return `From ${prefix}${amount(min)}${suffix}`;
  if (max !== undefined) return `Up to ${prefix}${amount(max)}${suffix}`;
  return typeof salary.text === 'string' ? salary.text.trim() : '';
}
