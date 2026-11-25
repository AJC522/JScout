/**
 * Client-side checks that mirror what the server accepts (src/server/features/profile/schemas.ts),
 * so problems show next to the field instead of as a failed save.
 */
import { MAX_RESUME_BYTES } from '../../../shared/constants';
import type { PersonalInfo } from '../../../shared/types';

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value.trim());
}

/** True for "" and for web addresses, with or without the scheme ("github.com/me" is fine). */
export function isValidLink(raw: string): boolean {
  const value = raw.trim();
  if (!value) return true;
  if (/\s/.test(value)) return false;
  // A scheme is letters followed by ":" that is not a port number ("example.com:8080").
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value);
  const withScheme = value.startsWith('//') ? `https:${value}` : hasScheme ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return url.hostname.includes('.') || url.hostname === 'localhost';
}

/** "", "YYYY" or "YYYY-MM", as the server stores entry dates. */
export function isYearMonth(value: string): boolean {
  return /^(\d{4}(-(0[1-9]|1[0-2]))?)?$/.test(value.trim());
}

export const LINK_ERROR = 'Enter a web address, like linkedin.com/in/you';
export const EMAIL_ERROR = 'Enter an email address, like you@example.com';
export const DATE_ERROR = 'Use YYYY or YYYY-MM, like 2021-04';

export type PersonalErrors = Partial<Record<Exclude<keyof PersonalInfo, 'otherLinks'>, string>> & {
  /** Errors for other links, by link id. */
  otherLinks?: Record<string, string>;
};

export function validatePersonal(p: PersonalInfo): PersonalErrors {
  const errors: PersonalErrors = {};
  if (p.email.trim() && !isValidEmail(p.email)) errors.email = EMAIL_ERROR;
  for (const field of ['linkedin', 'github', 'portfolio', 'website'] as const) {
    if (!isValidLink(p[field])) errors[field] = LINK_ERROR;
  }
  const linkErrors: Record<string, string> = {};
  for (const link of p.otherLinks) {
    if (!link.url.trim()) linkErrors[link.id] = 'Add the address or remove this link';
    else if (!isValidLink(link.url)) linkErrors[link.id] = LINK_ERROR;
  }
  if (Object.keys(linkErrors).length > 0) errors.otherLinks = linkErrors;
  return errors;
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Parse a number typed into a form. "" means "not set" (null); anything that is not a number
 * within [min, max] is undefined so the caller can show an error.
 */
export function parseOptionalNumber(input: string, min: number, max: number): number | null | undefined {
  const text = input.replace(/[\s,_]/g, '');
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < min || value > max) return undefined;
  return value;
}

const RESUME_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

/** Why a chosen résumé file cannot be uploaded, or null when it looks fine. */
export function checkResumeFile(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.doc')) return 'Old Word files (.doc) cannot be read. Save it as .docx or PDF, or paste the text instead.';
  if (!RESUME_EXTENSIONS.some((ext) => name.endsWith(ext))) return 'Choose a PDF, Word (.docx) or text file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_RESUME_BYTES) {
    return `That file is larger than ${Math.round(MAX_RESUME_BYTES / (1024 * 1024))} MB. Try a smaller export, or paste the text instead.`;
  }
  return null;
}

export const RESUME_ACCEPT = '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';
