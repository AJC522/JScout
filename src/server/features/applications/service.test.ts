import { beforeEach, describe, expect, it } from 'vitest';
import type { JobPosting } from '../../../shared/types';
import type { AppConfig } from '../../config';
import { type Db, openDb } from '../../db';
import { ApiError } from '../../errors';
import { EventBus } from '../../events';
import type { AppContext, ApplicationsService, JobStore, Services } from '../../services';
import type { HttpClient } from '../../sources/types';
import { createApplicationsService } from './service';

const DAY = 86_400_000;
const silent = { debug() {}, info() {}, warn() {}, error() {} };

function posting(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: 'job-1',
    clusterKey: 'cluster-1',
    source: 'greenhouse',
    sourceName: 'Greenhouse',
    externalId: 'ext-1',
    url: 'https://boards.example.com/jobs/1',
    applyUrl: 'https://boards.example.com/jobs/1/apply',
    title: 'Senior Software Engineer',
    company: 'Acme',
    location: { places: [], remote: 'remote', remoteScope: ['US'] },
    locationText: 'Remote (US)',
    salary: { min: 120_000, max: 150_000, currency: 'USD', period: 'year' },
    employmentType: 'full-time',
    seniority: 'senior',
    tags: [],
    skills: ['TypeScript', 'React'],
    snippet: '',
    hasDescription: true,
    postedAt: '2026-11-01T00:00:00.000Z',
    firstSeenAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: '2026-11-19T00:00:00.000Z',
    ...overrides,
  };
}

function insertJob(db: Db, id: string, clusterKey: string, closedAt: string | null): void {
  db.run(
    `INSERT INTO jobs (id, source, feed_key, external_id, cluster_key, url, title, title_core, company, company_key,
       first_seen_at, last_seen_at, closed_at, content_hash)
     VALUES (?, 'test', 'test', ?, ?, 'https://example.com', 'Job', 'job', 'Co', 'co', '2026-01-01', '2026-01-01', ?, 'h')`,
    id,
    id,
    clusterKey,
    closedAt,
  );
}

function expectApiError(fn: () => unknown, status: number): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(status);
    return;
  }
  throw new Error(`expected ApiError ${status}`);
}

let db: Db;
let now: Date;
let postings: Map<string, JobPosting>;
let service: ApplicationsService;

const tick = (ms = 1000): void => {
  now = new Date(now.getTime() + ms);
};
const manual = (title: string, company = 'Initech') => service.create({ job: { title, company } });

beforeEach(() => {
  db = openDb(':memory:');
  now = new Date('2026-11-20T12:00:00.000Z');
  postings = new Map([
    ['job-1', posting()],
    ['job-1b', posting({ id: 'job-1b', source: 'remotive', sourceName: 'Remotive' })],
    ['job-2', posting({ id: 'job-2', clusterKey: 'cluster-2', title: 'Data Engineer', salary: undefined, applyUrl: undefined })],
  ]);
  const jobs: Partial<JobStore> = {
    getPosting: (id) => postings.get(id),
    getDescriptionHtml: (id) => (id === 'job-1' ? '<p>Build things.</p>' : ''),
  };
  const ctx: AppContext = {
    config: {} as AppConfig,
    db,
    http: {} as HttpClient,
    events: new EventBus(),
    log: silent,
    now: () => now,
    services: { jobs } as Services,
  };
  service = createApplicationsService(ctx);
});

