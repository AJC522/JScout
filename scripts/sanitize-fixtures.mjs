#!/usr/bin/env node
/**
 * Sanitise the captured job-source responses in tests/fixtures/sources so they can be published.
 *
 * The fixtures are real API responses, and the adapters and tests parse them exactly as they parse the
 * live APIs, so each file keeps its exact shape: envelope keys, ordering and counts, the JSON escaping
 * style (PHP's "\/" and "\u00e9", Rails' "\u0026", plain UTF-8), XML escaping and CDATA, HTML markup,
 * entity style, whitespace and Remote OK's mojibake. Every string that does not change is copied byte for
 * byte. What changes:
 *
 * - Free text (job descriptions, excerpts, pay blurbs, AI disclaimers, HN comment bodies): every text
 *   node is replaced by neutral job-ad prose of about the same length, drawn from a fixed phrase bank by a
 *   PRNG seeded with the posting id and the replaced text. Runs are deterministic, and the HTML and plain
 *   variants of a posting (Ashby, Lever), or one posting captured in several files, get the same prose.
 *   Kept verbatim: section labels ("Benefits:", short headings), text nodes of 12 characters or fewer,
 *   bare URLs, and sentences or clauses under 160 characters that carry a signal the libraries extract:
 *   a skill from src/server/data/skills.json, a currency amount, remote/location/visa wording, an
 *   employment type, seniority, or a job title. Nothing that names a person (a common given name followed
 *   by a surname, a name next to "CEO" or "founder") is kept, and no text node keeps a run of more than
 *   180 characters of carried-over text.
 *   Trade-off: the tests keep realistic signals (skills, salary sentences, remote and eligibility
 *   phrases) at the cost of publishing short factual fragments of the original postings; everything
 *   longer, or without a signal, is generated, so no posting's prose survives as a whole.
 * - Personal data: e-mail addresses -> <role>@example.com or jobs@example.com, phone numbers ->
 *   +1 555 0100, IPv4/IPv6 addresses (also base64-encoded, as in Remote OK's anti-spam tag) ->
 *   192.0.2.1 / 2001:db8::1, HN user names -> stable pseudonyms, links to personal profiles and files in
 *   HN comments -> example.com. HN comment bodies never carry over first-person sentences.
 * - The Cloudflare challenge page is reduced to a minimal page with the same status markers.
 *
 * Structured facts (ids, titles, companies, locations, salary numbers and strings, dates, tags, URLs,
 * counts) and HN comment headers ("Company | Role | Location | ...") are kept as they are.
 *
 * Usage: node scripts/sanitize-fixtures.mjs [--from <raw dir>] [--to <dir>]
 * Both default to tests/fixtures/sources (in place). Re-running it on sanitised files changes nothing.
 * scripts/check-fixtures.mjs verifies the result.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeHTML } from 'entities';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = path.join(ROOT, 'tests', 'fixtures', 'sources');

// ---------------------------------------------------------------------------
// Generated prose
// ---------------------------------------------------------------------------

// Neutral on purpose: no skill, place, remote/employment/seniority word, job title or amount, so the
// generated text adds no signal of its own to what the libraries extract. Sentences hold no clause
// separators (",", ":", ";", " - "), so a re-run never splits one and the output is stable.
const SENTENCES = [
  'Feedback here is frequent and kind.',
  'Questions are welcome at every step.',
  'We keep meetings short and leave room for focused work.',
  'You will help shape how the product grows over the coming year.',
  'We share progress openly and make decisions in writing.',
  'Day to day you will turn rough ideas into clear and working results.',
  'Good notes matter here because decisions are made in the open.',
  'We look for people who ask questions early and follow through.',
  'Our customers count on us every day so quality is part of the job.',
  'You will partner with colleagues across the company to solve real problems.',
  'New joiners get a buddy and a clear plan for the first weeks.',
  'We value curiosity and a calm approach to hard problems.',
  'Every project starts with a short written plan that anyone can comment on.',
  'We measure success by the outcomes we deliver for the people we serve.',
  'You will own a clear area of work and see it through from start to finish.',
  'We try to make the simple thing easy and the hard thing possible.',
  'The role offers room to grow as the company grows.',
  'We welcome applicants from every background and walk of life.',
  'Expect a friendly process with quick replies.',
  'You will help improve the habits the group relies on.',
  'Most weeks mix shaping ideas with building and reviewing finished work.',
  'We celebrate progress and learn from mistakes as we go.',
  'Clear goals and honest updates help everyone stay aligned.',
  'You will have the time and support to do your best work.',
  'We hold a high bar and give each other the help to meet it.',
  'This is a chance to make a visible difference early on.',
  'Our values guide how we hire and how we make decisions.',
  'We care about doing the work well and about each other.',
  'Small groups own their outcomes and choose how to reach them.',
  'Please apply even if you do not match every point listed here.',
  'The work is varied and no two weeks look quite the same.',
  'We read every application with care.',
  'You will learn quickly and share what you learn.',
  'Kindness and candour go together here.',
  'We prefer simple solutions that hold up over time.',
  'Your ideas will be heard from the first week.',
  'We make time to reflect on what went well and what did not.',
  'Our pace is steady and we plan ahead to keep it that way.',
  'Everyone here helps new colleagues find their footing.',
  'We are proud of the product and of how we build it.',
  'You will see the results of your work in the hands of customers.',
  'We grow together.',
  'Details follow below.',
  'Thank you for reading.',
  'We would love to hear from you.',
  'Your voice matters here.',
  'We keep things simple.',
];

const CLAUSES = [
  'and the group is glad to help',
  'with plenty of room to learn',
  'as part of a friendly group',
  'so that the work stays simple',
  'which keeps everyone on track',
  'while keeping quality high',
  'in a calm and focused way',
  'along with clear goals',
  'for the people we serve',
  'with honest and regular feedback',
  'so that good ideas move quickly',
  'and we share what we learn',
  'with time set aside for learning',
  'from the first week onwards',
  'and every voice is heard',
  'through clear written plans',
];

const PHRASES = [
  'Overview',
  'Details',
  'The role',
  'Our group',
  'How we work',
  'What to expect',
  'Day to day',
  'Good to know',
  'Next steps',
  'About this job',
  'Group habits',
  'Growth and support',
  'Ways of working',
  'In this role',
  'Our approach',
  'Where you fit',
  'Time to learn',
  'Shared goals',
  'Clear priorities',
  'Thoughtful reviews',
  'Room to grow',
  'Helpful colleagues',
  'A steady pace',
  'Why join us',
  'What we value',
  'A friendly process',
  'How to apply here',
  'What you will find here',
  'Life in the group',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every bank entry, without its final full stop, longest first. */
