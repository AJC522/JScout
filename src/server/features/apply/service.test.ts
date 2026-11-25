import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BuiltApp, buildApp } from '../../app';
import { loadConfig } from '../../config';
import { openDb } from '../../db';
import { normalizePosting } from '../../ingest/normalize';
import { remotiveSource } from '../../sources/remotive';
import type { RawPosting } from '../../sources/types';
import { createEmailApplyService } from './service';
import { smtpTransport } from './mailer';
import { fakeSmtp } from './testing';

// --- app -----------------------------------------------------------------------------------------

const NOW = new Date('2026-11-20T12:00:00.000Z');
let built: BuiltApp;
let smtp: Awaited<ReturnType<typeof fakeSmtp>>;

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) {
  const res = await built.app.inject({ method, url, headers: { host: 'localhost:4310' }, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
}

function seedJob(id: string, description: string): string {
  const raw: RawPosting = {
    externalId: id,
    url: `https://remotive.com/remote-jobs/${id}`,
    title: 'Backend Engineer',
    company: 'Acme',
    locations: ['Remote - US'],
    remote: 'remote',
    descriptionHtml: description,
    postedAt: NOW.toISOString(),
  };
  const posting = normalizePosting(raw, { source: remotiveSource.def, feedKey: 'remotive', now: NOW })!;
  built.ctx.services.jobs.upsertFeed({ feedKey: 'remotive', source: 'remotive' }, [posting], { complete: false, now: NOW });
  return posting.id;
}

const useAccount = (password = 'app-pass') =>
  call('PATCH', '/api/settings', {
    email: { host: '127.0.0.1', port: smtp.port, secure: false, fromAddress: 'maya@example.net', fromName: '', password },
  });

beforeEach(async () => {
  smtp = await fakeSmtp({ password: 'app-pass' });
  built = await buildApp({
    config: loadConfig({ logLevel: 'silent', disableSync: true, clientDir: undefined, dataDir: '/nonexistent-not-used' }),
    db: openDb(':memory:'),
    now: () => NOW,
  });
  built.ctx.services.emailApply = createEmailApplyService(built.ctx, { transport: smtpTransport });
  built.ctx.services.profile.patch({ personal: { fullName: 'Maya Chen', email: 'maya.chen@example.org', phone: '+1 512 555 0100', linkedin: 'https://linkedin.com/in/mayachen' } });
  built.ctx.services.profile.setResumeText('MAYA CHEN\nBackend engineer. Go, PostgreSQL, Kubernetes.');
});

afterEach(async () => {
  await built.close();
  await smtp.close();
});

describe('email account settings', () => {
  it('stores the account without ever returning the password', async () => {
    const res = await useAccount();
    expect(res.status).toBe(200);
    expect(res.body.email).toEqual({ host: '127.0.0.1', port: smtp.port, secure: false, user: 'maya@example.net', fromAddress: 'maya@example.net', fromName: '', hasPassword: true });
    expect(JSON.stringify(res.body)).not.toContain('app-pass');
    expect((await call('PATCH', '/api/settings', { email: null })).body.email).toBeNull();
  });

  it('rejects an account that cannot work', async () => {
    expect((await call('PATCH', '/api/settings', { email: { host: 'not a host', fromAddress: 'maya@example.net' } })).status).toBe(400);
    expect((await call('PATCH', '/api/settings', { email: { host: 'smtp.gmail.com', fromAddress: 'maya' } })).status).toBe(400);
  });
});

describe('applying by email', () => {
  it('drafts an application to the address the posting gives', async () => {
    const jobId = seedJob('a1', '<p>Go and Postgres.</p><p>To apply, send your resume to jobs@acme.dev.</p>');
    const res = await call('POST', '/api/apply/email/draft', { jobId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      to: 'jobs@acme.dev',
      suggestions: [{ address: 'jobs@acme.dev', label: 'From the posting' }],
      subject: 'Application for Backend Engineer at Acme – Maya Chen',
      bodySource: 'template',
      resume: { kind: 'resume', fileName: 'Maya Chen Resume.txt', mimeType: 'text/plain', fromText: true },
      canSend: false,
    });
    expect(res.body.body).toMatch(/^Dear Acme hiring team,/);
    expect(res.body.body).toMatch(/Maya Chen\n\+1 512 555 0100 · maya\.chen@example\.org · https:\/\/linkedin\.com\/in\/mayachen$/);
    await useAccount();
    expect((await call('POST', '/api/apply/email/draft', { jobId })).body).toMatchObject({ canSend: true, fromAddress: 'maya@example.net' });
  });

  it('sends it from the user’s account with the résumé attached, and records the application', async () => {
    const jobId = seedJob('a2', '<p>To apply, send your resume to jobs@acme.dev.</p>');
    await useAccount();
    const res = await call('POST', '/api/apply/email/send', {
      jobId,
      to: 'jobs@acme.dev',
      cc: 'maya.chen@example.org',
      subject: 'Backend Engineer – Maya Chen',
      body: 'Dear Acme hiring team,\n\nI would like to apply.\n\nMaya Chen',
      attachResume: true,
    });
    expect(res.status).toBe(200);

    expect(smtp.received).toHaveLength(1);
    const mail = smtp.received[0]!;
    expect(mail.auth).toBe('maya@example.net');
    expect(mail.from).toBe('<maya@example.net>');
    expect(mail.to).toEqual(['<jobs@acme.dev>', '<maya.chen@example.org>']);
    expect(mail.data).toContain('From: Maya Chen <maya@example.net>');
    expect(mail.data).toContain('Reply-To: maya.chen@example.org');
    expect(mail.data).toContain('Subject: =?UTF-8?Q?Backend_Engineer_=E2=80=93_Maya_Chen?=');
    expect(mail.data).toContain('I would like to apply.');
    expect(mail.data).toMatch(/Content-Disposition: attachment; filename="Maya Chen Resume\.txt"/);

    const app = res.body.application;
    expect(app).toMatchObject({ jobId, status: 'applied', appliedAt: NOW.toISOString() });
    expect(app.events.map((e: { title: string }) => e.title)).toContain('Applied by email to jobs@acme.dev');
    const email = app.documents.find((d: { kind: string }) => d.kind === 'email');
    expect(email.content).toMatch(/^To: jobs@acme\.dev\nCc: maya\.chen@example\.org\nFrom: maya@example\.net\nSubject: Backend Engineer – Maya Chen\nAttachment: Maya Chen Resume\.txt/);
  });

  it('moves a saved application to Applied and reuses its saved cover letter and contacts', async () => {
    const jobId = seedJob('a3', '<p>Remote backend role.</p>');
    const app = built.ctx.services.applications.create({ jobId });
    built.ctx.services.applications.patch(app.id, { contacts: [{ id: '', name: 'Sam Lee', role: 'Recruiter', email: 'sam@acme.dev', phone: '', linkedin: '', notes: '' }] });
    built.ctx.services.applications.addDocument(app.id, { kind: 'cover-letter', title: 'Letter', content: 'Dear Sam,\n\nMy saved letter.', generatedBy: 'manual' });

    const draft = (await call('POST', '/api/apply/email/draft', { applicationId: app.id })).body;
    expect(draft).toMatchObject({ to: 'sam@acme.dev', suggestions: [{ address: 'sam@acme.dev', label: 'Sam Lee, Recruiter' }], bodySource: 'saved-letter' });
    expect(draft.body).toMatch(/^Dear Sam,\n\nMy saved letter\./);

    await useAccount();
    const res = await call('POST', '/api/apply/email/send', { applicationId: app.id, to: 'sam@acme.dev', subject: draft.subject, body: draft.body, attachResume: false });
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('applied');
    expect(smtp.received[0]!.data).not.toContain('Content-Disposition: attachment');
  });

  it('explains what is wrong instead of sending', async () => {
    const jobId = seedJob('a4', '<p>Remote backend role.</p>');
    const send = (patch: object) => call('POST', '/api/apply/email/send', { jobId, to: 'jobs@acme.dev', subject: 'Hi', body: 'Hello', attachResume: false, ...patch });

    expect((await send({})).body.error.message).toMatch(/Set up the email account to send from in Settings/);
    await useAccount('wrong-password');
    const refused = await send({});
    expect(refused.status).toBe(502);
    expect(refused.body.error.message).toMatch(/rejected the sign-in.*app password/);
    await useAccount();
    expect((await send({ to: 'not-an-address' })).body.error.message).toBe('“not-an-address” in To is not an email address.');
    expect((await send({ subject: '   ' })).body.error.message).toBe('Add a subject line.');
    expect(smtp.received).toHaveLength(0);
    // Nothing was sent, so nothing was recorded.
    expect(built.ctx.services.applications.list()).toHaveLength(0);
  });

  it('sends a test message to the account’s own address', async () => {
    await useAccount();
    expect(await call('POST', '/api/email/test')).toEqual({ status: 200, body: { to: 'maya@example.net' } });
    expect(smtp.received[0]!.to).toEqual(['<maya@example.net>']);
  });
});