describe('create', () => {
  it('snapshots an indexed job with defaults', () => {
    const app = service.create({ jobId: 'job-1' });
    expect(app).toMatchObject({
      jobId: 'job-1',
      clusterKey: 'cluster-1',
      status: 'saved',
      priority: 0,
      notes: '',
      jobClosed: false,
      createdAt: now.toISOString(),
      statusChangedAt: now.toISOString(),
      job: {
        title: 'Senior Software Engineer',
        company: 'Acme',
        remote: 'remote',
        locationText: 'Remote (US)',
        applyUrl: 'https://boards.example.com/jobs/1/apply',
        salaryText: '$120k–$150k/yr',
        sourceName: 'Greenhouse',
        skills: ['TypeScript', 'React'],
        descriptionHtml: '<p>Build things.</p>',
      },
    });
    expect(app.appliedAt).toBeUndefined();
    expect(app.followUpAt).toBeUndefined();
    expect(app.checklist.map((c) => c.label)).toEqual([
      'Review the posting',
      'Tailor résumé',
      'Write cover letter',
      'Submit application',
      'Follow up',
    ]);
    expect(new Set(app.checklist.map((c) => c.id)).size).toBe(5);
    expect(app.events).toHaveLength(1);
    expect(app.events[0]).toMatchObject({ type: 'created', detail: 'From Greenhouse' });
  });

  it('answers 404 for an unknown job', () => {
    expectApiError(() => service.create({ jobId: 'nope' }), 404);
  });

  it('is idempotent per job cluster', () => {
    const first = service.create({ jobId: 'job-1' });
    service.patch(first.id, { notes: 'keep me' });
    const again = service.create({ jobId: 'job-1', status: 'applied' });
    const sibling = service.create({ jobId: 'job-1b' });
    expect(again.id).toBe(first.id);
    expect(sibling.id).toBe(first.id);
    expect(again).toMatchObject({ status: 'saved', notes: 'keep me' });
    expect(service.list()).toHaveLength(1);
  });

  it('creates manual applications with a sanitised description', () => {
    const app = service.create({
      job: {
        title: '  Product Designer ',
        company: 'Initech',
        url: 'https://initech.example/careers/42',
        descriptionHtml: '<p onclick="x()">Hello</p><script>alert(1)</script>',
      },
      notes: 'Referral from Sam',
    });
    expect(app.jobId).toBeUndefined();
    expect(app.clusterKey).toBeUndefined();
    expect(app.job).toMatchObject({ title: 'Product Designer', company: 'Initech', source: 'manual', url: 'https://initech.example/careers/42' });
    expect(app.job.descriptionHtml).toContain('Hello');
    expect(app.job.descriptionHtml).not.toMatch(/script|onclick/);
    expect(app.notes).toBe('Referral from Sam');
  });

  it('rejects bad manual input', () => {
    expectApiError(() => service.create({ job: { title: 'X', company: 'Y', url: 'javascript:alert(1)' } }), 400);
    expectApiError(() => service.create({ job: { title: '  ', company: 'Y' } }), 400);
    expectApiError(() => service.create({}), 400);
  });

  it('starts an applied application with appliedAt and a follow-up', () => {
    const app = service.create({ job: { title: 'X', company: 'Y' }, status: 'applied' });
    expect(app.appliedAt).toBe(now.toISOString());
    expect(app.followUpAt).toBe(new Date(now.getTime() + 7 * DAY).toISOString());
  });

  it('puts new applications at the top of their column', () => {
    const a = manual('A');
    tick();
    const b = manual('B');
    expect(b.sortOrder).toBeLessThan(a.sortOrder);
    expect(service.list().map((x) => x.job.title)).toEqual(['B', 'A']);
  });
});

