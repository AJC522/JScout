/**
 * HTML handling for job descriptions. Descriptions come from untrusted third
 * parties and are rendered in the UI, so `sanitizeHtml` is a security boundary.
 *
 * Design (why this is safe by construction):
 *  - Input is tokenised with htmlparser2's Tokenizer, but the tree is built here with
 *    an O(1) stack and a hard depth cap. (htmlparser2's Parser keeps its open-element
 *    stack with Array#unshift and is quadratic: 200k unclosed tags take ~20 s.)
 *  - Only a fixed set of element kinds survives into an internal block/inline model;
 *    everything else is unwrapped (text kept) or dropped with its whole subtree.
 *  - Output is serialised from that model by this module: every text run is escaped,
 *    the only attribute ever written is a[href] (re-validated, canonicalised through the
 *    WHATWG URL parser) plus fixed target/rel values. No raw-text elements (script, style,
 *    textarea, title, noscript, xmp, …) can ever appear in the output, so parser
 *    differentials between htmlparser2 and browsers (mutation XSS) cannot smuggle markup.
 *  - Entities are decoded exactly once (by the tokenizer, or by the explicit one-time
 *    decode of an entity-escaped document); nothing is decoded after sanitising.
 */
import { Tokenizer, type TokenizerCallbacks } from 'htmlparser2';
import { decodeHTML } from 'entities';

/** Inputs longer than this are truncated before parsing (largest real descriptions are ~25 KB). */
export const MAX_HTML_INPUT_CHARS = 500_000;
/** Elements nested deeper than this are unwrapped (their text is kept). */
const MAX_DEPTH = 48;
const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer nofollow"';

// ---------------------------------------------------------------------------
// Element tables
// ---------------------------------------------------------------------------

/** Source tag -> canonical tag we keep a node for. Tags not listed are unwrapped. */
const KEEP: Readonly<Record<string, string>> = {
  p: 'p', div: 'div', br: 'br', hr: 'hr',
  ul: 'ul', ol: 'ol', menu: 'ul', dir: 'ul', li: 'li',
  strong: 'strong', b: 'b', em: 'em', i: 'i', u: 'u', code: 'code', tt: 'code', kbd: 'code', samp: 'code',
  h1: 'h3', h2: 'h3', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6',
  blockquote: 'blockquote', pre: 'pre', listing: 'pre', a: 'a',
  table: 'table', thead: 'thead', tbody: 'tbody', tfoot: 'tbody', tr: 'tr', th: 'th', td: 'td',
  // Block-level containers without an allowed counterpart act as paragraph boundaries.
  section: 'div', article: 'div', header: 'div', footer: 'div', main: 'div', nav: 'div', aside: 'div',
  address: 'div', figure: 'div', figcaption: 'div', details: 'div', summary: 'div', fieldset: 'div',
  legend: 'div', hgroup: 'div', center: 'div', dl: 'div', dt: 'div', dd: 'div', caption: 'div',
};

/** Elements removed together with everything inside them. */
const DROP = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'noembed',
  'noframes', 'template', 'title', 'textarea', 'xmp', 'plaintext', 'svg', 'math', 'select', 'option',
  'optgroup', 'datalist', 'button', 'input', 'img', 'image', 'video', 'audio', 'source', 'track', 'canvas',
  'map', 'area', 'head', 'meta', 'link', 'base', 'basefont', 'bgsound', 'param', 'picture', 'form',
  'portal', 'dialog', 'slot', 'keygen', 'command', 'isindex', 'colgroup', 'col',
]);

/** Elements that never have content (no stack frame is pushed for them). */
const VOID = new Set([
  'area', 'base', 'basefont', 'br', 'col', 'command', 'embed', 'frame', 'hr', 'img', 'image', 'input',
  'isindex', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'bgsound',
]);

const UNWRAP_KNOWN = [
  'span', 'font', 'small', 'big', 'sub', 'sup', 's', 'strike', 'del', 'ins', 'mark', 'abbr', 'acronym',
  'q', 'time', 'label', 'html', 'body', 'nobr', 'bdi', 'bdo', 'data', 'dfn', 'ruby', 'rt', 'rp', 'output',
  'meter', 'progress', 'cite', 'var', 'blink', 'marquee', 'o:p',
];

/** Every HTML element name we recognise; used to tell real markup from prose. */
const KNOWN_TAGS = new Set([...Object.keys(KEEP), ...DROP, ...VOID, ...UNWRAP_KNOWN]);