const BANK = [...SENTENCES.map((s) => s.slice(0, -1)), ...CLAUSES, ...PHRASES].sort((a, b) => b.length - a.length);
const BANK_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${BANK.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu');

/** The parts of a text that are not generated prose (whitespace and punctuation between them included). */
export function nonGeneratedParts(text) {
  return text.split(BANK_RE);
}

const isGenerated = (text) => nonGeneratedParts(text).every((part) => !/[\p{L}\p{N}]/u.test(part));

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG, so a given input always yields the same prose. */
function prng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One of the three entries closest in length to len. */
function closest(list, len, next) {
  const near = [...list].sort((a, b) => Math.abs(a.length - len) - Math.abs(b.length - len)).slice(0, 3);
  return near[Math.floor(next() * near.length)];
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Generated prose standing in for one sentence, clause or line of length about original.length. A
 * clause is capitalised only when it opens its sentence (initial) and the original was capitalised.
 */
function generate(original, seed, initial) {
  const next = prng(hash(`${seed}\u0000${original}`));
  const len = original.length;
  const last = original.at(-1);
  if (last === ',' || last === ';' || last === ':') {
    const clause = closest(CLAUSES, len - 1, next);
    return (initial && /^\p{Lu}/u.test(original) ? capitalise(clause) : clause) + last;
  }
  const stop = /[.!?]$/.test(original);
  const out = [];
  let left = len;
  for (;;) {
    const fits = SENTENCES.filter((s) => s.length <= left && s !== out.at(-1));
    if (fits.length === 0) break;
    const pick = fits[Math.floor(next() * fits.length)];
    out.push(pick);
    left -= pick.length + 1;
  }
  if (out.length === 0) return closest(PHRASES, len - (stop ? 1 : 0), next) + (stop ? '.' : '');
  const text = out.join(' ');
  return stop ? text : text.slice(0, -1);
}

// ---------------------------------------------------------------------------
// Signals worth keeping
// ---------------------------------------------------------------------------

// Soft skills and spoken languages occur in most sentences; matching them would keep nearly everything.
const SKIPPED_SKILL_CATEGORIES = new Set(['soft-skill', 'language']);

function skillPattern() {
  const { skills } = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'server', 'data', 'skills.json'), 'utf8'));
  const terms = new Set();
  for (const skill of skills) {
    if (SKIPPED_SKILL_CATEGORIES.has(skill.category)) continue;
    for (const term of [skill.name, ...skill.aliases]) if (term.length >= 2) terms.add(term);
  }
  const alternatives = [...terms].sort((a, b) => b.length - a.length).map(escapeRe);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}+#])`, 'u');
}

