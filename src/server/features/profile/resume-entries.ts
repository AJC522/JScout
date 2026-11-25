/** Experience and education entries from the matching résumé sections. */
import { randomUUID } from 'node:crypto';
import type { EducationEntry, ExperienceEntry } from '../../../shared/types';
import { resolvePlace } from '../../lib/location';
import { findRole } from '../../lib/titles';
import { type DateRange, findDateRanges, findSingleDate, formatDatePoint } from './resume-dates';
import { findPlace, isBullet, splitParts, stripBullet } from './resume-parse';

const TITLE_WORDS_RE =
  /\b(?:engineer|developer|programmer|architect|manager|director|analyst|scientist|designer|consultant|specialist|coordinator|administrator|assistant|associate|intern|nurse|accountant|auditor|bookkeeper|controller|teacher|tutor|lecturer|professor|researcher|technician|technologist|officer|representative|agent|advisor|adviser|lead|head|vp|vice president|president|founder|co-founder|owner|partner|clerk|cashier|barista|chef|cook|driver|operator|supervisor|executive|strategist|writer|editor|producer|marketer|recruiter|therapist|pharmacist|physician|paralegal|attorney|lawyer|counsel|electrician|mechanic|planner|buyer|trainer|instructor|coach|librarian|secretary|receptionist|aide|caregiver|rn|lpn|cna|cpa|devops|sre|qa|tester|scrum master|product owner|principal|staff|senior|junior|sr|jr)\b/i;
const COMPANY_WORDS_RE =
  /\b(?:inc|llc|ltd|limited|corp|corporation|company|co|gmbh|plc|llp|ag|bv|group|holdings|technologies|technology|labs|systems|solutions|partners|consulting|hospital|clinic|medical center|health|healthcare|university|college|school|institute|bank|capital|ventures|studios?|agency|foundation|council|department|ministry|services|industries|international|global|enterprises|networks|media|foods|pharmaceuticals|retail|restaurant|hotel|airlines|motors|energy|insurance|financial|logistics)\b|&/i;
const COMPANY_SUFFIX_RE = /^(?:inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|llp|lp|ag|sa|bv|pty ltd)\.?$/i;
const ABBREVIATION_END_RE = /\b(?:inc|co|ltd|corp|llc|jr|sr|st)\.$/i;

function endsLikeSentence(line: string): boolean {
  return /[!?;:]$/.test(line) || (line.endsWith('.') && !ABBREVIATION_END_RE.test(line));
}

/** A short line that could name a job title, employer or place (not a bullet or a sentence). */
function isHeaderLike(line: string): boolean {
  return !isBullet(line) && line.length <= 100 && !endsLikeSentence(line) && line.split(/\s+/).length <= 12 && !/^[a-z]{2}/.test(line);
}

function titleScore(s: string): number {
  return (TITLE_WORDS_RE.test(s) ? 2 : 0) + (findRole(s) ? 3 : 0) - (COMPANY_WORDS_RE.test(s) ? 1 : 0);
}

function companyScore(s: string): number {
  return (COMPANY_WORDS_RE.test(s) ? 2 : 0) - (TITLE_WORDS_RE.test(s) ? 1 : 0);
}

