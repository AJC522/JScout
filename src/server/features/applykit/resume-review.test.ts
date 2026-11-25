import { describe, expect, it, vi } from 'vitest';
import type { ProfileService, Services } from '../../services';
import { type ProfileContext, fromPastedPosting, loadProfile, resolveJob } from './context';
import { degreeLevel, extractRequirements, minDegreeLevel } from './requirements';
import { checkBullet, gerundToPast, toGerund } from './resume-bullets';
import { parseResumeDoc } from './resume-doc';
import { analyzeResume, reviewResume } from './resume-review';
import { tailorResume } from './resume-tailor';
import {
  type ProfileFixture,
  nursingJob,
  nursingProfile,
  salesApplication,
  softwareJob,
  softwareProfile,
  softwareResume,
} from './test-fixtures';

vi.mock('../../lib/skills', () => import('./test-fixtures').then((m) => m.fakeSkills));
vi.mock('../../lib/titles', () => import('./test-fixtures').then((m) => m.fakeTitles));
vi.mock('../../lib/location', () => import('./test-fixtures').then((m) => m.fakeLocation));

const NOW = new Date('2026-11-20T12:00:00.000Z');

function profileOf(f: ProfileFixture, extraSkills: string[] = []): ProfileContext {
  return loadProfile({
    get: () => structuredClone(f.profile),
    effectiveSkills: () => [...f.skills, ...extraSkills],
    resumeText: () => f.resumeText,
  } as Partial<ProfileService> as ProfileService);
}

const services = {
  search: { jobDetail: (id: string) => [softwareJob, nursingJob].find((d) => d.job.id === id) },
  applications: { get: (id: string) => (id === salesApplication.id ? salesApplication : undefined) },
  jobs: { getDescriptionHtml: () => '' },
} as unknown as Pick<Services, 'search' | 'applications' | 'jobs'>;

const softwareTarget = () => resolveJob(services, { jobId: 'job-sw' });
const review = (resume = softwareResume, me = profileOf(softwareProfile, ['Kubernetes'])) =>
  analyzeResume(softwareTarget(), parseResumeDoc(resume, NOW), me, { source: 'saved' });

