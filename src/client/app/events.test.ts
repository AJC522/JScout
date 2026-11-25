import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Bootstrap, IndexSummary } from '../../shared/types';
import { qk } from '../lib/query';
import { applyServerEvent } from './events';

const index: IndexSummary = { openJobs: 100, sources: 3, companies: 10, syncing: false, pendingFeeds: 0 };
const bootstrap: Bootstrap = {
  version: '1',
  settings: { theme: 'system', autoSync: true, closedRetentionDays: 30, maxPostingAgeDays: 60, ai: { hasKey: false, keySource: null, model: 'm' }, email: null },
  index,
  profile: { onboarded: true, name: 'Jane', completeness: 80 },
  tracker: { active: 1, followUpsDue: 0 },
  savedSearches: { count: 1, newResults: 0 },
};

function client(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(qk.bootstrap(), bootstrap);
  return queryClient;
}

const current = (queryClient: QueryClient) => queryClient.getQueryData<Bootstrap>(qk.bootstrap())?.index;

describe('applyServerEvent', () => {
  it('replaces the index summary on hello and index-changed', () => {
    const queryClient = client();
    applyServerEvent(queryClient, { type: 'hello', index: { ...index, openJobs: 5 } });
    expect(current(queryClient)?.openJobs).toBe(5);
    applyServerEvent(queryClient, { type: 'index-changed', index: { ...index, openJobs: 9 } });
    expect(current(queryClient)?.openJobs).toBe(9);
  });

  it('tracks sync progress', () => {
    const queryClient = client();
    applyServerEvent(queryClient, { type: 'sync-started', feeds: 4 });
    expect(current(queryClient)).toMatchObject({ syncing: true, pendingFeeds: 4 });
    applyServerEvent(queryClient, { type: 'feed-finished', feedKey: 'a', source: 'x', ok: true, added: 1, updated: 0, closed: 0, pendingFeeds: 3 });
    expect(current(queryClient)).toMatchObject({ syncing: true, pendingFeeds: 3 });
    applyServerEvent(queryClient, { type: 'sync-finished', index: { ...index, openJobs: 140 }, added: 40, durationMs: 1200 });
    expect(current(queryClient)).toMatchObject({ syncing: false, pendingFeeds: 0, openJobs: 140 });
  });

  it('marks bootstrap stale after a sync so badge counts refresh', () => {
    const queryClient = client();
    applyServerEvent(queryClient, { type: 'sync-finished', index, added: 0, durationMs: 1 });
    expect(queryClient.getQueryState(qk.bootstrap())?.isInvalidated).toBe(true);
  });

  it('does nothing before bootstrap has loaded', () => {
    const queryClient = new QueryClient();
    applyServerEvent(queryClient, { type: 'hello', index });
    expect(queryClient.getQueryData(qk.bootstrap())).toBeUndefined();
  });
});