/** The line without the given span (a date), tidying the separators and brackets left behind. */
const cutSpan = (line: string, span: { index: number; length: number }) =>
  `${line.slice(0, span.index)} ${line.slice(span.index + span.length)}`
    .replace(/[([]\s*[)\]]/g, ' ')
    .replace(/^[\s,|–—-]+|[\s,|–—(-]+$/g, '')
    .trim();

const MIN_STANDALONE_CITY_POPULATION = 50_000;

/** "Berlin", "New York", "California": a piece that names a place on its own (not a code, title or employer). */
function standalonePlace(piece: string): boolean {
  if (piece.length < 3 || !/^\p{Lu}/u.test(piece) || /^[A-Z]{2,3}$/.test(piece) || piece.split(/\s+/).length > 3) return false;
  if (TITLE_WORDS_RE.test(piece) || COMPANY_WORDS_RE.test(piece)) return false;
  const place = resolvePlace(piece);
  if (!place) return false;
  if (place.kind === 'city') return (place.population ?? 0) >= MIN_STANDALONE_CITY_POPULATION;
  return place.kind === 'admin1' || place.kind === 'country';
}

/** "Zalando, Hamburg" read as an unknown town in the state of Hamburg. */
function unknownLocality(place: string): boolean {
  const resolved = resolvePlace(place);
  return resolved?.kind === 'admin1' && resolved.city !== undefined;
}

/**
 * The location at the end of a header part. In "Title, Company, City" the place is the last piece:
 * "Senior Engineer, Brightline Analytics, Berlin" must not become the town "Brightline Analytics" in the
 * state of Berlin (losing the employer), and "…, Acme Corp, London" must keep London.
 */
function headerPlace(part: string): { place: string; index: number } | undefined {
  const found = findPlace(part);
  const pieces = part.split(/,\s*/);
  const last = pieces.at(-1)!.trim();
  if (pieces.length >= 3 && (!found || unknownLocality(found.place)) && standalonePlace(last)) {
    return { place: last, index: part.lastIndexOf(last) };
  }
  return found;
}

/** Header text -> title/company candidates and a location. */
function headerParts(texts: string[]): { parts: string[]; location: string } {
  const parts: string[] = [];
  let location = '';
  for (const text of texts) {
    for (let part of splitParts(text)) {
      if (/^(?:remote|hybrid)$/i.test(part)) {
        location ||= part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        continue;
      }
      const place = headerPlace(part);
      if (place) {
        location ||= place.place;
        part = part.slice(0, place.index).replace(/[\s,]+$/, '');
      }
      const at = /\s(?:at|@)\s/.exec(part);
      const pieces = at ? [part.slice(0, at.index), part.slice(at.index + at[0].length)] : part.split(/,\s+/);
      for (const piece of pieces.map((p) => p.trim()).filter(Boolean)) {
        // "Acme, Inc." must stay one company.
        if (COMPANY_SUFFIX_RE.test(piece) && parts.length) parts[parts.length - 1] += `, ${piece}`;
        else parts.push(piece);
      }
    }
  }
  return { parts, location };
}

function assignTitleCompany(parts: string[]): { title: string; company: string } {
  const [first, ...others] = parts;
  if (first === undefined) return { title: '', company: '' };
  if (!others.length) return titleScore(first) >= companyScore(first) ? { title: first, company: '' } : { title: '', company: first };
  const titleScores = parts.map(titleScore);
  const companyScores = parts.map(companyScore);
  let ti = titleScores.indexOf(Math.max(...titleScores));
  if (titleScores[ti]! <= 0) {
    // No title evidence: if one part is clearly the employer, the title is the first other part; else "Title, Company".
    const ci = companyScores.indexOf(Math.max(...companyScores));
    ti = companyScores[ci]! > 0 ? (ci === 0 ? 1 : 0) : 0;
  }
  const rest = parts.map((_p, i) => i).filter((i) => i !== ti);
  const ci = rest.reduce((best, i) => (companyScores[i]! > companyScores[best]! ? i : best), rest[0]!);
  return { title: parts[ti]!, company: parts[ci]! };
}

function highlightsFrom(lines: string[]): string[] {
  const out: string[] = [];
  let previousIsBullet = false;
  for (const line of lines) {
    const bullet = isBullet(line);
    const text = stripBullet(line);
    if (!text || (findPlace(text)?.index === 0 && text.length < 60)) continue;
    const previous = out[out.length - 1];
    // A wrapped bullet: a plain line starting in lower case continues the bullet before it.
    if (!bullet && previous !== undefined && previousIsBullet && /^[a-z]/.test(text) && !/[.!?]$/.test(previous)) {
      out[out.length - 1] = `${previous} ${text}`.slice(0, 1000);
      continue;
    }
    out.push(text.slice(0, 1000));
    previousIsBullet = bullet;
  }
  return out.slice(0, 30);
}

export interface ParsedExperience {
  entry: ExperienceEntry;
  range: DateRange;
}

/**
 * Jobs in an experience section. Each line with a date range anchors one job; its title and
 * employer come from the rest of that line plus the short lines just before it (when the first
 * job's header precedes its dates) or just after it, and the lines up to the next job are highlights.
 */
export function parseExperience(lines: string[], now: Date): ParsedExperience[] {
  // A dated bullet or sentence ("Grew sales 30% in 2019 - 2020") is an achievement, not a job.
  const anchors = lines.flatMap((line, i) => {
    const range = isBullet(line) ? undefined : findDateRanges(line, now)[0];
    return range && cutSpan(line, range).split(/\s+/).length <= 14 ? [{ i, range }] : [];
  });
  const firstAnchor = anchors[0];
  if (!firstAnchor) return [];
  // The first job sets the layout: header lines before the dated line, or after it.
  let preCount = 0;
  for (let j = firstAnchor.i - 1; j >= 0 && preCount < 2 && isHeaderLike(lines[j]!); j--) preCount++;

  const headers: Array<{ from: number; to: number; texts: string[] }> = [];
  for (const [k, anchor] of anchors.entries()) {
    const previousEnd = headers[k - 1]?.to ?? -1;
    const nextAnchor = anchors[k + 1]?.i ?? lines.length;
    const texts: string[] = [];
    let from = anchor.i;
    for (let j = anchor.i - 1, taken = 0; taken < preCount && j > previousEnd && isHeaderLike(lines[j]!); j--, taken++) {
      texts.unshift(lines[j]!);
      from = j;
    }
    const remainder = cutSpan(lines[anchor.i]!, anchor.range);
    if (remainder) texts.push(remainder);
    let to = anchor.i;
    if (preCount === 0) {
      while (to + 1 < nextAnchor && to - anchor.i < 2 && headerParts(texts).parts.length < 2 && isHeaderLike(lines[to + 1]!)) {
        texts.push(lines[to + 1]!);
        to++;
      }
    }
    // A line holding only a place ("Austin, TX") right after the header belongs to it.
    const next = lines[to + 1];
    if (next !== undefined && to + 1 < nextAnchor && findPlace(next)?.index === 0 && next.length < 60) {
      texts.push(next);
      to++;
    }
    headers.push({ from, to, texts });
  }

  return anchors.map((anchor, k) => {
    const header = headers[k]!;
    const bodyEnd = headers[k + 1]?.from ?? lines.length;
    const { parts, location } = headerParts(header.texts);
    const { title, company } = assignTitleCompany(parts);
    const { range } = anchor;
    return {
      range,
      entry: {
        id: randomUUID(),
        title,
        company,
        location,
        start: formatDatePoint(range.start),
        end: range.current ? '' : formatDatePoint(range.end),
        current: range.current,
        summary: '',
        highlights: highlightsFrom(lines.slice(header.to + 1, bodyEnd)),
      },
    };
  });
}

// --- education ---------------------------------------------------------------------------

const SCHOOL_RE =
  /\b(?:university|college|institute|school|academy|polytechnic|conservatory|seminary|universidad|université|universität|università|hochschule|polytechnique)\b/i;
const SCHOOL_ABBREVIATION_RE = /\b(?:MIT|UCLA|NYU|USC|LSE|EPFL|ETH|IIT)\b/;
const OF_FIELD =
  "of\\s+(?:Business\\s+Administration|Fine\\s+Arts|Public\\s+Health|Social\\s+Work|Applied\\s+Science|Computer\\s+Applications|Science|Arts|Engineering|Education|Laws|Technology|Commerce|Nursing|Music|Architecture|Philosophy|Medicine|[A-Z][a-z]+)";
const DEGREE_RE = new RegExp(
  `(?<![\\p{L}.])(${[
    `Doctor(?:ate)?\\s+${OF_FIELD}`,
    "Master(?:'s|’s|s)?(?:\\s+" + OF_FIELD + '|\\s+[Dd]egree)?',
    "Bachelor(?:'s|’s|s)?(?:\\s+" + OF_FIELD + '|\\s+[Dd]egree)?',
    "Associate(?:'s|’s)?\\s+(?:" + OF_FIELD + '|[Dd]egree)',
    'High\\s+School\\s+Diploma',
    'Ph\\.?\\s?D\\.?',
    'Ed\\.?D\\.?',
    'D\\.?N\\.?P\\.?',
    'Pharm\\.?D\\.?',
    'M\\.?B\\.?A\\.?',
    'B\\.?S\\.?N\\.?',
    'M\\.?S\\.?N\\.?',
    'B\\.?B\\.?A\\.?',
    'B\\.?F\\.?A\\.?',
    'M\\.?F\\.?A\\.?',
    'M\\.?P\\.?H\\.?',
    'A\\.?A\\.?S\\.?',
    'B\\.?\\s?Sc\\.?',
    'M\\.?\\s?Sc\\.?',
    'B\\.?\\s?Eng\\.?',
    'M\\.?\\s?Eng\\.?',
    'B\\.?\\s?Tech\\.?',
    'M\\.?\\s?Tech\\.?',
    'B\\.?\\s?Com\\.?',
    'M\\.?\\s?Ed\\.?',
    'LL\\.?B\\.?',
    'LL\\.?M\\.?',
    'B\\.?S\\.?',
    'B\\.?A\\.?',
    'M\\.?S\\.?',
    'M\\.?A\\.?',
    'A\\.?S\\.?',
    'A\\.?A\\.?',
    'J\\.?D\\.?',
    'M\\.?D\\.?',
    'Diploma',
    'Certificate',
    'GED',
  ].join('|')})(?![\\p{L}])`,
  'u',
);

/** The field of study after a degree: "in Computer Science, GPA 3.8" -> "Computer Science". */
function cleanField(raw: string): string {
  const field = raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^[\s,:;–—-]*(?:(?:in|of)\s+)?/i, '')
    .split(/\b(?:GPA|grade|honou?rs|cum laude|magna|summa|with distinction|first class|minor|concentration)\b/i)[0]!
    .replace(/[\s,;:–—-]+$/, '')
    .trim();
  return field.length <= 100 && !/\d/.test(field) ? field : '';
}