describe('patch', () => {
  it('handles moving to applied and beyond', () => {
    const app = manual('A');
    const other = service.create({ job: { title: 'B', company: 'Y' }, status: 'applied' });
    tick();
    const applied = service.patch(app.id, { status: 'applied' });
    expect(applied).toMatchObject({
      status: 'applied',
      statusChangedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      appliedAt: now.toISOString(),
      followUpAt: new Date(now.getTime() + 7 * DAY).toISOString(),
    });
    expect(applied.sortOrder).toBeLessThan(other.sortOrder);
    expect(applied.events[0]).toMatchObject({ type: 'status', title: 'Moved to Applied', detail: 'From Saved' });
    const appliedAt = applied.appliedAt;

    tick(DAY);
    const interviewing = service.patch(app.id, { status: 'interviewing' });
    expect(interviewing.appliedAt).toBe(appliedAt);
    tick(DAY);
    expect(service.patch(app.id, { status: 'applied' }).appliedAt).toBe(appliedAt);
    expect(service.patch(app.id, { appliedAt: null }).appliedAt).toBeUndefined();
    expect(service.patch(app.id, { appliedAt: '2026-11-02' }).appliedAt).toBe('2026-11-02T00:00:00.000Z');
  });

  it('records appliedAt when the Applied column is skipped, but not for rejected/withdrawn from saved', () => {
    const skipped = manual('A');
    tick();
    const interviewing = service.patch(skipped.id, { status: 'interviewing' });
    expect(interviewing.appliedAt).toBe(now.toISOString());
    expect(interviewing.followUpAt).toBeUndefined();

    const created = service.create({ job: { title: 'B', company: 'Y' }, status: 'offer' });
    expect(created.appliedAt).toBe(now.toISOString());

    const notApplied = manual('C');
    expect(service.patch(notApplied.id, { status: 'withdrawn' }).appliedAt).toBeUndefined();
    expect(service.patch(manual('D').id, { status: 'rejected' }).appliedAt).toBeUndefined();
  });

  it('keeps an existing follow-up and lets explicit values win', () => {
    const a = manual('A');
    service.patch(a.id, { followUpAt: '2026-12-24T09:00:00.000Z' });
    expect(service.patch(a.id, { status: 'applied' }).followUpAt).toBe('2026-12-24T09:00:00.000Z');

    const b = manual('B');
    const moved = service.patch(b.id, { status: 'applied', followUpAt: null, appliedAt: '2026-11-18T10:00:00Z', sortOrder: 42 });
    expect(moved.followUpAt).toBeUndefined();
    expect(moved.appliedAt).toBe('2026-11-18T10:00:00.000Z');
    expect(moved.sortOrder).toBe(42);
  });

  it('treats a move to the current status and an empty patch as no change', () => {
    const a = manual('A');
    tick();
    const same = service.patch(a.id, { status: 'saved' });
    expect(same.updatedAt).toBe(a.updatedAt);
    expect(same.sortOrder).toBe(a.sortOrder);
    expect(same.events).toHaveLength(1);
    expect(service.patch(a.id, {}).updatedAt).toBe(a.updatedAt);
  });

  it('updates fields and assigns missing ids', () => {
    const a = manual('A');
    tick();
    const contact = { id: '', name: 'Sam', role: 'Recruiter', email: 'sam@example.com', phone: '', linkedin: '', notes: '' };
    const patched = service.patch(a.id, {
      notes: 'Call back',
      priority: 3,
      contacts: [contact, { ...contact, name: 'Alex' }],
      checklist: [
        { id: 'keep', label: 'One', done: true },
        { id: 'keep', label: 'Dup', done: false },
        { id: '', label: 'Two', done: false },
      ],
      job: {
        title: 'A2',
        applyUrl: '',
        salaryText: '€60K',
        descriptionHtml: 'Line one\n\n<img src=x onerror=alert(1)>',
      },
    });
    expect(patched).toMatchObject({ notes: 'Call back', priority: 3, updatedAt: now.toISOString() });
    expect(patched.contacts.every((c) => c.id.length > 0)).toBe(true);
    expect(patched.contacts[0]!.id).not.toBe(patched.contacts[1]!.id);
    expect(patched.checklist[0]!.id).toBe('keep');
    expect(new Set(patched.checklist.map((c) => c.id)).size).toBe(3);
    expect(patched.job).toMatchObject({ title: 'A2', company: 'Initech', salaryText: '€60K' });
    expect(patched.job.applyUrl).toBeUndefined();
    expect(patched.job.descriptionHtml).not.toMatch(/onerror/);
    expectApiError(() => service.patch(a.id, { job: { url: 'ftp://x' } }), 400);
    expectApiError(() => service.patch('missing', { notes: 'x' }), 404);
  });
});

