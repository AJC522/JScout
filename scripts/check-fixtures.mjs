#!/usr/bin/env node
/**
 * Check that the captured source fixtures are safe to publish (see scripts/sanitize-fixtures.mjs).
 * Fails when any file under tests/fixtures holds (in its raw text or in decoded JSON strings, XML and HTML):
 *  - an IPv4/IPv6 address outside the documentation ranges, plain or base64-encoded;
 *  - an e-mail address (plain or spelled out as "name [at] host [dot] com") not at example.com/org/net;
 *  - a phone number other than the 555-01xx placeholders;
 *  - a free-text run longer than 200 characters that is not generated prose: in every JSON string,
 *    XML element and HTML text node, after removing the generator's phrases.
 * Usage: node scripts/check-fixtures.mjs [dir]   (default: tests/fixtures)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeXML } from 'entities';
import {
  BASE64_RE,
  EMAIL_RE,
  IPV4_RE,
  IPV6_RE,
  OBFUSCATED_EMAIL_RE,
  PHONE_RE,
  REMOTEOK_TRAILER,
  TAG_RE,
  base64Ip,
  decode,
  isDocumentationIp,
  listFiles,
  nonGeneratedParts,
} from './sanitize-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_RUN = 200;

/**
 * JSON keys and XML elements that hold no posting prose: the API operators' own terms-of-use notices that
 * every client receives (Remotive, Remote OK, Jobicy, Himalayas), and long lists of countries
 * (Jobicy's jobGeo, We Work Remotely's <country>/<region>).
 */
const NOT_PROSE = new Set(['00-warning', '0-legal-notice', 'legal', 'friendlyNotice', 'comments', 'jobGeo', 'country', 'region']);

const excerpt = (s) => JSON.stringify(s.length > 90 ? `${s.slice(0, 90)}…` : s);

function checkAddresses(text, report) {
  for (const [ip] of text.matchAll(IPV4_RE)) if (!isDocumentationIp(ip)) report(`IPv4 address ${ip}`);
  for (const [ip] of text.matchAll(IPV6_RE)) if (!isDocumentationIp(ip)) report(`IPv6 address ${ip}`);
  for (const [token] of text.matchAll(BASE64_RE)) {
    const found = base64Ip(token);
    if (found && !isDocumentationIp(found.ip)) report(`base64-encoded IP address ${found.ip} in ${token}`);
  }
  for (const [email, , domain] of text.matchAll(EMAIL_RE)) {
    if (!/^example\.(?:com|org|net)$/i.test(domain)) report(`e-mail address ${email}`);
  }
  for (const [email] of text.matchAll(OBFUSCATED_EMAIL_RE)) if (!/\bexample\b/i.test(email)) report(`e-mail address ${email}`);
  for (const [phone] of text.matchAll(PHONE_RE)) if (!/555[\s.-]?01\d\d$/.test(phone)) report(`phone number ${phone}`);
}

/** A string that may be HTML, entity-escaped HTML or plain text: decoded addresses, then free text. */
function checkFreeText(value, report) {
  checkAddresses(decode(value), report);
  if (value.length <= MAX_RUN) return;
  // Remote OK's per-request anti-spam notice (its IP tag is checked above) is the API's text, not the employer's.
  for (const node of value.replace(REMOTEOK_TRAILER, '').split(TAG_RE)) {
    for (const part of nonGeneratedParts(decode(node))) {
      const run = part.trim();
      // A single token (a query string, a data URI) is not prose.
      if (run.length > MAX_RUN && /\s/.test(run)) report(`${run.length} characters of free text that is not generated prose: ${excerpt(run)}`);
    }
  }
}

function checkJson(value, report, key = '') {
  if (typeof value === 'string') {
    if (NOT_PROSE.has(key)) checkAddresses(value, report);
    else checkFreeText(value, report);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) checkJson(v, report, Array.isArray(value) ? key : k);
  }
}

/** Leaf elements of an RSS feed, CDATA or entity-escaped; outside items too (channel descriptions). */
function checkXml(text, report) {
  for (const m of text.matchAll(/<([\w:]+)(?:\s[^>]*)?>([^<]*|\s*<!\[CDATA\[[\s\S]*?\]\]>\s*)<\/\1>/g)) {
    const [, name, inner] = m;
    const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(inner);
    const value = cdata ? cdata[1] : decodeXML(inner);
    if (NOT_PROSE.has(name)) checkAddresses(value, report);
    else checkFreeText(value, report);
  }
}

function main() {
  const dir = path.resolve(process.argv[2] ?? path.join(ROOT, 'tests', 'fixtures'));
  const problems = new Set(); // the raw and the decoded text can report the same address
  const files = listFiles(dir);
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const report = (message) => problems.add(`${rel}: ${message}`);
    const text = fs.readFileSync(file, 'utf8');
    checkAddresses(text, report);
    if (file.endsWith('.json')) checkJson(JSON.parse(text), report);
    else if (file.endsWith('.xml')) checkXml(text, report);
    else checkFreeText(text, report);
  }
  if (problems.size) {
    console.error([...problems].join('\n'));
    console.error(`\n${problems.size} problem(s) in ${files.length} fixture files.`);
    process.exit(1);
  }
  console.log(`${files.length} fixture files checked: no IP or e-mail addresses, phone numbers or unsanitised free text.`);
}

main();
