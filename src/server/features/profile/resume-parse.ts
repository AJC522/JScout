/** Résumé text structure (sections, bullets) and contact details. Precision over recall: when unsure, return nothing. */
import type { ResumeAnalysis } from '../../../shared/types';
import { resolvePlace } from '../../lib/location';
import { normalizeLink } from './normalize';

export type SectionKind = 'header' | 'experience' | 'education' | 'skills' | 'summary' | 'certifications' | 'projects' | 'other';

export interface Section {
  kind: SectionKind;
  heading: string;
  /** Non-empty, trimmed lines after the heading. */
  lines: string[];
}

const HEADINGS: Array<[SectionKind, string[]]> = [
  [
    'experience',
    [
      'experience', 'work experience', 'professional experience', 'relevant experience', 'employment', 'employment history',
      'work history', 'career history', 'professional history', 'career experience', 'positions held', 'clinical experience',
      'teaching experience', 'industry experience', 'professional background', 'experience highlights', 'nursing experience',
      'relevant work experience', 'professional employment',
    ],
  ],
  [
    'education',
    [
      'education', 'education and training', 'education and certifications', 'education and qualifications', 'academic background',
      'academic history', 'academics', 'academic qualifications', 'educational background', 'education and credentials',
    ],
  ],
  [
    'skills',
    [
      'skills', 'technical skills', 'key skills', 'core skills', 'core competencies', 'competencies', 'areas of expertise', 'expertise',
      'skills and tools', 'tools and technologies', 'technologies', 'technical proficiencies', 'skills summary', 'skills and abilities',
      'skills and interests', 'tools',
    ],
  ],
  [
    'summary',
    [
      'summary', 'professional summary', 'career summary', 'profile', 'professional profile', 'about', 'about me', 'objective',
      'career objective', 'summary of qualifications', 'qualifications summary', 'personal statement', 'executive summary',
    ],
  ],
  ['certifications', ['certifications', 'certification', 'licenses', 'licensure', 'licenses and certifications', 'certifications and licenses', 'certificates', 'credentials']],
  ['projects', ['projects', 'personal projects', 'selected projects', 'side projects', 'key projects', 'academic projects']],
  [
    'other',
    [
      'awards', 'honors', 'honors and awards', 'awards and honors', 'publications', 'presentations', 'volunteer', 'volunteering',
      'volunteer experience', 'community involvement', 'interests', 'hobbies', 'languages', 'references', 'activities',
      'affiliations', 'memberships', 'professional affiliations', 'professional memberships', 'courses', 'training',
      'additional information', 'leadership', 'extracurricular activities', 'patents', 'additional',
    ],
  ],
];

const HEADING_KINDS = new Map<string, SectionKind>(HEADINGS.flatMap(([kind, names]) => names.map((n) => [n, kind] as const)));

/** The heading a line represents, e.g. "PROFESSIONAL EXPERIENCE:" or "## Work History" or "E X P E R I E N C E". */
export function headingKind(line: string): SectionKind | undefined {
  if (line.length > 50) return undefined;
  let s = line.replace(/^#+\s*/, '').replace(/[*_=~]+/g, ' ').trim();
  // Letter-spaced headings: "E X P E R I E N C E".
  if (/^(?:\p{L} ){3,}\p{L}$/u.test(s)) s = s.replace(/ /g, '');
  s = s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s.split(' ').length > 5) return undefined;
  return HEADING_KINDS.get(s);
}

export function splitSections(text: string): Section[] {
  const sections: Section[] = [{ kind: 'header', heading: '', lines: [] }];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const kind = headingKind(line);
    if (kind) sections.push({ kind, heading: line, lines: [] });
    else sections[sections.length - 1]!.lines.push(line);
  }
  return sections;
}

const BULLET_RE = /^(?:[•●○◦▪▫■□‣⁃∙·➢➤►✓✔]\s*|[-*–—]\s+|\d{1,2}[.)]\s+)/;

export const isBullet = (line: string) => BULLET_RE.test(line);
export const stripBullet = (line: string) => line.replace(BULLET_RE, '').trim();

/** Splits a header line into its parts: tabs, runs of spaces, pipes, bullets and spaced dashes separate them. */
export function splitParts(line: string): string[] {
  return line
    .split(/\t+|\s{2,}|\s*[|•·]\s*|\s[–—-]\s|\s[–—]|[–—]\s/)
    .map((p) => p.trim().replace(/^[,;:]+|[,;:]+$/g, '').trim())
    .filter(Boolean);
}

