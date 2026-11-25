/**
 * The address a posting takes applications at, when it says to apply by email ("Send your résumé to
 * jobs@acme.com", "Interested? Email jane@acme.com", a mailto: link). Addresses for other things
 * are left alone: accommodation requests, privacy, fraud reports, press, benefits questions.
 */
import type { ApplyEmail } from '../../shared/types';
import { htmlToText } from './html';
import { truncate } from './text';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
const MAILTO = /href\s*=\s*["']mailto:([^"'?#\s]+)(?:\?([^"'#]*))?["']/gi;

/** Says outright that applications go to this address. */
const EXPLICIT =
  /\b(?:to apply|apply (?:by|via|through) e-?mail|apply by sending|send (?:us |me )?(?:your|a|an|the)?\s*(?:updated |current )?(?:resume|résumé|cv|application|cover letter)s?|e-?mail (?:us |me )?(?:your|a|an)\s*(?:resume|résumé|cv|application|cover letter)s?|applications? (?:should|must|can|may|will) be (?:sent|e-?mailed|submitted)|submit (?:your )?(?:resume|résumé|cv|application)s? (?:to|by e-?mail|via e-?mail))\b/i;
const ABOUT_APPLYING = /\b(?:apply|applying|application|applications|applicants?|resume|résumé|cv|cover letter|portfolio|interested|interest)\b/i;
const VERB_BEFORE = /\b(?:e-?mail|send|write to|reach out|reach|contact|apply|drop (?:me|us) a line)\b[^.@]{0,40}$/i;
/** Addresses in sentences about something else. */
const OTHER_PURPOSE =
  /\b(?:accommodat\w*|disabilit\w*|accessib\w*|privacy|personal data|data protection|gdpr|ccpa|unsubscribe|fraud\w*|scam\w*|phishing|vulnerabilit\w*|security (?:issue|concern)|press|media inquir\w*|investors?|billing|benefits question|no (?:recruiters|agencies)|recruiters? (?:and|or) agencies|do not (?:e-?mail|contact|send)|equal (?:employment )?opportunity)\b/i;
const OTHER_LOCAL = /^(?:no-?reply|do-?not-?reply|donotreply|privacy|accommodations?|accessibility|legal|press|media|abuse|security|benefits|payroll|billing|support|help|ir|investors?|dpo|gdpr|unsubscribe)$/i;
const JOBS_LOCAL = /^(?:jobs?|careers?|hiring|recruit\w*|talent\w*|hr|apply|applications?|join\w*|work|people|team|resumes?|cv)$/i;
const SUBJECT = /\bsubject(?: line)?\s*(?:of|:|as|reading|should be|should read|with|line:)?\s*["“'‘]([^"”'’\n]{3,100})["”'’]/i;
const SUBJECT_PLAIN = /\bsubject(?: line)?\s*:\s*([^.\n]{3,100}?)(?:[.\n]|$)/i;

const EVIDENCE_CHARS = 220;

interface Candidate {
  address: string;
  sentence: string;
  score: number;
  explicit: boolean;
  subject?: string;
}

/** The sentence an address sits in (full stops inside addresses don't end it). */
function sentenceAround(text: string, index: number): string {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const lineEnd = text.indexOf('\n', index);
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  // Same length, so offsets carry over: "jobs@acme.com" keeps its dots out of the sentence split.
  const masked = line.replace(EMAIL, (m) => m.replace(/\./g, '\u2024'));
  const at = index - lineStart;
  let start = 0;
  for (const m of masked.slice(0, at).matchAll(/[.!?]\s+/g)) start = m.index + m[0].length;
  const end = /[.!?](?:\s|$)/.exec(masked.slice(at));
  return line.slice(start, end ? at + end.index + 1 : undefined).trim();
}

function subjectHint(...texts: Array<string | undefined>): string | undefined {
  for (const t of texts) {
    if (!t) continue;
    const m = SUBJECT.exec(t) ?? SUBJECT_PLAIN.exec(t);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

function sameLineBefore(text: string, index: number): string {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  return text.slice(Math.max(lineStart, index - 120), index);
}

/** The address applications go to, when the posting says to apply by email. */
export function findApplyEmail(descriptionHtml: string, descriptionText: string): ApplyEmail | undefined {
  const candidates: Candidate[] = [];
  const linked = new Map<string, string | undefined>();
  for (const m of descriptionHtml.matchAll(MAILTO)) {
    let address = m[1]!;
    try {
      address = decodeURIComponent(address);
    } catch {
      /* keep as written */
    }
    let subject: string | undefined;
    if (m[2]) {
      try {
        subject = new URLSearchParams(m[2].replace(/&amp;/g, '&')).get('subject')?.trim() || undefined;
      } catch {
        /* no usable subject */
      }
    }
    linked.set(address.toLowerCase(), subject);
  }

  for (const m of descriptionText.matchAll(EMAIL)) {
    const address = m[0].replace(/[.]+$/, '');
    const [local = '', domain = ''] = address.split('@');
    if (OTHER_LOCAL.test(local) || /\.(?:png|jpe?g|gif|svg|webp)$/i.test(domain)) continue;
    const sentence = sentenceAround(descriptionText, m.index);
    if (OTHER_PURPOSE.test(sentence)) continue;
    const before = descriptionText.slice(Math.max(0, m.index - 60), m.index);
    const explicit = EXPLICIT.test(sentence);
    let score = 0;
    if (explicit) score += 3;
    // "Interested? Email jane@acme.com": the cue can be in the sentence before, on the same line.
    else if (ABOUT_APPLYING.test(sentence) || ABOUT_APPLYING.test(sameLineBefore(descriptionText, m.index))) score += 2;
    if (VERB_BEFORE.test(before)) score += 1;
    if (JOBS_LOCAL.test(local)) score += 1;
    const key = address.toLowerCase();
    if (linked.has(key)) score += 1;
    const next = descriptionText.slice(m.index, m.index + 200);
    candidates.push({ address, sentence, score, explicit, subject: linked.get(key) ?? subjectHint(sentence, next) });
  }

  const best = candidates.filter((c) => c.score >= 2).sort((a, b) => b.score - a.score || Number(b.explicit) - Number(a.explicit))[0];
  if (!best) return undefined;
  const out: ApplyEmail = { address: best.address, evidence: truncate(best.sentence, EVIDENCE_CHARS), explicit: best.explicit };
  if (best.subject) out.subject = best.subject;
  return out;
}

/**
 * The apply-by-email address of a posting's description. Employer job boards (`hasForm`) have their
 * own application form, so an address there counts only when the posting says outright to apply by email.
 */
export function postingApplyEmail(descriptionHtml: string, opts: { hasForm: boolean }): ApplyEmail | undefined {
  if (!descriptionHtml) return undefined;
  const found = findApplyEmail(descriptionHtml, htmlToText(descriptionHtml));
  return found && (found.explicit || !opts.hasForm) ? found : undefined;
}
