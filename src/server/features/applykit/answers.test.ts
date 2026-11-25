import { describe, expect, it } from 'vitest';
import type { Profile } from '../../../shared/types';
import { adaptAnswer, bankAnswer, classifyQuestion, rankAnswers, scaffoldAnswer } from './answers';
import type { JobContext } from './context';
import { savedAnswer, softwareProfile } from './test-fixtures';

const job: JobContext = {
  key: 'job-1',
  title: 'Senior Backend Engineer',
  company: 'Lumen Pay',
  locationText: 'Remote (US)',
  location: { places: [], remote: 'remote', remoteScope: ['US'] },
  salary: { min: 160000, max: 190000, currency: 'USD', period: 'year', annualMin: 160000, annualMax: 190000 },
  seniority: 'senior',
  employmentType: 'full-time',
  skills: ['TypeScript'],
  descriptionText: '',
};

const bank = [
  savedAnswer('why-co', 'Why this company?', 'I want to work at {company} because the {title} role builds on my payments work.', ['motivation']),
  savedAnswer('salary', 'What are your salary expectations?', 'Around $160,000 base.', ['salary']),
  savedAnswer('weak', 'What is your greatest weakness?', 'I used to over-polish documentation.'),
  savedAnswer('star', 'Tell us about a time you resolved a conflict.', 'At Brightline Health, two teams disagreed…', ['conflict']),
  savedAnswer('old', 'Why do you want to join Stripe?', 'Stripe is where I can grow as a Backend Engineer working on payments.'),
];

function profile(over: (p: Profile) => void): Profile {
  const p = structuredClone(softwareProfile.profile);
  over(p);
  return p;
}

describe('question matching', () => {
  it('classifies common question types', () => {
    expect(classifyQuestion('Why do you want to work here?')).toBe('why-company');
    expect(classifyQuestion('What interests you about working at Lumen Pay?')).toBe('why-company');
    expect(classifyQuestion('Why are you interested in this role?')).toBe('why-role');
    expect(classifyQuestion('Tell me about yourself')).toBe('about-you');
    expect(classifyQuestion('What are your desired pay and benefits?')).toBe('salary');
    expect(classifyQuestion('When can you start?')).toBe('start');
    expect(classifyQuestion('Will you now or in the future require visa sponsorship?')).toBe('authorization');
    expect(classifyQuestion('Describe a time you failed.')).toBe('behavioral');
    expect(classifyQuestion('What is your favourite programming language?')).toBe('other');
  });

  it('ranks saved answers by meaning, not exact wording', () => {
    const ranked = rankAnswers('Why do you want to work here?', bank);
    expect(ranked.map((r) => r.answer.id).slice(0, 2)).toEqual(['why-co', 'old']);
    expect(ranked.map((r) => r.answer.id)).not.toContain('salary');

    const interests = rankAnswers('What interests you about our company?', bank);
    expect(interests[0]?.answer.id).toBe('why-co');

    expect(rankAnswers('What compensation are you looking for?', bank)[0]?.answer.id).toBe('salary');
    expect(rankAnswers('Describe a disagreement with a coworker — a time you handled conflict', bank)[0]?.answer.id).toBe('star');
    expect(rankAnswers('What is your favourite programming language?', bank)).toEqual([]);
  });

  it('counts tags towards similarity and returns at most five', () => {
    const tagged = savedAnswer('t', 'A note', 'Text', ['salary']);
    const untagged = savedAnswer('u', 'A note', 'Text');
    const ranked = rankAnswers('Salary expectations?', [untagged, tagged]);
    expect(ranked[0]?.answer.id).toBe('t');
    const many = Array.from({ length: 8 }, (_, i) => savedAnswer(`s${i}`, 'Why this company?', 'x'));
    expect(rankAnswers('Why this company?', many)).toHaveLength(5);
  });
});

