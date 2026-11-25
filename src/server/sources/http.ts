import { setTimeout as sleep } from 'node:timers/promises';
import { type HttpClient, type HttpRequestOptions, type HttpResponse, SourceError } from './types';

export interface HttpClientOptions {
  userAgent: string;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
  defaultMinIntervalMs?: number;
  /** Upper bound on how long a Retry-After is honoured before giving up, in seconds. */
  maxRetryAfterSeconds?: number;
}

const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;

function buildUrl(url: string, query?: HttpRequestOptions['query']): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.round((date - now) / 1000));
}

async function readBody(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new SourceError('parse', `Response too large (${declared} bytes)`);
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SourceError('parse', `Response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Polite HTTP client for job sources: one request at a time per host with a
 * minimum gap, timeouts, bounded retries with backoff, response size limits,
 * conditional requests, and failures mapped to SourceError.
 */
/** Wait `ms`, or fail with SourceError('aborted') (and clear the timer) as soon as `signal` aborts. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return sleep(ms);
  return sleep(ms, undefined, { signal }).catch((err: unknown) => {
    throw signal.aborted ? new SourceError('aborted', 'Request aborted') : err;
  });
}

/** `promise`, or a SourceError('aborted') as soon as `signal` aborts (the promise itself carries on). */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new SourceError('aborted', 'Request aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SourceError('aborted', 'Request aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultTimeout = options.defaultTimeoutMs ?? 30_000;
  const defaultInterval = options.defaultMinIntervalMs ?? 1_000;
  const maxRetryAfter = options.maxRetryAfterSeconds ?? 20;

  // Per-host queue: each request waits for the previous one's slot plus the gap.
  const hostTail = new Map<string, Promise<void>>();
  const hostNextAt = new Map<string, number>();

  /**
   * Run `fn` in the host's queue. A request cancelled while it waits for its turn is never sent: it
   * leaves the queue at once (requests behind it still wait for the ones ahead) and takes no gap.
   */
  async function paced<T>(host: string, minIntervalMs: number, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
    const previous = hostTail.get(host) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    hostTail.set(
      host,
      previous.then(() => mine),
    );
    let sent = false;
    try {
      await untilAborted(previous, signal);
      const wait = (hostNextAt.get(host) ?? 0) - Date.now();
      if (wait > 0) await pause(wait, signal);
      sent = true;
      return await fn();
    } finally {
      if (sent) hostNextAt.set(host, Date.now() + minIntervalMs);
      release();
    }
  }

  async function once(url: string, opts: HttpRequestOptions): Promise<{ res: Response; text: string }> {
    // A listener added to an already-aborted signal never fires: check first.
    if (opts.signal?.aborted) throw new SourceError('aborted', 'Request aborted');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), opts.timeoutMs ?? defaultTimeout);
    const onAbort = () => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const headers: Record<string, string> = {
        'user-agent': options.userAgent,
        accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
        ...opts.headers,
      };
      if (opts.etag) headers['if-none-match'] = opts.etag;
      if (opts.lastModified) headers['if-modified-since'] = opts.lastModified;
      let body: string | undefined;
      if (opts.body !== undefined) {
        body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
        if (typeof opts.body !== 'string' && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
          headers['content-type'] = 'application/json';
        }
      }
      const res = await fetchImpl(url, {
        method: opts.method ?? 'GET',
        headers,
        body,
        signal: controller.signal,
        redirect: 'follow',
      });
      const text = res.status === 304 ? '' : await readBody(res, opts.maxBytes ?? DEFAULT_MAX_BYTES);
      return { res, text };
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  async function request(url: string, opts: HttpRequestOptions): Promise<{ res: Response; text: string }> {
    const full = buildUrl(url, opts.query);
    const host = new URL(full).host;
    const retries = opts.retries ?? 2;
    const allow = new Set([304, ...(opts.allowStatus ?? [])]);
    let lastError: SourceError | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (opts.signal?.aborted) throw new SourceError('aborted', 'Request aborted');
      if (attempt > 0) await pause(Math.min(8_000, 600 * 2 ** (attempt - 1)), opts.signal);
      try {
        const { res, text } = await paced(host, opts.minIntervalMs ?? defaultInterval, opts.signal, () => once(full, opts));
        if (res.ok || allow.has(res.status)) return { res, text };

        const retryAfter = parseRetryAfter(res.headers.get('retry-after'), Date.now());
        if (res.status === 429) {
          lastError = new SourceError('rate-limited', `${host} is rate limiting requests (HTTP 429)`, {
            status: 429,
            retryAfter,
          });
          if (retryAfter !== undefined && retryAfter > maxRetryAfter) throw lastError;
          if (retryAfter) await pause(retryAfter * 1000, opts.signal);
          continue;
        }
        if (res.status === 404 || res.status === 410) {
          throw new SourceError('not-found', `${host} returned HTTP ${res.status}`, { status: res.status });
        }
        if (res.status === 401) {
          throw new SourceError('auth', `${host} rejected the credentials (HTTP 401)`, { status: 401 });
        }
        if (res.status === 403) {
          const challenge = /<html|captcha|cloudflare|access denied/i.test(text.slice(0, 2000));
          throw new SourceError(
            challenge ? 'blocked' : 'auth',
            `${host} refused the request (HTTP 403${challenge ? ', bot protection' : ''})`,
            { status: 403 },
          );
        }
        lastError = new SourceError('http', `${host} returned HTTP ${res.status}`, { status: res.status, retryAfter });
        if (res.status < 500) throw lastError;
      } catch (err) {
        if (err instanceof SourceError) {
          if (err.kind === 'rate-limited' || (err.kind === 'http' && (err.status ?? 0) >= 500)) {
            lastError = err;
            if (attempt === retries || (err.retryAfter ?? 0) > maxRetryAfter) throw err;
            continue;
          }
          throw err;
        }
        if (opts.signal?.aborted) throw new SourceError('aborted', 'Request aborted', { cause: err });
        const message = err instanceof Error ? err.message : String(err);
        lastError = new SourceError(
          'network',
          /timeout|aborted/i.test(message) ? `${host} timed out` : `Could not reach ${host}: ${message}`,
          { cause: err },
        );
      }
    }
    throw lastError ?? new SourceError('network', `Request to ${host} failed`);
  }

  function headersOf(res: Response): Record<string, string> {
    const out: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }

  async function json<T>(url: string, opts: HttpRequestOptions): Promise<HttpResponse<T>> {
    const { res, text } = await request(url, opts);
    let data: T | undefined;
    if (res.status !== 304 && text.length > 0) {
      try {
        data = JSON.parse(text) as T;
      } catch (err) {
        if (res.ok) {
          const looksHtml = /^\s*</.test(text);
          throw new SourceError(
            looksHtml ? 'blocked' : 'parse',
            `${new URL(res.url || url).host} returned ${looksHtml ? 'an HTML page' : 'invalid JSON'} instead of JSON`,
            { status: res.status, cause: err },
          );
        }
      }
    }
    return { status: res.status, headers: headersOf(res), data, text, url: res.url || url };
  }

  return {
    getJson: (url, opts = {}) => json(url, { ...opts, method: 'GET' }),
    postJson: (url, body, opts = {}) => json(url, { ...opts, method: 'POST', body }),
    async getText(url, opts = {}) {
      const { res, text } = await request(url, { ...opts, method: 'GET' });
      return { status: res.status, headers: headersOf(res), data: res.status === 304 ? undefined : text, text, url: res.url || url };
    },
  };
}