// --- location ---------------------------------------------------------------------

const REGION_CODES = new Set(
  (
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD ' +
    'TN TX UT VT VA WA WV WI WY DC PR AB BC MB NB NL NS NT NU ON PE QC SK YT'
  ).split(' '),
);

/** Words that mean a "City, Region"-shaped string is something else (a school, a company, a job). */
export const NOT_A_PLACE_RE =
  /\b(?:university|college|institute|school|academy|inc|llc|ltd|corp|company|group|hospital|clinic|bank|engineer|developer|manager|analyst|nurse|accountant|designer|director|intern|assistant|specialist|consultant|officer|technician|teacher|software|senior|junior|street|st|avenue|ave|road|rd|suite|apt|floor)\b/i;

const CITY = "\\p{Lu}[\\p{L}.'’-]*(?:\\s(?:\\p{Lu}[\\p{L}.'’-]*|de|del|la|le|upon|on|am|im|sur))*";
const PLACE_RE = new RegExp(`(?:^|[,\\s])(${CITY}),\\s*([A-Z]{2}|\\p{Lu}\\p{L}+(?:\\s\\p{Lu}\\p{L}+){0,2})(?:\\s+[A-Z0-9]{3,5}(?:[\\s-][A-Z0-9]{3,4})?)?$`, 'du');

/**
 * A "City, ST" or "City, Country" location at the end of `text` (a postcode after it is ignored),
 * with the position where it starts.
 * US states and Canadian provinces are recognised directly; anything else must resolve in the gazetteer.
 */
export function findPlace(text: string): { place: string; index: number } | undefined {
  const m = PLACE_RE.exec(text);
  if (!m) return undefined;
  const city = m[1]!;
  const region = m[2]!;
  if (city.split(/\s+/).length > 4 || NOT_A_PLACE_RE.test(city) || NOT_A_PLACE_RE.test(region)) return undefined;
  const place = `${city}, ${region}`;
  if (!REGION_CODES.has(region)) {
    const resolved = resolvePlace(place);
    if (!resolved || (resolved.kind !== 'city' && resolved.kind !== 'admin1')) return undefined;
  }
  return { place, index: m.indices?.[1]?.[0] ?? m.index };
}

// --- contact ----------------------------------------------------------------------------

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,24}/i;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[\w%-]+\/?/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/(?!(?:orgs|features|about|topics|sponsors|marketplace|settings)\b)[A-Za-z0-9][A-Za-z0-9-]{0,38}(?![\w-])/i;
const WEBSITE_RE =
  /(?<![\w@.-])(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|dev|me|co|app|ai|tech|design|site|page|info|xyz|blog|online|studio|uk|de|ca|au|nl|fr|es|it|ch|se|no|dk|fi|ie|nz|us)(?:\/[^\s|,;)]*)?(?![\w.-])/gi;
const PHONE_CANDIDATE_RE = /(?:\+|\(|(?<![\w/.-]))\d[\d\s().-]{5,20}\d(?![\w/])/g;
const PHONE_LABEL_RE = /\b(?:phone|tel|telephone|mobile|cell|mob)\b/i;

function phoneIn(line: string): string | undefined {
  for (const m of line.matchAll(PHONE_CANDIDATE_RE)) {
    const candidate = m[0].trim();
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) continue;
    if (/^(?:19|20)\d{2}\s*-\s*(?:19|20)\d{2}$/.test(candidate)) continue; // a year range
    if (/^\d{5}-\d{4}$/.test(candidate)) continue; // ZIP+4
    if (/^\d{1,4}[./-]\d{1,2}[./-]\d{2,4}$/.test(candidate)) continue; // a date
    if ((candidate.match(/\(/g) ?? []).length !== (candidate.match(/\)/g) ?? []).length) continue;
    const plus = candidate.startsWith('+');
    if (digits.length >= 10 || (plus && digits.length >= 8) || (PHONE_LABEL_RE.test(line) && digits.length >= 7)) return candidate;
  }
  return undefined;
}

