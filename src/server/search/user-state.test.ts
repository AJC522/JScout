import { beforeEach, describe, expect, it } from 'vitest';
import type { ApplicationStatus } from '../../shared/types';
import type { AppConfig } from '../config';
import { openDb } from '../db';
import { ApiError } from '../errors';
import { EventBus } from '../events';
import type { AppContext, ApplicationsService, Services, UserStateService } from '../services';
import type { HttpClient } from '../sources/types';
import { createUserStateService } from './user-state';

let now: Date;
let tracked: Map<string, { applicationId: string; status: ApplicationStatus }>;
let service: UserStateService;

beforeEach(() => {
  now = new Date('2026-11-20T12:00:00.000Z');
  tracked = new Map([['c3', { applicationId: 'app-3', status: 'interviewing' }]]);
  const applications: Partial<ApplicationsService> = {
    stateByCluster: (keys) => new Map([...tracked].filter(([k]) => keys.includes(k))),
  };
  const ctx: AppContext = {
    config: {} as AppConfig,
    db: openDb(':memory:'),
    http: {} as HttpClient,
    events: new EventBus(),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    now: () => now,
    services: { applications } as Services,
  };
  service = createUserStateService(ctx);
});

describe('user state', () => {
  it('merges hidden, viewed and tracker state for every requested key', () => {
    service.hide({ id: 'j1', clusterKey: 'c1' });
    service.markViewed({ id: 'j2', clusterKey: 'c2' });
    const state = service.forClusters(['c1', 'c2', 'c3', 'c4', 'c1']);
    expect([...state.entries()]).toEqual([
      ['c1', { hidden: true }],
      ['c2', { hidden: false, viewedAt: now.toISOString() }],
      ['c3', { hidden: false, applicationId: 'app-3', applicationStatus: 'interviewing' }],
      ['c4', { hidden: false }],
    ]);
    expect(service.forCluster('c1')).toEqual({ hidden: true });
    expect(service.forCluster('nothing')).toEqual({ hidden: false });
    expect(service.forClusters([]).size).toBe(0);
  });

  it('keeps the latest view and unhides', () => {
    service.markViewed({ id: 'j1', clusterKey: 'c1' });
    now = new Date(now.getTime() + 60_000);
    service.markViewed({ id: 'j1b', clusterKey: 'c1' });
    expect(service.forCluster('c1').viewedAt).toBe('2026-11-20T12:01:00.000Z');
    // A clock that went backwards (or an older copy viewed) never rewinds the timestamp.
    now = new Date('2026-01-01T00:00:00.000Z');
    service.markViewed({ id: 'j1', clusterKey: 'c1' });
    expect(service.forCluster('c1').viewedAt).toBe('2026-11-20T12:01:00.000Z');

    service.hide({ id: 'j1', clusterKey: 'c1' });
    service.unhide('c1');
    expect(service.forCluster('c1').hidden).toBe(false);
  });

  it('handles very large key lists', () => {
    service.hide({ id: 'j', clusterKey: 'k39999' });
    const keys = Array.from({ length: 40_000 }, (_, i) => `k${i}`);
    const state = service.forClusters(keys);
    expect(state.size).toBe(40_000);
    expect(state.get('k39999')!.hidden).toBe(true);
  });

  it('exports, imports twice and clears', () => {
    service.hide({ id: 'j1', clusterKey: 'c1' });
    now = new Date(now.getTime() + 1000);
    service.hide({ id: 'j2', clusterKey: 'c2' });
    service.markViewed({ id: 'j2', clusterKey: 'c2' });
    const exported = service.exportHidden();
    expect(exported).toEqual([
      { clusterKey: 'c1', hiddenAt: '2026-11-20T12:00:00.000Z' },
      { clusterKey: 'c2', hiddenAt: '2026-11-20T12:00:01.000Z' },
    ]);
    service.clear();
    expect(service.forCluster('c2')).toEqual({ hidden: false });
    expect(service.importHidden(exported)).toBe(2);
    expect(service.importHidden(exported)).toBe(2);
    expect(service.exportHidden()).toEqual(exported);
    expect(() => service.importHidden([{ clusterKey: '', hiddenAt: 'x' }])).toThrow(ApiError);
  });
});
