/**
 * A résumé as the review sees it: its lines grouped into sections, the bullets that describe
 * the work (with the job each belongs to), and what the profile's résumé parser reads from it
 * (contact details, dated jobs, education, years of experience).
 *
 * The parsing helpers are pure text functions owned by the profile feature; reusing them keeps
 * the review's reading of a résumé identical to the one the profile page shows.
 */
import type { ResumeAnalysis } from '../../../shared/types';
import { extractSkills } from '../../lib/skills';
import { foldText } from '../../lib/text';
import { analyzeResumeText } from '../profile/resume-analysis';
import { type SectionKind, headingKind, isBullet, stripBullet } from '../profile/resume-parse';
import { stemmedText, wordCount } from './text';

export interface ResumeLine {
  /** Index into `ResumeDoc.lines`. */
  index: number;
  /** Trimmed text with any bullet marker removed. */
  text: string;
  bullet: boolean;
  /** Set on a section heading line. */
  heading?: SectionKind;
  /** The section the line sits in ('header' before the first heading). */
  section: SectionKind;
}

export interface ResumeBullet {
  /** First and last line of the bullet (a wrapped bullet spans several lines). */
  start: number;
  end: number;
  text: string;
  /** The job line or section heading above the bullet. */
  context: string;
  section: SectionKind;
  stemmed: string;
}

export interface ResumeDoc {
  text: string;
  /** Every line of the text, blank ones included, as written. */
  lines: string[];
  /** Non-blank lines. */
  entries: ResumeLine[];
  /** Kinds of the headed sections present. */
  sections: Set<SectionKind>;
  /** Whether headings are written in capitals ("EXPERIENCE"), to match when adding sections. */
  capsHeadings: boolean;
  bullets: ResumeBullet[];
  analysis: ResumeAnalysis;
  /** Canonical skills named anywhere in the résumé. */
  skills: string[];
  skillSet: Set<string>;
  stemmed: string;
  stems: string[];
  stemSet: Set<string>;
  words: number;
}

/** Sections whose bullets describe work done (everything except lists of skills, schools and credentials). */
const NO_WORK_BULLETS = new Set<SectionKind>(['skills', 'education', 'certifications', 'summary']);
const WORK_SECTIONS = new Set<SectionKind>(['experience', 'projects']);
const MIN_SENTENCE_WORDS = 8;
const YEAR = /\b(19|20)\d{2}\b/;

/** A job header line ("Engineer, Acme (2020 – present)"): short and dated. */
const isDatedHeader = (text: string) => YEAR.test(text) && text.split(/\s+/).length <= 14;
const DATE_WORDS =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?|\b(19|20)\d{2}\b|\b\d{1,2}\/\d{2,4}\b|\b(present|current|now|today)\b|[–—\-|•·,()]/gi;
/** A line that is only a date range ("Mar 2021 – Present"): not a useful label for the bullets under it. */
const isDateOnly = (text: string) => YEAR.test(text) && text.replace(DATE_WORDS, ' ').trim().split(/\s+/).filter(Boolean).length <= 1;

export function parseResumeDoc(text: string, now: Date): ResumeDoc {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const entries: ResumeLine[] = [];
  const sections = new Set<SectionKind>();
  let section: SectionKind = 'header';
  let headings = 0;
  let capsHeadings = 0;
  for (const [index, raw] of lines.entries()) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const kind = headingKind(trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, ''));
    if (kind) {
      section = kind;
      sections.add(kind);
      headings++;
      if (/\p{Lu}{3}/u.test(trimmed) && trimmed === trimmed.toUpperCase()) capsHeadings++;
      entries.push({ index, text: trimmed.replace(/^#+\s*/, '').replace(/[*_]+/g, '').trim(), bullet: false, heading: kind, section });
      continue;
    }
    const bullet = isBullet(trimmed);
    entries.push({ index, text: bullet ? stripBullet(trimmed) : trimmed, bullet, section });
  }

  const bullets: ResumeBullet[] = [];
  let context = '';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.heading) {
      context = e.text;
      continue;
    }
    const sentence = WORK_SECTIONS.has(e.section) && !e.bullet && e.text.split(/\s+/).length >= MIN_SENTENCE_WORDS && !isDatedHeader(e.text);
    if ((!e.bullet && !sentence) || NO_WORK_BULLETS.has(e.section)) {
      if (!e.bullet && (!isDateOnly(e.text) || !context)) context = e.text;
      continue;
    }
    // PDF text often wraps a bullet onto lines that start in lower case: join them back.
    let end = i;
    let body = e.text;
    while (e.bullet) {
      const next = entries[end + 1];
      if (!next || next.bullet || next.heading || next.index !== entries[end]!.index + 1 || !/^\p{Ll}/u.test(next.text)) break;
      body = `${body} ${next.text}`;
      end++;
    }
    bullets.push({ start: e.index, end: entries[end]!.index, text: body, context, section: e.section, stemmed: stemmedText(body) });
    i = end;
  }

  const analysis = analyzeResumeText(text, { now });
  const skills = extractSkills(text);
  const stemmed = stemmedText(text);
  const stems = stemmed.trim().split(' ').filter(Boolean);
  return {
    text,
    lines,
    entries,
    sections,
    capsHeadings: headings > 0 && capsHeadings * 2 >= headings,
    bullets,
    analysis,
    skills,
    skillSet: new Set(skills.map(foldText)),
    stemmed,
    stems,
    stemSet: new Set(stems),
    words: wordCount(text),
  };
}