const SKILL_RE = skillPattern();
const CURRENCY_RE =
  /[$€£¥₹]\s?\d|\d\s?[kK]?\s?(?:USD|EUR|GBP|CAD|AUD|CHF|SEK|NOK|DKK|PLN|INR|JPY|SGD|NZD|BRL|MXN|ZAR)\b|\b(?:USD|EUR|GBP|CAD|AUD|CHF|SEK|NOK|DKK|PLN|INR)\s?\d/;
const REMOTE_RE =
  /\b(?:remote(?:ly)?|hybrid|on-?site|in[- ]office|office|relocat\w*|visas?|sponsor\w*|authori[sz]ed|authori[sz]ation|right to work|time ?zones?|UTC|GMT|CET|EST|PST|anywhere|worldwide|based in|located in|locations?|countr(?:y|ies)|citizens?|citizenship|residen(?:t|ts|cy)|commut\w*)\b/i;
const EMPLOYMENT_RE =
  /\b(?:full[- ]time|part[- ]time|contract(?:or)?|freelanc\w*|intern(?:ship)?s?|permanent|temporary|fixed[- ]term|seasonal|hours? (?:per|a) week)\b/i;
// "Staff" and "Principal" only capitalised: "our staff" and "principal duties" are not levels.
const SENIORITY_RE = /\b(?:[Ss]enior|[Jj]unior|[Mm]id[- ]level|[Ee]ntry[- ]level|Principal|Staff|[Hh]ead of|\d+\+?\s*(?:years?|yrs))\b/;
const TITLE_RE =
  /\b(?:Engineer|Developer|Designer|Manager|Scientist|Analyst|Architect|Administrator|Director|Specialist|Consultant|Coordinator|Recruiter|Accountant|Representative)s?\b/;
const FIRST_PERSON_RE = /\b(?:I|I'm|I've|I'd|I'll|me|my|myself)\b/;

