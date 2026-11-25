import { APIConnectionTimeoutError, AuthenticationError, RateLimitError } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_MODEL } from '../../../shared/constants';
import type { Application, ApplicationStatus, CoverLetterRequest } from '../../../shared/types';
import type { AppContext, ApplicationsService, ProfileService, SearchService, SettingsService } from '../../services';
import { LAST_ERROR_KEY, NO_KEY_REASON } from './ai';
import { createApplyKitService } from './service';
import { salesApplication, savedAnswer, softwareJob, softwareProfile, softwareResume } from './test-fixtures';

vi.mock('../../lib/skills', () => import('./test-fixtures').then((m) => m.fakeSkills));
vi.mock('../../lib/titles', () => import('./test-fixtures').then((m) => m.fakeTitles));
vi.mock('../../lib/location', () => import('./test-fixtures').then((m) => m.fakeLocation));

const sdk = vi.hoisted(() => ({ create: vi.fn(), constructed: [] as unknown[] }));
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic {
    messages = { create: sdk.create };
    constructor(options: unknown) {
      sdk.constructed.push(options);
    }
  }
  return { ...actual, default: FakeAnthropic };
});

const DESCRIPTION_MARKER = 'Lumen Pay builds payments infrastructure';

function message(text: string, stopReason = 'end_turn') {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: DEFAULT_AI_MODEL,
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

let store: Map<string, unknown>;
let apiKey: string | undefined;
let settings: SettingsService;

function makeService() {
  store = new Map();
  settings = {
    getApp: () => ({ theme: 'system', autoSync: true, closedRetentionDays: 30, maxPostingAgeDays: 60, ai: { hasKey: Boolean(apiKey), keySource: apiKey ? ('saved' as const) : null, model: '' } }),
    getSecret: () => apiKey,
    getJson: <T>(key: string) => store.get(key) as T | undefined,
    setJson: vi.fn((key: string, value: unknown) => void store.set(key, value)),
    remove: vi.fn((key: string) => void store.delete(key)),
  } as Partial<SettingsService> as SettingsService;
  const profile = {
    get: () => {
      const p = structuredClone(softwareProfile.profile);
      p.answers = [savedAnswer('a1', 'Why this company?', 'I want to join {company} because of its payments focus.', ['motivation'])];
      return p;
    },
    effectiveSkills: () => softwareProfile.skills,
    resumeText: () => softwareProfile.resumeText,
  } as Partial<ProfileService> as ProfileService;
  const search = { jobDetail: (id: string) => (id === softwareJob.job.id ? softwareJob : undefined) } as Partial<SearchService>;
  const applications = { get: () => undefined, list: (): Application[] => [] } as Partial<ApplicationsService>;
  const ctx = {
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => new Date('2026-11-20T12:00:00.000Z'),
    services: { settings, profile, search, applications, jobs: {} },
  } as unknown as AppContext;
  return { service: createApplyKitService(ctx), ctx };
}

const letterRequest: CoverLetterRequest = { jobId: 'job-sw', tone: 'professional', length: 'medium', mode: 'ai' };

beforeEach(() => {
  sdk.create.mockReset();
  sdk.constructed.length = 0;
  apiKey = 'sk-ant-test-key';
});

describe('apply kit service: AI drafting', () => {
  it('drafts a cover letter with the configured key and model, using only supplied facts', async () => {
    const { service } = makeService();
    sdk.create.mockResolvedValue(message('Subject: Application\n\nDear Lumen Pay team,\n\n**I build payment systems.**\n\nMaya Chen'));
    store.set(LAST_ERROR_KEY, 'old failure');

    const result = await service.coverLetter(letterRequest);

    expect(result).toEqual({ content: 'Dear Lumen Pay team,\n\nI build payment systems.\n\nMaya Chen', generatedBy: 'ai' });
    expect(sdk.constructed).toEqual([{ apiKey: 'sk-ant-test-key', timeout: 60_000 }]);
    const [params] = sdk.create.mock.calls[0]!;
    expect(params).toMatchObject({ model: DEFAULT_AI_MODEL, max_tokens: 4000, output_config: { effort: 'low' } });
    expect(params.system).toMatch(/Never invent employers, job titles/);
    expect(params.system).toMatch(/about 250 words/);
    expect(params.messages[0].content).toContain(DESCRIPTION_MARKER);
    expect(params.messages[0].content).toContain('Built a claims payment service');
    expect(store.has(LAST_ERROR_KEY)).toBe(false);
  });

  it('falls back to the template when the key is rejected, and records why', async () => {
    const { service, ctx } = makeService();
    sdk.create.mockRejectedValue(new AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers()));

    const result = await service.coverLetter(letterRequest);

    expect(result.generatedBy).toBe('template');
    expect(result.fallbackReason).toBe('The AI provider rejected the API key. Check it in Settings.');
    expect(result.content).toMatch(/^Dear Lumen Pay hiring team,/);
    expect(service.aiStatus()).toEqual({ configured: true, model: DEFAULT_AI_MODEL, lastError: result.fallbackReason });
    // The log carries the error class only: never the prompt or the key.
    const logged = JSON.stringify(vi.mocked(ctx.log.warn).mock.calls);
    expect(logged).not.toContain('sk-ant-test-key');
    expect(logged).not.toContain(DESCRIPTION_MARKER);
  });

  it('falls back on timeouts and rate limits with a short human reason', async () => {
    const { service } = makeService();
    sdk.create.mockRejectedValueOnce(new APIConnectionTimeoutError());
    expect((await service.coverLetter(letterRequest)).fallbackReason).toBe("The AI provider didn't respond in time. Try again shortly.");
    sdk.create.mockRejectedValueOnce(new RateLimitError(429, { type: 'error' }, 'rate limited', new Headers()));
    expect((await service.coverLetter(letterRequest)).fallbackReason).toBe(
      "The AI provider's rate limit was reached. Try again in a minute.",
    );
  });

  it('treats a truncated or refused draft as a failure', async () => {
    const { service } = makeService();
    sdk.create.mockResolvedValueOnce(message('Dear Lumen Pay', 'max_tokens'));
    expect((await service.coverLetter(letterRequest)).fallbackReason).toBe('The AI draft was cut off before it finished.');
    sdk.create.mockResolvedValueOnce(message('', 'refusal'));
    expect((await service.coverLetter(letterRequest)).generatedBy).toBe('template');
  });

  it('sends nothing in template mode or without a key', async () => {
    const { service } = makeService();
    expect((await service.coverLetter({ ...letterRequest, mode: 'template' })).generatedBy).toBe('template');
    apiKey = undefined;
    const noKey = await service.coverLetter(letterRequest);
    expect(noKey).toMatchObject({ generatedBy: 'template', fallbackReason: NO_KEY_REASON });
    const answer = await service.answer({ jobId: 'job-sw', question: 'Why this company?', mode: 'ai' });
    expect(answer.fallbackReason).toBe(NO_KEY_REASON);
    expect(sdk.constructed).toHaveLength(0);
    expect(sdk.create).not.toHaveBeenCalled();
    expect(service.aiStatus()).toEqual({ configured: false, model: DEFAULT_AI_MODEL });
  });

  it('drafts answers with related saved answers as references', async () => {
    const { service } = makeService();
    sdk.create.mockResolvedValue(message('Lumen Pay works on payments, which is what I do.'));

    const result = await service.answer({ jobId: 'job-sw', question: 'Why do you want to work here?', mode: 'ai', maxWords: 120 });

    expect(result).toMatchObject({ generatedBy: 'ai', content: 'Lumen Pay works on payments, which is what I do.' });
    expect(result.related.map((a) => a.id)).toEqual(['a1']);
    const [params] = sdk.create.mock.calls[0]!;
    expect(params.system).toMatch(/at most 120 words/);
    expect(params.max_tokens).toBe(2500 + 120 * 3);
    expect(params.messages[0].content).toContain('<saved_answer>\nQuestion: Why this company?');
    expect(params.messages[0].content).toContain('Work authorization: US citizen');
  });

  it('reuses a saved answer in bank mode', async () => {
    const { service } = makeService();
    const result = await service.answer({ jobId: 'job-sw', question: 'Why do you want to work here?', mode: 'bank' });
    expect(result).toEqual({
      content: 'I want to join Lumen Pay because of its payments focus.',
      generatedBy: 'template',
      related: [expect.objectContaining({ id: 'a1' })],
    });
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it('tests the connection with one tiny request', async () => {
    const { service } = makeService();
    sdk.create.mockResolvedValueOnce(message('OK'));
    expect(await service.aiTest()).toEqual({ configured: true, model: DEFAULT_AI_MODEL });
    expect(sdk.create.mock.calls[0]![0]).toMatchObject({ max_tokens: 16 });

    sdk.create.mockRejectedValueOnce(new AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers()));
    expect(await service.aiTest()).toMatchObject({ lastError: 'The AI provider rejected the API key. Check it in Settings.' });

    apiKey = undefined;
    expect(await service.aiTest()).toEqual({ configured: false, model: DEFAULT_AI_MODEL, lastError: NO_KEY_REASON });
  });

  it('answers 404 for unknown jobs and 400 for a letter without a target', async () => {
    const { service } = makeService();
    await expect(service.coverLetter({ ...letterRequest, jobId: 'nope' })).rejects.toMatchObject({ status: 404 });
    await expect(service.coverLetter({ tone: 'warm', length: 'short', mode: 'template' })).rejects.toMatchObject({ status: 400 });
    expect(() => service.analyze({ jobId: 'nope' })).toThrow(/Job was not found/);
  });
});

describe('apply kit service: résumé review and rework', () => {
  function makeResumeService(resumeText = softwareResume) {
    const made = makeService();
    const services = made.ctx.services as unknown as Record<string, Record<string, unknown>>;
    services.profile!.resumeText = () => resumeText;
    const apps: Array<Pick<Application, 'id' | 'status' | 'job' | 'jobId'>> = [
      { ...salesApplication, status: 'applied' as ApplicationStatus },
      { ...salesApplication, id: 'app-old', status: 'rejected' as ApplicationStatus },
    ];
    services.applications = {
      list: () => apps,
      get: (id: string) => (id === salesApplication.id ? salesApplication : undefined),
    };
    return made;
  }

  it('reviews the saved résumé, a draft, or a pasted posting', () => {
    const { service } = makeResumeService();
    const saved = service.reviewResume({ jobId: 'job-sw' });
    expect(saved).toMatchObject({ source: 'saved', job: { title: 'Senior Backend Engineer', company: 'Lumen Pay' } });
    expect(saved.skillsMatched).toEqual(['TypeScript', 'Node.js', 'PostgreSQL', 'AWS']);

    const draft = service.reviewResume({ jobId: 'job-sw', resumeText: `${softwareResume}
Kubernetes, Kafka` });
    expect(draft.source).toBe('draft');
    expect(draft.skillsMissing).toEqual([]);
    expect(draft.score).toBeGreaterThan(saved.score);

    const pasted = service.reviewResume({ posting: { title: 'Frontend Engineer', company: 'Acme', description: 'Requirements\n- 3+ years of React experience\n- Docker' } });
    expect(pasted.job).toEqual({ title: 'Frontend Engineer', company: 'Acme' });
    expect(pasted.requirements.map((r) => [r.text, r.status])).toEqual([
      ['3+ years of React experience', 'met'],
      ['Docker', 'met'],
    ]);
  });

  it('asks for a résumé when there is none', () => {
    const { service } = makeResumeService('  ');
    expect(() => service.reviewResume({ jobId: 'job-sw' })).toThrow(/Add your résumé first/);
    expect(() => service.reviewResume({ jobId: 'job-sw', resumeText: '' })).toThrow(/draft is empty/);
    expect(service.resumeScores()).toEqual([]);
  });

  it('tailors a draft without AI', async () => {
    const { service } = makeResumeService();
    const result = await service.reworkResume({ jobId: 'job-sw', mode: 'template' });
    expect(result.generatedBy).toBe('template');
    expect(result.content).toContain('- Maintained the internal admin dashboard used by support staff');
    expect(result.changes.length).toBeGreaterThan(1);
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it('rewrites with AI under no-invention rules, passing the review findings as hints', async () => {
    const { service } = makeResumeService();
    sdk.create.mockResolvedValue(message('MAYA CHEN\n\nSUMMARY\nBackend engineer.\n\nEXPERIENCE\n- Built a claims payment service [add % uptime]'));

    const result = await service.reworkResume({ jobId: 'job-sw', mode: 'ai' });

    expect(result).toMatchObject({ generatedBy: 'ai', content: expect.stringContaining('Built a claims payment service') });
    expect(result.changes).toEqual([
      'Rewritten with AI for Senior Backend Engineer at Lumen Pay.',
      'Read every line before you use it: keep only what is true of your work.',
      'Fill in the bracketed placeholder with real figures, or remove it.',
    ]);
    expect(sdk.constructed).toEqual([{ apiKey: 'sk-ant-test-key', timeout: 150_000 }]);
    const [params] = sdk.create.mock.calls[0]!;
    expect(params.system).toMatch(/Never add employers, roles, dates/);
    expect(params.system).toMatch(/Never make up a figure/);
    const prompt: string = params.messages[0].content;
    expect(prompt).toContain(DESCRIPTION_MARKER);
    expect(prompt).toContain('<resume_to_rewrite>\nMaya Chen');
    expect(prompt).toContain('<review_findings>');
    expect(prompt).toContain('Requirements the résumé does not clearly show: "Experience with PostgreSQL and distributed systems"');
    // The résumé is sent once, as the text to rewrite.
    expect(prompt.split('Responsible for maintaining').length).toBe(2);
  });

  it('falls back to the template draft when AI fails', async () => {
    const { service } = makeResumeService();
    sdk.create.mockRejectedValue(new APIConnectionTimeoutError());
    const result = await service.reworkResume({ jobId: 'job-sw', mode: 'ai' });
    expect(result).toMatchObject({ generatedBy: 'template', fallbackReason: "The AI provider didn't respond in time. Try again shortly." });
    expect(result.content).toContain('Maintained the internal admin dashboard');
  });

  it('scores the résumé against every active application', () => {
    const { service } = makeResumeService();
    expect(service.resumeScores()).toEqual([
      {
        applicationId: 'app-sales',
        title: 'Account Executive, Mid-Market',
        company: 'Brightwave Software',
        status: 'applied',
        score: expect.any(Number),
        band: expect.any(String),
        requiredMet: expect.any(Number),
        requiredTotal: 4,
        limited: false,
      },
    ]);
  });
});
