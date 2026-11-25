import { describe, expect, it, vi } from 'vitest';
import type { ProfileService, Services } from '../../services';
import { type ProfileContext, loadProfile, resolveJob } from './context';
import { analyzeFit } from './fit';
import { requiredYears } from './flags';
import {
  type ProfileFixture,
  nursingJob,
  nursingProfile,
  salesApplication,
  salesProfile,
  softwareJob,
  softwareProfile,
} from './test-fixtures';

vi.mock('../../lib/skills', () => import('./test-fixtures').then((m) => m.fakeSkills));
vi.mock('../../lib/titles', () => import('./test-fixtures').then((m) => m.fakeTitles));
vi.mock('../../lib/location', () => import('./test-fixtures').then((m) => m.fakeLocation));

function profileOf(f: ProfileFixture): ProfileContext {
  return loadProfile({
    get: () => structuredClone(f.profile),
    effectiveSkills: () => f.skills,
    resumeText: () => f.resumeText,
  } as Partial<ProfileService> as ProfileService);
}

const services = {
  search: { jobDetail: (id: string) => [softwareJob, nursingJob].find((d) => d.job.id === id) },
  applications: { get: (id: string) => (id === salesApplication.id ? salesApplication : undefined) },
  jobs: { getDescriptionHtml: () => '' },
} as unknown as Pick<Services, 'search' | 'applications' | 'jobs'>;

