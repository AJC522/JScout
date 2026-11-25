/**
 * Typed client for the HTTP API described in src/shared/api.ts.
 *
 *   const res = await api('POST /api/search', { body: query });
 *   const job = await api('GET /api/jobs/:id', { params: { id } });
 */
import type { RouteBody, RouteKey, RouteParams, RouteQuery, RouteRes } from '../../shared/api';
import type { ApiErrorBody } from '../../shared/types';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Part<Name extends string, T> = [T] extends [undefined] ? unknown : { [K in Name]: T };

export type ApiArgs<K extends RouteKey> = Part<'params', RouteParams<K>> &
  Part<'body', RouteBody<K>> &
  Part<'query', RouteQuery<K>> & { signal?: AbortSignal };

type ArgsTuple<K extends RouteKey> = { signal?: AbortSignal } extends ApiArgs<K> ? [args?: ApiArgs<K>] : [args: ApiArgs<K>];

interface LooseArgs {
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
  signal?: AbortSignal;
}

export function buildUrl(route: string, args: LooseArgs = {}): { method: string; url: string } {
  const space = route.indexOf(' ');
  const method = route.slice(0, space);
  let path = route.slice(space + 1);
  for (const [key, value] of Object.entries(args.params ?? {})) {
    path = path.replace(`:${key}`, encodeURIComponent(value));
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(args.query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return { method, url: qs ? `${path}?${qs}` : path };
}

async function toError(res: Response): Promise<ApiRequestError> {
  let body: ApiErrorBody | undefined;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* not JSON */
  }
  const message =
    body?.error?.message ??
    (res.status === 0 || res.status >= 502
      ? 'JScout is not responding. Is it still running in your terminal?'
      : `Request failed (${res.status})`);
  return new ApiRequestError(res.status, body?.error?.code ?? 'http_error', message, body?.error?.details);
}

export async function api<K extends RouteKey>(route: K, ...rest: ArgsTuple<K>): Promise<RouteRes<K>> {
  const args = (rest[0] ?? {}) as LooseArgs;
  const { method, url } = buildUrl(route, args);
  const hasBody = args.body !== undefined;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(args.body) : undefined,
      signal: args.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError(0, 'network', 'Could not reach JScout. Is it still running in your terminal?');
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as unknown as RouteRes<K>;
  return (await res.json()) as RouteRes<K>;
}

/** Upload a file as multipart/form-data under the "file" field. */
export async function uploadFile<T>(path: string, file: File, signal?: AbortSignal): Promise<T> {
  const form = new FormData();
  form.append('file', file, file.name);
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', body: form, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError(0, 'network', 'Could not reach JScout. Is it still running in your terminal?');
  }
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

/** Human-readable message for anything thrown by `api`. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