/** htmlparser2's open-implies-close rules (only the top of the stack is checked). */
const P_ONLY = new Set(['p']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p']);
const FORM_TAGS = new Set(['input', 'option', 'optgroup', 'select', 'button', 'datalist', 'textarea']);
const IMPLIES_CLOSE: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
  ['tr', new Set(['tr', 'th', 'td'])], ['th', new Set(['th'])], ['td', new Set(['thead', 'th', 'td'])],
  ['body', new Set(['head', 'link', 'script'])], ['a', new Set(['a'])], ['li', new Set(['li'])],
  ['p', P_ONLY], ['h1', HEADINGS], ['h2', HEADINGS], ['h3', HEADINGS], ['h4', HEADINGS], ['h5', HEADINGS],
  ['h6', HEADINGS], ['select', FORM_TAGS], ['input', FORM_TAGS], ['output', FORM_TAGS], ['button', FORM_TAGS],
  ['datalist', FORM_TAGS], ['textarea', FORM_TAGS], ['option', new Set(['option'])],
  ['optgroup', new Set(['optgroup', 'option'])], ['dd', new Set(['dd', 'dt'])], ['dt', new Set(['dd', 'dt'])],
  ...['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
    'footer', 'form', 'header', 'hr', 'main', 'nav', 'ol', 'pre', 'section', 'table', 'ul']
    .map((t): [string, ReadonlySet<string>] => [t, P_ONLY]),
  ['tbody', new Set(['thead', 'tbody'])], ['tfoot', new Set(['thead', 'tbody'])],
]);

/**
 * Structural elements that close an open element of the same family even when inline
 * elements sit above it (`<li><b>x<li>y` -> two items), scanning a bounded number of frames
 * and stopping at the family's container.
 */
const SCOPED_CLOSE: ReadonlyMap<string, { close: ReadonlySet<string>; stop: ReadonlySet<string> }> = new Map([
  ['li', { close: new Set(['li']), stop: new Set(['ul', 'ol', 'menu', 'dir', 'table']) }],
  ['dt', { close: new Set(['dt', 'dd']), stop: new Set(['dl', 'table']) }],
  ['dd', { close: new Set(['dt', 'dd']), stop: new Set(['dl', 'table']) }],
  ['tr', { close: new Set(['tr', 'td', 'th']), stop: new Set(['table', 'thead', 'tbody', 'tfoot']) }],
  ['td', { close: new Set(['td', 'th']), stop: new Set(['tr', 'table']) }],
  ['th', { close: new Set(['td', 'th']), stop: new Set(['tr', 'table']) }],
]);
const SCOPED_SCAN_LIMIT = 12;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const CP1252: Readonly<Record<string, number>> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};
/** A UTF-8 lead byte followed by continuation bytes, as seen through Latin-1 or Windows-1252. */
const MOJIBAKE_RE =
  /[Â-ô][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-‚“-„†-•…‰‹›€™]{1,3}/g;
const utf8 = new TextDecoder('utf-8', { fatal: true });

function decodeMojibake(seq: string): string {
  const bytes: number[] = [];
  for (const ch of seq) {
    const c = ch.charCodeAt(0);
    bytes.push(c <= 0xff ? c : (CP1252[ch] ?? 0));
  }
  const lead = bytes[0] ?? 0;
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2;
  if (bytes.length < need) return seq;
  try {
    return utf8.decode(Uint8Array.from(bytes.slice(0, need))) + seq.slice(need);
  } catch {
    return seq;
  }
}

/**
 * Repair UTF-8 text that was decoded as Latin-1/Windows-1252 somewhere upstream
 * ("donâ€™t" -> "don’t", "MÃ¼nchen" -> "München"). Only byte sequences that form valid
 * UTF-8 are rewritten; repeated until stable so doubly-garbled text also comes out clean.
 */
export function fixMojibake(s: string): string {
  if (!/[Â-ô]/.test(s)) return s;
  for (let pass = 0; pass < 3; pass++) {
    const next = s.replace(MOJIBAKE_RE, decodeMojibake);
    if (next === s) break;
    s = next;
  }
  return s;
}

/** C0/C1 controls (except whitespace), zero-width spaces/joiners used as junk, BOMs. */
const JUNK_RE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f​⁠﻿]/g;

/** Text clean-up shared by every path, so textToHtml output is stable under sanitizeHtml. */
function cleanText(s: string): string {
  return fixMojibake(s).replace(JUNK_RE, '');
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function escText(s: string): string {
  return /[&<>]/.test(s) ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : s;
}

/** Decode HTML entities (named and numeric). */
export function decodeEntities(s: string): string {
  if (typeof s !== 'string' || !s.includes('&')) return typeof s === 'string' ? s : '';
  return decodeHTML(s);
}

/** Escape text for inclusion in HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const BANNED_IN_URL = /(?:javascript|vbscript|livescript|data):/i;

/**
 * Validate and canonicalise a link target. Returns an absolute http(s) or mailto URL, or
 * undefined. Browsers ignore tab/CR/LF anywhere in a URL and strip leading/trailing C0
 * controls and spaces, so we do the same *before* looking at the scheme; the result is
 * re-serialised by the WHATWG URL parser so what we write is exactly what a browser follows.
 * Protocol-relative ("//host/…") and "www." links are upgraded to https.
 */
export function safeHref(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
  if (!s || s.length > 2048) return undefined;
  if (s.startsWith('//')) s = `https:${s}`;
  else if (/^www\.[a-z0-9-]/i.test(s)) s = `https://${s}`;
  if (!/^(?:https?|mailto):/i.test(s)) return undefined;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') return undefined;
  if (url.protocol !== 'mailto:' && !url.hostname) return undefined;
  if (url.protocol === 'mailto:' && !url.pathname.includes('@')) return undefined;
  const href = url.href;
  // Never emit these anywhere in an attribute, even inside an otherwise valid http URL.
  if (BANNED_IN_URL.test(href) || BANNED_IN_URL.test(s)) return undefined;
  return href;
}

function linkLabel(href: string): string {
  if (!href.startsWith('mailto:')) return href;
  const addr = href.slice(7).split('?')[0] ?? '';
  try {
    return decodeURIComponent(addr);
  } catch {
    return addr;
  }
}

function linkHtml(href: string, inner: string): string {
  return `<a href="${escapeHtml(href)}" ${LINK_ATTRS}>${inner}</a>`;
}

// ---------------------------------------------------------------------------
// Detection: markup vs. entity-escaped markup vs. plain text
// ---------------------------------------------------------------------------

const TAGLIKE_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)(?:\s[^<>]*)?\/?>|<!--|<!doctype/gi;