describe('events and documents', () => {
  it('adds and removes events, newest first, scoped to the application', () => {
    const a = manual('A');
    const b = manual('B');
    tick();
    const interview = service.addEvent(a.id, { type: 'interview', title: 'Phone screen', at: '2026-11-25T15:00:00+01:00' });
    expect(interview.at).toBe('2026-11-25T14:00:00.000Z');
    const note = service.addEvent(a.id, { type: 'note', title: 'Sent thank-you' });
    expect(note).toMatchObject({ at: now.toISOString(), detail: '' });
    expect(service.get(a.id)!.events.map((e) => e.title)).toEqual(['Phone screen', 'Sent thank-you', 'Saved to tracker']);
    expect(service.get(a.id)!.updatedAt).toBe(now.toISOString());

    expectApiError(() => service.removeEvent(b.id, note.id), 404);
    expectApiError(() => service.addEvent('missing', { type: 'note', title: 'x' }), 404);
    service.removeEvent(a.id, note.id);
    expect(service.get(a.id)!.events).toHaveLength(2);
    expectApiError(() => service.removeEvent(a.id, note.id), 404);
  });

  it('adds, edits and removes documents', () => {
    const a = manual('A');
    const b = manual('B');
    const doc = service.addDocument(a.id, { kind: 'cover-letter', title: 'Letter', content: 'Dear team', generatedBy: 'template' });
    expect(service.get(a.id)!.events[0]).toMatchObject({ type: 'document', title: 'Added cover letter', detail: 'Letter' });
    tick();
    const edited = service.patchDocument(a.id, doc.id, { content: 'Dear Acme team' });
    expect(edited).toMatchObject({ title: 'Letter', content: 'Dear Acme team', updatedAt: now.toISOString(), createdAt: doc.createdAt });
    expect(service.get(a.id)!.documents).toEqual([edited]);

    expectApiError(() => service.patchDocument(b.id, doc.id, { title: 'Hijack' }), 404);
    expectApiError(() => service.removeDocument(b.id, doc.id), 404);
    expectApiError(() => service.patchDocument(a.id, doc.id, { title: ' ' }), 400);
    service.removeDocument(a.id, doc.id);
    expect(service.get(a.id)!.documents).toEqual([]);
  });

  it('removes an application with its events and documents', () => {
    const a = manual('A');
    service.addDocument(a.id, { kind: 'email', title: 'Mail', content: 'Hi', generatedBy: 'manual' });
    service.remove(a.id);
    expect(service.get(a.id)).toBeUndefined();
    expect(db.scalar('SELECT COUNT(*) FROM application_events')).toBe(0);
    expect(db.scalar('SELECT COUNT(*) FROM documents')).toBe(0);
    expectApiError(() => service.remove(a.id), 404);
  });
});

describe('list', () => {
  it('orders by pipeline then position and filters', () => {
    const offer = manual('Offer job');
    service.patch(offer.id, { status: 'offer' });
    const applied = manual('Applied job', 'Société Générale');
    service.patch(applied.id, { status: 'applied' });
    manual('Saved job');
    const noted = manual('Other');
    service.patch(noted.id, { notes: 'Ask about REMOTE policy' });

    expect(service.list().map((a) => a.job.title)).toEqual(['Other', 'Saved job', 'Applied job', 'Offer job']);
    expect(service.list({ status: 'applied' }).map((a) => a.id)).toEqual([applied.id]);
    expect(service.list({ q: 'societe' }).map((a) => a.id)).toEqual([applied.id]);
    expect(service.list({ q: 'remote' }).map((a) => a.id)).toEqual([noted.id]);
    expect(service.list({ q: 'job generale' }).map((a) => a.id)).toEqual([applied.id]);
    expect(service.list({ q: 'saved', status: 'offer' })).toEqual([]);
  });

  it('reports closed postings', () => {
    const a = service.create({ jobId: 'job-1' });
    const b = service.create({ jobId: 'job-2' });
    expect(service.get(a.id)!.jobClosed).toBe(false);

    insertJob(db, 'job-1', 'cluster-1', '2026-11-19T00:00:00.000Z');
    expect(service.get(a.id)!.jobClosed).toBe(true);

    // The linked posting left the index: closed only when every remaining copy is closed.
    insertJob(db, 'job-2b', 'cluster-2', '2026-11-19T00:00:00.000Z');
    expect(service.list().find((x) => x.id === b.id)!.jobClosed).toBe(true);
    insertJob(db, 'job-2c', 'cluster-2', null);
    expect(service.list().find((x) => x.id === b.id)!.jobClosed).toBe(false);
  });
});

