/**
 * HTML handling for job descriptions. Descriptions come from untrusted third
 * parties and are rendered in the UI, so `sanitizeHtml` is a security boundary.
 */
import { notImplemented } from './not-implemented';

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
 */
export function sanitizeHtml(html: string): string {
  return notImplemented(`sanitizeHtml(${html.length} chars)`);
}

/**
 * Convert HTML to readable plain text: block elements become line breaks, list
 * items get a "- " prefix, entities are decoded, whitespace is collapsed, and no
 * tag or attribute text leaks through. Accepts entity-escaped HTML like sanitizeHtml.
 */
export function htmlToText(html: string): string {
  return notImplemented(`htmlToText(${html.length} chars)`);
}

/** Convert plain text to safe HTML: escape, blank lines -> paragraphs, "- "/"* "/"• " lines -> lists, bare URLs -> links. */
export function textToHtml(text: string): string {
  return notImplemented(`textToHtml(${text.length} chars)`);
}

/** Decode HTML entities (named and numeric). */
export function decodeEntities(s: string): string {
  return notImplemented(`decodeEntities(${s.length} chars)`);
}

/** Escape text for inclusion in HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
