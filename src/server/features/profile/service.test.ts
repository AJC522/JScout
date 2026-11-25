import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProfile } from '../../../shared/constants';
import type { Profile } from '../../../shared/types';
import type { AppConfig } from '../../config';
import { type Db, openDb } from '../../db';
import * as skills from '../../lib/skills';
import type { AppContext, ProfileService } from '../../services';
import { WARNINGS } from './resume-analysis';
import { createProfileService } from './service';
import { makeDocx, makePdf } from './test-fixtures';

vi.mock('../../lib/skills', async () => (await import('./test-fakes')).skillsModule);
vi.mock('../../lib/titles', async () => (await import('./test-fakes')).titlesModule);
vi.mock('../../lib/location', async () => (await import('./test-fakes')).locationModule);

let db: Db;
let dataDir: string;
let clock: Date;
let ctx: AppContext;
let profile: ProfileService;

const resumePath = () => path.join(dataDir, 'resume', 'original');

beforeEach(() => {
  db = openDb(':memory:');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jscout-profile-'));
  clock = new Date('2026-11-25T12:00:00.000Z');
  ctx = {
    db,
    config: { dataDir } as AppConfig,
    now: () => clock,
    log: { debug() {}, info() {}, warn() {}, error() {} },
  } as unknown as AppContext;
  profile = createProfileService(ctx);
});