describe('fit analysis', () => {
  it('scores a strong software match honestly, with concrete suggestions', () => {
    const fit = analyzeFit(resolveJob(services, { jobId: 'job-sw' }), profileOf(softwareProfile));

    expect(fit.skillsMatched).toEqual(['TypeScript', 'Node.js', 'PostgreSQL', 'AWS']);
    expect(fit.skillsMissing).toEqual(['Kubernetes', 'Kafka']);
    expect(fit.skillsExtra).toEqual(['React']);
    expect(fit.titleAlignment.kind).toBe('exact');
    expect(fit.seniorityAlignment).toMatchObject({ job: 'senior' });
    expect(fit.locationAlignment.ok).toBe(true);
    expect(fit.salaryAlignment.ok).toBe(true);
    // The citizenship mention is EEO boilerplate, not a requirement.
    expect(fit.flags).toEqual([]);
    expect(fit.score).toBeGreaterThanOrEqual(70);
    expect(fit.summary).toMatch(/^Strong fit \(\d+\/100\): you have 4 of 6 listed skills/);

    expect(fit.keywords.length).toBeGreaterThanOrEqual(10);
    expect(fit.keywords.length).toBeLessThanOrEqual(25);
    expect(fit.keywords[0]!.weight).toBe(1);
    const terms = fit.keywords.map((k) => k.term);
    expect(terms).toEqual(expect.arrayContaining(['TypeScript', 'Kubernetes', 'distributed systems', 'payments']));
    expect(fit.keywords.find((k) => k.term === 'Kubernetes')?.present).toBe(false);
    expect(fit.keywords.find((k) => k.term === 'distributed systems')?.present).toBe(true);
    expect(terms).not.toContain('Lumen');

    expect(fit.suggestions).toContain(
      "Your résumé doesn't mention Kubernetes, which the posting lists twice — if you have used it, add it to your skills.",
    );
    expect(fit.suggestions).toContain(
      'Lead with your payments experience; the posting mentions payments in its opening paragraph.',
    );
    // Never suggest claiming something without the "if you have" qualifier.
    for (const s of fit.suggestions.filter((x) => x.includes("doesn't mention"))) expect(s).toMatch(/if you have/);
  });

  it('flags nursing blockers: on-site only, no sponsorship, missing certification', () => {
    const fit = analyzeFit(resolveJob(services, { jobId: 'job-rn' }), profileOf(nursingProfile));

    expect(fit.skillsMissing).toEqual(['ACLS', 'Electronic Health Records']);
    expect(fit.titleAlignment.kind).toBe('synonym');
    expect(fit.locationAlignment).toEqual({ ok: false, detail: "On-site in Chicago, IL; you're looking for remote work only." });
    expect(fit.flags).toHaveLength(3);
    expect(fit.flags[0]).toMatch(/^On-site only, but you prefer remote work: “This is an on-site position/);
    expect(fit.flags[1]).toMatch(/^Visa sponsorship is not offered, and your profile says you need it/);
    expect(fit.flags[2]).toBe("Requires ACLS certification, which your profile doesn't mention.");
    // RN licence and BLS are in the résumé, so they are not flagged.
    expect(fit.flags.join(' ')).not.toMatch(/RN licence|BLS/);
    expect(fit.score).toBeLessThan(60);
  });

  it('analyses a tracked sales application from its snapshot', () => {
    const fit = analyzeFit(resolveJob(services, { applicationId: 'app-sales' }), profileOf(salesProfile));

    expect(fit.skillsMatched).toEqual(expect.arrayContaining(['SaaS', 'Salesforce', 'Negotiation']));
    expect(fit.skillsMissing).toEqual(['Pipeline Management']);
    expect(fit.titleAlignment.kind).toBe('synonym');
    expect(fit.seniorityAlignment.detail).toBe("The posting doesn't state a seniority level.");
    expect(fit.locationAlignment).toEqual({ ok: true, detail: 'In Toronto, ON, one of your preferred locations.' });
    // "Canadian citizen or permanent resident" is satisfied by a permanent resident.
    expect(fit.flags).toEqual(["Requires a valid driver’s licence, which your profile doesn't mention."]);
  });

  it('flags clearance, citizenship and experience far above the profile', () => {
    const job = resolveJob(services, { jobId: 'job-sw' });
    job.descriptionText =
      'Must be a U.S. citizen with an active Top Secret security clearance. Requires 10+ years of software engineering experience.';
    const me = profileOf({ ...softwareProfile, profile: { ...softwareProfile.profile, work: { ...softwareProfile.profile.work, workAuthorization: 'UK citizen' } } });
    const fit = analyzeFit(job, me);
    expect(fit.flags).toEqual([
      'Requires a security clearance: “Must be a U.S. citizen with an active Top Secret security clearance.”',
      'Citizenship requirement: “Must be a U.S. citizen with an active Top Secret security clearance.”',
      'Asks for 10+ years of experience; your profile says 6.',
    ]);
    // A US citizen satisfies the citizenship requirement.
    expect(analyzeFit(job, profileOf(softwareProfile)).flags.some((f) => f.startsWith('Citizenship'))).toBe(false);
  });

  it('is neutral rather than wrong when the profile is empty', () => {
    const fit = analyzeFit(resolveJob(services, { jobId: 'job-sw' }), profileOf({ ...softwareProfile, profile: { ...softwareProfile.profile, preferences: { ...softwareProfile.profile.preferences, targetTitles: [], salaryMin: null }, work: { ...softwareProfile.profile.work, currentTitle: '', summary: '' }, experience: [] }, skills: [], resumeText: '' }));
    expect(fit.skillsMatched).toEqual([]);
    expect(fit.salaryAlignment.ok).toBeNull();
    expect(fit.titleAlignment.detail).toBe('Add target titles to your profile to compare job titles.');
    expect(fit.summary).toMatch(/add your skills or résumé/);
    expect(fit.suggestions[0]).toMatch(/^Add your skills and résumé/);
  });

  it('answers 404 for unknown targets', () => {
    expect(() => resolveJob(services, { jobId: 'nope' })).toThrow(/Job was not found/);
    expect(() => resolveJob(services, { applicationId: 'nope' })).toThrow(/Application was not found/);
    // An unknown application falls back to the job when both are given.
    expect(resolveJob(services, { applicationId: 'nope', jobId: 'job-sw' }).title).toBe('Senior Backend Engineer');
  });

  it('reads experience requirements', () => {
    expect(requiredYears('3-5 years of professional experience; 2+ years of Kubernetes experience')).toBe(3);
    expect(requiredYears("At least 8 years' experience leading teams")).toBe(8);
    expect(requiredYears('We have been around for 10 years.')).toBeUndefined();
  });
});