// Common given names: "Thomas Lacroix" in a bold "meet the founders" label, or "ask Sarah Chen" in a short
// sentence, is a person, not a heading or a fact about the job. A best-effort net on top of the length rules.
const GIVEN_NAMES = new Set(
  (
    'aaron adam adrian ahmed alan albert alex alexander alexandra alexis ali alice alicia amanda amy ana andrea andreas ' +
    'andrew angela anna anne anthony antonio ben benjamin brian carlos caroline catherine charles chris christian ' +
    'christina christopher claire daniel david diana diego dmitri edward elena elizabeth emily emma eric eva fatima ' +
    'felix francesco frank gabriel george hannah harry helen henry hugo isabel jack jacob james jan jane jason jeff ' +
    'jennifer jeremy jessica joe johannes john jonathan jordan jose joseph juan julia julien karen kate kevin laura ' +
    'lauren lisa lucas luis luke marco maria mark martin mary matthew max michael michelle mohamed mohammed natalie ' +
    'nicholas nicolas nina oliver olivia omar pablo patrick paul pedro peter philip pierre priya rachel rahul raj ' +
    'rebecca richard robert ryan sam samuel sara sarah scott sebastian sophie stefan stephen steven susan thomas tim ' +
    'tom victor william yuki'
  ).split(' '),
);
const NAME_RE = /(?<![\p{L}\p{N}])(\p{Lu}\p{Ll}+)\s+\p{Lu}[\p{Ll}'-]+/gu;
// "Our CEO, Jane Q. Doe," / "Jane Doe, co-founder": any name next to an executive or founder title.
const NAMED_LEADER_RE =
  /\b(?:CEO|CTO|CFO|COO|CPO|CMO|[Ff]ounder|[Cc]o-?founder|[Pp]resident|[Cc]hair(?:man|woman|person)?),?\s+(?:\p{Lu}[\p{Ll}.'-]*\s+){1,2}\p{Lu}[\p{Ll}'-]+|(?:\p{Lu}[\p{Ll}'-]+\s+){1,2}\p{Lu}[\p{Ll}'-]+,\s+(?:our\s+)?(?:CEO|CTO|CFO|COO|[Ff]ounder|[Cc]o-?founder)\b/u;
const mentionsPerson = (text) =>
  NAMED_LEADER_RE.test(text) || [...text.matchAll(NAME_RE)].some((m) => GIVEN_NAMES.has(m[1].toLowerCase()));

function hasSignal(text, ctx) {
  if (mentionsPerson(text) || (ctx.hn && FIRST_PERSON_RE.test(text))) return false;
  return (
    SKILL_RE.test(text) ||
    CURRENCY_RE.test(text) ||
    REMOTE_RE.test(text) ||
    EMPLOYMENT_RE.test(text) ||
    TITLE_RE.test(text) ||
    // An HN commenter's "N years at <employer>" is their CV, not the job's requirement.
    (!ctx.hn && SENIORITY_RE.test(text))
  );
}

const LABEL_PARENTS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'u', 'th', 'dt', 'label', 'summary']);
const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', '&', '-', '–', '—']);
const URL_ONLY_RE = /^(?:https?:\/\/|www\.)\S+$|^[\w-]+(?:\.[\w-]+)+(?:\/\S*)?$/i;

/** A section label ("Benefits:", "What We Offer", a short bold lead-in): structure, not prose. */
function isLabel(text, parent) {
  if (text.length > 50 || /[.!?]$/.test(text)) return false;
  if (LABEL_PARENTS.has(parent) || text.endsWith(':')) return true;
  const words = text.split(/\s+/);
  return words.length <= 6 && words.every((w) => /^[\p{Lu}\p{N}(&]/u.test(w) || SMALL_WORDS.has(w.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Text and HTML rewriting
// ---------------------------------------------------------------------------

/** Readable text of a raw text node, for length and signal checks (entity-escaped HTML is decoded twice). */
export const decode = (raw) => decodeHTML(decodeHTML(raw)).replace(/\u00a0/g, ' ');

const KEEP_LIMIT = 160;
const RUN_LIMIT = 180;

/**
 * Keep or replace one sentence, clause or line. run.kept is the length of carried-over text since the
 * last generated piece in this text node; it caps how much original text can stand together.
 */
function keepOrGenerate(raw, keep, ctx, run, initial = true) {
  const text = decode(raw);
  if (isGenerated(text)) {
    run.kept = 0;
    ctx.stats.generated += text.length;
    return raw;
  }
  if (keep && run.kept + text.length <= RUN_LIMIT) {
    run.kept += text.length + 1;
    ctx.stats.kept += text.length;
    return raw;
  }
  run.kept = 0;
  ctx.stats.generated += text.length;
  return generate(text, ctx.seed, initial);
}

const SENTENCE_SPLIT_RE = /(?<=[.!?])(\s+)(?=\S)/;
// Commas, colons, semicolons that do not end an entity ("&amp;", or "&amp;amp;" in escaped HTML), and spaced dashes.
const CLAUSE_SPLIT_RE = /((?<=[,:]|(?<!&(?:amp;)?#?[a-z0-9]{1,10});)\s+|\s+[–—-]\s+)/i;

function rewriteSentence(raw, ctx, run) {
  const text = decode(raw);
  // A sentence already mixing kept and generated clauses (a re-run) is judged clause by clause again.
  const mixed = nonGeneratedParts(text).length > 1;
  if (text.length < KEEP_LIMIT && !mixed) return keepOrGenerate(raw, hasSignal(text, ctx), ctx, run);
  // A first-person sentence in an HN comment is about the commenter; none of its clauses is kept.
  if (ctx.hn && FIRST_PERSON_RE.test(text)) return keepOrGenerate(raw, false, ctx, run);
  const parts = raw.split(CLAUSE_SPLIT_RE);
  const keep = parts.map((part, i) => {
    if (i % 2 === 1) return false;
    const clause = decode(part);
    return isGenerated(clause) || (clause.length < KEEP_LIMIT && hasSignal(clause, ctx));
  });
  // Nothing worth keeping: one stretch of prose reads better than a string of generated clauses.
  if (!keep.includes(true)) return keepOrGenerate(raw, false, ctx, run);
  return parts.map((part, i) => (i % 2 === 1 ? part : keepOrGenerate(part, keep[i], ctx, run, i === 0))).join('');
}

function rewriteLine(raw, ctx, run, parent) {
  const text = decode(raw).trim();
  const structural = text.length <= 12 || isLabel(text, parent) || URL_ONLY_RE.test(text);
  if (structural) return keepOrGenerate(raw, !mentionsPerson(text), ctx, run);
  return raw
    .split(SENTENCE_SPLIT_RE)
    .map((part, i) => (i % 2 === 1 ? part : rewriteSentence(part, ctx, run)))
    .join('');
}

/** Rewrite one text node (raw, entities and all), keeping its surrounding whitespace and line breaks. */
function rewriteText(raw, ctx, parent) {
  if (!/\p{L}/u.test(decode(raw))) return raw;
  const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
  const run = { kept: 0 };
  const lines = body
    .split(/(\s*\n\s*)/)
    .map((part, i) => (i % 2 === 1 || part === '' ? part : rewriteLine(part, ctx, run, parent)))
    .join('');
  return lead + lines + trail;
}

// Real tags and entity-escaped ones ("&lt;p&gt;": Greenhouse content, some Remote OK and Arbeitnow bodies,
// which may end in a real-HTML footer). Text between them is entity-escaped too, so kept text stays raw.
export const TAG_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z][^<>]*>|<![^<>]*>|&lt;!--[\s\S]*?--&gt;|&lt;\/?[A-Za-z][\s\S]*?&gt;/g;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Replace the text nodes of an HTML fragment (or plain text, which is one text node); tags stay as they are. */
function rewriteHtml(html, ctx) {
  const stack = [];
  let out = '';
  let last = 0;
  for (const m of html.matchAll(TAG_RE)) {
    out += rewriteText(html.slice(last, m.index), ctx, stack.at(-1)) + m[0];
    last = m.index + m[0].length;
    const tag = /^(?:<|&lt;)(\/?)([A-Za-z][\w:-]*)/.exec(m[0]);
    if (!tag || /\/(?:>|&gt;)$/.test(m[0])) continue;
    const name = tag[2].toLowerCase();
    if (tag[1]) {
      const at = stack.lastIndexOf(name);
      if (at >= 0) stack.length = at;
    } else if (!VOID_TAGS.has(name)) {
      stack.push(name);
    }
  }
  return out + rewriteText(html.slice(last), ctx, stack.at(-1));
}

const OUTER_ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#34;': '"', '&#39;': "'", '&#039;': "'", '&apos;': "'" };
const OUTER_RE = /&(?:lt|gt|amp|quot|#34|#39|#039|apos);/g;

/**
 * The XML entity layer of an RSS element holding escaped HTML: decoded, and re-encoded in the same
 * style. Throws if the style cannot be reproduced.
 */
function outerLayer(s) {
  const used = new Set(s.match(OUTER_RE));
  const quote = [...used].find((e) => OUTER_ENTITIES[e] === '"');
  const apostrophe = [...used].find((e) => OUTER_ENTITIES[e] === "'");
  const decoded = s.replace(OUTER_RE, (e) => OUTER_ENTITIES[e]);
  const encode = (t) =>
    t.replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? (quote ?? c) : (apostrophe ?? c),
    );
  if (encode(decoded) !== s) throw new Error(`cannot reproduce the entity escaping of: ${s.slice(0, 80)}`);
  return { decoded, encode };
}

/**
 * Remote OK serves each UTF-8 byte as a Latin-1 character. Rewriting that text directly could cut a
 * multi-byte sequence in half (an NBSP byte reads as whitespace), which stops the adapter's repair, so the
 * decoded text is rewritten and served back the same way.
 */
function viaMojibake(s, rewrite) {
  const text = Buffer.from(s, 'latin1').toString('utf8');
  if (/[^\u0000-\u00ff]/.test(s) || Buffer.from(text, 'utf8').toString('latin1') !== s) return rewrite(s);
  return Buffer.from(rewrite(text), 'utf8').toString('latin1');
}

/**
 * Rewrite a description, leaving the parts matched by ctx.protect (boilerplate the adapters rely on) as
 * they are; ctx.mojibake marks Remote OK's byte-per-character text.
 */
function rewriteDescription(s, ctx) {
  if (ctx.mojibake) return viaMojibake(s, (text) => rewriteDescription(text, { ...ctx, mojibake: false }));
  let out = '';
  let last = 0;
  const kept = (ctx.protect ?? []).flatMap((re) => [...s.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))]);
  for (const m of kept.sort((a, b) => a.index - b.index)) {
    if (m.index < last) continue;
    out += rewriteHtml(s.slice(last, m.index), ctx) + m[0];
    last = m.index + m[0].length;
  }
  return scrubProse(out + rewriteHtml(s.slice(last), ctx));
}

// ---------------------------------------------------------------------------
// Personal data
// ---------------------------------------------------------------------------

export const EMAIL_RE = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const ROLE_MAILBOX_RE = /^[a-z_]*(?:jobs|careers|hr|recruit\w*|talent|accommodations|security|hello|apply\w*|privacy|info)$/i;
// Bracketed forms only: "name at host.com" is indistinguishable from prose ("listed at linear.app").
export const OBFUSCATED_EMAIL_RE =
  /([\w.+-]+)\s*(?:\[at\]|\(at\)|\{at\})\s*[\w-]+(?:(?:\s*(?:\[dot\]|\(dot\)|\{dot\})\s*|\.)[a-z]{2,})+/gi;
export const IPV4_RE = /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w.]*\d)/g;
export const IPV6_RE =
  /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})(?![\w:])/gi;
export const BASE64_RE = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{11,}={0,2}(?![A-Za-z0-9+/=])/g;
export const PHONE_RE = /(?<![\w+])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\w)|\+\d{1,3}(?:[\s.-]\d{2,4}){3,4}(?![\w.-]*\d)/g;