describe('posting requirements', () => {
  it('splits requirements from nice-to-haves and skips the duties list', () => {
    const reqs = extractRequirements(softwareTarget().descriptionText);
    expect(reqs.map((r) => [r.text, r.level])).toEqual([
      ['5+ years of backend engineering experience', 'required'],
      ['Strong TypeScript and Node.js skills', 'required'],
      ['Experience with PostgreSQL and distributed systems', 'required'],
      ['Hands-on Kubernetes experience in production', 'required'],
      ['Experience with payments or other distributed systems that move money', 'required'],
      ['Kafka at scale', 'preferred'],
      ['Terraform', 'preferred'],
    ]);
    expect(reqs[0]!.kind).toBe('experience');
    expect(reqs[1]!.kind).toBe('skill');
  });

  it('reads a "Requirements:" heading and leaves out conditions a résumé does not answer', () => {
    const nursing = extractRequirements(resolveJob(services, { jobId: 'job-rn' }).descriptionText);
    expect(nursing.map((r) => r.text)).toEqual([
      'Active RN license in Illinois required',
      'BLS and ACLS certification required',
      '2+ years of ICU experience',
      'Experience with Epic electronic health records',
    ]);
    expect(nursing[0]!.kind).toBe('credential');

    const sales = extractRequirements(resolveJob(services, { applicationId: 'app-sales' }).descriptionText);
    // The licence-and-travel line and the citizenship sentence are conditions of the job.
    expect(sales.map((r) => r.text)).toEqual([
      '3+ years of B2B SaaS sales experience',
      'A track record of exceeding quota',
      'Experience with Salesforce and pipeline management',
      'Excellent negotiation skills',
    ]);
  });

  it('reads pasted postings with • bullets, marks soft skills, and falls back to requirement-like lines', () => {
    const pasted = fromPastedPosting({
      title: 'Platform Engineer',
      description: `Responsibilities
• Run Kubernetes clusters

Qualifications
• Bachelor's degree in Computer Science or equivalent experience
• 3+ years with Terraform
• Excellent communication skills

Preferred
• Kafka`,
    });
    expect(extractRequirements(pasted.descriptionText).map((r) => [r.text, r.level, r.kind])).toEqual([
      ["Bachelor's degree in Computer Science or equivalent experience", 'required', 'education'],
      ['3+ years with Terraform', 'required', 'experience'],
      ['Excellent communication skills', 'required', 'soft'],
      ['Kafka', 'preferred', 'skill'],
    ]);

    const loose = extractRequirements(
      'We build tools for clinics. You must have 2+ years of React experience. Knowledge of PostgreSQL is a plus. Must be a US citizen. We offer great benefits.',
    );
    expect(loose.map((r) => [r.text, r.level])).toEqual([
      ['You must have 2+ years of React experience', 'required'],
      ['Knowledge of PostgreSQL is a plus', 'preferred'],
    ]);
  });

  it('keeps requirements but not culture talk from prose under a requirements heading', () => {
    const reqs = extractRequirements(`Who you are

We value curiosity and a calm approach to hard problems. You have shipped production services in TypeScript. Questions are welcome at every step.

Minimum requirements

- 2+ years of industry software engineering experience (does not include internships or co-ops)
- Clear goals help everyone stay aligned. Kindness and candour go together here
- Kafka`);
    expect(reqs.map((r) => r.text)).toEqual([
      'You have shipped production services in TypeScript',
      '2+ years of industry software engineering experience (does not include internships or co-ops)',
      'Kafka',
    ]);
    // The aside is not counted against the résumé.
    const checked = reviewResume(
      fromPastedPosting({ title: 'Engineer', description: `Requirements\n- ${reqs[1]!.text}` }),
      parseResumeDoc(softwareResume, NOW),
      profileOf(softwareProfile),
      { source: 'saved' },
    ).requirements[0]!;
    expect(checked.missing).not.toContain('internships');
    expect(checked.status).toBe('met');
  });

  it('reads degree levels without mistaking codes and product names for degrees', () => {
    expect(degreeLevel('BS in Computer Science')).toBe(2);
    expect(degreeLevel('B.S., Computer Science')).toBe(2);
    expect(degreeLevel("Master's in Nursing")).toBe(3);
    expect(degreeLevel('PhD in Physics')).toBe(4);
    expect(degreeLevel('Proficiency in MS Office')).toBe(0);
    expect(degreeLevel('Boston University, Boston, MA')).toBe(0);
    expect(degreeLevel('Scrum Master certification')).toBe(0);
    expect(minDegreeLevel('BS or MS in Computer Science')).toBe(2);
    expect(degreeLevel('BS or MS in Computer Science')).toBe(3);
  });
});