/** True when the string contains at least one real tag of a known HTML element (or a comment). */
function hasRealTags(s: string): boolean {
  if (!s.includes('<')) return false;
  for (const m of s.matchAll(TAGLIKE_RE)) {
    const name = m[2];
    if (name === undefined || KNOWN_TAGS.has(name.toLowerCase())) return true;
  }
  return false;
}

const ESC_OPEN_AT_START = /^\s*&lt;([a-zA-Z][a-zA-Z0-9]*)(?=\s|\/|&gt;)/i;
const ESC_TAG_RE = /&lt;(\/?)([a-zA-Z][a-zA-Z0-9]*)(?=\s|\/|&gt;)/gi;

/** Number of real tags of known elements (and comments/doctypes), stopping once `limit` is exceeded. */
function countRealTags(s: string, limit: number): number {
  if (!s.includes('<')) return 0;
  let n = 0;
  for (const m of s.matchAll(TAGLIKE_RE)) {
    const name = m[2];
    if (name === undefined || KNOWN_TAGS.has(name.toLowerCase())) n++;
    if (n > limit) break;
  }
  return n;
}

/**
 * Is this string an entity-escaped HTML *document* (Greenhouse returns
 * "&lt;div class=&quot;content-intro&quot;&gt;&lt;p&gt;…&lt;/p&gt;…"), rather than prose or
 * markup that merely *mentions* tags ("Use a &lt;br&gt; tag to break lines")?
 *
 * Heuristic, all three must hold:
 *  1. it begins, after optional whitespace, with an escaped tag of a known element —
 *     escaped documents start with their first element, prose about HTML starts with words;
 *  2. it contains at least one escaped *closing* tag of a known element — a lone mention
 *     such as "&lt;br&gt;" or "&lt;div&gt;" never closes an element;
 *  3. escaped tags dominate: there are no real tags, or at least twice as many escaped
 *     known tags as real ones. This covers aggregators (Arbeitnow, Remote OK) that wrap an
 *     escaped ATS description and append a short real-HTML footer ("<p>Find <a>…</a></p>"),
 *     while a real document quoting a few escaped tags as text stays as it is.
 * Only then is the string decoded — exactly once, as a whole — and parsed as HTML.
 */
export function isEntityEscapedMarkup(s: string): boolean {
  if (typeof s !== 'string') return false;
  const m = ESC_OPEN_AT_START.exec(s);
  if (!m || !KNOWN_TAGS.has((m[1] ?? '').toLowerCase())) return false;
  let escaped = 0;
  let closers = 0;
  for (const t of s.matchAll(ESC_TAG_RE)) {
    if (!KNOWN_TAGS.has((t[2] ?? '').toLowerCase())) continue;
    escaped++;
    if (t[1]) closers++;
  }
  if (closers === 0) return false;
  return countRealTags(s, Math.floor(escaped / 2)) * 2 <= escaped;
}

function limitInput(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.length > MAX_HTML_INPUT_CHARS ? s.slice(0, MAX_HTML_INPUT_CHARS) : s;
}

/** The markup to parse, or undefined when the input is plain text. */
function toMarkup(src: string): string | undefined {
  if (isEntityEscapedMarkup(src)) return decodeHTML(src);
  if (hasRealTags(src)) return src;
  return undefined;
}

// ---------------------------------------------------------------------------
// Tree building (linear time, depth-capped)
// ---------------------------------------------------------------------------

interface ElNode {
  tag: string;
  href?: string;
  children: Array<ElNode | string>;
  parent: ElNode | null;
  depth: number;
}

interface Frame {
  name: string;
  node: ElNode | null;
  drop: boolean;
}

