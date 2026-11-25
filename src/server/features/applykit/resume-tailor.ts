/**
 * A tailored résumé draft made without AI. Only changes that keep every fact intact are made:
 *
 *  - weak bullet openers become action verbs ("Responsible for managing…" -> "Managed…");
 *  - under each job, the bullets most related to the posting move to the top;
 *  - skills the posting asks for move to the front of the skills section, and posting skills
 *    the profile lists (but the résumé doesn't) are added;
 *  - a résumé without a summary gets one, from the profile's own summary or from its titles,
 *    years and matching skills.
 *
 * Everything else (the user's wording, dates, employers, numbers) is left exactly as written.
 */
import { extractSkills } from '../../lib/skills';
import { foldText, uniqueFolded } from '../../lib/text';
import type { JobContext, ProfileContext } from './context';
import type { ResumeBullet, ResumeDoc, ResumeLine } from './resume-doc';
import { type BulletInsight, REORDER_GAIN, type ResumeAnalysisDetail, bulletGroups, draftSummary } from './resume-review';
import { containsPhrase, listPhrase, phraseKey, stemmedText } from './text';

export interface TailorResult {
  content: string;
  changes: string[];
}

const BULLET_PREFIX = /^\s*(?:[•●○◦▪▫■□‣⁃∙·➢➤►✓✔]\s*|[-*–—]\s+|\d{1,2}[.)]\s+)?/;
const MAX_NEW_SKILLS_LINE = 15;
const SEPARATORS = [',', '|', '•', '·', ';'] as const;

interface Edits {
  /** Lines start..end replaced by `lines`. */
  replace: Map<number, { end: number; lines: string[] }>;
  /** Lines inserted before a line index (lines.length = at the end). */
  insert: Map<number, string[]>;
}

function insertAt(edits: Edits, index: number, lines: string[]) {
  edits.insert.set(index, [...(edits.insert.get(index) ?? []), ...lines]);
}

function bulletLines(doc: ResumeDoc, insight: BulletInsight): string[] {
  const { bullet, review } = insight;
  if (!review.rewrite) return doc.lines.slice(bullet.start, bullet.end + 1);
  const prefix = BULLET_PREFIX.exec(doc.lines[bullet.start]!)?.[0] ?? '';
  return [`${prefix}${review.rewrite}`];
}

/** Contiguous runs of a job's bullets (a blank or other line between bullets ends a run). */
function contiguousRuns(group: BulletInsight[]): BulletInsight[][] {
  const runs: BulletInsight[][] = [];
  for (const insight of group) {
    const run = runs.at(-1);
    const prev = run?.at(-1);
    if (run && prev && insight.bullet.start === prev.bullet.end + 1) run.push(insight);
    else runs.push([insight]);
  }
  return runs;
}

function tailorBullets(doc: ResumeDoc, insights: BulletInsight[], edits: Edits) {
  const rewritten: BulletInsight[] = [];
  const reordered: string[] = [];
  const handled = new Set<ResumeBullet>();
  for (const group of bulletGroups(insights)) {
    for (const run of contiguousRuns(group)) {
      if (run.length < 2) continue;
      const best = Math.max(...run.map((r) => r.review.relevance));
      if (best - run[0]!.review.relevance < REORDER_GAIN) continue;
      // Quarter-point buckets keep near-ties in the user's own order.
      const sorted = run
        .map((insight, i) => ({ insight, i, bucket: Math.round(insight.review.relevance * 4) }))
        .sort((a, b) => b.bucket - a.bucket || a.i - b.i)
        .map((x) => x.insight);
      edits.replace.set(run[0]!.bullet.start, { end: run.at(-1)!.bullet.end, lines: sorted.flatMap((s) => bulletLines(doc, s)) });
      for (const r of run) {
        handled.add(r.bullet);
        if (r.review.rewrite) rewritten.push(r);
      }
      reordered.push(run[0]!.bullet.context);
    }
  }
  for (const insight of insights) {
    if (handled.has(insight.bullet) || !insight.review.rewrite) continue;
    edits.replace.set(insight.bullet.start, { end: insight.bullet.end, lines: bulletLines(doc, insight) });
    rewritten.push(insight);
  }
  return { rewritten, reordered: uniqueFolded(reordered.filter(Boolean)) };
}