const DOC_IPV4 = '192.0.2.1';
const DOC_IPV6 = '2001:db8::1';
export const isDocumentationIp = (ip) => /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$|^2001:db8:/i.test(ip);
const IP_ONLY_RE = new RegExp(`^(?:${IPV4_RE.source}|${IPV6_RE.source})$`, 'i');
const isIp = (s) => IP_ONLY_RE.test(s);

/** The IP address a base64 token encodes, alone or after a one-letter prefix (Remote OK's "R" + base64). */
export function base64Ip(token) {
  for (const [prefix, b64] of [['', token], [token[0], token.slice(1)]]) {
    const text = Buffer.from(b64, 'base64').toString('latin1');
    if (Buffer.from(text, 'latin1').toString('base64').replace(/=+$/, '') === b64.replace(/=+$/, '') && isIp(text)) {
      return { prefix, ip: text };
    }
  }
  return undefined;
}

const mailbox = (local) => (ROLE_MAILBOX_RE.test(local) ? local.toLowerCase() : 'jobs');

/** Replace e-mail and IP addresses anywhere (structured fields included). */
function scrubAddresses(s) {
  return s
    .replace(EMAIL_RE, (m, local, domain) => (/^example\.(?:com|org|net)$/i.test(domain) ? m : `${mailbox(local)}@example.com`))
    .replace(OBFUSCATED_EMAIL_RE, (m, local) => (/\bexample\b/i.test(m) ? m : `${mailbox(local)} [at] example [dot] com`))
    .replace(IPV4_RE, (ip) => (isDocumentationIp(ip) ? ip : DOC_IPV4))
    .replace(IPV6_RE, (ip) => (isDocumentationIp(ip) ? ip : DOC_IPV6))
    .replace(BASE64_RE, (token) => {
      const found = base64Ip(token);
      if (!found || isDocumentationIp(found.ip)) return token;
      const ip = found.ip.includes(':') ? DOC_IPV6 : DOC_IPV4;
      return found.prefix + Buffer.from(ip).toString('base64');
    });
}