function buildTree(markup: string): ElNode {
  const root: ElNode = { tag: '#root', children: [], parent: null, depth: 0 };
  const stack: Frame[] = [];
  const openCount = new Map<string, number>();
  let cur = root;
  let dropDepth = 0;
  let foreignDepth = 0;
  let tagName = '';
  let capturing = false;
  let attrValue = '';
  let href: string | undefined;
  let hrefSeen = false;

  const addText = (t: string): void => {
    if (dropDepth > 0 || !t) return;
    const kids = cur.children;
    const prev = kids[kids.length - 1];
    if (typeof prev === 'string') kids[kids.length - 1] = prev + t;
    else kids.push(t);
  };

  const addLeaf = (tag: string): void => {
    if (dropDepth > 0) return;
    cur.children.push({ tag, children: [], parent: cur, depth: cur.depth + 1 });
  };

  const popFrame = (): void => {
    const f = stack.pop();
    if (!f) return;
    openCount.set(f.name, (openCount.get(f.name) ?? 1) - 1);
    if (f.drop) dropDepth--;
    if (f.name === 'svg' || f.name === 'math') foreignDepth--;
    if (f.node) cur = f.node.parent ?? root;
  };

  const popThrough = (name: string): void => {
    while (stack.length > 0) {
      const top = stack[stack.length - 1]?.name;
      popFrame();
      if (top === name) return;
    }
  };

  const openTag = (selfClosing: boolean): void => {
    const name = tagName;
    tagName = '';
    if (!name) return;

    const implied = IMPLIES_CLOSE.get(name);
    if (implied) {
      while (stack.length > 0 && implied.has(stack[stack.length - 1]?.name ?? '')) popFrame();
    }
    const scoped = SCOPED_CLOSE.get(name);
    if (scoped) {
      for (let i = stack.length - 1; i >= 0 && i >= stack.length - SCOPED_SCAN_LIMIT; i--) {
        const n = stack[i]?.name ?? '';
        if (scoped.stop.has(n)) break;
        if (scoped.close.has(n)) {
          while (stack.length > i) popFrame();
          break;
        }
      }
    }

    if (VOID.has(name)) {
      if (name === 'br' || name === 'hr') addLeaf(name);
      return;
    }

    const frame: Frame = { name, node: null, drop: DROP.has(name) };
    if (frame.drop) dropDepth++;
    else if (dropDepth === 0 && cur.depth < MAX_DEPTH) {
      const tag = KEEP[name];
      const safe = tag === 'a' ? safeHref(href) : undefined;
      if (tag && (tag !== 'a' || safe)) {
        const node: ElNode = { tag, children: [], parent: cur, depth: cur.depth + 1 };
        if (safe) node.href = safe;
        cur.children.push(node);
        cur = node;
        frame.node = node;
      }
    }
    stack.push(frame);
    openCount.set(name, (openCount.get(name) ?? 0) + 1);
    if (name === 'svg' || name === 'math') foreignDepth++;
    // "<svg/>" and self-closing tags inside foreign content really are closed (as in browsers).
    if (selfClosing && foreignDepth > 0) popFrame();
  };

  const cbs: TokenizerCallbacks = {
    onattribname(start, end) {
      attrValue = '';
      capturing = tagName === 'a' && !hrefSeen && markup.slice(start, end).toLowerCase() === 'href';
    },
    onattribdata(start, end) {
      if (capturing) attrValue += markup.slice(start, end);
    },
    onattribentity(cp) {
      if (capturing) attrValue += String.fromCodePoint(cp);
    },
    onattribend() {
      if (capturing) {
        href = attrValue;
        hrefSeen = true;
      }
      capturing = false;
      attrValue = '';
    },
    onopentagname(start, end) {
      tagName = markup.slice(start, end).toLowerCase();
      href = undefined;
      hrefSeen = false;
    },
    onopentagend() {
      openTag(false);
    },
    onselfclosingtag() {
      openTag(true);
    },
    onclosetag(start, end) {
      const name = markup.slice(start, end).toLowerCase();
      if (VOID.has(name)) {
        if (name === 'br') addLeaf('br'); // "</br>" is a line break in every browser
        return;
      }
      if ((openCount.get(name) ?? 0) > 0) popThrough(name);
    },
    ontext(start, end) {
      addText(markup.slice(start, end));
    },
    ontextentity(cp) {
      addText(String.fromCodePoint(cp));
    },
    oncdata() {},
    oncomment() {},
    ondeclaration() {},
    onprocessinginstruction() {},
    onend() {},
    isInForeignContext() {
      return foreignDepth > 0;
    },
  };

  const tokenizer = new Tokenizer({ xmlMode: false, decodeEntities: true }, cbs);
  tokenizer.write(markup);
  tokenizer.end();
  return root;
}

// ---------------------------------------------------------------------------
// Normalised model
// ---------------------------------------------------------------------------

interface InlineEl {
  k: 'el';
  tag: string;
  href?: string;
  children: Inline[];
}
const BR = Object.freeze({ k: 'br' as const });
type Inline = string | typeof BR | InlineEl;

type RunTag = 'p' | 'h3' | 'h4' | 'h5' | 'h6' | 'run';
interface Section {
  t: 'thead' | 'tbody';
  rows: Cell[][];
}
interface Cell {
  th: boolean;
  c: Block[];
}
type Block =
  | { t: RunTag; c: Inline[] }
  | { t: 'pre'; text: string }
  | { t: 'ul' | 'ol'; items: Block[][] }
  | { t: 'blockquote'; c: Block[] }
  | { t: 'hr' }
  | { t: 'table'; sections: Section[] };

