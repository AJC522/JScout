/**
 * Bullet-level résumé checks and the rewrites that are safe to make without knowing more:
 * a weak opener ("Responsible for managing…") becomes an action verb ("Managed…"), and a
 * leading "I" is dropped. Nothing is added: results and numbers only the user can supply.
 */
import type { BulletIssue } from '../../../shared/types';
import { upperFirst, wordCount } from './text';

const LONG_WORDS = 32;
const SHORT_WORDS = 5;

/** A result in numbers: digits, percentages, money, or spelled-out quantities. */
const METRIC =
  /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|hundreds|thousand|thousands|million|millions|billion|dozens?|half|double[ds]?|doubling|tripled?|quadrupled?)\b/i;
const FIRST_PERSON = /(^|[^\p{L}])(I|I['’](m|ve|d)|[Mm]y|[Mm]e)(?![\p{L}'’])/u;
const PASSIVE = /\b(was|were|been|being|got)\s+(\w+ed|built|led|made|run|done|given|taken|written|chosen|sent|held|won|grown|taught|sold)\b(?!\s+(to|for)\s+\w+ing)/i;

/** Openers that describe a duty rather than an action, in the order they are tried. */
const DUTY_OPENER = /^(?:i\s+(?:was\s+)?)?(responsible for|accountable for|in charge of|tasked with|duties included|duties include|my duties included|role included|charged with)\s+/i;
const CONTRIBUTION_OPENER = /^(?:i\s+)?(worked on|participated in|involved in|was involved in|was part of|took part in|was a member of|contributed towards)\s+/i;
const HELPED_OPENER = /^(?:i\s+)?(helped|assisted|aided)\s+(?:to\s+)?/i;
export const WEAK_OPENER = new RegExp(
  `${DUTY_OPENER.source}|${CONTRIBUTION_OPENER.source}|${HELPED_OPENER.source}|^(?:i\\s+)?(handled|dealt with|was tasked)\\b`,
  'i',
);

const IRREGULAR_PAST: Record<string, string> = {
  leading: 'led', building: 'built', running: 'ran', writing: 'wrote', making: 'made', overseeing: 'oversaw',
  teaching: 'taught', selling: 'sold', driving: 'drove', setting: 'set', getting: 'got', keeping: 'kept',
  bringing: 'brought', buying: 'bought', dealing: 'dealt', meeting: 'met', giving: 'gave', speaking: 'spoke',
  taking: 'took', holding: 'held', winning: 'won', growing: 'grew', cutting: 'cut', sending: 'sent', finding: 'found',
  choosing: 'chose', drawing: 'drew', upholding: 'upheld', understanding: 'understood', putting: 'put', paying: 'paid',
  spending: 'spent', shutting: 'shut', telling: 'told', thinking: 'thought', seeing: 'saw', feeding: 'fed',
  forecasting: 'forecast', broadcasting: 'broadcast', beginning: 'began', standing: 'stood', rebuilding: 'rebuilt',
  rewriting: 'rewrote', undertaking: 'undertook', withholding: 'withheld', reading: 'read', shipping: 'shipped',
};

/** "managing" -> "managed", "copying" -> "copied", "building" -> "built". */
export function gerundToPast(gerund: string): string | undefined {
  const word = gerund.toLowerCase();
  if (!/^[a-z]{3,}ing$/.test(word) || ['being', 'during', 'nothing', 'string', 'spring', 'something', 'anything', 'everything'].includes(word)) return undefined;
  if (IRREGULAR_PAST[word]) return IRREGULAR_PAST[word];
  const stem = word.slice(0, -3);
  if (/[^aeiou]y$/.test(stem)) return `${stem.slice(0, -1)}ied`;
  if (stem.endsWith('e')) return `${stem}d`;
  return `${stem}ed`;
}

/** Base verb -> -ing for the common action verbs that follow "helped" ("build" -> "building"). */
export function toGerund(verb: string): string | undefined {
  const v = verb.toLowerCase();
  if (!/^[a-z]{2,}$/.test(v) || v.endsWith('ing')) return undefined;
  const doubled = new Set(['plan', 'ship', 'stop', 'scan', 'chat', 'drop', 'grab', 'plug', 'swap', 'trim', 'run', 'set', 'get', 'cut', 'put', 'win', 'map', 'tag', 'log']);
  if (doubled.has(v)) return `${v}${v.at(-1)}ing`;
  if (v.endsWith('ie')) return `${v.slice(0, -2)}ying`;
  if (v.endsWith('e') && !v.endsWith('ee') && v.length > 2) return `${v.slice(0, -1)}ing`;
  return `${v}ing`;
}

/** Verbs that commonly follow "helped" ("helped build"); anything else is left as it is. */
const HELPED_VERBS = new Set(
  (
    'build design develop create launch implement improve migrate plan run manage organize organise coordinate write ' +
    'deliver ship scale automate reduce increase grow drive lead train onboard prepare analyze analyse maintain test ' +
    'support define establish streamline roll introduce redesign rebuild refactor set integrate deploy optimize optimise'
  ).split(' '),
);

function rewriteOpener(text: string): string | undefined {
  const duty = DUTY_OPENER.exec(text);
  if (duty) {
    const rest = text.slice(duty[0].length);
    const [first = '', ...others] = rest.split(/\s+/);
    const past = gerundToPast(first.replace(/[^\p{L}]/gu, ''));
    if (past) return `${upperFirst(past)} ${others.join(' ')}`.trim();
    if (/^(the|a|an|all|our|their|its|end-to-end|day-to-day|daily|weekly|monthly)\b/i.test(rest)) return `Owned ${rest}`;
    return `Handled ${rest}`;
  }
  const contribution = CONTRIBUTION_OPENER.exec(text);
  if (contribution) return `Contributed to ${text.slice(contribution[0].length)}`;
  const helped = HELPED_OPENER.exec(text);
  if (helped) {
    const rest = text.slice(helped[0].length);
    const with_ = /^(with|in|on)\s+/i.exec(rest);
    if (with_) return `Supported ${rest.slice(with_[0].length)}`;
    const [verb = '', ...others] = rest.split(/\s+/);
    const gerund = HELPED_VERBS.has(verb.toLowerCase()) ? toGerund(verb) : undefined;
    if (gerund) return `Contributed to ${gerund} ${others.join(' ')}`.trim();
  }
  return undefined;
}

/** Drop a leading "I" ("I built…" -> "Built…"). */
function dropLeadingI(text: string): string | undefined {
  const m = /^I\s+(?!am\b|was\b|have\b|had\b)(\p{L}+)/u.exec(text);
  return m ? upperFirst(text.slice(2).trimStart()) : undefined;
}

export interface BulletCheck {
  issues: BulletIssue[];
  rewrite?: string;
}

export function checkBullet(text: string): BulletCheck {
  const issues: BulletIssue[] = [];
  const words = wordCount(text);
  if (WEAK_OPENER.test(text)) issues.push('weak-start');
  if (!METRIC.test(text)) issues.push('no-metric');
  if (words > LONG_WORDS) issues.push('too-long');
  else if (words < SHORT_WORDS) issues.push('too-short');
  if (FIRST_PERSON.test(text)) issues.push('first-person');
  if (PASSIVE.test(text)) issues.push('passive');

  let rewrite = rewriteOpener(text) ?? dropLeadingI(text);
  if (rewrite) rewrite = rewrite.replace(/\s+/g, ' ').trim();
  return rewrite && rewrite !== text ? { issues, rewrite } : { issues };
}

export const hasMetric = (text: string) => METRIC.test(text);
export const isWeakStart = (text: string) => WEAK_OPENER.test(text);
