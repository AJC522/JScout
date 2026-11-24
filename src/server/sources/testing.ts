/**
 * Test helpers for source adapters: a fake HttpClient that serves fixtures and
 * records requests, plus a ready-made SourceContext.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot } from '../config';
import {
  type HttpClient,
  type HttpRequestOptions,
  type HttpResponse,
  type SourceContext,
  SourceError,
} from './types';

export const FIXTURES_DIR = path.join(findProjectRoot(), 'tests', 'fixtures', 'sources');

/** Read a fixture as text, e.g. readFixture('remotive', 'list.json'). */
export function readFixture(source: string, name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, source, name), 'utf8');
}

export function readJsonFixture<T = unknown>(source: string, name: string): T {
  return JSON.parse(readFixture(source, name)) as T;
}

export interface FakeRoute {
  /** Matched against the full URL including query string. */
  match: string | RegExp | ((url: string) => boolean);
  status?: number;
  headers?: Record<string, string>;
  /** String bodies are returned as-is; objects are JSON-encoded. */
  body?: unknown;
  /** Throw this instead of responding. */
  error?: SourceError;
}

export interface RecordedRequest {
  method: string;
  url: string;
  options: HttpRequestOptions;
}

export interface FakeHttp extends HttpClient {
  requests: RecordedRequest[];
  /** Add a route at the front (takes precedence). */
  on(route: FakeRoute): void;
}

function fullUrl(url: string, query?: HttpRequestOptions['query']): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
}

/**
 * Fake HttpClient. Unmatched requests throw a `not-found` SourceError, mirroring
 * the real client's behaviour for HTTP 404; statuses >= 400 that are not listed
 * in `allowStatus` throw the same SourceError kinds the real client would.
 */
export function fakeHttp(routes: FakeRoute[] = []): FakeHttp {
  const table = [...routes];
  const requests: RecordedRequest[] = [];

  function respond<T>(method: string, url: string, options: HttpRequestOptions, asJson: boolean): HttpResponse<T> {
    const target = fullUrl(url, options.query);
    requests.push({ method, url: target, options });
    const route = table.find((r) =>
      typeof r.match === 'string' ? target.includes(r.match) : r.match instanceof RegExp ? r.match.test(target) : r.match(target),
    );
    if (!route) throw new SourceError('not-found', `No fixture for ${target}`, { status: 404 });
    if (route.error) throw route.error;
    const status = route.status ?? 200;
    const text = route.body === undefined ? '' : typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    const allowed = status < 400 || status === 304 || (options.allowStatus ?? []).includes(status);
    if (!allowed) {
      if (status === 404 || status === 410) throw new SourceError('not-found', `HTTP ${status}`, { status });
      if (status === 429) throw new SourceError('rate-limited', 'HTTP 429', { status });
      if (status === 401) throw new SourceError('auth', 'HTTP 401', { status });
      if (status === 403) throw new SourceError('blocked', 'HTTP 403', { status });
      throw new SourceError('http', `HTTP ${status}`, { status });
    }
    let data: unknown;
    if (status !== 304 && text) {
      if (asJson) {
        try {
          data = JSON.parse(text);
        } catch (err) {
          if (status < 400) throw new SourceError('parse', 'invalid JSON', { status, cause: err });
        }
      } else {
        data = text;
      }
    }
    return { status, headers: route.headers ?? {}, data: data as T | undefined, text, url: target };
  }

  return {
    requests,
    on: (route) => {
      table.unshift(route);
    },
    getJson: async (url, opts = {}) => respond('GET', url, opts, true),
    getText: async (url, opts = {}) => respond<string>('GET', url, opts, false),
    postJson: async (url, body, opts = {}) => respond('POST', url, { ...opts, body }, true),
  };
}

export function testContext(http: HttpClient, config: Record<string, string> = {}, now = new Date('2026-11-24T12:00:00Z')): SourceContext {
  const noop = () => undefined;
  return { http, config, log: { debug: noop, info: noop, warn: noop }, now: () => now };
}
