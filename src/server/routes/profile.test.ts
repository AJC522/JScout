import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataExport } from '../../shared/api';
import { MAX_RESUME_BYTES } from '../../shared/constants';
import type { ServerEvent } from '../../shared/types';
import { type BuiltApp, buildApp } from '../app';
import { loadConfig } from '../config';
import { openDb } from '../db';
import { makePdf } from '../features/profile/test-fixtures';
import type { Services } from '../services';

vi.mock('../lib/skills', async () => (await import('../features/profile/test-fakes')).skillsModule);
vi.mock('../lib/titles', async () => (await import('../features/profile/test-fakes')).titlesModule);
vi.mock('../lib/location', async () => (await import('../features/profile/test-fakes')).locationModule);

let built: BuiltApp;
let dataDir: string;
let calls: string[];
let events: ServerEvent[];

const HOST = { host: '127.0.0.1:4310' };

async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  const res = await built.app.inject({ method, url, headers: HOST, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
}

function multipart(field: string, fileName: string, content: Buffer) {
  const boundary = '----jscout-test-boundary';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { ...HOST, 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const upload = (field: string, fileName: string, content: Buffer) =>
  built.app.inject({ method: 'POST', url: '/api/profile/resume', ...multipart(field, fileName, content) });

const SAVED_SEARCH = { id: 's1', name: 'Go jobs', query: { q: 'golang' }, pinned: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
const HIDDEN = { clusterKey: 'c1', hiddenAt: '2026-01-03T00:00:00.000Z' };
const COMPANY = { name: 'Acme', ats: 'greenhouse' as const, token: 'acme', enabled: true };
const APPLICATION = {
  id: 'a1',
  status: 'applied',
  job: { title: 'Engineer', company: 'Acme', locationText: '', remote: 'remote', url: '', source: 'manual', sourceName: '', employmentType: 'full-time', skills: [], descriptionHtml: '' },
  notes: '',
  priority: 0,
  contacts: [],
  checklist: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  statusChangedAt: '2026-01-01T00:00:00.000Z',
  sortOrder: 0,
  jobClosed: false,
  events: [],
  documents: [],
};

/** Fakes for the services this feature does not own; they record what the routes ask of them. */
function installFakes(services: Services) {
  const record = <T>(name: string, value: T) => () => {
    calls.push(name);
    return value;
  };
  Object.assign(services, {
    savedSearches: { exportAll: () => [SAVED_SEARCH], importAll: (items: unknown[]) => (calls.push('savedSearches.import'), items.length), clear: record('savedSearches.clear', undefined) },
    applications: { exportAll: () => [APPLICATION], importAll: (items: unknown[]) => (calls.push('applications.import'), items.length), clear: record('applications.clear', undefined) },
    companies: { exportUser: () => [COMPANY], importUser: (items: unknown[]) => (calls.push('companies.import'), items.length) },
    userState: { exportHidden: () => [HIDDEN], importHidden: (items: unknown[]) => (calls.push('userState.import'), items.length), clear: record('userState.clear', undefined) },
    search: { clearHistory: record('search.clearHistory', undefined) },
    jobs: { clear: record('jobs.clear', undefined) },
    sync: { summary: () => ({ openJobs: 0, sources: 0, companies: 0, syncing: false, pendingFeeds: 0 }), stop: async () => {} },
  } as unknown as Partial<Services>);
}

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jscout-routes-'));
  built = await buildApp({
    config: loadConfig({ logLevel: 'silent', disableSync: true, clientDir: undefined, dataDir }),
    db: openDb(':memory:'),
    now: () => new Date('2026-11-25T12:00:00.000Z'),
  });
  calls = [];
  events = [];
  built.ctx.events.subscribe((e) => events.push(e));
  installFakes(built.ctx.services);
});

afterEach(async () => {
  await built.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('profile', () => {
  it('reads and patches the profile', async () => {
    expect((await call('GET', '/api/profile')).body.personal.fullName).toBe('');
    const patched = await call('PATCH', '/api/profile', { personal: { fullName: ' Jane ', github: 'github.com/jane' }, preferences: { skills: ['golang'] } });
    expect(patched.status).toBe(200);
    expect(patched.body.personal).toMatchObject({ fullName: 'Jane', github: 'https://github.com/jane' });
    expect(patched.body.preferences.skills).toEqual(['Go']);
    expect((await call('GET', '/api/profile')).body.personal.fullName).toBe('Jane');
  });

  it.each([
    [{ nickname: 'x' }, ''],
    [{ personal: { website: 'javascript:alert(1)' } }, 'personal.website'],
    [{ personal: { email: 'nope' } }, 'personal.email'],
    [{ personal: { favouriteColour: 'blue' } }, 'personal'],
    [{ work: { yearsExperience: -1 } }, 'work.yearsExperience'],
    [{ preferences: { remote: ['moon'] } }, 'preferences.remote.0'],
    [{ preferences: { targetTitles: Array.from({ length: 61 }, (_v, i) => `T${i}`) } }, 'preferences.targetTitles'],
    [{ experience: [{ start: 'Jan 2020' }] }, 'experience.0.start'],
    [{ onboardedAt: 'yesterday' }, 'onboardedAt'],
  ])('rejects invalid patch %j', async (payload, pathPrefix) => {
    const res = await call('PATCH', '/api/profile', payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
    expect(res.body.error.details[0].path).toBe(pathPrefix);
  });

  it('serves completeness and quick-fill', async () => {
    await call('PATCH', '/api/profile', { personal: { fullName: 'Jane Doe', email: 'jane@example.com' } });
    const completeness = await call('GET', '/api/profile/completeness');
    expect(completeness.body.percent).toBe(20);
    const fill = await call('GET', '/api/profile/quick-fill');
    expect(fill.body.map((f: { key: string }) => f.key)).toEqual(['fullName', 'firstName', 'lastName', 'email']);
  });
});

describe('résumé', () => {
  it('uploads a PDF, serves the original back and deletes it', async () => {
    const pdf = makePdf(['Jane Doe', 'jane@example.com', 'EXPERIENCE', 'Software Engineer, Acme Corp   2019 - Present']);
    const res = await upload('file', 'Jané CV.pdf', pdf);
    expect(res.statusCode).toBe(200);
    expect(res.json().resume).toMatchObject({ fileName: 'Jané CV.pdf', mimeType: 'application/pdf', hasFile: true, sizeBytes: pdf.length });
    expect(res.json().analysis.experience).toMatchObject([{ title: 'Software Engineer', company: 'Acme Corp', current: true }]);

    const file = await built.app.inject({ method: 'GET', url: '/api/profile/resume/file', headers: HOST });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(pdf)).toBe(true);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toBe(`attachment; filename="Jan_ CV.pdf"; filename*=UTF-8''Jan%C3%A9%20CV.pdf`);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toBe('no-store');

    expect((await call('GET', '/api/profile/resume/analysis')).body.contact.email).toBe('jane@example.com');
    expect((await call('DELETE', '/api/profile/resume')).body.resume).toBeNull();
    expect((await call('GET', '/api/profile/resume/file')).status).toBe(404);
  });

  it('serves text uploads with a charset', async () => {
    await upload('file', 'cv.md', Buffer.from('# Jane Doe\n'));
    const file = await built.app.inject({ method: 'GET', url: '/api/profile/resume/file', headers: HOST });
    expect(file.headers['content-type']).toBe('text/markdown; charset=utf-8');
  });

  it('rejects bad uploads with clear errors', async () => {
    const notMultipart = await call('POST', '/api/profile/resume', { file: 'x' });
    expect(notMultipart.status).toBe(400);
    const malformed = await built.app.inject({ method: 'POST', url: '/api/profile/resume', headers: { ...HOST, 'content-type': 'multipart/form-data' }, payload: 'garbage' });
    expect(malformed.statusCode).toBe(400);
    const empty = await built.app.inject({ method: 'POST', url: '/api/profile/resume', headers: { ...HOST, 'content-type': 'multipart/form-data; boundary=x' }, payload: '--x--\r\n' });
    expect(empty.statusCode).toBe(400);
    const wrongField = await upload('resume', 'cv.txt', Buffer.from('Jane'));
    expect(wrongField.statusCode).toBe(400);
    expect(wrongField.json().error.message).toMatch(/"file"/);
    const legacy = await upload('file', 'cv.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    expect(legacy.statusCode).toBe(400);
    expect(legacy.json().error.message).toMatch(/\.docx or PDF/);
    const tooLarge = await upload('file', 'cv.txt', Buffer.alloc(MAX_RESUME_BYTES + 10, 0x61));
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error).toMatchObject({ code: 'too_large', message: expect.stringMatching(/up to 8 MB/) });
    expect((await call('GET', '/api/profile')).body.resume).toBeNull();
  });

  it('accepts pasted text', async () => {
    const res = await call('PUT', '/api/profile/resume/text', { text: 'Jane Doe\nEXPERIENCE\nEngineer, Acme  2020 - 2022' });
    expect(res.status).toBe(200);
    expect(res.body.resume).toMatchObject({ fileName: 'Pasted résumé', hasFile: false });
    expect(res.body.analysis.yearsExperience).toBe(2.1);
    expect((await call('PUT', '/api/profile/resume/text', { text: 42 })).status).toBe(400);
    expect((await call('PUT', '/api/profile/resume/text', { text: '   ' })).status).toBe(400);
  });
});

describe('data export and import', () => {
  it('exports everything the user owns', async () => {
    await call('PATCH', '/api/profile', { personal: { fullName: 'Jane' } });
    const res = await built.app.inject({ method: 'GET', url: '/api/data/export', headers: HOST });
    const body = res.json() as DataExport;
    expect(res.headers['cache-control']).toBe('no-store');
    expect(body).toMatchObject({ app: 'jscout', formatVersion: 1, exportedAt: '2026-11-25T12:00:00.000Z', savedSearches: [SAVED_SEARCH], applications: [APPLICATION], userCompanies: [COMPANY], hiddenJobs: [HIDDEN] });
    expect(body.profile.personal.fullName).toBe('Jane');
  });

  it('imports a backup, and importing it twice gives the same result', async () => {
    await call('PATCH', '/api/profile', { personal: { fullName: 'Jane', linkedin: 'linkedin.com/in/jane' }, answers: [{ question: 'Why?', answer: 'Because' }] });
    const backup = (await call('GET', '/api/data/export')).body as DataExport;
    await call('PATCH', '/api/profile', { personal: { fullName: 'Someone else' } });

    const first = await call('POST', '/api/data/import', backup);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ profile: true, savedSearches: 1, applications: 1, userCompanies: 1, hiddenJobs: 1 });
    expect(calls).toEqual(['savedSearches.import', 'applications.import', 'companies.import', 'userState.import']);
    const afterFirst = (await call('GET', '/api/profile')).body;
    expect(afterFirst.personal).toMatchObject({ fullName: 'Jane', linkedin: 'https://linkedin.com/in/jane' });
    expect(afterFirst.answers[0]).toMatchObject({ question: 'Why?', answer: 'Because', updatedAt: backup.profile.answers[0]!.updatedAt });

    expect((await call('POST', '/api/data/import', backup)).status).toBe(200);
    expect((await call('GET', '/api/profile')).body).toEqual(afterFirst);
  });

  it('accepts minimal and older backups', async () => {
    const res = await call('POST', '/api/data/import', { app: 'jscout', formatVersion: 1, profile: { personal: { fullName: 'Old' }, extra: true } });
    expect(res.body).toEqual({ profile: true, savedSearches: 0, applications: 0, userCompanies: 0, hiddenJobs: 0 });
    expect((await call('GET', '/api/profile')).body.personal).toMatchObject({ fullName: 'Old', otherLinks: [] });
  });

  it.each([
    [{ app: 'other', formatVersion: 1, profile: {} }, 'app'],
    [{ app: 'jscout', formatVersion: 2, profile: {} }, 'formatVersion'],
    [{ app: 'jscout', formatVersion: 1 }, 'profile'],
    [{ app: 'jscout', formatVersion: 1, profile: {}, savedSearches: [{ ...SAVED_SEARCH, query: { q: 'x', bogus: 1 } }] }, 'savedSearches.0.query'],
    [{ app: 'jscout', formatVersion: 1, profile: {}, userCompanies: [{ ...COMPANY, ats: 'myspace' }] }, 'userCompanies.0.ats'],
    [{ app: 'jscout', formatVersion: 1, profile: {}, applications: [{ ...APPLICATION, status: 'ghosted' }] }, 'applications.0.status'],
    [{ app: 'jscout', formatVersion: 1, profile: {}, hiddenJobs: [{ clusterKey: '' , hiddenAt: 'x' }] }, 'hiddenJobs.0.clusterKey'],
  ])('rejects invalid backups (%#)', async (payload, pathPrefix) => {
    await call('PATCH', '/api/profile', { personal: { fullName: 'Keep me' } });
    const res = await call('POST', '/api/data/import', payload);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe(pathPrefix);
    expect(calls).toEqual([]);
    expect((await call('GET', '/api/profile')).body.personal.fullName).toBe('Keep me');
  });

  it('rolls back everything when one part fails', async () => {
    await call('PATCH', '/api/profile', { personal: { fullName: 'Keep me' } });
    built.ctx.services.companies.importUser = () => {
      throw new Error('boom');
    };
    const res = await call('POST', '/api/data/import', { app: 'jscout', formatVersion: 1, profile: { personal: { fullName: 'New' } } });
    expect(res.status).toBe(500);
    expect((await call('GET', '/api/profile')).body.personal.fullName).toBe('Keep me');
  });
});

describe('data reset', () => {
  async function seed() {
    const db = built.ctx.db;
    db.run("INSERT INTO sync_state (feed_key, source) VALUES ('remotive', 'remotive')");
    db.run("INSERT INTO companies (id, name, ats, token, origin, added_at) VALUES ('greenhouse:seed', 'Seed', 'greenhouse', 'seed', 'seed', 'x')");
    db.run("INSERT INTO companies (id, name, ats, token, origin, added_at) VALUES ('lever:mine', 'Mine', 'lever', 'mine', 'user', 'x')");
    built.ctx.services.settings.updateApp({ theme: 'dark' });
    await call('PATCH', '/api/profile', { personal: { fullName: 'Jane' } });
    await upload('file', 'cv.txt', Buffer.from('Jane Doe'));
  }

  it('clears only the index for scope "index"', async () => {
    await seed();
    expect((await call('POST', '/api/data/reset', { scope: 'index' })).body).toEqual({ ok: true });
    expect(calls).toEqual(['jobs.clear']);
    expect(built.ctx.db.scalar('SELECT COUNT(*) FROM sync_state')).toBe(0);
    expect(built.ctx.db.scalar('SELECT COUNT(*) FROM companies')).toBe(2);
    expect((await call('GET', '/api/profile')).body.personal.fullName).toBe('Jane');
    expect(built.ctx.services.settings.getApp().theme).toBe('dark');
    expect(events).toEqual([{ type: 'index-changed', index: expect.objectContaining({ openJobs: 0 }) }]);
  });

  it('wipes user data for scope "everything"', async () => {
    await seed();
    expect((await call('POST', '/api/data/reset', { scope: 'everything' })).status).toBe(200);
    expect(calls).toEqual(['jobs.clear', 'savedSearches.clear', 'applications.clear', 'userState.clear', 'search.clearHistory']);
    const profile = (await call('GET', '/api/profile')).body;
    expect(profile.personal.fullName).toBe('');
    expect(profile.resume).toBeNull();
    expect(fs.existsSync(path.join(dataDir, 'resume', 'original'))).toBe(false);
    // Bundled boards go back to their first-run state: unfollowed.
    expect(built.ctx.db.all('SELECT id, enabled FROM companies')).toEqual([{ id: 'greenhouse:seed', enabled: 0 }]);
    expect(built.ctx.db.scalar('SELECT COUNT(*) FROM settings')).toBe(0);
    expect(built.ctx.services.settings.getApp().theme).toBe('system');
  });

  it('validates the scope', async () => {
    expect((await call('POST', '/api/data/reset', { scope: 'all' })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('data reset on disk', () => {
  it('leaves no deleted key or note readable in the data folder', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jscout-reset-'));
    const real = await buildApp({ config: loadConfig({ logLevel: 'silent', disableSync: true, clientDir: undefined, dataDir: dir }) });
    try {
      const send = (method: 'POST' | 'PATCH', url: string, payload: object) => real.app.inject({ method, url, headers: HOST, payload });
      expect((await send('PATCH', '/api/settings', { ai: { apiKey: 'sk-ant-RESETKEY4242' } })).statusCode).toBe(200);
      const created = await send('POST', '/api/applications', {
        job: { title: 'Engineer', company: 'Acme' },
        notes: 'Spoke to recruiter Zebedee Quiltwhistle',
      });
      expect(created.statusCode).toBe(200);
      expect((await send('POST', '/api/data/reset', { scope: 'everything' })).statusCode).toBe(200);
      const file = real.ctx.config.dbPath;
      const bytes = ['', '-wal'].map((s) => (fs.existsSync(file + s) ? fs.readFileSync(file + s).toString('latin1') : '')).join('');
      expect(bytes).not.toContain('sk-ant-RESETKEY4242');
      expect(bytes).not.toContain('Zebedee Quiltwhistle');
    } finally {
      await real.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