/** "Languages: TypeScript, Go, SQL" -> label "Languages: ", items, separator ", ". */
function splitList(text: string): { label: string; items: string[]; sep: string } | undefined {
  const labelled = /^([^:,|]{1,30}:\s*)(.+)$/.exec(text);
  const label = labelled?.[1] ?? '';
  const body = labelled?.[2] ?? text;
  const sep = SEPARATORS.map((s) => ({ s, n: body.split(s).length - 1 })).sort((a, b) => b.n - a.n)[0]!;
  if (sep.n < 2) return undefined;
  const items = body.split(sep.s).map((i) => i.trim()).filter(Boolean);
  return { label, items, sep: sep.s === ',' || sep.s === ';' ? `${sep.s} ` : ` ${sep.s} ` };
}

function tailorSkills(doc: ResumeDoc, detail: ResumeAnalysisDetail, job: JobContext, edits: Edits, heading: (name: string) => string) {
  const jobSkills = new Set(job.skills.map(foldText));
  const jobText = stemmedText(`${job.title}\n${job.descriptionText}`);
  const relevant = (item: string) =>
    extractSkills(item).some((s) => jobSkills.has(foldText(s))) || containsPhrase(jobText, phraseKey(item.replace(/\(.*?\)/g, '')));
  const toAdd = detail.review.skillsInProfileOnly;
  const entries = doc.entries.filter((e) => e.section === 'skills' && !e.heading);
  const movedUp: string[] = [];

  if (entries.length === 0) {
    const list = uniqueFolded([...detail.skillsMatched, ...toAdd, ...doc.skills]).slice(0, MAX_NEW_SKILLS_LINE);
    if (list.length === 0) return { movedUp, added: [] as string[], created: [] as string[] };
    const anchor = doc.entries.find((e) => e.heading && e.heading !== 'summary' && e.heading !== 'header');
    const block = [heading('Skills'), list.join(', '), ''];
    insertAt(edits, anchor ? anchor.index : doc.lines.length, anchor ? block : ['', ...block]);
    return { movedUp, added: [], created: list };
  }

  // Lists on a line: relevant items first.
  for (const entry of entries) {
    if (edits.replace.has(entry.index)) continue;
    const list = splitList(entry.text);
    if (!list || list.items.length < 3) continue;
    const first = list.items.filter(relevant);
    if (first.length === 0 || first.length === list.items.length) continue;
    const ordered = [...first, ...list.items.filter((i) => !relevant(i))];
    if (ordered.every((item, i) => item === list.items[i])) continue;
    const raw = doc.lines[entry.index]!;
    const prefix = entry.bullet ? (BULLET_PREFIX.exec(raw)?.[0] ?? '') : (/^\s*/.exec(raw)?.[0] ?? '');
    edits.replace.set(entry.index, { end: entry.index, lines: [`${prefix}${list.label}${ordered.join(list.sep)}`] });
    movedUp.push(...first);
  }
  // One skill per bullet: relevant bullets first within each contiguous run.
  const singles = entries.filter((e) => e.bullet && !splitList(e.text));
  const runs: ResumeLine[][] = [];
  for (const e of singles) {
    const run = runs.at(-1);
    if (run && run.at(-1)!.index + 1 === e.index) run.push(e);
    else runs.push([e]);
  }
  for (const run of runs) {
    if (run.length < 2) continue;
    const first = run.filter((e) => relevant(e.text));
    if (first.length === 0 || first.length === run.length) continue;
    const ordered = [...first, ...run.filter((e) => !relevant(e.text))];
    if (ordered.every((e, i) => e === run[i])) continue;
    edits.replace.set(run[0]!.index, { end: run.at(-1)!.index, lines: ordered.map((e) => doc.lines[e.index]!) });
    movedUp.push(...first.map((e) => e.text));
  }

  if (toAdd.length > 0) {
    const last = entries.at(-1)!;
    const prefix = BULLET_PREFIX.exec(doc.lines[last.index]!)?.[0] ?? '';
    const lines = last.bullet && singles.length > 0 ? toAdd.map((s) => `${prefix}${s}`) : [`${prefix}Additional skills: ${toAdd.join(', ')}`];
    insertAt(edits, last.index + 1, lines);
  }
  return { movedUp: uniqueFolded(movedUp), added: toAdd, created: [] as string[] };
}

