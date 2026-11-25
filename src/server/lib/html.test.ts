import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from 'htmlparser2';
import { describe, expect, it } from 'vitest';
import {
  MAX_HTML_INPUT_CHARS,
  decodeEntities,
  escapeHtml,
  fixMojibake,
  htmlToText,
  isEntityEscapedMarkup,
  safeHref,
  sanitizeHtml,
  textToHtml,
} from './html';

const LINK = 'target="_blank" rel="noopener noreferrer nofollow"';
const a = (href: string, text: string): string => `<a href="${href}" ${LINK}>${text}</a>`;

// ---------------------------------------------------------------------------
// Invariants every sanitizeHtml output must satisfy
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set([
  'p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code',
  'pre', 'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);
const FORBIDDEN_RE = /<\s*\/?\s*(?:script|style|iframe|img|svg|math|form|input|object|embed|link|meta|base|textarea|title|noscript|template|xmp)\b/i;
const BANNED_SCHEME_RE = /(?:javascript|data|vbscript)\s*:/i;
/** "<" directly followed by a tag name (or "/" and a tag name). */
const TAG_IN_TEXT_RE = /<\/?[a-zA-Z]/;

/** Problems found in sanitised output; an empty list means every invariant holds. */
function violations(out: string): string[] {
  const problems: string[] = [];
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (!ALLOWED_TAGS.has(name)) problems.push(`tag <${name}>`);
        for (const [k, v] of Object.entries(attrs)) {
          if (name !== 'a' || !['href', 'target', 'rel'].includes(k)) problems.push(`attribute ${name}[${k}]`);
          if (BANNED_SCHEME_RE.test(v)) problems.push(`banned scheme in ${name}[${k}]=${v}`);
        }
        if (name === 'a') {
          if (!/^(?:https?:\/\/|mailto:)/i.test(attrs.href ?? '')) problems.push(`href ${attrs.href ?? '(none)'}`);
          if (attrs.target !== '_blank') problems.push('a without target=_blank');
          if (attrs.rel !== 'noopener noreferrer nofollow') problems.push('a without rel');
        }
      },
      oncomment() {
        problems.push('comment');
      },
      onprocessinginstruction(name) {
        problems.push(`declaration ${name}`);
      },
    },
    { decodeEntities: true },
  );
  parser.write(out);
  parser.end();
  if (FORBIDDEN_RE.test(out)) problems.push('forbidden element text');
  const again = sanitizeHtml(out);
  if (again !== out) problems.push(`not stable under a second pass:\n  1: ${out.slice(0, 300)}\n  2: ${again.slice(0, 300)}`);
  return problems;
}

function expectSafe(input: string): string {
  const out = sanitizeHtml(input);
  expect(violations(out), `input: ${input.slice(0, 200)}`).toEqual([]);
  return out;
}

// ---------------------------------------------------------------------------
// Data-driven: every HTML-looking string in the captured source fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = fileURLToPath(new URL('../../../tests/fixtures/sources', import.meta.url));
const LOOKS_HTML_RE = /<\/?[a-zA-Z][^<>]*>|&lt;\/?[a-zA-Z]/;

function listFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries.sort()) {
    const p = join(dir, e);
    try {
      if (statSync(p).isDirectory()) out.push(...listFiles(p));
      else out.push(p);
    } catch {
      // unreadable entry: skip
    }
  }
  return out;
}

function stringsFromJson(v: unknown, out: string[]): void {
  if (typeof v === 'string') {
    if (LOOKS_HTML_RE.test(v)) out.push(v);
  } else if (Array.isArray(v)) {
    for (const x of v) stringsFromJson(x, out);
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v)) stringsFromJson(x, out);
  }
}

/** Text content of every XML element / CDATA section, as an RSS reader would hand it to an adapter. */
function stringsFromXml(xml: string, out: string[]): void {
  let buf = '';
  const flush = (): void => {
    if (LOOKS_HTML_RE.test(buf)) out.push(buf);
    buf = '';
  };
  const p = new Parser({ ontext: (t) => (buf += t), onopentag: flush, onclosetag: flush }, { xmlMode: true, decodeEntities: true });
  p.write(xml);
  p.end();
  flush();
}

interface FixtureString {
  file: string;
  value: string;
}

function fixtureStrings(): FixtureString[] {
  const found: FixtureString[] = [];
  for (const file of listFiles(FIXTURE_ROOT)) {
    const isJson = file.endsWith('.json');
    if (!isJson && !file.endsWith('.xml')) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!text.trim()) continue;
    const values: string[] = [];
    if (isJson) {
      try {
        stringsFromJson(JSON.parse(text), values);
      } catch {
        continue; // truncated or not really JSON
      }
    } else {
      stringsFromXml(text, values);
    }
    for (const value of values) found.push({ file: relative(FIXTURE_ROOT, file), value });
  }
  return found;
}