afterEach(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('get and patch', () => {
  it('returns a complete empty profile on a fresh database', () => {
    expect(profile.get()).toEqual(emptyProfile('2026-11-25T12:00:00.000Z'));
  });

  it('fills fields missing from profiles saved by older versions', () => {
    db.run(
      "INSERT INTO profile (id, data, updated_at) VALUES ('default', ?, 'x')",
      JSON.stringify({ personal: { fullName: 'Old Timer' }, experience: [{ title: 'Clerk' }], updatedAt: '2020-01-01T00:00:00.000Z' }),
    );
    const p = createProfileService(ctx).get();
    expect(p.personal.fullName).toBe('Old Timer');
    expect(p.personal.otherLinks).toEqual([]);
    expect(p.work.yearsExperience).toBeNull();
    expect(p.preferences.radiusKm).toBe(50);
    expect(p.experience[0]).toMatchObject({ title: 'Clerk', highlights: [], current: false });
    expect(p.answers).toEqual([]);
  });

  it('merges sections shallowly, replaces arrays and bumps updatedAt', () => {
    profile.patch({ personal: { fullName: 'Jane Doe', phone: '555' }, preferences: { targetTitles: ['A', 'B'] } });
    clock = new Date('2026-11-26T08:00:00.000Z');
    const next = profile.patch({ personal: { phone: '+1 512 555 0142' }, preferences: { targetTitles: ['C'] } });
    expect(next.personal).toMatchObject({ fullName: 'Jane Doe', phone: '+1 512 555 0142' });
    expect(next.preferences.targetTitles).toEqual(['C']);
    expect(next.updatedAt).toBe('2026-11-26T08:00:00.000Z');
    expect(createProfileService(ctx).get()).toEqual(next);
  });

  it('normalises on write', () => {
    const p = profile.patch({
      personal: {
        fullName: '  Jane Doe ',
        email: ' Jane.Doe@Example.COM ',
        linkedin: 'linkedin.com/in/jane',
        github: 'http://github.com/jane',
        portfolio: '',
        otherLinks: [
          { id: '', label: 'Blog', url: 'jane.blog' },
          { id: '', label: 'Same', url: 'https://jane.blog' },
        ],
      },
      preferences: {
        targetTitles: ['Software Engineer', 'software engineer ', '', 'Backend Engineer'],
        skills: ['golang', 'Go', 'TS', 'Rust', 'rust'],
        locations: ['Austin, TX', 'austin, tx'],
        salaryCurrency: 'eur',
      },
      experience: [{ id: '', title: ' Engineer ', company: 'Acme', location: '', start: '2020-01', end: '2021-02', current: true, summary: '', highlights: [' Did things ', ''] }, { id: '', title: '', company: '', location: '', start: '', end: '', current: false, summary: '', highlights: [] }],
    });
    expect(p.personal).toMatchObject({
      fullName: 'Jane Doe',
      email: 'jane.doe@example.com',
      linkedin: 'https://linkedin.com/in/jane',
      github: 'http://github.com/jane',
      portfolio: '',
    });
    expect(p.personal.otherLinks).toEqual([{ id: expect.any(String), label: 'Blog', url: 'https://jane.blog' }]);
    expect(p.preferences.targetTitles).toEqual(['Software Engineer', 'Backend Engineer']);
    expect(p.preferences.skills).toEqual(['Go', 'TypeScript', 'Rust']);
    expect(p.preferences.locations).toEqual(['Austin, TX']);
    expect(p.preferences.salaryCurrency).toBe('EUR');
    expect(p.experience).toHaveLength(1);
    expect(p.experience[0]).toMatchObject({ title: 'Engineer', end: '', current: true, highlights: ['Did things'] });
    expect(p.experience[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects links that are not web addresses', () => {
    expect(() => profile.patch({ personal: { website: 'javascript:alert(1)' } })).toThrow(/personal.website/);
    expect(() => profile.patch({ personal: { portfolio: 'not a url' } })).toThrow(/personal.portfolio/);
    expect(() => profile.patch({ personal: { otherLinks: [{ id: 'x', label: 'x', url: 'ftp://x.org' }] } })).toThrow(/otherLinks/);
    expect(profile.get().personal.website).toBe('');
  });

  it('caps list sizes and keeps ids unique', () => {
    const titles = Array.from({ length: 80 }, (_v, i) => `Title ${i}`);
    const p = profile.patch({
      preferences: { targetTitles: titles },
      education: [
        { id: 'same', school: 'A', degree: '', field: '', start: '', end: '' },
        { id: 'same', school: 'B', degree: '', field: '', start: '', end: '' },
      ],
    });
    expect(p.preferences.targetTitles).toHaveLength(60);
    expect(p.education[0]!.id).toBe('same');
    expect(p.education[1]!.id).not.toBe('same');
  });

  it('maintains SavedAnswer.updatedAt', () => {
    const first = profile.patch({ answers: [{ id: 'a1', question: 'Why us?', answer: 'Because.', tags: [], updatedAt: '' }] });
    expect(first.answers[0]!.updatedAt).toBe('2026-11-25T12:00:00.000Z');
    clock = new Date('2026-12-01T00:00:00.000Z');
    const unchanged = profile.patch({ answers: [...first.answers, { id: '', question: 'Salary?', answer: 'Negotiable', tags: ['pay'], updatedAt: '1999-01-01' }] });
    expect(unchanged.answers[0]!.updatedAt).toBe('2026-11-25T12:00:00.000Z');
    expect(unchanged.answers[1]!.updatedAt).toBe('2026-12-01T00:00:00.000Z');
    clock = new Date('2026-12-02T00:00:00.000Z');
    const edited = profile.patch({ answers: [{ ...unchanged.answers[0]!, answer: 'Because I love it.' }] });
    expect(edited.answers).toHaveLength(1);
    expect(edited.answers[0]!.updatedAt).toBe('2026-12-02T00:00:00.000Z');
  });

  it('does not keep a profile written in a transaction that rolled back', () => {
    profile.patch({ personal: { fullName: 'Before' } });
    expect(() =>
      db.tx(() => {
        profile.patch({ personal: { fullName: 'During' } });
        expect(profile.get().personal.fullName).toBe('During');
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(profile.get().personal.fullName).toBe('Before');
  });

  it('hands out copies', () => {
    const p = profile.get();
    p.personal.fullName = 'Mutated';
    p.preferences.skills.push('X');
    expect(profile.get().personal.fullName).toBe('');
    expect(profile.get().preferences.skills).toEqual([]);
  });
});

describe('completeness', () => {
  it('reports missing items and reaches exactly 100', () => {
    const empty = profile.completeness();
    expect(empty.percent).toBe(0);
    expect(empty.missing.map((m) => m.key)).toEqual([
      'name', 'email', 'phone', 'location', 'resume', 'targetTitles', 'skills', 'locations', 'workAuthorization', 'summary', 'experience', 'answers',
    ]);
    profile.patch({
      personal: { fullName: 'Jane', email: 'j@example.com', phone: '1', location: 'Austin' },
      work: { workAuthorization: 'US citizen', summary: 'Engineer.' },
      preferences: { targetTitles: ['Engineer'], skills: ['Go'], remote: ['remote'] },
      experience: [{ id: '', title: 'Engineer', company: '', location: '', start: '', end: '', current: false, summary: '', highlights: [] }],
      answers: [1, 2].map((i) => ({ id: '', question: `Q${i}`, answer: 'A', tags: [], updatedAt: '' })),
    });
    expect(profile.completeness().percent).toBe(75);
    expect(profile.completeness().missing.map((m) => m.key)).toEqual(['resume', 'answers']);
    profile.setResumeText('Jane Doe\nEngineer');
    profile.patch({ answers: [1, 2, 3].map((i) => ({ id: '', question: `Q${i}`, answer: 'A', tags: [], updatedAt: '' })) });
    expect(profile.completeness()).toEqual({ percent: 100, missing: [] });
  });
});

describe('effectiveSkills', () => {
  it('puts preference skills first, then résumé skills, and caches the résumé extraction', () => {
    profile.patch({ preferences: { skills: ['Go', 'Rust'] } });
    profile.setResumeText('Skills: TypeScript, Go, PostgreSQL');
    const spy = vi.spyOn(skills, 'extractSkills');
    expect(profile.effectiveSkills()).toEqual(['Go', 'Rust', 'TypeScript', 'PostgreSQL']);
    profile.patch({ personal: { fullName: 'Jane' } });
    expect(profile.effectiveSkills()).toEqual(['Go', 'Rust', 'TypeScript', 'PostgreSQL']);
    expect(spy).toHaveBeenCalledTimes(1);
    profile.setResumeText('Python and SQL');
    spy.mockClear(); // setResumeText analysed the new text; count only what effectiveSkills does
    expect(profile.effectiveSkills()).toEqual(['Go', 'Rust', 'Python', 'SQL']);
    expect(profile.effectiveSkills()).toEqual(['Go', 'Rust', 'Python', 'SQL']);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('résumé', () => {
  it('stores an uploaded PDF owner-only, extracts its text and analyses it', async () => {
    const pdf = makePdf([
      'Jane Doe',
      'Austin, TX | jane.doe@example.com | (512) 555-0142',
      'EXPERIENCE',
      'Senior Software Engineer, Acme Corp     Jan 2020 - Present',
      '- Built billing APIs in TypeScript and Go.',
      'EDUCATION',
      'B.S. Computer Science, University of Texas at Austin, 2012 - 2016',
    ]);
    const result = await profile.setResumeFile({ fileName: '../My Resume.pdf', mimeType: 'text/html', bytes: pdf });
    expect(result.resume).toEqual({
      fileName: 'My Resume.pdf',
      mimeType: 'application/pdf',
      text: expect.stringContaining('Senior Software Engineer, Acme Corp'),
      updatedAt: '2026-11-25T12:00:00.000Z',
      sizeBytes: pdf.length,
      hasFile: true,
    });
    expect(result.analysis.contact).toMatchObject({ fullName: 'Jane Doe', email: 'jane.doe@example.com', phone: '(512) 555-0142', location: 'Austin, TX' });
    expect(result.analysis.experience).toMatchObject([{ title: 'Senior Software Engineer', company: 'Acme Corp', start: '2020-01', current: true }]);
    expect(result.analysis.skills).toEqual(expect.arrayContaining(['TypeScript', 'Go']));
    expect(result.analysis.warnings).toEqual([]);

    expect(fs.readFileSync(resumePath()).equals(pdf)).toBe(true);
    if (process.platform !== 'win32') expect(fs.statSync(resumePath()).mode & 0o777).toBe(0o600);
    expect(profile.resumeFile()).toEqual({ fileName: 'My Resume.pdf', mimeType: 'application/pdf', bytes: pdf });
    expect(profile.resumeText()).toContain('jane.doe@example.com');
    const withoutIds = (v: unknown) => JSON.parse(JSON.stringify(v, (k, val) => (k === 'id' ? undefined : val)));
    expect(withoutIds(profile.analyzeResume())).toEqual(withoutIds(result.analysis));
  });

  it('stores an image-only PDF but warns that it looks scanned', async () => {
    const result = await profile.setResumeFile({ fileName: 'scan.pdf', mimeType: 'application/pdf', bytes: makePdf([]) });
    expect(result.resume).toMatchObject({ text: '', hasFile: true });
    expect(result.analysis.warnings).toEqual([WARNINGS.scanned]);
    expect(profile.analyzeResume().warnings).toEqual([WARNINGS.scanned]);
    expect(fs.existsSync(resumePath())).toBe(true);
  });

  it('extracts a DOCX upload and replaces the previous file', async () => {
    await profile.setResumeFile({ fileName: 'old.txt', mimeType: 'text/plain', bytes: Buffer.from('Old résumé text') });
    const docx = makeDocx(['Priya Raman', 'Experience', 'Senior Data Analyst\tMar 2021 – Present', 'Northwind Analytics, Seattle, WA']);
    const result = await profile.setResumeFile({ fileName: 'cv.docx', mimeType: 'application/octet-stream', bytes: docx });
    expect(result.resume.mimeType).toContain('wordprocessingml');
    expect(result.resume.text).toContain('Senior Data Analyst\tMar 2021 – Present');
    expect(result.analysis.experience).toMatchObject([{ title: 'Senior Data Analyst', company: 'Northwind Analytics', location: 'Seattle, WA' }]);
    expect(fs.readFileSync(resumePath()).equals(docx)).toBe(true);
    expect(fs.readdirSync(path.join(dataDir, 'resume'))).toEqual(['original']);
  });

  it('rejects unsupported uploads without touching the stored résumé', async () => {
    await profile.setResumeFile({ fileName: 'cv.txt', mimeType: 'text/plain', bytes: Buffer.from('Jane Doe') });
    await expect(profile.setResumeFile({ fileName: 'cv.doc', mimeType: 'application/msword', bytes: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) })).rejects.toMatchObject({ status: 400 });
    expect(profile.resumeText()).toBe('Jane Doe');
    expect(profile.resumeFile()?.bytes.toString()).toBe('Jane Doe');
  });

  it('accepts pasted text and drops any stored file', async () => {
    await profile.setResumeFile({ fileName: 'cv.pdf', mimeType: 'application/pdf', bytes: makePdf(['Jane']) });
    const result = profile.setResumeText('  Jane Doe\r\n\r\n\r\n\r\nEngineer  ');
    expect(result.resume).toEqual({ fileName: 'Pasted résumé', mimeType: 'text/plain', text: 'Jane Doe\n\nEngineer', updatedAt: clock.toISOString(), sizeBytes: 0, hasFile: false });
    expect(profile.resumeFile()).toBeUndefined();
    expect(fs.existsSync(resumePath())).toBe(false);
    expect(() => profile.setResumeText(' \n\u0000 ')).toThrow(/Paste/);
  });

  it('deletes the résumé file and text', async () => {
    await profile.setResumeFile({ fileName: 'cv.txt', mimeType: 'text/plain', bytes: Buffer.from('Jane Doe') });
    expect(profile.deleteResume().resume).toBeNull();
    expect(fs.existsSync(resumePath())).toBe(false);
    expect(profile.resumeFile()).toBeUndefined();
    expect(profile.analyzeResume().warnings).toEqual([WARNINGS.noResume]);
    expect(profile.deleteResume().resume).toBeNull();
  });
});

describe('replace (data import)', () => {
  it('replaces everything, normalising leniently and keeping answer timestamps', () => {
    profile.patch({ personal: { fullName: 'Before' }, preferences: { skills: ['Go'] } });
    const incoming: Profile = {
      ...emptyProfile('2025-01-01T00:00:00.000Z'),
      personal: { ...emptyProfile('').personal, fullName: 'After', website: 'javascript:alert(1)', email: 'not-an-email' },
      answers: [{ id: 'a', question: 'Q', answer: 'A', tags: [], updatedAt: '2025-03-04T05:06:07.000Z' }],
      onboardedAt: '2025-01-02T00:00:00.000Z',
    };
    const p = profile.replace(incoming);
    expect(p.personal).toMatchObject({ fullName: 'After', website: '', email: '' });
    expect(p.preferences.skills).toEqual([]);
    expect(p.answers[0]!.updatedAt).toBe('2025-03-04T05:06:07.000Z');
    expect(p.onboardedAt).toBe('2025-01-02T00:00:00.000Z');
    expect(p.updatedAt).toBe(clock.toISOString());
  });

  it('keeps the stored file only when the imported résumé is the same one', async () => {
    await profile.setResumeFile({ fileName: 'cv.txt', mimeType: 'text/plain', bytes: Buffer.from('Jane Doe CV') });
    const backup = profile.get();
    expect(profile.replace(backup).resume?.hasFile).toBe(true);
    expect(fs.existsSync(resumePath())).toBe(true);

    const other = { ...backup, resume: { ...backup.resume!, text: 'Someone else' } };
    expect(profile.replace(other).resume).toMatchObject({ text: 'Someone else', hasFile: false });
    expect(fs.existsSync(resumePath())).toBe(false);
    expect(profile.resumeFile()).toBeUndefined();
  });
});

describe('quickFill', () => {
  it('lists the values to copy into application forms and omits empty ones', () => {
    profile.patch({
      personal: {
        fullName: 'María de la Cruz',
        email: 'maria@example.com',
        linkedin: 'linkedin.com/in/maria',
        otherLinks: [{ id: 'l1', label: 'Dribbble', url: 'dribbble.com/maria' }],
      },
      work: { yearsExperience: 7, requiresSponsorship: false, willingToRelocate: true, workAuthorization: 'EU citizen' },
      preferences: { salaryMin: 85000, salaryCurrency: 'EUR' },
      experience: [
        { id: '', title: 'Designer', company: 'Old Co', location: '', start: '2015', end: '2018', current: false, summary: '', highlights: [] },
        { id: '', title: 'Lead Designer', company: 'Now Co', location: '', start: '2018', end: '', current: true, summary: '', highlights: [] },
      ],
      education: [
        { id: '', school: 'High School', degree: 'Diploma', field: '', start: '', end: '2008' },
        { id: '', school: 'Universidad de Sevilla', degree: 'BFA', field: 'Graphic Design', start: '2008', end: '2012' },
      ],
    });
    const fields = Object.fromEntries(profile.quickFill().map((f) => [f.key, f.value]));
    expect(fields).toEqual({
      fullName: 'María de la Cruz',
      firstName: 'María',
      lastName: 'de la Cruz',
      email: 'maria@example.com',
      linkedin: 'https://linkedin.com/in/maria',
      'link:l1': 'https://dribbble.com/maria',
      currentTitle: 'Lead Designer',
      currentCompany: 'Now Co',
      yearsExperience: '7',
      workAuthorization: 'EU citizen',
      requiresSponsorship: 'No',
      willingToRelocate: 'Yes',
      salaryExpectation: '€85,000',
      school: 'Universidad de Sevilla',
      degree: 'BFA',
      fieldOfStudy: 'Graphic Design',
    });
    expect(profile.quickFill().find((f) => f.key === 'link:l1')).toMatchObject({ label: 'Dribbble', group: 'links' });
  });

  it('is empty for an empty profile', () => {
    expect(profile.quickFill()).toEqual([]);
  });
});