/** Schools and degrees in an education section, one entry per school or degree. */
export function parseEducation(lines: string[], now: Date): EducationEntry[] {
  const entries: EducationEntry[] = [];
  let current: EducationEntry | undefined;
  let pendingDates: { start: string; end: string } | undefined;

  for (const raw of lines) {
    let rest = stripBullet(raw);
    let dates: { start: string; end: string } | undefined;
    const range = findDateRanges(rest, now)[0];
    const single = range ? undefined : findSingleDate(rest, now);
    if (range) {
      dates = { start: formatDatePoint(range.start), end: range.current ? '' : formatDatePoint(range.end) };
      rest = cutSpan(rest, range);
    } else if (single) {
      dates = { start: '', end: formatDatePoint(single) };
      rest = cutSpan(rest, single);
    }
    rest = rest.replace(/\b(?:expected|anticipated|graduated|graduation|class of)\b:?/gi, ' ').trim();
    const place = findPlace(rest);
    if (place) rest = rest.slice(0, place.index);
    const parts = rest
      .split(/,\s+|\s*[|•·]\s*|\t+|\s{2,}|\s[–—-]\s/)
      .map((p) => p.trim())
      .filter(Boolean);

    const school = parts.find((p) => SCHOOL_RE.test(p) || SCHOOL_ABBREVIATION_RE.test(p)) ?? '';
    let degree = '';
    let field = '';
    for (let k = 0; k < parts.length && !degree; k++) {
      const part = parts[k]!;
      const m = part === school ? null : DEGREE_RE.exec(part);
      if (!m) continue;
      degree = m[1]!.trim();
      field = cleanField(part.slice(m.index + m[0].length));
      const next = parts[k + 1];
      if (!field && next !== undefined && next !== school) field = cleanField(next);
    }

    if (!school && !degree) {
      // Only a line holding nothing but dates is trusted to date the entry ("Dean's List 2016" is not).
      if (dates && !/\p{L}/u.test(rest)) {
        if (current && !current.start && !current.end) Object.assign(current, dates);
        else if (!current) pendingDates = dates;
      }
      continue;
    }
    if (!current || (school && current.school) || (degree && current.degree)) {
      current = { id: randomUUID(), school: '', degree: '', field: '', start: '', end: '', ...pendingDates };
      pendingDates = undefined;
      entries.push(current);
    }
    if (school) current.school = school;
    if (degree) {
      current.degree = degree;
      current.field ||= field;
    }
    if (dates && !current.start && !current.end) Object.assign(current, dates);
  }
  return entries.slice(0, 10);
}