describe('bank answers', () => {
  it('fills {company}/{title} tokens', () => {
    expect(adaptAnswer(bank[0]!.answer, job, [])).toBe(
      'I want to work at Lumen Pay because the Senior Backend Engineer role builds on my payments work.',
    );
  });

  it("swaps the names of the job an answer was written for", () => {
    const adapted = adaptAnswer(bank[4]!.answer, job, [{ company: 'Stripe', title: 'Backend Engineer' }]);
    expect(adapted).toBe('Lumen Pay is where I can grow as a Senior Backend Engineer working on payments.');
    // Without a job there is nothing to adapt to.
    expect(adaptAnswer(bank[0]!.answer, undefined, [])).toBe(bank[0]!.answer);
  });

  it('reuses a close match and scaffolds otherwise', () => {
    const p = softwareProfile.profile;
    const input = { question: 'Why do you want to work here?', job, profile: p, strengths: ['TypeScript', 'Node.js'] };
    const reused = bankAnswer(rankAnswers(input.question, bank), input, () => []);
    expect(reused).toContain('I want to work at Lumen Pay');

    const scaffold = bankAnswer([], input, () => []);
    expect(scaffold).toContain('What draws me to Lumen Pay: [');
    expect(scaffold).toContain('I bring TypeScript and Node.js, which I use in my work as a Software Engineer at Brightline Health.');
  });
});

describe('scaffolds', () => {
  const base = { job, strengths: ['TypeScript', 'Node.js', 'PostgreSQL'] };

  it('answers salary questions from the saved preferences', () => {
    const text = scaffoldAnswer({ ...base, question: 'What are your salary expectations?', profile: softwareProfile.profile });
    expect(text).toContain("I'm looking for a base salary of around $150,000 or more");
    expect(text).toContain('The range listed in the posting ($160k–$190k/yr) is in line with that.');
    const noMin = scaffoldAnswer({ ...base, question: 'Desired salary?', profile: profile((p) => (p.preferences.salaryMin = null)) });
    expect(noMin).toMatch(/^\[Your target range/);
  });

  it('answers start date and authorization questions from the profile', () => {
    const start = scaffoldAnswer({
      ...base,
      question: 'When can you start?',
      profile: profile((p) => (p.work.earliestStart = 'Immediately')),
    });
    expect(start).toBe('I can start immediately. My notice period is 2 weeks.');

    const auth = scaffoldAnswer({ ...base, question: 'Are you legally authorized to work in the US?', profile: softwareProfile.profile });
    expect(auth).toBe("Work authorization: US citizen. I don't need visa sponsorship.");
    const unknown = scaffoldAnswer({
      ...base,
      question: 'Do you require sponsorship?',
      profile: profile((p) => {
        p.work.workAuthorization = '';
        p.work.requiresSponsorship = null;
      }),
    });
    expect(unknown).toBe('[Your work authorization status.] [Whether you need visa sponsorship.]');
  });

  it('answers security clearance questions from the profile', () => {
    const q = 'Do you currently hold an active security clearance?';
    expect(classifyQuestion(q)).toBe('clearance');
    expect(scaffoldAnswer({ ...base, question: q, profile: profile((p) => (p.work.clearance = { level: 'ts-sci', status: 'active', polygraph: 'ci' })) })).toBe(
      'Yes, I hold an active TS/SCI with CI polygraph clearance. [Granting agency and investigation date, if they ask.]',
    );
    expect(scaffoldAnswer({ ...base, question: q, profile: profile((p) => (p.work.clearance = { level: 'secret', status: 'inactive' })) })).toMatch(
      /^I previously held a Secret clearance; it is currently inactive\./,
    );
    expect(scaffoldAnswer({ ...base, question: q, profile: profile((p) => (p.work.clearance = null)) })).toMatch(/^I don't currently hold a security clearance\./);
  });

  it('gives a STAR outline that points at a relevant highlight', () => {
    const text = scaffoldAnswer({ ...base, question: 'Tell us about a time you led a migration.', profile: softwareProfile.profile });
    expect(text).toMatch(/^Situation: \[/);
    expect(text).toContain('Result: [');
    expect(text).toContain('"Led the migration of billing data to PostgreSQL with zero downtime" (Brightline Health)');
  });

  it('introduces the user from their summary without inventing anything', () => {
    const text = scaffoldAnswer({ ...base, question: 'Tell me about yourself.', profile: softwareProfile.profile });
    expect(text).toContain("I'm a backend engineer with 6 years of experience building payment and billing systems");
    expect(text).toContain('My core skills include TypeScript, Node.js and PostgreSQL.');
  });

  it('keeps strengths honest when there are not enough', () => {
    const text = scaffoldAnswer({ ...base, strengths: ['TypeScript'], question: 'What are your greatest strengths?', profile: softwareProfile.profile });
    expect(text.split('\n')).toEqual([
      '1. TypeScript: [an example where you used it, and the result]',
      '2. [strength]: [an example where you used it, and the result]',
      '3. [strength]: [an example where you used it, and the result]',
    ]);
  });
});