describe('bullet checks', () => {
  it('turns duty openers into action verbs without adding facts', () => {
    expect(checkBullet('Responsible for managing a team of 5 engineers')).toEqual({
      issues: ['weak-start'],
      rewrite: 'Managed a team of 5 engineers',
    });
    expect(checkBullet('Responsible for the payroll process').rewrite).toBe('Owned the payroll process');
    expect(checkBullet('Worked on the checkout redesign').rewrite).toBe('Contributed to the checkout redesign');
    expect(checkBullet('Helped build the billing API').rewrite).toBe('Contributed to building the billing API');
    expect(checkBullet('Assisted with quarterly audits').rewrite).toBe('Supported quarterly audits');
    expect(checkBullet('I led the migration to Kubernetes for 40 services')).toEqual({
      issues: ['first-person'],
      rewrite: 'Led the migration to Kubernetes for 40 services',
    });
    expect(checkBullet('Cut checkout latency by 35%')).toEqual({ issues: [] });
  });

  it('flags missing numbers, length and passive voice', () => {
    expect(checkBullet('Built the onboarding flow for new clinics').issues).toEqual(['no-metric']);
    expect(checkBullet('Reports were prepared weekly for the board').issues).toContain('passive');
    expect(checkBullet('Docs').issues).toEqual(['no-metric', 'too-short']);
    const long = `Designed ${'and shipped a new service '.repeat(7)}in 2024`;
    expect(checkBullet(long).issues).toContain('too-long');
  });

  it('conjugates regular and irregular verbs', () => {
    expect(['managing', 'building', 'copying', 'deploying', 'planning', 'creating'].map(gerundToPast)).toEqual([
      'managed',
      'built',
      'copied',
      'deployed',
      'planned',
      'created',
    ]);
    expect(gerundToPast('being')).toBeUndefined();
    expect(['build', 'create', 'plan', 'develop', 'tie'].map(toGerund)).toEqual(['building', 'creating', 'planning', 'developing', 'tying']);
  });
});

