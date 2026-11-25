import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GapAnalysis } from '../../shared/types';
import { type BuiltApp, buildApp } from '../app';
import { loadConfig } from '../config';
import { openDb } from '../db';
import { feedKeyFor, normalizePosting } from '../ingest/normalize';
import { getSource } from '../sources/registry';
import type { BoardRef } from '../sources/types';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const BOARD: BoardRef = { ats: 'greenhouse', token: 'acmesec', name: 'Acme Security' };
const CITIES = ['Austin, TX', 'Dallas, TX', 'Houston, TX', 'Denver, CO', 'Boston, MA', 'Seattle, WA', 'Chicago, IL'];

let built: BuiltApp;

async function gaps(payload: object): Promise<{ status: number; body: GapAnalysis }> {
  const res = await built.app.inject({ method: 'POST', url: '/api/gaps', headers: { host: 'localhost:4310' }, payload });
  return { status: res.statusCode, body: res.json() };
}

/** Postings on one board, each in its own city so none are folded together as duplicates. */
function seed(postings: Array<{ id: string; title: string; skills: string }>): void {
  const def = getSource('greenhouse')!.def;
  const feedKey = feedKeyFor('greenhouse', BOARD);
  const normalized = postings.map((p, i) => {
    const n = normalizePosting(
      {
        externalId: p.id,
        title: p.title,
        url: `https://jobs.example.com/${p.id}`,
        company: BOARD.name,
        locations: [CITIES[i % CITIES.length]!],
        remote: 'onsite',
        postedAt: NOW.toISOString(),
        descriptionHtml: `<p>Join our team.</p><h3>Requirements</h3><p>Experience with ${p.skills}.</p>`,
      },
      { source: def, feedKey, board: BOARD, now: NOW },
    );
    if (!n) throw new Error(`posting ${p.id} was rejected`);
    return n;
  });
  built.ctx.services.jobs.upsertFeed({ feedKey, source: 'greenhouse' }, normalized, { complete: true, now: NOW });
}

beforeEach(async () => {
  built = await buildApp({
    config: loadConfig({ logLevel: 'silent', disableSync: true, clientDir: undefined, dataDir: '/nonexistent-not-used' }),
    db: openDb(':memory:'),
    now: () => NOW,
  });
  seed([
    { id: 'sa-1', title: 'Security Analyst', skills: 'Python, Splunk and Kubernetes' },
    { id: 'sa-2', title: 'Security Analyst', skills: 'Python, Splunk and Kubernetes' },
    { id: 'sa-3', title: 'Security Analyst', skills: 'Splunk, Kubernetes and the CISSP' },
    { id: 'sa-4', title: 'Security Analyst', skills: 'Splunk, Kubernetes and Terraform' },
    { id: 'sa-5', title: 'Security Analyst', skills: 'Python and Wireshark' },
    { id: 'cook', title: 'Line Cook', skills: 'knife skills and food safety' },
  ]);
});

afterEach(async () => {
  await built.close();
});

describe('POST /api/gaps', () => {
  it('analyses the jobs the profile aims for, ranking what is missing', async () => {
    built.ctx.services.profile.patch({ preferences: { targetTitles: ['Security Analyst'], skills: ['Python', 'Splunk'] }, work: { yearsExperience: 4 } });
    const { status, body } = await gaps({ scope: 'profile' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ scope: 'profile', basis: 'Security Analyst', jobs: 5, jobsWithSkills: 5, hasResume: false });
    expect(body.blocker).toBeUndefined();
    expect(body.missingSkills[0]).toMatchObject({ name: 'Kubernetes', jobs: 4, share: 80 });
    expect(body.missingCerts.map((c) => c.name)).toEqual(['CISSP']);
    expect(body.strengths.map((s) => s.name)).toEqual(['Splunk', 'Python']);
    expect(body.recommendations[0]).toMatchObject({ id: 'add-resume' });
    expect(body.recommendations.map((r) => r.id)).toContain('learn-skill:Kubernetes');
  });

  it('points out skills the résumé leaves out', async () => {
    built.ctx.services.profile.patch({ preferences: { targetTitles: ['Security Analyst'], skills: ['Python', 'Splunk'] } });
    built.ctx.services.profile.setResumeText('Security analyst. Built detection scripts in Python for five years.');
    const { body } = await gaps({ scope: 'profile' });
    expect(body.hasResume).toBe(true);
    expect(body.resumeGaps).toEqual([{ name: 'Splunk', kind: 'skill', jobs: 4, share: 80 }]);
    expect(body.recommendations[0]).toMatchObject({ id: 'resume-skills', title: 'Put Splunk on your résumé', priority: 'high' });
  });

  it('needs target titles (or a current title) to know which jobs to look at', async () => {
    expect((await gaps({ scope: 'profile' })).body).toMatchObject({ blocker: 'no-targets', jobs: 0 });

    built.ctx.services.profile.patch({ work: { currentTitle: 'Security Analyst' }, preferences: { skills: ['Python'] } });
    const { body } = await gaps({ scope: 'profile' });
    expect(body).toMatchObject({ jobs: 5, basis: 'Security Analyst' });
    expect(body.recommendations.map((r) => r.id)).toContain('add-targets');
  });

  it('says when no jobs match', async () => {
    built.ctx.services.profile.patch({ preferences: { targetTitles: ['Astronaut'] } });
    expect((await gaps({ scope: 'profile' })).body).toMatchObject({ blocker: 'no-jobs', jobs: 0, basis: 'Astronaut' });
  });

  it('analyses the active applications', async () => {
    built.ctx.services.profile.patch({ preferences: { skills: ['Python'] } });
    expect((await gaps({ scope: 'applications' })).body).toMatchObject({ blocker: 'no-applications', jobs: 0 });

    const id = built.ctx.db.scalar<string>("SELECT id FROM jobs WHERE external_id = 'sa-4'")!;
    built.ctx.services.applications.create({ jobId: id });
    const { body } = await gaps({ scope: 'applications' });
    expect(body).toMatchObject({ scope: 'applications', basis: 'Your active application', jobs: 1 });
    expect(body.missingSkills.map((s) => s.name).sort()).toEqual(['Kubernetes', 'Splunk', 'Terraform']);
  });

  it('analyses a search', async () => {
    built.ctx.services.profile.patch({ preferences: { skills: ['Python'] } });
    const { body } = await gaps({ scope: 'search', query: { q: 'Line Cook' } });
    expect(body).toMatchObject({ scope: 'search', basis: 'Line Cook', jobs: 1 });
  });

  it('rejects a search scope without a query, and unknown scopes', async () => {
    expect((await gaps({ scope: 'search' })).status).toBe(400);
    expect((await gaps({ scope: 'everything' })).status).toBe(400);
  });
});
