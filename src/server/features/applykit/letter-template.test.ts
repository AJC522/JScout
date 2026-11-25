import { describe, expect, it, vi } from 'vitest';
import { LETTER_LENGTHS, LETTER_TONES } from '../../../shared/constants';
import type { LetterLength, Profile } from '../../../shared/types';
import type { ProfileService, Services } from '../../services';
import { type JobContext, loadProfile, resolveJob } from './context';
import { analyzeFit } from './fit';
import { LETTER_TARGET_WORDS, templateLetter } from './letter-template';
import { nursingJob, nursingProfile, salesApplication, salesProfile, softwareJob, softwareProfile, type ProfileFixture } from './test-fixtures';
import { wordCount } from './text';

vi.mock('../../lib/skills', () => import('./test-fixtures').then((m) => m.fakeSkills));
vi.mock('../../lib/titles', () => import('./test-fixtures').then((m) => m.fakeTitles));
vi.mock('../../lib/location', () => import('./test-fixtures').then((m) => m.fakeLocation));

const services = {
  search: { jobDetail: (id: string) => [softwareJob, nursingJob].find((d) => d.job.id === id) },
  applications: { get: (id: string) => (id === salesApplication.id ? salesApplication : undefined) },
  jobs: { getDescriptionHtml: () => '' },
} as unknown as Pick<Services, 'search' | 'applications' | 'jobs'>;

const NOTES = 'Mention that I am relocating to Seattle in March and can work Pacific hours.';

function letterFor(job: JobContext, fixture: ProfileFixture, opts: { tone: (typeof LETTER_TONES)[number]; length: LetterLength; notes?: string }) {
  const me = loadProfile({
    get: () => structuredClone(fixture.profile),
    effectiveSkills: () => fixture.skills,
    resumeText: () => fixture.resumeText,
  } as Partial<ProfileService> as ProfileService);
  const fit = analyzeFit(job, me);
  return templateLetter({ job, profile: me.profile, skills: fit.skillsMatched, themes: fit.keywords.filter((k) => k.present && k.weight >= 0.3 && !fit.skillsMatched.includes(k.term) && !/engineer|nurse|executive/i.test(k.term)).map((k) => k.term).slice(0, 4), missing: fit.skillsMissing, locationOk: fit.locationAlignment.ok === true, ...opts });
}

/** Capitalised words that do not start a line or sentence: names, which must come from the inputs. */
function properNouns(letter: string): string[] {
  const out: string[] = [];
  for (const line of letter.split('\n')) {
    const tokens = line.split(/\s+/).filter(Boolean);
    tokens.forEach((token, i) => {
      const word = token.replace(/^[“"(]+|[.,;:!?”")]+$/g, '');
      const startsSentence = i === 0 || /[.!?:]["”)]?$/.test(tokens[i - 1]!);
      if (startsSentence || !/^\p{Lu}/u.test(word) || /^I(['’](m|ve|d))?$/.test(word)) return;
      out.push(word);
    });
  }
  return out;
}

const BANDS: Record<LetterLength, [number, number]> = { short: [110, 190], medium: [200, 310], long: [280, 460] };
const CLICHES = [/I am writing to express/i, /team player/i, /hit the ground running/i, /passionate/i];

describe('template cover letters', () => {
  const job = resolveJob(services, { jobId: 'job-sw' });
  const inputs = JSON.stringify([softwareJob, softwareProfile, NOTES]);

  for (const tone of LETTER_TONES) {
    for (const length of LETTER_LENGTHS) {
      it(`${tone} / ${length}: right length, no placeholders, nothing invented`, () => {
        const letter = letterFor(job, softwareProfile, { tone, length, notes: NOTES });
        const words = wordCount(letter);
        expect(words).toBeGreaterThanOrEqual(BANDS[length][0]);
        expect(words).toBeLessThanOrEqual(BANDS[length][1]);
        expect(letter).not.toMatch(/\[/);
        for (const cliche of CLICHES) expect(letter).not.toMatch(cliche);
        for (const noun of properNouns(letter)) expect(inputs, `"${noun}" is not in the inputs`).toContain(noun);
        expect(letter).toContain('Lumen Pay');
        expect(letter).toContain('Senior Backend Engineer');
        expect(letter).toContain('I am relocating to Seattle in March and can work Pacific hours.');
        expect(letter.trim().endsWith('Maya Chen')).toBe(true);
        expect(letter.match(/!/g)?.length ?? 0).toBeLessThanOrEqual(1);
        // Skills the user lacks are never claimed.
        expect(letter).not.toMatch(/Kubernetes|Kafka/);
      });
    }
  }

  it('grows with the requested length', () => {
    const counts = LETTER_LENGTHS.map((length) => wordCount(letterFor(job, softwareProfile, { tone: 'professional', length })));
    expect(counts[0]!).toBeLessThan(counts[1]!);
    expect(counts[1]!).toBeLessThan(counts[2]!);
    expect(Math.abs(counts[2]! - LETTER_TARGET_WORDS.long)).toBeLessThan(90);
  });

  it('phrases letters differently for different jobs, and identically for the same job', () => {
    const a = letterFor(job, softwareProfile, { tone: 'warm', length: 'medium' });
    const other = { ...job, key: 'another-job' };
    const variants = new Set(['k1', 'k2', 'k3', 'k4'].map((key) => letterFor({ ...job, key }, softwareProfile, { tone: 'warm', length: 'medium' })));
    expect(letterFor(job, softwareProfile, { tone: 'warm', length: 'medium' })).toBe(a);
    expect(variants.size).toBeGreaterThan(1);
    expect(letterFor(other, softwareProfile, { tone: 'warm', length: 'medium' })).not.toBe(a);
  });

  it('works for nursing and sales profiles without inventing names', () => {
    const rn = letterFor(resolveJob(services, { jobId: 'job-rn' }), nursingProfile, { tone: 'professional', length: 'medium' });
    const ae = letterFor(resolveJob(services, { applicationId: 'app-sales' }), salesProfile, { tone: 'enthusiastic', length: 'short' });
    for (const [letter, inputs] of [
      [rn, JSON.stringify([nursingJob, nursingProfile])],
      [ae, JSON.stringify([salesApplication, salesProfile])],
    ] as const) {
      for (const noun of properNouns(letter)) expect(inputs, `"${noun}" is not in the inputs`).toContain(noun);
      expect(letter).not.toMatch(/\[/);
    }
    expect(rn).toContain('Mercy Valley Hospital');
    expect(rn).not.toMatch(/ACLS/);
    expect(ae).toContain('Brightwave Software');
  });

  it('states years of experience as a whole number', () => {
    const work = { ...softwareProfile.profile.work, summary: '', yearsExperience: 8.5 };
    const letter = letterFor(job, { ...softwareProfile, profile: { ...softwareProfile.profile, work } }, { tone: 'professional', length: 'medium' });
    expect(letter).toContain('over 8 years of professional experience');
    expect(letter).not.toContain('8.5');
  });

  it('marks only essential missing information as a placeholder', () => {
    const bare: Profile = { ...softwareProfile.profile, personal: { ...softwareProfile.profile.personal, fullName: '' }, work: { ...softwareProfile.profile.work, summary: '', currentTitle: '', currentCompany: '', yearsExperience: null }, experience: [], education: [] };
    const letter = letterFor(job, { profile: bare, skills: [], resumeText: '' }, { tone: 'concise', length: 'short' });
    expect(letter).toContain('[Your name]');
    expect(letter).toContain('[A sentence or two about your background');
    expect(letter.match(/\[/g)).toHaveLength(2);
  });
});