const NAME_PARTICLES = new Set(['de', 'da', 'del', 'della', 'der', 'den', 'di', 'du', 'la', 'le', 'van', 'von', 'bin', 'binti', 'al', 'y', 'dos', 'das']);
const NOT_A_NAME_RE =
  /\b(?:resume|résumé|curriculum|vitae|cv|profile|summary|contact|objective|experience|education|skills|engineer|developer|manager|analyst|nurse|accountant|designer|consultant|director|specialist|coordinator|assistant|intern|scientist|professional|technician|teacher|officer|representative|university|college|inc|llc|street|avenue|road|portfolio|page)\b/i;
const CREDENTIALS_RE = /,?\s+\b(?:RN|BSN|MSN|CPA|CFA|PMP|MBA|PhD|Ph\.D\.|MD|JD|PE|CNA|LPN|NP|DNP|PharmD|CPHQ|SHRM-CP|ACCA|CA)\b\.?$/;

function titleCaseWord(word: string): string {
  return word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** The first line as a personal name ("Jane Doe", "JOSÉ M. GARCÍA-LÓPEZ, RN"), or undefined when it does not look like one. */
export function nameFromLine(line: string): string | undefined {
  let candidate = (line.split(/\s*[|•·]\s*|\t|\s{2,}|\s[–—-]\s/)[0] ?? '').trim();
  while (CREDENTIALS_RE.test(candidate)) candidate = candidate.replace(CREDENTIALS_RE, '').trim();
  candidate = candidate.replace(/,$/, '');
  if (!candidate || /[\d@/\\:;,()]/.test(candidate) || NOT_A_NAME_RE.test(candidate)) return undefined;
  const words = candidate.split(/\s+/);
  if (words.length < 2 || words.length > 4) return undefined;
  let named = 0;
  for (const w of words) {
    if (NAME_PARTICLES.has(w)) continue;
    if (!/^\p{Lu}(?:[\p{L}'’-]*\p{L})?\.?$/u.test(w)) return undefined;
    if (w.length > 2 || !w.endsWith('.')) named++;
  }
  if (named < 2) return undefined;
  const allCaps = candidate === candidate.toUpperCase();
  return allCaps ? words.map((w) => (NAME_PARTICLES.has(w.toLowerCase()) ? w.toLowerCase() : titleCaseWord(w))).join(' ') : candidate;
}

const TOP_LINES = 12;

/** Contact details from the top of the résumé (email and profile links from anywhere). */
export function extractContact(sections: Section[], text: string): ResumeAnalysis['contact'] {
  const contact: ResumeAnalysis['contact'] = {};
  const allLines = sections.flatMap((s) => (s.kind === 'header' ? s.lines : [s.heading, ...s.lines]));
  const top = allLines.slice(0, TOP_LINES);

  const firstLine = top.find((l) => !/^(?:résumé|resume|curriculum vitae|cv)$/i.test(l));
  const name = firstLine ? nameFromLine(firstLine) : undefined;
  if (name) contact.fullName = name;

  const email = EMAIL_RE.exec(text)?.[0];
  if (email) contact.email = email.toLowerCase();

  const phone = top.map(phoneIn).find(Boolean) ?? allLines.filter((l) => PHONE_LABEL_RE.test(l)).map(phoneIn).find(Boolean);
  if (phone) contact.phone = phone;

  const linkedin = LINKEDIN_RE.exec(text)?.[0];
  if (linkedin) contact.linkedin = normalizeLink(linkedin.replace(/\/$/, '')) ?? undefined;
  const github = GITHUB_RE.exec(text)?.[0];
  if (github) contact.github = normalizeLink(github) ?? undefined;

  const topText = top.join('\n').replace(new RegExp(EMAIL_RE.source, 'gi'), ' ');
  for (const m of topText.matchAll(WEBSITE_RE)) {
    const url = m[0].replace(/[.)]+$/, '');
    const explicit = /^(?:https?:\/\/|www\.)/i.test(url);
    if (/linkedin\.com|github\.com/i.test(url) || (!explicit && url !== url.toLowerCase())) continue;
    const link = normalizeLink(url);
    if (link) {
      contact.website = link;
      break;
    }
  }

  for (const line of top.slice(0, 8)) {
    const found = splitParts(line.replace(new RegExp(EMAIL_RE.source, 'gi'), ' '))
      .map((part) => findPlace(part))
      .find(Boolean);
    if (found) {
      contact.location = found.place;
      break;
    }
  }
  for (const key of Object.keys(contact) as Array<keyof typeof contact>) if (!contact[key]) delete contact[key];
  return contact;
}