describe('sanitizeHtml on captured source fixtures', () => {
  const strings = fixtureStrings();

  it('finds HTML descriptions in the fixtures', () => {
    expect(strings.length).toBeGreaterThan(50);
  });

  it('satisfies every invariant on every HTML string', () => {
    const failures: string[] = [];
    for (const { file, value } of strings) {
      const out = sanitizeHtml(value);
      const problems = violations(out);
      const text = htmlToText(out);
      if (TAG_IN_TEXT_RE.test(text)) problems.push(`tag-like text in htmlToText: ${text.slice(text.search(TAG_IN_TEXT_RE), 80)}`);
      if (/\S/.test(htmlToText(value)) && !/\S/.test(out)) problems.push('non-empty description sanitised to nothing');
      if (problems.length > 0) failures.push(`${file}: ${problems.join('; ')}`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('turns entity-escaped (Greenhouse) descriptions into real markup', () => {
    const escaped = strings.filter((s) => !/<[a-zA-Z]/.test(s.value) && isEntityEscapedMarkup(s.value));
    expect(escaped.length).toBeGreaterThan(0);
    for (const { value } of escaped) {
      const out = sanitizeHtml(value);
      expect(out).toMatch(/^<(?:p|h3|h4|ul|ol|table|blockquote|pre)>/);
      expect(out).not.toContain('&lt;p&gt;');
    }
  });

  it('keeps the readable text of fixture descriptions (htmlToText of input and output agree)', () => {
    let checked = 0;
    for (const { value } of strings) {
      expect(htmlToText(sanitizeHtml(value))).toBe(htmlToText(value));
      checked++;
    }
    expect(checked).toBe(strings.length);
  });

  it('does not throw on files that are empty, not JSON/XML, or malformed', () => {
    expect(() => fixtureStrings()).not.toThrow();
    expect(() => stringsFromXml('', [])).not.toThrow();
    expect(() => stringsFromXml('<rss><channel><item><description>&lt;p&gt;x', [])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// XSS
// ---------------------------------------------------------------------------

const XSS: string[] = [
  // script in every casing / nesting
  '<script>alert(1)</script>',
  '<SCRIPT>alert(1)</SCRIPT>',
  '<ScRiPt src=//evil.example/x.js></ScRiPt>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<script><script>alert(1)</script></script>',
  '<<script>script>alert(1)<</script>/script>',
  '<script\n>alert(1)</script\n>',
  '<script/xss src="//evil.example"></script>',
  '<p>before<script>document.write("<p>x</p>")</script>after</p>',
  '<script>unclosed alert(1)',
  '<div><script>alert(1)</div>',
  // event handlers
  '<p onclick="alert(1)" onmouseover=alert(1)>x</p>',
  '<a href="https://ok.example" onclick="alert(1)">x</a>',
  '<body onload=alert(1)><p>x</p></body>',
  '<b/onmouseover=alert(1)>x</b>',
  '<p\nonclick\n=\nalert(1)>x</p>',
  // javascript: URLs, obfuscated
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="&#x6A;&#x61;&#x76;&#x61;script:alert(1)">x</a>',
  '<a href="&#0000106&#0000097vascript:alert(1)">x</a>',
  '<a href="java&#09;script:alert(1)">x</a>',
  '<a href="java\tscript:alert(1)">x</a>',
  '<a href="java&NewLine;script:alert(1)">x</a>',
  '<a href=" &#14;  javascript:alert(1)">x</a>',
  '<a href="\u0001javascript:alert(1)">x</a>',
  '<a href="javascript&colon;alert(1)">x</a>',
  '<a href="jav&#x09;ascript:alert(1)">x</a>',
  '<a href=javascript:alert(1)>x</a>',
  '<a href="  javascript:alert(1)">x</a>',
  '<a href="https://ok.example" href="javascript:alert(1)">x</a>',
  '<a href="https://ok.example/?u=javascript:alert(1)">x</a>',
  '<a href="https://ok.example/&quot; onmouseover=&quot;alert(1)">x</a>',
  '<a href="http:javascript:alert(1)">x</a>',
  '<a href="//ok.example/x">protocol-relative</a>',
  // data: / vbscript:
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<a href="DATA:text/html,<script>alert(1)</script>">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="VBScript:msgbox(1)">x</a>',
  // SVG / MathML
  '<svg onload=alert(1)>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><a xlink:href="javascript:alert(1)"><text x="0" y="20">x</text></a></svg>',
  '<svg/><p>after</p>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<math href="javascript:alert(1)">CLICK</math>',
  '<math><mi xlink:href="data:x,<script>alert(1)</script>">x</mi></math>',
  // styles
  '<style>body{background:red}</style><p>x</p>',
  '<p style="position:fixed;top:0;background:url(javascript:alert(1))">x</p>',
  '<div style="behavior:url(x.htc)">x</div>',
  // images, frames, objects, forms
  '<img src=x onerror=alert(1)>',
  '<img src="https://tracker.example/pixel.gif" width="1" height="1">',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="javascript:alert(1)"></object><embed src="javascript:alert(1)">',
  '<form action="https://evil.example"><input name=x><button>Go</button></form>',
  '<video><source onerror="alert(1)"></video>',
  // malformed / unclosed
  '<p>unclosed <b>bold <i>italic',
  '<a href="https://ok.example"',
  '<a href="https://ok.example">unterminated',
  '<p <script>alert(1)</script>>x</p>',
  '<img """><script>alert(1)</script>">',
  '<</p>>',
  '<p>a</b></i></u></a></p></p></div>',
  // comments
  '<p>x</p><!-- <script>alert(1)</script> -->',
  '<!--[if IE]><script>alert(1)</script><![endif]-->',
  '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings></o:OfficeDocumentSettings></xml><![endif]-->',
  '<!--> <script>alert(1)</script> -->',
  '<!-- unterminated comment <script>alert(1)</script>',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<?xml version="1.0"?><p>x</p>',
  '<!DOCTYPE html><p>x</p>',
  // base / meta / link
  '<base href="javascript:alert(1)//"><a href="/x">x</a>',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<link rel=stylesheet href=//evil.example/x.css>',
  // mutation-XSS style
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<template><img src=x onerror=alert(1)></template>',
  '<title><img src=x onerror=alert(1)></title>',
  '<textarea><img src=x onerror=alert(1)></textarea>',
  '<xmp><img src=x onerror=alert(1)></xmp>',
  '<noembed><img title="</noembed><img src onerror=alert(1)>"></noembed>',
  '<select><style><img src=x onerror=alert(1)></style></select>',
  '<plaintext><img src=x onerror=alert(1)>',
  '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
  '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
  '<p>&lt;/p&gt;&lt;img src=x onerror=alert(1)&gt;</p>',
  // entity-escaped payloads (decoded at most once, then sanitised)
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&lt;p&gt;Hi&lt;/p&gt;&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
  '&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;&lt;/p&gt;',
  '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;',
  '&lt;p&gt;&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;&lt;/p&gt;',
];

describe('sanitizeHtml XSS', () => {
  it.each(XSS)('neutralises %s', (input) => {
    const out = expectSafe(input);
    expect(out).not.toMatch(/<[^>]+\son\w+\s*=/i);
    expect(out).not.toMatch(/<[^>]*(?:javascript|vbscript|data):/i);
    const text = htmlToText(out);
    expect(text).toBe(htmlToText(input));
    // Script/markup text may only appear in the plain text when the input spelled it as escaped text.
    if (!/&(?:amp;)?lt;/.test(input)) expect(text).not.toMatch(/<(?:script|img|svg|style|iframe)/i);
  });

  it('drops script/style content entirely (not just the tags)', () => {
    expect(sanitizeHtml('<p>a<script>alert(1)</script>b</p>')).toBe('<p>ab</p>');
    expect(sanitizeHtml('<style>p{color:red}</style><p>x</p>')).toBe('<p>x</p>');
    expect(sanitizeHtml('<p>x</p><script>unclosed')).toBe('<p>x</p>');
    expect(sanitizeHtml('<scr<script>ipt>alert(1)</scr</script>ipt>')).toBe('<p>ipt&gt;alert(1)ipt&gt;</p>');
  });

  it('removes unsafe links but keeps their text', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">click</a>')).toBe('<p>click</p>');
    expect(sanitizeHtml('<a href="&#106;avascript:alert(1)">click</a>')).toBe('<p>click</p>');
    expect(sanitizeHtml('<a href="java&#09;script:alert(1)">click</a>')).toBe('<p>click</p>');
    expect(sanitizeHtml('<a href="data:text/html,x">click</a>')).toBe('<p>click</p>');
    expect(sanitizeHtml('<a href="https://ok.example/?u=javascript:alert(1)">click</a>')).toBe('<p>click</p>');
    expect(sanitizeHtml('<a>no href</a>')).toBe('<p>no href</p>');
    expect(sanitizeHtml('<a href="/relative/path">rel</a>')).toBe('<p>rel</p>');
  });

  it('keeps only href on links, canonicalised, with fixed target/rel', () => {
    expect(sanitizeHtml('<a href="https://ok.example" title="t" class="c" style="s" target="_self" rel="opener" id="i">ok</a>')).toBe(
      `<p>${a('https://ok.example/', 'ok')}</p>`,
    );
    expect(sanitizeHtml('<a href=" https://ok.example/a?b=1&amp;c=2 ">ok</a>')).toBe(`<p>${a('https://ok.example/a?b=1&amp;c=2', 'ok')}</p>`);
    expect(sanitizeHtml('<a href="//cdn.example/x">x</a>')).toBe(`<p>${a('https://cdn.example/x', 'x')}</p>`);
    expect(sanitizeHtml('<a href="mailto:jobs@example.com">Email us</a>')).toBe(`<p>${a('mailto:jobs@example.com', 'Email us')}</p>`);
    expect(sanitizeHtml('<a href="https://ok.example/&quot; onmouseover=&quot;alert(1)">x</a>')).toBe(
      `<p>${a('https://ok.example/%22%20onmouseover=%22alert(1)', 'x')}</p>`,
    );
  });

  it('renders mutation-XSS containers as nothing', () => {
    for (const tag of ['noscript', 'template', 'title', 'textarea', 'xmp', 'noembed', 'iframe', 'select']) {
      expect(sanitizeHtml(`<p>a</p><${tag}><img src=x onerror=alert(1)></${tag}><p>b</p>`)).toBe('<p>a</p><p>b</p>');
    }
  });

  it('decodes entity-escaped payloads exactly once, then sanitises', () => {
    expect(sanitizeHtml('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('');
    expect(sanitizeHtml('&lt;p&gt;Hi&lt;/p&gt;&lt;img src=x onerror=alert(1)&gt;')).toBe('<p>Hi</p>');
    // Inside a real document, escaped markup is text and stays text.
    expect(sanitizeHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    // Doubly escaped: one decode leaves escaped text, shown verbatim, never markup.
    expect(sanitizeHtml('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;')).toBe('<p>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</p>');
    expect(htmlToText('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    // Escaped document containing a doubly-escaped payload: the payload ends up as visible text.
    expect(sanitizeHtml('&lt;p&gt;&amp;lt;script&amp;gt;x&amp;lt;/script&amp;gt;&lt;/p&gt;')).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });
});

describe('safeHref', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['HTTP://EXAMPLE.com/A', 'http://example.com/A'],
    ['  https://example.com/x  ', 'https://example.com/x'],
    ['//example.com/x', 'https://example.com/x'],
    ['www.example.com/jobs', 'https://www.example.com/jobs'],
    ['mailto:a@b.co', 'mailto:a@b.co'],
    ['https://exa\nmple.com/', 'https://example.com/'],
    ['http:///x', 'http://x/'], // what a browser follows, too
  ])('accepts %j', (input, expected) => {
    expect(safeHref(input)).toBe(expected);
  });

  it.each([
    undefined, '', ' ', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' \u0000javascript:alert(1)', 'java\nscript:alert(1)',
    'data:text/html,x', 'vbscript:x', 'ftp://example.com', '/relative', '#anchor', 'mailto:', 'https://',
    'https://example.com/?next=javascript:alert(1)', 'tel:+15555550100', `https://example.com/${'a'.repeat(3000)}`,
  ])('rejects %j', (input) => {
    expect(safeHref(input)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Entity-escaped markup detection
// ---------------------------------------------------------------------------

describe('entity-escaped markup detection', () => {
  it('decodes Greenhouse-style escaped documents once', () => {
    const gh =
      '&lt;div class=&quot;content-intro&quot;&gt;&lt;p&gt;We are &lt;strong&gt;hiring&lt;/strong&gt; at AT&amp;amp;T.&lt;/p&gt;&lt;/div&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;';
    expect(isEntityEscapedMarkup(gh)).toBe(true);
    expect(sanitizeHtml(gh)).toBe('<p>We are <strong>hiring</strong> at AT&amp;T.</p><ul><li>One</li></ul>');
    expect(htmlToText(gh)).toBe('We are hiring at AT&T.\n\n- One');
    expect(isEntityEscapedMarkup('  \n&lt;p&gt;Hello&lt;/p&gt;')).toBe(true);
    expect(isEntityEscapedMarkup('&lt;h2&gt;About&lt;/h2&gt;text')).toBe(true);
  });

  it('decodes an escaped body that an aggregator followed with a real-HTML footer', () => {
    const mixed =
      '&lt;p&gt;Body &amp;amp; more&lt;/p&gt;\n&lt;ul&gt;&lt;li&gt;x&lt;/li&gt;&lt;li&gt;y&lt;/li&gt;&lt;/ul&gt;<p>Find <a href="https://www.arbeitnow.co.uk">Jobs</a> on Arbeitnow</a>';
    expect(isEntityEscapedMarkup(mixed)).toBe(true);
    expect(sanitizeHtml(mixed)).toBe(
      `<p>Body &amp; more</p><ul><li>x</li><li>y</li></ul><p>Find ${a('https://www.arbeitnow.co.uk/', 'Jobs')} on Arbeitnow</p>`,
    );
    const footer = '&lt;p&gt;Hi&lt;/p&gt;&lt;h3&gt;&lt;/h3&gt;<br/><br/>Please mention the word **X** when applying';
    expect(sanitizeHtml(footer)).toBe('<p>Hi</p><p>Please mention the word **X** when applying</p>');
  });

  it('does not decode a real document that only quotes a few escaped tags', () => {
    const doc = '&lt;b&gt;Note&lt;/b&gt;<p>a</p><p>b</p>';
    expect(isEntityEscapedMarkup(doc)).toBe(false);
    expect(sanitizeHtml(doc)).toBe('<p>&lt;b&gt;Note&lt;/b&gt;</p><p>a</p><p>b</p>');
  });

  it('leaves prose that merely mentions tags as text', () => {
    for (const prose of [
      'Use a &lt;br&gt; tag to break lines',
      'You know when to use &lt;div&gt; vs &lt;section&gt; and why &lt;/p&gt; is optional.',
      'Experience with &lt;canvas&gt; and WebGL',
      '&lt;br&gt; is a void element', // starts with a tag but never closes an element
      '&lt;3 our team!',
      '&lt;custom-element&gt;x&lt;/custom-element&gt;',
      '&lt;foo&gt;bar&lt;/foo&gt;',
    ]) {
      expect(isEntityEscapedMarkup(prose), prose).toBe(false);
      const out = sanitizeHtml(prose);
      expect(out.startsWith('<p>')).toBe(true);
      expect(htmlToText(out)).toBe(decodeEntities(prose).replace(/\s+/g, ' ').trim());
    }
    expect(sanitizeHtml('Use a &lt;br&gt; tag to break lines')).toBe('<p>Use a &lt;br&gt; tag to break lines</p>');
  });

  it('does not decode escaped markup that sits inside real markup', () => {
    expect(sanitizeHtml('<p>Write &lt;p&gt;text&lt;/p&gt;</p>')).toBe('<p>Write &lt;p&gt;text&lt;/p&gt;</p>');
  });

  it('treats unknown tag-like text as prose, not markup', () => {
    expect(sanitizeHtml('Salary <$100k> negotiable')).toBe('<p>Salary &lt;$100k&gt; negotiable</p>');
    expect(sanitizeHtml('Use Vec<String> and Option<T>')).toBe('<p>Use Vec&lt;String&gt; and Option&lt;T&gt;</p>');
    expect(sanitizeHtml('5 < 6 and 7 > 3')).toBe('<p>5 &lt; 6 and 7 &gt; 3</p>');
  });
});

// ---------------------------------------------------------------------------
// Output hygiene
// ---------------------------------------------------------------------------

describe('sanitizeHtml output hygiene', () => {
  it.each([
    ['<h1>Title</h1><h2>Sub</h2><h3>Three</h3><h6>Six</h6>', '<h3>Title</h3><h3>Sub</h3><h3>Three</h3><h6>Six</h6>'],
    ['<div>Block one</div><div>Block two</div>', '<p>Block one</p><p>Block two</p>'],
    ['<div><div><p>Nested</p></div></div>', '<p>Nested</p>'],
    ['<div>Text<ul><li>a</li></ul>more</div>', '<p>Text</p><ul><li>a</li></ul><p>more</p>'],
    ['<p><span style="color:red">red</span> <font face="x">font</font></p>', '<p>red font</p>'],
    ['<p>a<br><br><br><br>b</p>', '<p>a</p><p>b</p>'],
    ['<p>a<br>b</p>', '<p>a<br>b</p>'],
    ['<p>x<br></p><p><br></p>', '<p>x</p>'],
    ['<p></p><p> </p><p>&nbsp;</p><p><span> </span></p><p>Real</p>', '<p>Real</p>'],
    ['  \n<p>  padded   text  </p>\n  ', '<p>padded text</p>'],
    ['<br><br><p>x</p><br>', '<p>x</p>'],
    ['<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>', '<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>'],
    ['<ol><li><p>Para in item</p></li></ol>', '<ol><li>Para in item</li></ol>'],
    ['<ul><li><p>a</p><p>b</p></li></ul>', '<ul><li>a<br>b</li></ul>'],
    ['<ul><li></li><li> </li><li>x</li></ul>', '<ul><li>x</li></ul>'],
    ['<ul></ul><p>x</p>', '<p>x</p>'],
    ['<ul><li>a<li>b</ul>', '<ul><li>a</li><li>b</li></ul>'],
    [
      '<table><thead><tr><th>H</th></tr></thead><tr><td>a</td><td>b</td></tr></table>',
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    ],
    ['<table><tr><td></td></tr></table><p>x</p>', '<p>x</p>'],
    ['<strong><p>A</p><p>B</p></strong>', '<p><strong>A</strong></p><p><strong>B</strong></p>'],
    ['<p><b><i>x</i></b></p>', '<p><b><i>x</i></b></p>'],
    ['<blockquote><p>Quote</p></blockquote>', '<blockquote><p>Quote</p></blockquote>'],
    ['<pre>  code\n    indented</pre>', '<pre>  code\n    indented</pre>'],
    ['<p>x</p><hr><hr><p>y</p><hr>', '<p>x</p><hr><p>y</p>'],
    ['<section><header>Head</header><article>Body</article></section>', '<p>Head</p><p>Body</p>'],
    ['<p>Tracking<img src="https://t.example/p.gif" width="1" height="1"></p>', '<p>Tracking</p>'],
    ['<p class="text-lg font-bold" style="margin:0">Tailwind</p>', '<p>Tailwind</p>'],
    ['<p>Rocket 🚀 emoji ✅</p>', '<p>Rocket 🚀 emoji ✅</p>'],
    ['<p>donâ€™t move to MÃ¼nchen</p>', '<p>don’t move to München</p>'],
    ['<p>a\u0000b​c</p>', '<p>abc</p>'],
    ['<p>broken \uD83D emoji \uDE80 and 🚀</p>', '<p>broken emoji and 🚀</p>'],
    ['<p>Tom &amp; Jerry &lt;3 &nbsp;&copy;</p>', '<p>Tom &amp; Jerry &lt;3 ©</p>'],
    ['<p>Click <a href="https://x.example/apply"><img src="btn.png"></a></p>', `<p>Click ${a('https://x.example/apply', 'https://x.example/apply')}</p>`],
    ['<a href="mailto:jobs@x.example"></a>', `<p>${a('mailto:jobs@x.example', 'jobs@x.example')}</p>`],
    ['<a href="https://a.example">outer <a href="https://b.example">inner</a></a>', `<p>${a('https://a.example/', 'outer ')}${a('https://b.example/', 'inner')}</p>`],
    ['<p>x</p><p>y', '<p>x</p><p>y</p>'],
    ['Line one\nLine two', '<p>Line one<br>Line two</p>'],
  ])('%s', (input, expected) => {
    expect(expectSafe(input)).toBe(expected);
  });

  it('truncates oversized input without splitting a character', () => {
    const big = `<p>${'a'.repeat(MAX_HTML_INPUT_CHARS - 4)}🚀🚀</p>`;
    const out = sanitizeHtml(big);
    expect(out.endsWith('a</p>')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(MAX_HTML_INPUT_CHARS + 10);
    expect(htmlToText(big)).toBe('a'.repeat(MAX_HTML_INPUT_CHARS - 4));
  });

  it('returns empty string for empty, whitespace-only and non-string input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml('   \n\t ')).toBe('');
    expect(sanitizeHtml('<p> </p><br>')).toBe('');
    expect(sanitizeHtml('<script>x</script>')).toBe('');
    expect(sanitizeHtml(undefined as unknown as string)).toBe('');
    expect(htmlToText(null as unknown as string)).toBe('');
    expect(textToHtml(42 as unknown as string)).toBe('');
  });

  it('converts plain text input with textToHtml', () => {
    expect(sanitizeHtml('Hello\n\n- one\n- two')).toBe(textToHtml('Hello\n\n- one\n- two'));
  });
});

// ---------------------------------------------------------------------------
// htmlToText
// ---------------------------------------------------------------------------

describe('htmlToText', () => {
  it.each([
    ['<p>Para one</p><p>Para two</p>', 'Para one\n\nPara two'],
    ['<h1>Title</h1><p>Body</p>', 'Title\n\nBody'],
    ['<ul><li>One</li><li>Two</li></ul>', '- One\n- Two'],
    ['<ol><li>One</li><li>Two<ul><li>Sub</li></ul></li></ol>', '- One\n- Two\n  - Sub'],
    ['<table><tr><th>Name</th><th>Value</th></tr><tr><td>a</td><td>1</td></tr></table>', 'Name | Value\na | 1'],
    ['<p>a<br>b<br/>c</p>', 'a\nb\nc'],
    ['<p>a<br><br><br><br>b</p>', 'a\n\nb'],
    ['<p>  lots   of\n\n spaces\t</p>', 'lots of spaces'],
    ['<div>x</div>\n\n\n\n<div>y</div>', 'x\n\ny'],
    ['<p>Tom &amp; Jerry &lt;3 &eacute; &#8212; &#x1F680;</p>', 'Tom & Jerry <3 é — 🚀'],
    ['<p>See <a href="https://x.example/jobs">our jobs page</a>.</p>', 'See our jobs page.'],
    ['<p>Apply: <a href="https://x.example/apply"></a></p>', 'Apply: https://x.example/apply'],
    ['<p title="attr text">x</p><img alt="alt text" src="y">', 'x'],
    ['<p>a<script>var x = "<b>";</script>b<style>.c{}</style></p>', 'ab'],
    ['<p>x<!-- comment --></p>', 'x'],
    ['<b>bold</b><i>it</i>', 'boldit'],
    ['<span>a</span> <span>b</span>', 'a b'],
    ['<p>Hello<p>World', 'Hello\n\nWorld'],
    ['<pre>a\n  b</pre>', 'a\nb'],
    ['<blockquote><p>q1</p><p>q2</p></blockquote>', 'q1\n\nq2'],
    ['&lt;p&gt;Escaped&lt;/p&gt;&lt;ul&gt;&lt;li&gt;item&lt;/li&gt;&lt;/ul&gt;', 'Escaped\n\n- item'],
    ['plain\r\ntext\r\n\r\n\r\nmore', 'plain\ntext\n\nmore'],
    ['', ''],
  ])('%j', (input, expected) => {
    expect(htmlToText(input)).toBe(expected);
  });

  it('never leaks tag or attribute text', () => {
    const t = htmlToText('<div class="x" data-foo="bar"><a href="https://x.example" title="secret">link</a><img alt="ALT"></div>');
    expect(t).toBe('link');
  });
});

// ---------------------------------------------------------------------------
// textToHtml
// ---------------------------------------------------------------------------

describe('textToHtml', () => {
  it.each([
    ['Hello world', '<p>Hello world</p>'],
    ['Line one\nLine two\n\nPara two', '<p>Line one<br>Line two</p><p>Para two</p>'],
    ['- one\n- two', '<ul><li>one</li><li>two</li></ul>'],
    ['* one\n• two\n· three', '<ul><li>one</li><li>two</li><li>three</li></ul>'],
    ['1. first\n2) second\n(3) third', '<ol><li>first</li><li>second</li><li>third</li></ol>'],
    ['Intro:\n- a\n- b\nOutro', '<p>Intro:</p><ul><li>a</li><li>b</li></ul><p>Outro</p>'],
    ['- item\n  continued', '<ul><li>item<br>continued</li></ul>'],
    ['- a\n1. b', '<ul><li>a</li></ul><ol><li>b</li></ol>'],
    ['<script>alert(1)</script> & "q"', '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "q"</p>'],
    ['Visit https://x.example/jobs?a=1&b=2.', `<p>Visit ${a('https://x.example/jobs?a=1&amp;b=2', 'https://x.example/jobs?a=1&amp;b=2')}.</p>`],
    ['(see https://x.example/a_(b))', `<p>(see ${a('https://x.example/a_(b)', 'https://x.example/a_(b)')})</p>`],
    ['Go to https://x.example, now', `<p>Go to ${a('https://x.example/', 'https://x.example')}, now</p>`],
    ['javascript:alert(1) and ftp://x.example', '<p>javascript:alert(1) and ftp://x.example</p>'],
    ['https://x.example/?u=javascript:alert(1)', '<p>https://x.example/?u=javascript:alert(1)</p>'],
    ['2024 was great.\n10 people', '<p>2024 was great.<br>10 people</p>'],
    ['-not a bullet', '<p>-not a bullet</p>'],
    ['\n\n  \n', ''],
  ])('%j', (input, expected) => {
    expect(textToHtml(input)).toBe(expected);
  });

  it('produces output that sanitizeHtml leaves unchanged', () => {
    const inputs = [
      'Hello\n\n- a https://x.example/a.\n- b\n\n1. c\n2. d\n\nBye <b>&amp;</b>',
      'A & B < C > D "E" \'F\'',
      'mail me: mailto:x@y.example or https://x.example/%20',
      'donâ€™t\u0000 stop',
      '&lt;p&gt;literal&lt;/p&gt;',
      '- \n- x',
    ];
    for (const t of inputs) {
      const html = textToHtml(t);
      expect(sanitizeHtml(html), t).toBe(html);
      expect(violations(html)).toEqual([]);
    }
  });
});

describe('decodeEntities / escapeHtml / fixMojibake', () => {
  it('decodes named and numeric entities once', () => {
    expect(decodeEntities('&amp; &lt; &gt; &quot; &#39; &apos; &nbsp; &eacute; &#233; &#xE9; &mdash; &hellip;')).toBe(
      '& < > " \' \'   é é é — …',
    );
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeEntities('AT&T &unknown; & alone')).toBe('AT&T &unknown; & alone');
    expect(decodeEntities('&#0; &#x110000;')).toBe('� �');
    expect(decodeEntities('no entities')).toBe('no entities');
    expect(decodeEntities('')).toBe('');
  });

  it('escapes all HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    expect(decodeEntities(escapeHtml(`<>&"'`))).toBe(`<>&"'`);
  });

  it('repairs UTF-8 mojibake without touching legitimate Latin-1 text', () => {
    expect(fixMojibake('donâ€™t')).toBe('don’t');
    expect(fixMojibake('MÃ¼nchen, SÃ£o Paulo')).toBe('München, São Paulo');
    expect(fixMojibake('ðŸš€ launch')).toBe('🚀 launch');
    expect(fixMojibake('Ã‚Â£50k')).toBe('£50k');
    expect(fixMojibake('Café, naïve, Ångström, ½')).toBe('Café, naïve, Ångström, ½');
  });
});

// ---------------------------------------------------------------------------
// Fuzzing: random tag soup must always satisfy the invariants
// ---------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const PIECES = [
  '<p>', '</p>', '<div>', '</div>', '<ul>', '</ul>', '<ol>', '<li>', '</li>', '<b>', '</b>', '<i>', '<strong>', '</em>',
  '<a href="https://x.example/a">', '<a href="javascript:alert(1)">', '</a>', '<br>', '<br><br>', '<hr>', '<table>',
  '<tr>', '<td>', '</td>', '<th>', '</table>', '<thead>', '<tbody>', '<pre>', '</pre>', '<h1>', '</h1>', '<h4>',
  '<blockquote>', '</blockquote>', '<span style="x">', '</span>', '<script>', '</script>', '<style>', '<svg>', '</svg>',
  '<math>', '<!--', '-->', '<img src=x onerror=alert(1)>', '<textarea>', '</textarea>', '<noscript>', '<template>',
  'text', ' ', '\n', '  ', '&amp;', '&lt;b&gt;', '&lt;/p&gt;', '&nbsp;', '<', '>', '"', "'", '=', 'é', '🚀', 'Ã©',
  'https://y.example/z', '- ', '1. ', '<p onclick=alert(1)>', '<code>', '</code>', '<u>', '<br/>', '</br>',
];

describe('fuzzing', () => {
  it('random tag soup always yields valid, stable, safe output', () => {
    const r = rng(12345);
    for (let n = 0; n < 20000; n++) {
      let s = '';
      const len = 1 + Math.floor(r() * 30);
      for (let k = 0; k < len; k++) s += PIECES[Math.floor(r() * PIECES.length)] ?? '';
      const out = sanitizeHtml(s);
      const problems = violations(out);
      expect(problems, `input: ${JSON.stringify(s)}`).toEqual([]);
      // For markup input, the readable text of the sanitised HTML is the readable text of the input.
      if (/<(?:p|div|ul|ol|li|b|i|strong|a|br|hr|table|tr|td|th|pre|h1|h4|blockquote|span|code|u|script|style|svg|math|img|textarea|noscript|template)\b/.test(s)) {
        expect(htmlToText(out), `input: ${JSON.stringify(s)}`).toBe(htmlToText(s));
      }
    }
  });

  it('random plain text round-trips through textToHtml and sanitizeHtml unchanged', () => {
    const r = rng(777);
    const bits = ['a', 'b c', ' ', '\n', '\n\n', '- ', '* ', '1. ', '  ', '<', '>', '&', '&amp;', 'https://x.example/p', '.', ')', '(', 'é', '\t', '•'];
    for (let n = 0; n < 2000; n++) {
      let s = '';
      const len = 1 + Math.floor(r() * 25);
      for (let k = 0; k < len; k++) s += bits[Math.floor(r() * bits.length)] ?? '';
      const html = textToHtml(s);
      expect(sanitizeHtml(html), JSON.stringify(s)).toBe(html);
    }
  });
});

// ---------------------------------------------------------------------------
// Performance: pathological inputs stay linear
// ---------------------------------------------------------------------------

describe('performance', () => {
  const MB = 1_000_000;
  const cases: Array<[string, string]> = [
    ['200k unclosed <div>', '<div>'.repeat(200_000)],
    ['deeply nested lists', '<ul><li>x'.repeat(MB / 10)],
    ['unclosed inline tags', '<b><i>x'.repeat(MB / 7)],
    ['unterminated attributes', '<a href="x" '.repeat(MB / 12)],
    ['stray close tags', '</div></span>'.repeat(MB / 13)],
    ['nested tables', '<table><tr><td>'.repeat(MB / 15)],
    ['1M "<"', '<'.repeat(MB)],
    ['comment openers', '<!--'.repeat(MB / 4)],
    ['escaped tags', '&lt;p&gt;x&lt;/p&gt;'.repeat(MB / 20)],
    ['entities', '&amp;&#x41;&nbsp;'.repeat(MB / 16)],
    ['svg soup', '<svg><p>'.repeat(MB / 8)],
    ['long text with no tags', `${'word '.repeat(MB / 5)}`],
    ['many paragraphs', '<p>Some text here</p>'.repeat(MB / 22)],
  ];

  it.each(cases)('%s finishes quickly', (_label, input) => {
    expect(input.length).toBeGreaterThanOrEqual(MB * 0.9);
    let t = performance.now();
    const out = sanitizeHtml(input);
    const sanitizeMs = performance.now() - t;
    t = performance.now();
    htmlToText(input);
    const textMs = performance.now() - t;
    expect(sanitizeMs).toBeLessThan(1000);
    expect(textMs).toBeLessThan(1000);
    expect(out.length).toBeLessThan(MAX_HTML_INPUT_CHARS * 8);
  });
});