/** Where a new summary goes: before the first heading, or after the name and contact lines. */
function summaryPosition(doc: ResumeDoc): number {
  const firstHeading = doc.entries.find((e) => e.heading);
  if (firstHeading) return firstHeading.index;
  const { contact } = doc.analysis;
  const contactBits = [contact.email, contact.phone, contact.linkedin, contact.github, contact.website].filter((c): c is string => Boolean(c));
  const top: ResumeLine[] = [];
  for (const e of doc.entries.slice(0, 6)) {
    if (e.bullet || /\b(19|20)\d{2}\b/.test(e.text)) break;
    top.push(e);
  }
  const isContact = (e: ResumeLine) => /@|https?:|www\.|linkedin|github/i.test(e.text) || contactBits.some((c) => e.text.includes(c.replace(/^https?:\/\//, '')));
  const lastContact = top.filter(isContact).at(-1);
  if (lastContact) return lastContact.index + 1;
  // Just the name on the first line, or no recognisable header at all.
  return contact.fullName && top[0] ? top[0].index + 1 : 0;
}

function render(doc: ResumeDoc, edits: Edits): string {
  const out: string[] = [];
  for (let i = 0; i <= doc.lines.length; i++) {
    out.push(...(edits.insert.get(i) ?? []));
    if (i === doc.lines.length) break;
    const replacement = edits.replace.get(i);
    if (replacement) {
      out.push(...replacement.lines);
      i = replacement.end;
    } else out.push(doc.lines[i]!);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const short = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

export function tailorResume(doc: ResumeDoc, detail: ResumeAnalysisDetail, job: JobContext, me: ProfileContext): TailorResult {
  const edits: Edits = { replace: new Map(), insert: new Map() };
  const heading = (name: string) => (doc.capsHeadings ? name.toUpperCase() : name);
  const changes: string[] = [];

  const bullets = tailorBullets(doc, detail.bullets, edits);
  const skills = tailorSkills(doc, detail, job, edits, heading);

  if (!doc.sections.has('summary')) {
    const strengths = uniqueFolded([
      ...detail.skillsMatched,
      ...detail.keywords.filter((k) => (k.kind === 'phrase' || k.kind === 'name') && k.present && k.weight >= 0.4).map((k) => k.term),
    ]);
    const summary = draftSummary(detail.facts, me, strengths);
    if (summary) {
      insertAt(edits, summaryPosition(doc), [heading('Summary'), summary, '']);
      changes.push(
        me.profile.work.summary.trim()
          ? 'Added a summary at the top, taken from your profile. Adjust it to speak to this job.'
          : 'Added a summary at the top from your job title, years and the skills this posting asks for. Rewrite it in your own voice.',
      );
    }
  }
  if (bullets.rewritten.length > 0) {
    const example = bullets.rewritten[0]!.review;
    changes.push(
      `Rewrote ${bullets.rewritten.length === 1 ? 'a bullet' : `${bullets.rewritten.length} bullets`} to start with an action verb (for example “${short(example.text)}” → “${short(example.rewrite!)}”).`,
    );
  }
  if (bullets.reordered.length > 0) {
    changes.push(`Moved the bullets most related to this posting to the top under ${listPhrase(bullets.reordered.map((c) => `“${short(c, 50)}”`))}.`);
  }
  if (skills.movedUp.length > 0) changes.push(`Put the skills this posting asks for first in your skills section (${listPhrase(skills.movedUp.slice(0, 5))}).`);
  if (skills.created.length > 0) changes.push(`Added a skills section: ${skills.created.join(', ')}. Remove anything you wouldn't want to be asked about.`);
  if (skills.added.length > 0) {
    changes.push(`Added ${listPhrase(skills.added)} from your profile to your skills section. Keep only what you can back up in an interview.`);
  }
  if (changes.length === 0) {
    changes.push('Your résumé already leads with what this posting asks for, so no automatic changes were needed. The recommendations list the edits only you can make.');
  }
  return { content: render(doc, edits), changes };
}