/** An inline formatting context: the chain of inline elements a text atom sits in. */
interface Fmt {
  tag: string;
  href?: string;
  parent: Fmt | null;
  inA: boolean;
  chain?: Fmt[];
}
/** A text run (or a line break when text is null) with its formatting. */
interface Atom {
  text: string | null;
  fmt: Fmt | null;
}

const NO_CHAIN: Fmt[] = [];
function chainOf(f: Fmt | null): Fmt[] {
  if (!f) return NO_CHAIN;
  f.chain ??= [...chainOf(f.parent), f];
  return f.chain;
}

/** Collapse whitespace inside a line of atoms and trim both ends; drops empty atoms. */
function normalizeLine(line: Atom[]): Atom[] {
  const out: Atom[] = [];
  let spaceBefore = true;
  for (const a of line) {
    let t = (a.text ?? '').replace(/\s+/g, ' ');
    if (spaceBefore && t.startsWith(' ')) t = t.slice(1);
    if (!t) continue;
    out.push({ text: t, fmt: a.fmt });
    spaceBefore = t.endsWith(' ');
  }
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (!last) break;
    const t = (last.text ?? '').replace(/ $/, '');
    if (t) {
      last.text = t;
      break;
    }
    out.pop();
  }
  return out;
}

/** Rebuild nested inline elements from atoms, merging atoms that share the same element. */
function group(atoms: Atom[], from: number, to: number, level: number): Inline[] {
  const out: Inline[] = [];
  let i = from;
  while (i < to) {
    const a = atoms[i];
    if (!a) break;
    const ch = chainOf(a.fmt);
    if (ch.length <= level) {
      const t = a.text ?? '';
      const prev = out[out.length - 1];
      if (typeof prev === 'string') out[out.length - 1] = prev + t;
      else out.push(t);
      i++;
      continue;
    }
    const f = ch[level];
    let j = i + 1;
    while (j < to) {
      const cj = chainOf(atoms[j]?.fmt ?? null);
      if (cj.length > level && cj[level] === f) j++;
      else break;
    }
    if (f) {
      const el: InlineEl = { k: 'el', tag: f.tag, children: group(atoms, i, j, level + 1) };
      if (f.href) el.href = f.href;
      out.push(el);
    }
    i = j;
  }
  return out;
}

/**
 * Collects inline content into runs and emits blocks. In "item" mode (li, td, th) runs are
 * left bare and paragraph boundaries become single <br>s; otherwise runs become <p> (or the
 * current heading) and a blank line (two or more <br>) starts a new paragraph.
 */
class Flow {
  readonly blocks: Block[] = [];
  runTag: RunTag;
  textCount = 0;
  private atoms: Atom[] = [];

  constructor(readonly item: boolean) {
    this.runTag = item ? 'run' : 'p';
  }

  text(s: string, fmt: Fmt | null): void {
    if (!s) return;
    this.atoms.push({ text: s, fmt });
    if (/\S/.test(s)) this.textCount++;
  }

  br(fmt: Fmt | null): void {
    this.atoms.push({ text: null, fmt });
  }

  boundary(): void {
    if (this.item) {
      if (this.atoms.length > 0) this.atoms.push({ text: null, fmt: null });
    } else {
      this.flush();
    }
  }

  block(b: Block): void {
    this.flush();
    this.blocks.push(b);
  }

  hr(): void {
    this.flush();
    if (this.blocks.length > 0 && this.blocks[this.blocks.length - 1]?.t !== 'hr') this.blocks.push({ t: 'hr' });
  }

  flush(): void {
    const atoms = this.atoms;
    if (atoms.length === 0) return;
    this.atoms = [];
    const split = !this.item && this.runTag === 'p';
    const paras: Inline[][] = [];
    let para: Inline[] | null = null;
    let gap = false;
    let line: Atom[] = [];
    const endLine = (): void => {
      const norm = normalizeLine(line);
      line = [];
      if (norm.length === 0) {
        gap = true;
        return;
      }
      const inl = group(norm, 0, norm.length, 0);
      if (para && !(gap && split)) para.push(BR, ...inl);
      else {
        para = inl;
        paras.push(para);
      }
      gap = false;
    };
    for (const a of atoms) {
      if (a.text === null) endLine();
      else line.push(a);
    }
    endLine();
    for (const c of paras) {
      // Two bare runs in a row (item mode, split by an empty heading or similar) would merge
      // when serialised and re-parsed; join them with the <br> that separates them.
      const last = this.blocks[this.blocks.length - 1];
      if (this.runTag === 'run' && last?.t === 'run') last.c.push(BR, ...c);
      else this.blocks.push({ t: this.runTag, c });
    }
  }
}

function walkChildren(el: ElNode, flow: Flow, fmt: Fmt | null): void {
  for (const ch of el.children) walk(ch, flow, fmt);
}