/** Free text only (numbers in structured fields are ids and amounts): phone numbers too. */
function scrubProse(s) {
  return scrubAddresses(s).replace(PHONE_RE, (m) => (/555[\s.-]?01\d\d$/.test(m) ? m : '+1 555 0100'));
}

// Profiles, CVs and personal files; not company sites, job boards or application forms (Google Forms).
const PERSONAL_LINK_RE =
  /^https?:\/\/(?:www\.)?(?:github\.com|gitlab\.com|twitter\.com|x\.com|calendly\.com|medium\.com|bsky\.app|[\w-]+\.substack\.com|drive\.google\.com|docs\.google\.com\/(?!forms\/)|(?:[\w-]+\.)?linkedin\.com\/in\/)/i;

/** HN links to a commenter's profile, CV or files point to example.com instead (HN escapes "/" as "&#x2F;"). */
function scrubProfileLinks(html) {
  const placeholder = 'https:&#x2F;&#x2F;example.com&#x2F;profile';
  return html.replace(/(<a\s[^>]*?href=")([^"]*)("[^>]*>)[\s\S]*?(<\/a>)/gi, (m, open, href, mid, close) =>
    PERSONAL_LINK_RE.test(decodeHTML(href)) ? `${open}${placeholder}${mid}${placeholder}${close}` : m,
  );
}

// ---------------------------------------------------------------------------
// Per-source fields
// ---------------------------------------------------------------------------

const list = (v) => (Array.isArray(v) ? v : []);

export const REMOTEOK_TRAILER = /(?:<br\s*\/?>\s*)*Please mention the word \*\*[^*]+\*\* and tag \S+ when applying[\s\S]*$/;
const HIMALAYAS_FOOTER = /<p>Originally posted on <a href="https:\/\/himalayas\.app">Himalayas<\/a><\/p>\s*$/;
const WWR_HEADER =
  /^\s*(?:<img [^>]*\/>\s*)?<p>\s*<strong>Headquarters:<\/strong>[^<]*(?:<br \/>\s*<strong>URL:<\/strong>\s*<a href="[^"]*">[^<]*<\/a>[^<]*)?<\/p>/;

const LEVER_FIELDS = [
  'description', 'descriptionPlain', 'descriptionBody', 'descriptionBodyPlain', 'opening', 'openingPlain',
  'additional', 'additionalPlain', 'salaryDescription', 'salaryDescriptionPlain',
];

