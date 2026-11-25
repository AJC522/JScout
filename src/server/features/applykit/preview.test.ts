import { it, vi } from 'vitest';
import type { ProfileService, Services } from '../../services';
import { loadProfile, resolveJob } from './context';
import { analyzeFit } from './fit';
import { templateLetter } from './letter-template';
import { nursingJob, nursingProfile, salesApplication, salesProfile, softwareJob, softwareProfile } from './test-fixtures';
import { wordCount } from './text';
vi.mock('../../lib/skills', () => import('./test-fixtures').then((m) => m.fakeSkills));
vi.mock('../../lib/titles', () => import('./test-fixtures').then((m) => m.fakeTitles));
vi.mock('../../lib/location', () => import('./test-fixtures').then((m) => m.fakeLocation));
const services = { search: { jobDetail: (id: string) => [softwareJob, nursingJob].find((d) => d.job.id === id) }, applications: { get: () => salesApplication }, jobs: { getDescriptionHtml: () => '' } } as unknown as Pick<Services, 'search' | 'applications' | 'jobs'>;
it('preview', () => {
  for (const [t, f, tone, length] of [[{ jobId: 'job-sw' }, softwareProfile, 'professional', 'long'], [{ jobId: 'job-sw' }, softwareProfile, 'warm', 'short'], [{ jobId: 'job-rn' }, nursingProfile, 'concise', 'medium'], [{ applicationId: 'x' }, salesProfile, 'enthusiastic', 'medium']] as const) {
    const job = resolveJob(services, t);
    const me = loadProfile({ get: () => f.profile, effectiveSkills: () => f.skills, resumeText: () => f.resumeText } as unknown as ProfileService);
    const fit = analyzeFit(job, me);
    if (tone === 'professional') console.log(JSON.stringify(fit, null, 1));
    if (tone === 'concise' || tone === 'enthusiastic') console.log(JSON.stringify({ score: fit.score, summary: fit.summary, kw: fit.keywords.map(k => `${k.term}:${k.weight}:${k.present}`), sug: fit.suggestions, sal: fit.salaryAlignment }, null, 1));
    const l = templateLetter({ job, profile: me.profile, strengths: fit.skillsMatched, tone, length, notes: tone === 'professional' ? 'Mention that I am relocating to Seattle in March.' : undefined });
    console.log(`----- ${tone}/${length} (${wordCount(l)} words)\n${l}\n`);
  }
});