function walk(node: ElNode | string, flow: Flow, fmt: Fmt | null): void {
  if (typeof node === 'string') {
    flow.text(cleanText(node), fmt);
    return;
  }
  switch (node.tag) {
    case 'br':
      flow.br(fmt);
      return;
    case 'strong':
    case 'b':
    case 'em':
    case 'i':
    case 'u':
    case 'code':
      walkChildren(node, flow, { tag: node.tag, parent: fmt, inA: fmt?.inA ?? false });
      return;
    case 'a': {
      if (fmt?.inA || !node.href) {
        walkChildren(node, flow, fmt);
        return;
      }
      const f: Fmt = { tag: 'a', href: node.href, parent: fmt, inA: true };
      const before = flow.textCount;
      walkChildren(node, flow, f);
      // A link with no text (e.g. it only wrapped an image) shows its address instead.
      if (flow.textCount === before) flow.text(linkLabel(node.href), f);
      return;
    }
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      flow.flush();
      const saved = flow.runTag;
      flow.runTag = node.tag;
      walkChildren(node, flow, fmt);
      flow.flush();
      flow.runTag = saved;
      return;
    }
    case 'ul':
    case 'ol': {
      const b = buildList(node, fmt);
      if (b) flow.block(b);
      else flow.boundary();
      return;
    }
    case 'blockquote': {
      const sub = new Flow(false);
      walkChildren(node, sub, fmt);
      sub.flush();
      if (sub.blocks.length > 0) flow.block({ t: 'blockquote', c: sub.blocks });
      else flow.boundary();
      return;
    }
    case 'pre': {
      const text = preText(node);
      if (text) flow.block({ t: 'pre', text });
      else flow.boundary();
      return;
    }
    case 'hr':
      flow.hr();
      return;
    case 'table': {
      const b = buildTable(node, fmt);
      if (b) flow.block(b);
      else flow.boundary();
      return;
    }
    case 'p':
    case 'div':
    case 'li':
    case 'tr':
    case 'td':
    case 'th':
    case 'thead':
    case 'tbody':
      // Paragraph boundary (list/table parts only get here when they are misplaced).
      flow.boundary();
      walkChildren(node, flow, fmt);
      flow.boundary();
      return;
    default:
      walkChildren(node, flow, fmt);
  }
}

function isBlank(n: ElNode | string): boolean {
  return typeof n === 'string' && !/\S/.test(cleanText(n));
}

function itemBlocks(children: Array<ElNode | string>, fmt: Fmt | null): Block[] {
  const f = new Flow(true);
  for (const ch of children) walk(ch, f, fmt);
  f.flush();
  return f.blocks;
}

function buildList(el: ElNode, fmt: Fmt | null): Block | null {
  const items: Block[][] = [];
  let stray: Array<ElNode | string> = [];
  const endStray = (): void => {
    if (stray.length === 0) return;
    const blocks = itemBlocks(stray, fmt);
    stray = [];
    if (blocks.length > 0) items.push(blocks);
  };
  for (const ch of el.children) {
    if (typeof ch !== 'string' && ch.tag === 'li') {
      endStray();
      const blocks = itemBlocks(ch.children, fmt);
      if (blocks.length > 0) items.push(blocks);
    } else if (typeof ch !== 'string' && (ch.tag === 'ul' || ch.tag === 'ol')) {
      // A list nested directly in a list belongs to the preceding item.
      endStray();
      const sub = buildList(ch, fmt);
      if (sub) {
        const last = items[items.length - 1];
        if (last) last.push(sub);
        else items.push([sub]);
      }
    } else if (stray.length > 0 || !isBlank(ch)) {
      stray.push(ch);
    }
  }
  endStray();
  return items.length > 0 ? { t: el.tag === 'ol' ? 'ol' : 'ul', items } : null;
}

function buildCells(children: Array<ElNode | string>, fmt: Fmt | null): Cell[] {
  const cells: Cell[] = [];
  let stray: Array<ElNode | string> = [];
  const endStray = (): void => {
    if (stray.length === 0) return;
    const c = itemBlocks(stray, fmt);
    stray = [];
    if (c.length > 0) cells.push({ th: false, c });
  };
  for (const ch of children) {
    if (typeof ch !== 'string' && (ch.tag === 'td' || ch.tag === 'th')) {
      endStray();
      cells.push({ th: ch.tag === 'th', c: itemBlocks(ch.children, fmt) });
    } else if (stray.length > 0 || !isBlank(ch)) {
      stray.push(ch);
    }
  }
  endStray();
  return cells;
}

function buildRows(children: Array<ElNode | string>, fmt: Fmt | null): Cell[][] {
  const rows: Cell[][] = [];
  let loose: Array<ElNode | string> = [];
  const endLoose = (): void => {
    if (loose.length === 0) return;
    rows.push(buildCells(loose, fmt));
    loose = [];
  };
  for (const ch of children) {
    if (typeof ch !== 'string' && ch.tag === 'tr') {
      endLoose();
      rows.push(buildCells(ch.children, fmt));
    } else if (loose.length > 0 || !isBlank(ch)) {
      loose.push(ch);
    }
  }
  endLoose();
  return rows.filter((r) => r.some((c) => c.c.length > 0));
}