describe('résumé review', () => {
  it('scores what the résumé shows against the posting, with evidence', () => {
    const { review: r } = review();
    expect(r.skillsMatched).toEqual(['TypeScript', 'Node.js', 'PostgreSQL', 'AWS']);
    expect(r.skillsMissing).toEqual(['Kubernetes', 'Kafka']);
    // The profile lists Kubernetes; nothing suggests claiming Kafka.
    expect(r.skillsInProfileOnly).toEqual(['Kubernetes']);

    const byText = new Map(r.requirements.map((q) => [q.text, q]));
    expect(byText.get('Strong TypeScript and Node.js skills')).toMatchObject({
      status: 'met',
      evidence: 'Built a claims payment service in TypeScript and Node.js that processes $40M a month',
    });
    expect(byText.get('5+ years of backend engineering experience')).toMatchObject({ status: 'met', kind: 'experience' });
    expect(byText.get('5+ years of backend engineering experience')!.note).toMatch(/about 8 years/);
    expect(byText.get('Hands-on Kubernetes experience in production')!.status).toBe('missing');
    expect(byText.get('Terraform')).toMatchObject({ status: 'missing', level: 'preferred' });

    expect(r.score).toBeGreaterThan(40);
    expect(r.score).toBeLessThan(80);
    expect(r.categories.map((c) => c.key)).toEqual(['skills', 'requirements', 'keywords', 'title', 'experience', 'quality']);
    expect(r.categories.find((c) => c.key === 'skills')!.score).toBe(67);
    expect(r.categories.find((c) => c.key === 'experience')!.score).toBe(100);
    expect(r.summary).toMatch(/^(Fair|Good) match \(\d+\/100\): your résumé shows \d of 5 requirements and 4 of 6 listed skills\./);
    expect(r.stats).toMatchObject({ bullets: 6, bulletsWithNumbers: 1, yearsExperience: 8.5 });
  });

  it('recommends honest, concrete changes, most important first', () => {
    const recs = review().review.recommendations;
    const ids = recs.map((x) => x.id);
    expect(recs[0]).toMatchObject({ id: 'add-skills:kubernetes', priority: 'high', title: 'Add Kubernetes to your résumé' });
    // Kubernetes is covered by the add-skills recommendation, so its requirement is not repeated.
    expect(ids.some((id) => id.startsWith('requirement:hands-on kubernetes'))).toBe(false);
    expect(recs.find((x) => x.id.startsWith('reorder:'))).toMatchObject({
      title: 'Lead with your most relevant bullet under “Software Engineer, Brightline Health”',
      before: 'Responsible for maintaining the internal admin dashboard used by support staff',
      after: 'Built a claims payment service in TypeScript and Node.js that processes $40M a month',
    });
    expect(recs.find((x) => x.id === 'weak-openers')).toMatchObject({
      after: 'Maintained the internal admin dashboard used by support staff',
    });
    expect(recs.find((x) => x.id === 'summary')!.after).toBe(softwareProfile.profile.work.summary);
    expect(recs.find((x) => x.id === 'first-person')!.after).toBe('Wrote the first automated test suite for the billing API');
    expect(recs.find((x) => x.id === 'numbers')!.after).toMatch(/\[result: /);
    const priorities = recs.map((x) => x.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => ['high', 'medium', 'low'].indexOf(a) - ['high', 'medium', 'low'].indexOf(b)));
    // Missing requirements the user may not have are framed conditionally.
    for (const rec of recs.filter((x) => x.area === 'requirements' && x.priority === 'high')) {
      expect(rec.detail).toMatch(/If you have|If you don't/);
    }
  });

  it('reviews each bullet: relevance, issues and a safe rewrite', () => {
    const bullets = review().review.bullets;
    expect(bullets).toHaveLength(6);
    const payments = bullets.find((b) => b.text.startsWith('Built a claims payment service'))!;
    expect(payments).toMatchObject({ context: 'Software Engineer, Brightline Health', issues: [] });
    expect(payments.relevance).toBeGreaterThan(0.5);
    expect(payments.covers).toEqual(expect.arrayContaining(['TypeScript', 'Node.js']));
    expect(bullets[0]).toMatchObject({ issues: ['weak-start', 'no-metric'], rewrite: 'Maintained the internal admin dashboard used by support staff' });
  });

  it('checks the basics every résumé needs', () => {
    const checks = new Map(review().review.checks.map((c) => [c.key, c.ok]));
    expect(checks.get('email')).toBe(true);
    expect(checks.get('phone')).toBe(true);
    expect(checks.get('experience')).toBe(true);
    expect(checks.get('dates')).toBe(true);
    expect(checks.get('skills')).toBe(true);
    expect(checks.get('education')).toBe(true);
    expect(checks.get('summary')).toBe(false);
    expect(checks.get('numbers')).toBe(false);
    expect(checks.get('verbs')).toBe(false);
    expect(checks.get('voice')).toBe(false);

    const bare = review('Maya Chen\nBuilt things in TypeScript').review;
    const bareChecks = new Map(bare.checks.map((c) => [c.key, c.ok]));
    expect(bareChecks.get('email')).toBe(false);
    expect(bareChecks.get('experience')).toBe(false);
    expect(bare.recommendations.slice(0, 2).map((x) => x.id)).toEqual(['contact', 'structure']);
  });

  it('leaves out categories it cannot assess instead of guessing', () => {
    const pasted = fromPastedPosting({ title: 'Office Manager', description: 'Join our friendly team in Austin.' });
    const r = reviewResume(pasted, parseResumeDoc(softwareResume, NOW), profileOf(softwareProfile), { source: 'draft' });
    const scores = Object.fromEntries(r.categories.map((c) => [c.key, c.score]));
    expect(scores.skills).toBeNull();
    expect(scores.requirements).toBeNull();
    expect(scores.experience).toBeNull();
    expect(r.source).toBe('draft');
    expect(r.warnings[0]).toMatch(/little or no description/);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('improves when the résumé is tailored', () => {
    const before = review();
    const tailored = tailorResume(parseResumeDoc(softwareResume, NOW), before, softwareTarget(), profileOf(softwareProfile, ['Kubernetes']));
    const after = review(tailored.content);
    expect(after.review.score).toBeGreaterThan(before.review.score);
  });

  it('scores the nursing résumé on credentials and years', () => {
    const r = analyzeResume(resolveJob(services, { jobId: 'job-rn' }), parseResumeDoc(nursingProfile.resumeText, NOW), profileOf(nursingProfile), {
      source: 'saved',
    }).review;
    const status = Object.fromEntries(r.requirements.map((q) => [q.text, q.status]));
    expect(status['Active RN license in Illinois required']).toBe('met');
    expect(status['BLS and ACLS certification required']).toBe('partial');
    expect(status['2+ years of ICU experience']).toBe('partial');
    expect(r.requirements.find((q) => q.text === '2+ years of ICU experience')!.note).toMatch(/profile says about 3 years/);
  });
});

describe('tailored draft (no AI)', () => {
  const tailor = (resume = softwareResume) => {
    const me = profileOf(softwareProfile, ['Kubernetes']);
    const doc = parseResumeDoc(resume, NOW);
    return tailorResume(doc, analyzeResume(softwareTarget(), doc, me, { source: 'saved' }), softwareTarget(), me);
  };

  it('reorders, rewrites and adds only what is already true', () => {
    const { content, changes } = tailor();
    const lines = content.split('\n');
    const at = (text: string) => lines.findIndex((l) => l.includes(text));

    // A summary from the profile goes above the first section.
    expect(at('SUMMARY')).toBe(at('EXPERIENCE') - 3);
    expect(lines[at('SUMMARY') + 1]).toBe(softwareProfile.profile.work.summary);
    // The payments bullet leads its job; weak openers are rewritten in place.
    expect(at('Built a claims payment service')).toBe(at('Mar 2021 – Present') + 1);
    expect(content).toContain('- Maintained the internal admin dashboard used by support staff');
    expect(content).toContain('- Contributed to the patient onboarding flow with the design team');
    expect(content).toContain('- Wrote the first automated test suite for the billing API');
    expect(content).not.toMatch(/Responsible for|Worked on|I wrote/);
    // Posting skills first; Kubernetes (from the profile) added, Kafka (not in the profile) not.
    expect(lines[at('SKILLS') + 1]).toBe('TypeScript, Node.js, PostgreSQL, AWS, React, Docker');
    expect(lines[at('SKILLS') + 2]).toBe('Additional skills: Kubernetes');
    expect(content).not.toContain('Kafka');
    // Facts are untouched.
    for (const fact of ['Maya Chen', 'maya@example.com', 'Jun 2018 – Feb 2021', '$40M a month', 'University of Texas at Austin, BS Computer Science, 2018']) {
      expect(content).toContain(fact);
    }
    expect(changes).toEqual([
      'Added a summary at the top, taken from your profile. Adjust it to speak to this job.',
      expect.stringMatching(/^Rewrote 4 bullets to start with an action verb/),
      'Moved the bullets most related to this posting to the top under “Software Engineer, Brightline Health”.',
      'Put the skills this posting asks for first in your skills section (TypeScript, Node.js, PostgreSQL and AWS).',
      'Added Kubernetes from your profile to your skills section. Keep only what you can back up in an interview.',
    ]);
  });

  it('adds a skills section and a summary to a résumé without headings', () => {
    const { content } = tailor(softwareProfile.resumeText);
    const lines = content.split('\n');
    expect(lines[0]).toBe('Maya Chen');
    expect(lines[1]).toBe('Summary');
    expect(lines.indexOf('Skills')).toBeGreaterThan(lines.indexOf('- React dashboards for enterprise customers'));
    expect(lines[lines.indexOf('Skills') + 1]).toBe('TypeScript, Node.js, PostgreSQL, AWS, Kubernetes, React');
  });

  it('says so when there is nothing safe to change', () => {
    const tidy = `Maya Chen
maya@example.com | (512) 555-0134

SUMMARY
Backend engineer building payments systems.

EXPERIENCE
Software Engineer, Brightline Health
Mar 2021 – Present
- Built a claims payment service in TypeScript and Node.js that processes $40M a month

SKILLS
TypeScript, Node.js, PostgreSQL, AWS, Kubernetes`;
    const { content, changes } = tailor(tidy);
    expect(content).toBe(tidy);
    expect(changes).toEqual([expect.stringMatching(/no automatic changes were needed/)]);
  });
});