/** For each JSON source: call field(object, key, seed, options?) on every free-text field of every posting. */
const JSON_SOURCES = {
  arbeitnow: (doc, field) => list(doc?.data).forEach((j) => field(j, 'description', j.slug)),
  ashby: (doc, field) =>
    list(doc?.jobs).forEach((j) => {
      field(j, 'descriptionHtml', j.id);
      field(j, 'descriptionPlain', j.id);
    }),
  greenhouse: (doc, field) =>
    (Array.isArray(doc?.jobs) ? doc.jobs : [doc]).forEach((j) => {
      field(j, 'content', j.id);
      field(j, 'ai_disclaimer', j.id);
      list(j?.pay_input_ranges).forEach((r) => field(r, 'blurb', j.id));
    }),
  himalayas: (doc, field) =>
    list(doc?.jobs).forEach((j) => {
      field(j, 'description', j.guid, { protect: [HIMALAYAS_FOOTER] });
      field(j, 'excerpt', j.guid);
    }),
  'hn-hiring': (doc, field) =>
    list(doc?.hits).forEach((h) => {
      if (typeof h.author === 'string' && !/^hn_user_[0-9a-z]+$/.test(h.author)) {
        const pseudonym = `hn_user_${hash(h.author).toString(36)}`;
        if (h._highlightResult?.author?.value === h.author) h._highlightResult.author.value = pseudonym;
        h.author = pseudonym;
      }
      field(h, 'comment_text', h.objectID);
    }),
  jobicy: (doc, field) =>
    list(doc?.jobs).forEach((j) => {
      field(j, 'jobDescription', j.id);
      field(j, 'jobExcerpt', j.id);
    }),
  lever: (doc, field) =>
    (Array.isArray(doc) ? doc.flatMap((x) => (Array.isArray(x?.postings) ? x.postings : [x])) : [doc]).forEach((p) => {
      for (const key of LEVER_FIELDS) field(p, key, p?.id);
      list(p?.lists).forEach((l) => field(l, 'content', p.id));
    }),
  remoteok: (doc, field) => list(doc).forEach((j) => field(j, 'description', j?.id, { protect: [REMOTEOK_TRAILER], mojibake: true })),
  remotive: (doc, field) => list(doc?.jobs).forEach((j) => field(j, 'description', j.id)),
  workingnomads: (doc, field) =>
    (Array.isArray(doc) ? doc : list(doc?.hits?.hits).map((h) => h._source)).forEach((j) => field(j, 'description', j?.id ?? j?.url)),
};

/** HN comments: the header (everything before the first <p>) is factual and parsed by the adapter. */
function rewriteHnComment(html, ctx) {
  const scrubbed = scrubProfileLinks(html);
  const at = scrubbed.indexOf('<p>');
  if (at < 0) return scrubProse(scrubbed);
  return scrubProse(scrubbed.slice(0, at)) + rewriteDescription(scrubbed.slice(at), { ...ctx, hn: true });
}

/** For each RSS source: the item elements holding free text, and boilerplate the adapter relies on. */
const XML_SOURCES = {
  himalayas: { elements: ['description', 'content:encoded'], protect: [HIMALAYAS_FOOTER] },
  remotive: { elements: ['description'], protect: [] },
  weworkremotely: { elements: ['description'], protect: [WWR_HEADER] },
};

const CLOUDFLARE_CHALLENGE =
  '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta name="robots" content="noindex,nofollow">' +
  '<meta http-equiv="refresh" content="360"></head><body><div class="main-wrapper" role="main"><div class="main-content">' +
  '<noscript><div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div></noscript>' +
  '</div></div><script src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/orchestrate/chl_page/v1"></script></body></html>';

// ---------------------------------------------------------------------------
// File formats
// ---------------------------------------------------------------------------

/** How a file escapes JSON strings, inferred from the file itself. */
function jsonStyle(text) {
  const escapedAscii = new Set();
  for (const m of text.matchAll(/\\u00([2-7][0-9a-fA-F])/g)) escapedAscii.add(String.fromCharCode(parseInt(m[1], 16)));
  return {
    slash: text.includes('\\/'),
    ascii: !/[^\x00-\x7f]/.test(text),
    upper: /\\u[0-9a-f]{0,3}[A-F]/.test(text),
    escapedAscii,
  };
}

const SHORT_ESCAPES = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };

function encodeJsonString(s, style) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (SHORT_ESCAPES[ch]) out += SHORT_ESCAPES[ch];
    else if (ch === '/' && style.slash) out += '\\/';
    else if (code < 0x20 || style.escapedAscii.has(ch) || (code > 0x7e && style.ascii)) {
      const hex = code.toString(16).padStart(4, '0');
      out += `\\u${style.upper ? hex.toUpperCase() : hex}`;
    } else out += ch;
  }
  return `${out}"`;
}

/**
 * Replace the string values at the given paths in the JSON text, leaving every other byte as it is.
 * Paths are keys/indexes joined by NUL. Throws if a replaced token's escaping cannot be reproduced.
 */