describe('stats', () => {
  it('counts statuses, follow-ups, recent applications and responses', () => {
    expect(service.stats()).toEqual({
      total: 0,
      byStatus: { saved: 0, applied: 0, screening: 0, interviewing: 0, offer: 0, accepted: 0, rejected: 0, withdrawn: 0 },
      followUpsDue: 0,
      appliedLast7Days: 0,
      appliedLast30Days: 0,
      responseRate: null,
    });

    const interviewing = manual('Interviewing');
    service.patch(interviewing.id, { status: 'applied', appliedAt: new Date(now.getTime() - 20 * DAY).toISOString() });
    service.patch(interviewing.id, { status: 'interviewing' });
    const rejectedAfterScreen = manual('Screened');
    service.patch(rejectedAfterScreen.id, { status: 'applied' });
    service.patch(rejectedAfterScreen.id, { status: 'screening' });
    service.patch(rejectedAfterScreen.id, { status: 'rejected', followUpAt: new Date(now.getTime() - DAY).toISOString() });
    const ghosted = manual('Ghosted');
    service.patch(ghosted.id, { status: 'applied', followUpAt: new Date(now.getTime() - 60_000).toISOString() });
    const waiting = manual('Waiting');
    service.patch(waiting.id, { followUpAt: new Date(now.getTime() + 3 * DAY).toISOString() });

    expect(service.stats()).toEqual({
      total: 4,
      byStatus: { saved: 1, applied: 1, screening: 0, interviewing: 1, offer: 0, accepted: 0, rejected: 1, withdrawn: 0 },
      followUpsDue: 1,
      appliedLast7Days: 2,
      appliedLast30Days: 3,
      responseRate: 2 / 3,
    });
  });
});

describe('stateByCluster', () => {
  it('maps clusters to the most recently updated application', () => {
    const first = service.create({ jobId: 'job-2' });
    tick();
    // A manual duplicate cannot be created through create(), so link one directly.
    const second = manual('Copy');
    db.run("UPDATE applications SET cluster_key = 'cluster-2', status = 'applied' WHERE id = ?", second.id);
    const state = service.stateByCluster(['cluster-2', 'unknown', '', 'cluster-2']);
    expect([...state.entries()]).toEqual([['cluster-2', { applicationId: second.id, status: 'applied' }]]);
    tick();
    service.patch(first.id, { notes: 'touched' });
    expect(service.stateByCluster(['cluster-2']).get('cluster-2')).toEqual({ applicationId: first.id, status: 'saved' });
  });

  it('handles very large key lists', () => {
    service.create({ jobId: 'job-1' });
    const keys = Array.from({ length: 40_000 }, (_, i) => `k${i}`);
    keys.push('cluster-1');
    expect(service.stateByCluster(keys).size).toBe(1);
    expect(service.stateByCluster([]).size).toBe(0);
  });
});

describe('export and import', () => {
  it('round-trips everything and is idempotent', () => {
    const a = service.create({ jobId: 'job-1' });
    service.patch(a.id, { status: 'applied', contacts: [{ id: 'c1', name: 'Sam', role: '', email: '', phone: '', linkedin: '', notes: '' }] });
    service.addDocument(a.id, { kind: 'answer', title: 'Why us?', content: 'Because.', generatedBy: 'ai' });
    manual('Manual');
    const exported = service.exportAll();
    expect(exported).toHaveLength(2);
    expect(exported.find((x) => x.id === a.id)!.events).toHaveLength(3);

    service.clear();
    expect(service.list()).toEqual([]);
    expect(service.importAll(exported)).toBe(2);
    expect(service.importAll(exported)).toBe(2);
    expect(service.exportAll()).toEqual(exported);
    expect(db.scalar('SELECT COUNT(*) FROM application_events')).toBe(4);
    expect(db.scalar('SELECT COUNT(*) FROM documents')).toBe(1);
  });

  it('cleans imported data and rejects invalid items atomically', () => {
    const base = {
      id: 'imp-1',
      status: 'saved',
      createdAt: '2026-10-01',
      job: { title: 'Imported', company: 'Co', url: 'javascript:alert(1)', descriptionHtml: '<b>ok</b><script>x</script>' },
      checklist: [{ label: 'Do it' }],
    };
    expect(service.importAll([base] as never)).toBe(1);
    const imported = service.get('imp-1')!;
    expect(imported.job.url).toBe('');
    expect(imported.job.descriptionHtml).not.toContain('script');
    expect(imported).toMatchObject({ createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', priority: 0 });
    expect(imported.checklist[0]).toMatchObject({ label: 'Do it', done: false });
    expect(imported.checklist[0]!.id).not.toBe('');

    const bad = [{ ...base, id: 'imp-2' }, { ...base, id: 'imp-3', status: 'bogus' }];
    expectApiError(() => service.importAll(bad as never), 400);
    expect(service.get('imp-2')).toBeUndefined();
  });
});
