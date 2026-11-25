/** Small helpers for reading untyped API payloads defensively. */
import { SourceError } from './types';

/** Trimmed non-empty string; numbers are stringified; anything else is undefined. */
export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? undefined : t;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Finite number from a number or numeric string ("120,000" and "120000.50" accepted). */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const t = value.replace(/,/g, '').trim();
    if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return undefined;
    return Number(t);
  }
  return undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Throws a `parse` SourceError when the payload is not the expected array. */
export function requireArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new SourceError('parse', `${what}: expected a list, got ${describe(value)}`);
  return value;
}

/** Throws a `parse` SourceError when the payload is not the expected object. */
export function requireRecord(value: unknown, what: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) throw new SourceError('parse', `${what}: expected an object, got ${describe(value)}`);
  return record;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value;
}

/** Trim, drop empties and non-strings, de-duplicate (case-insensitively), keep order. */
export function compactStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = asString(v);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Resolve a possibly relative link against a base; only http(s) URLs are returned. */
export function absoluteUrl(href: unknown, base?: string): string | undefined {
  const s = asString(href);
  if (!s) return undefined;
  try {
    const url = base ? new URL(s, base) : new URL(s);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