function buildTable(el: ElNode, fmt: Fmt | null): Block | null {
  const sections: Section[] = [];
  let loose: Array<ElNode | string> = [];
  const endLoose = (): void => {
    if (loose.length === 0) return;
    const rows = buildRows(loose, fmt);
    loose = [];
    if (rows.length > 0) sections.push({ t: 'tbody', rows });
  };
  for (const ch of el.children) {
    if (typeof ch !== 'string' && (ch.tag === 'thead' || ch.tag === 'tbody')) {
      endLoose();
      const rows = buildRows(ch.children, fmt);
      if (rows.length > 0) sections.push({ t: ch.tag, rows });
    } else if (loose.length > 0 || !isBlank(ch)) {
      loose.push(ch);
    }
  }
  endLoose();
  return sections.length > 0 ? { t: 'table', sections } : null;
}

const PRE_BREAKS = new Set(['p', 'div', 'li', 'tr', 'ul', 'ol', 'table', 'blockquote', 'pre', 'hr', 'h3', 'h4', 'h5', 'h6']);

function preText(el: ElNode): string {
  let out = '';
  const rec = (n: ElNode | string): void => {
    if (typeof n === 'string') {
      out += n;
      return;
    }
    if (n.tag === 'br') {
      out += '\n';
      return;
    }
    const brk = PRE_BREAKS.has(n.tag);
    if (brk) out += '\n';
    for (const c of n.children) rec(c);
    if (brk) out += '\n';
    else if (n.tag === 'td' || n.tag === 'th') out += ' ';
  };
  for (const c of el.children) rec(c);
  return cleanText(out)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*\n/, '')
    .trimEnd();
}

function toBlocks(markup: string): Block[] {
  const flow = new Flow(false);
  walkChildren(buildTree(markup), flow, null);
  flow.flush();
  const blocks = flow.blocks;
  while (blocks[0]?.t === 'hr') blocks.shift();
  while (blocks[blocks.length - 1]?.t === 'hr') blocks.pop();
  return blocks;
}

// ---------------------------------------------------------------------------
// Serialisers
// ---------------------------------------------------------------------------

function inlineHtml(nodes: Inline[]): string {
  let s = '';
  for (const n of nodes) {
    if (typeof n === 'string') s += escText(n);
    else if (n.k === 'br') s += '<br>';
    else if (n.tag === 'a' && n.href) s += linkHtml(n.href, inlineHtml(n.children));
    else s += `<${n.tag}>${inlineHtml(n.children)}</${n.tag}>`;
  }
  return s;
}

function blocksHtml(blocks: Block[]): string {
  let s = '';
  for (const b of blocks) {
    switch (b.t) {
      case 'run':
        s += inlineHtml(b.c);
        break;
      case 'p':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        s += `<${b.t}>${inlineHtml(b.c)}</${b.t}>`;
        break;
      case 'pre':
        s += `<pre>${escText(b.text)}</pre>`;
        break;
      case 'hr':
        s += '<hr>';
        break;
      case 'blockquote':
        s += `<blockquote>${blocksHtml(b.c)}</blockquote>`;
        break;
      case 'ul':
      case 'ol':
        s += `<${b.t}>`;
        for (const item of b.items) s += `<li>${blocksHtml(item)}</li>`;
        s += `</${b.t}>`;
        break;
      case 'table':
        s += '<table>';
        for (const sec of b.sections) {
          s += `<${sec.t}>`;
          for (const row of sec.rows) {
            s += '<tr>';
            for (const cell of row) {
              const tag = cell.th ? 'th' : 'td';
              s += `<${tag}>${blocksHtml(cell.c)}</${tag}>`;
            }
            s += '</tr>';
          }
          s += `</${sec.t}>`;
        }
        s += '</table>';
        break;
    }
  }
  return s;
}

function inlineText(nodes: Inline[]): string {
  let s = '';
  for (const n of nodes) {
    if (typeof n === 'string') s += n;
    else if (n.k === 'br') s += '\n';
    else s += inlineText(n.children);
  }
  return s;
}

function blockLines(b: Block): string[] {
  switch (b.t) {
    case 'run':
    case 'p':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return inlineText(b.c).split('\n');
    case 'pre':
      return b.text.split('\n').map(collapse);
    case 'hr':
      return [];
    case 'blockquote':
      return b.c.flatMap((x, i) => (i > 0 ? ['', ...blockLines(x)] : blockLines(x)));
    case 'ul':
    case 'ol': {
      const lines: string[] = [];
      for (const item of b.items) {
        const inner = item.flatMap(blockLines).filter((l) => l.trim() !== '');
        inner.forEach((l, i) => lines.push(i === 0 ? `- ${l}` : `  ${l}`));
      }
      return lines;
    }
    case 'table': {
      const lines: string[] = [];
      for (const sec of b.sections) {
        for (const row of sec.rows) {
          const cells = row
            .map((c) => collapse(c.c.flatMap(blockLines).join(' ')))
            .filter((t) => t !== '');
          if (cells.length > 0) lines.push(cells.join(' | '));
        }
      }
      return lines;
    }
  }
}