function replaceJsonStrings(text, changes, style) {
  let i = 0;
  let out = '';
  let last = 0;
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const stringToken = () => {
    const start = i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return [start, i];
  };
  const value = (at) => {
    skipSpace();
    const c = text[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      skipSpace();
      for (let n = 0; text[i] !== close; n++) {
        let key = n;
        if (c === '{') {
          const [ks, ke] = stringToken();
          key = JSON.parse(text.slice(ks, ke));
          skipSpace();
          i++; // ':'
        }
        value(`${at}\u0000${key}`);
        skipSpace();
        if (text[i] === ',') i++;
        skipSpace();
      }
      i++;
    } else if (c === '"') {
      const [start, end] = stringToken();
      if (!changes.has(at)) return;
      const original = text.slice(start, end);
      if (encodeJsonString(JSON.parse(original), style) !== original) throw new Error(`cannot reproduce the escaping of ${original.slice(0, 80)}`);
      out += text.slice(last, start) + encodeJsonString(changes.get(at), style);
      last = end;
    } else {
      while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
    }
  };
  value('');
  return out + text.slice(last);
}

function changedStrings(before, after, at, changes) {
  if (typeof before === 'string') {
    if (before !== after) changes.set(at, after);
  } else if (before && typeof before === 'object') {
    for (const key of Object.keys(before)) changedStrings(before[key], after[key], `${at}\u0000${key}`, changes);
  }
}

function scrubAllStrings(value) {
  if (Array.isArray(value)) return value.map(scrubAllStrings);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubAllStrings(v)]));
  return typeof value === 'string' ? scrubAddresses(value) : value;
}

function sanitizeJson(text, source, stats) {
  const before = JSON.parse(text);
  const after = scrubAllStrings(before);
  const postings = new Set();
  JSON_SOURCES[source]?.(after, (obj, key, seed, options = {}) => {
    if (!obj || typeof obj[key] !== 'string' || obj[key] === '') return;
    const ctx = { seed: `${source}:${seed}`, stats, ...options };
    obj[key] = source === 'hn-hiring' ? rewriteHnComment(obj[key], ctx) : rewriteDescription(obj[key], ctx);
    postings.add(seed);
    stats.fields++;
  });
  stats.postings += postings.size;
  const changes = new Map();
  changedStrings(before, after, '', changes);
  return changes.size ? replaceJsonStrings(text, changes, jsonStyle(text)) : text;
}

function sanitizeXml(text, source, stats) {
  const spec = XML_SOURCES[source];
  if (!spec) return scrubAddresses(text);
  const element = new RegExp(`(<(${spec.elements.map(escapeRe).join('|')})>)([\\s\\S]*?)(</\\2>)`, 'g');
  const items = text.replace(/<item>[\s\S]*?<\/item>/g, (item) => {
    const seed = /<guid[^>]*>([\s\S]*?)<\/guid>/.exec(item)?.[1] ?? /<link>([\s\S]*?)<\/link>/.exec(item)?.[1] ?? '';
    const ctx = { seed: `${source}:${seed}`, protect: spec.protect, stats };
    stats.postings++;
    return item.replace(element, (_m, open, _name, inner, close) => {
      stats.fields++;
      const cdata = /^(\s*<!\[CDATA\[)([\s\S]*)(\]\]>\s*)$/.exec(inner);
      if (cdata) return open + cdata[1] + rewriteDescription(cdata[2], ctx) + cdata[3] + close;
      const layer = outerLayer(inner);
      return open + layer.encode(rewriteDescription(layer.decoded, ctx)) + close;
    });
  });
  return scrubAddresses(items);
}

function sanitizeFile(rel, text, stats) {
  const source = rel.split(/[\\/]/)[0];
  if (rel.replace(/\\/g, '/') === 'weworkremotely/error-cloudflare-challenge-403.html') return CLOUDFLARE_CHALLENGE;
  if (rel.endsWith('.json')) return sanitizeJson(text, source, stats);
  if (rel.endsWith('.xml')) return sanitizeXml(text, source, stats);
  return scrubAddresses(text);
}

export function listFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    .sort();
}

function main(argv) {
  const arg = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? path.resolve(argv[at + 1] ?? '') : undefined;
  };
  const from = arg('--from') ?? FIXTURES_DIR;
  const to = arg('--to') ?? FIXTURES_DIR;
  const stats = { files: 0, changed: 0, postings: 0, fields: 0, kept: 0, generated: 0 };
  for (const file of listFiles(from)) {
    const rel = path.relative(from, file);
    const text = fs.readFileSync(file, 'utf8');
    const clean = sanitizeFile(rel, text, stats);
    const target = path.join(to, rel);
    stats.files++;
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === clean) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, clean);
    stats.changed++;
  }
  const share = stats.kept + stats.generated ? Math.round((100 * stats.kept) / (stats.kept + stats.generated)) : 0;
  console.log(
    `${stats.files} files read, ${stats.changed} written; ${stats.fields} free-text fields in ${stats.postings} postings; ` +
      `${share}% of the free text carried over as short factual fragments, the rest generated.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
