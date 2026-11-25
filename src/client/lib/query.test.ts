import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../api/client';
import { compactParams, createQueryClient, qk, shouldRetryQuery } from './query';
import type { SearchQuery } from '../../shared/types';

describe('shouldRetryQuery', () => {
  it('retries once for network and server errors', () => {
    expect(shouldRetryQuery(0, new ApiRequestError(0, 'network', 'down'))).toBe(true);
    expect(shouldRetryQuery(0, new ApiRequestError(503, 'x', 'busy'))).toBe(true);
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(true);
    expect(shouldRetryQuery(1, new ApiRequestError(503, 'x', 'busy'))).toBe(false);
  });

  it('never retries a 4xx answer', () => {
    expect(shouldRetryQuery(0, new ApiRequestError(404, 'not_found', 'gone'))).toBe(false);
    expect(shouldRetryQuery(0, new ApiRequestError(400, 'validation', 'bad'))).toBe(false);
  });
});

describe('createQueryClient', () => {
  it('uses the shared defaults', () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.retry).toBe(shouldRetryQuery);
    expect(defaults.mutations?.retry).toBe(false);
  });
});

describe('compactParams', () => {
  it('drops unset values so equivalent requests share a key', () => {
    expect(compactParams({ q: 'x', location: '', tags: [], page: 0, flag: false, missing: undefined, none: null })).toEqual({ q: 'x', page: 0, flag: false });
  });
});

describe('qk', () => {
  it('nests families under a shared prefix', () => {
    expect(qk.search()).toEqual(['search']);
    expect(qk.search({ q: 'designer', location: '' } as SearchQuery)).toEqual(['search', 'results', { q: 'designer' }]);
    expect(qk.applications()).toEqual(['applications']);
    expect(qk.applications({ status: 'applied', q: '' }).slice(0, 2)).toEqual(['applications', 'list']);
    expect(qk.application('7')).toEqual(['applications', 'detail', '7']);
    expect(qk.applicationStats()[0]).toBe('applications');
    expect(qk.profileCompleteness()[0]).toBe(qk.profileExtras()[0]);
    expect(qk.companies({ q: 'acme' } as never)).toEqual(['companies', 'list', { q: 'acme' }]);
  });

  it('normalises suggestion text', () => {
    expect(qk.suggest('titles', '  Product Designer ')).toEqual(['suggest', 'titles', 'product designer']);
  });

  it('gives equal keys for equivalent searches', () => {
    const a = qk.search({ q: 'go', remote: undefined } as unknown as SearchQuery);
    const b = qk.search({ q: 'go' } as SearchQuery);
    expect(a).toEqual(b);
  });
});