function blocksText(blocks: Block[]): string {
  const chunks: string[] = [];
  for (const b of blocks) {
    const lines = blockLines(b);
    if (lines.some((l) => l.trim() !== '')) chunks.push(lines.join('\n'));
  }
  return chunks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function plainText(text: string): string {
  return cleanText(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(collapse)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return HTML that is safe to inject and visually consistent:
 *  - allow only structural/inline text tags (p, br, ul, ol, li, strong/b, em/i, u, h3–h6
 *    [h1/h2 are demoted to h3], blockquote, code, pre, a, hr, table/thead/tbody/tr/th/td, span→unwrapped, div→p)
 *  - drop every attribute except a[href]; hrefs must be http(s) or mailto; links get
 *    target="_blank" rel="noopener noreferrer nofollow"
 *  - drop scripts, styles, iframes, images, forms, comments and event handlers entirely
 *  - accept entity-escaped HTML ("&lt;p&gt;…") as produced by some ATS APIs: when the input
 *    has no real tags but decodes to markup, decode once first
 *  - collapse empty paragraphs and runs of <br>
 * Plain text input (no markup) is converted with textToHtml.
 *
 * Notes: a div (or section/article/…) becomes a paragraph boundary, i.e. a <p> when it holds
 * text and nothing when it only wraps other blocks; inside li/td/th, paragraph boundaries become
 * a single <br>. Inline formatting that spans blocks is re-applied inside each block, as browsers
 * do. A link that has no text shows its address. The output is stable:
 * sanitizeHtml(sanitizeHtml(x)) === sanitizeHtml(x). Inputs are capped at MAX_HTML_INPUT_CHARS.
 */
export function sanitizeHtml(html: string): string {
  const src = limitInput(html);
  if (!/\S/.test(src)) return '';
  const markup = toMarkup(src);
  if (markup === undefined) return textToHtml(decodeEntities(src));
  return blocksHtml(toBlocks(markup));
}

/**
 * Convert HTML to readable plain text: block elements become line breaks, list
 * items get a "- " prefix, entities are decoded, whitespace is collapsed, and no
 * tag or attribute text leaks through. Accepts entity-escaped HTML like sanitizeHtml.
 *
 * Layout: blocks are separated by one blank line; list items are one per line ("- item",
 * nested lists indented by two spaces); table rows are one per line with cells joined by
 * " | "; <br> is a newline. Link text is kept and the URL dropped, unless the link has no text.
 */
export function htmlToText(html: string): string {
  const src = limitInput(html);
  if (!/\S/.test(src)) return '';
  const markup = toMarkup(src);
  if (markup === undefined) return plainText(decodeEntities(src));
  return blocksText(toBlocks(markup));
}

const BULLET_RE = /^\s*(?:[-*•·▪◦‣●○■□►▸➢➤✓✔]|–|—)\s+(.*)$/;
const NUMBERED_RE = /^\s*\(?\d{1,3}[.)]\s+(.*)$/;
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;

function trimUrl(url: string): string {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (last === undefined) return u;
    if ('.,;:!?*\'"’”'.includes(last)) u = u.slice(0, -1);
    else if (last === ')' && u.split('(').length < u.split(')').length) u = u.slice(0, -1);
    else if (last === ']' && u.split('[').length < u.split(']').length) u = u.slice(0, -1);
    else if (last === '}' || last === '>') u = u.slice(0, -1);
    else return u;
  }
}

/** Escape a collapsed line of text and turn bare http(s) URLs into links. */
function linkify(line: string): string {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    const href = safeHref(url);
    if (!href || m.index < last) continue;
    out += `${escText(line.slice(last, m.index))}${linkHtml(href, escText(url))}`;
    last = m.index + url.length;
  }
  return out + escText(line.slice(last));
}

/** Convert plain text to safe HTML: escape, blank lines -> paragraphs, "- "/"* "/"• " lines -> lists, bare URLs -> links. */
export function textToHtml(text: string): string {
  const src = cleanText(limitInput(text)).replace(/\r\n?/g, '\n');
  let html = '';
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: string[][] } | null = null;
  const closePara = (): void => {
    if (para.length > 0) html += `<p>${para.join('<br>')}</p>`;
    para = [];
  };
  const closeList = (): void => {
    if (list) html += `<${list.t}>${list.items.map((i) => `<li>${i.join('<br>')}</li>`).join('')}</${list.t}>`;
    list = null;
  };
  for (const raw of src.split('\n')) {
    const line = collapse(raw);
    if (!line) {
      closePara();
      closeList();
      continue;
    }
    const bullet = BULLET_RE.exec(raw);
    const numbered = bullet ? null : NUMBERED_RE.exec(raw);
    if (bullet || numbered) {
      const content = collapse((bullet ? bullet[1] : numbered?.[1]) ?? '');
      if (!content) continue;
      const t = bullet ? 'ul' : 'ol';
      closePara();
      if (list && list.t !== t) closeList();
      list ??= { t, items: [] };
      list.items.push([linkify(content)]);
      continue;
    }
    const lastItem = list?.items[list.items.length - 1];
    if (lastItem && /^\s/.test(raw)) {
      lastItem.push(linkify(line)); // indented continuation of a list item
      continue;
    }
    closeList();
    para.push(linkify(line));
  }
  closePara();
  closeList();
  return html;
}
