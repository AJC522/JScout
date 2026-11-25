import { describe, expect, it } from 'vitest';
import { detectClearance } from './clearance';

const job = (text: string, title = 'Software Engineer', extra: { tags?: string[]; sponsorsByDefault?: boolean } = {}) =>
  detectClearance({ title, text, ...extra });
const requirement = (text: string, title?: string) => job(text, title)?.requirement;

describe('detectClearance: no clearance', () => {
  it('returns undefined when the posting never mentions one', () => {
    expect(job('We build payment APIs in Go. 5+ years of experience required.')).toBeUndefined();
  });

  it('ignores clearances that are not security clearances', () => {
    expect(job('Prepare 510(k) submissions and obtain FDA clearance for new devices.')).toBeUndefined();
    expect(job('Must possess a valid IVP Fingerprint Clearance Card.')).toBeUndefined();
    expect(job('Applicants must obtain medical clearance before the first shift.')).toBeUndefined();
    expect(job('Financial Clearance Specialist: verify insurance before admission.', 'Financial Clearance Specialist')).toBeUndefined();
    expect(job('Must have current PA clearances (Act 34, 151 and 114) before starting.')).toBeUndefined();
    expect(job('Coordinate customs clearance for inbound freight.')).toBeUndefined();
    expect(job('Analyze crime trends and case clearance rates for command staff.', 'Crime Analyst')).toBeUndefined();
  });

  it('does not treat a police polygraph or background investigation as a clearance', () => {
    expect(job('Applicants must pass a background investigation, polygraph examination and psychological evaluation.', 'Police Officer')).toBeUndefined();
  });

  it('ignores prose that only mentions cleared customers or secret sauce', () => {
    expect(job('Our secret sauce is the team. We support cleared customers across the defense space.')).toBeUndefined();
    expect(job('Trade secrets and confidential information must be protected.')).toBeUndefined();
  });

  it('records a posting that says no clearance is needed', () => {
    expect(job('No security clearance is required for this role.')).toEqual({
      requirement: 'none',
      evidence: 'No security clearance is required for this role.',
    });
    expect(requirement('This position does not require a security clearance.')).toBe('none');
    expect(requirement('Clearance Type: None')).toBe('none');
    expect(requirement('Security Clearance: Not Required')).toBe('none');
  });
});

describe('detectClearance: must already hold one', () => {
  it.each([
    'Active TS/SCI clearance required.',
    'Must have an active Secret clearance.',
    'Currently possesses and is able to maintain an active U.S. Top Secret security clearance.',
    'Candidates must currently hold a DoD Secret clearance.',
    'Interim Secret clearance required to start.',
    'Security Clearance Status: Active and existing security clearance required on day 1',
    'Clearance Level Must Currently Possess: Secret',
    'We are unable to sponsor security clearances; applicants must already be cleared.',
  ])('%s', (text) => {
    expect(requirement(text)).toBe('active');
  });

  it('reads a "Cleared" title as holding one', () => {
    expect(job('Build mission software.', 'Cleared Software Engineer')).toMatchObject({ requirement: 'active' });
  });

  it('keeps the level to bring when the employer sponsors an upgrade', () => {
    expect(job('Active Secret clearance required with the ability to obtain TS/SCI.')).toMatchObject({ requirement: 'active', level: 'secret' });
    expect(job('Must possess a current DoD Secret clearance and the ability to obtain a TS/SCI.')).toMatchObject({
      requirement: 'active',
      level: 'secret',
    });
    expect(
      job('Clearance Level Must Currently Possess: Secret\nClearance Level Must Be Able to Obtain: Top Secret/SCI'),
    ).toMatchObject({ requirement: 'active', level: 'secret' });
  });
});

describe('detectClearance: the employer sponsors it', () => {
  it.each([
    'Ability to obtain a U.S. security clearance.',
    'Must be able to obtain and maintain a Secret clearance.',
    'Eligible to obtain and maintain an active U.S. Secret security clearance.',
    'Must be eligible for and willing to obtain a U.S. Government security clearance.',
    'Must have an active Secret clearance or the ability to obtain one.',
    'Candidates must possess or be able to obtain a DoD Secret clearance.',
    'Applicants selected will be subject to a government security investigation and must meet eligibility requirements for access to classified information.',
    'We will sponsor your security clearance.',
    'An active clearance is not required, but you must be able to obtain a Secret clearance.',
  ])('%s', (text) => {
    expect(requirement(text)).toBe('sponsored');
  });

  it('reads the "possess None / obtain Secret" label pair as sponsored', () => {
    expect(job('Clearance Level Must Currently Possess: None\nClearance Level Must Be Able to Obtain: Secret')).toMatchObject({
      requirement: 'sponsored',
      level: 'secret',
    });
  });

  it('lets a specific statement explain a vague one', () => {
    expect(job('This position requires a Secret clearance. You must be able to obtain and maintain it.')).toMatchObject({
      requirement: 'sponsored',
      level: 'secret',
    });
  });

  it('treats a federal agency’s required clearance as one it processes', () => {
    expect(job('', 'IT Specialist (INFOSEC)', { tags: ['Federal government', 'Secret clearance'], sponsorsByDefault: true })).toMatchObject({
      requirement: 'sponsored',
      level: 'secret',
    });
    expect(job('', 'Intelligence Analyst', { tags: ['Sensitive Compartmented Information clearance'], sponsorsByDefault: true })).toMatchObject({
      requirement: 'sponsored',
      level: 'ts-sci',
    });
    expect(job('Security clearance: Not Required', 'Park Ranger', { sponsorsByDefault: true })).toMatchObject({ requirement: 'none' });
  });

  it('still says "must already hold" for a federal job that demands a current clearance', () => {
    expect(job('You must currently possess a Top Secret clearance.', 'Program Analyst', { sponsorsByDefault: true })).toMatchObject({
      requirement: 'active',
      level: 'top-secret',
    });
  });
});

describe('detectClearance: required, sponsorship unclear', () => {
  it.each([
    'This position requires a Secret clearance.',
    'Secret clearance required.',
    'Security Clearance: Secret',
    'Clearance Type: Top Secret',
    'This position requires a government security clearance, you must be a US Citizen for consideration.',
  ])('%s', (text) => {
    expect(requirement(text)).toBe('required');
  });

  it('counts a clearance listed under qualifications', () => {
    expect(job('Basic Qualifications:\n- 5+ years of Python\n- TS/SCI with Full Scope Polygraph')).toEqual({
      requirement: 'required',
      level: 'ts-sci',
      polygraph: 'full-scope',
      evidence: 'TS/SCI with Full Scope Polygraph',
    });
  });

  it('reads a clearance in the title', () => {
    expect(job('Build data pipelines.', 'Data Engineer (TS/SCI w/ Poly)')).toMatchObject({ requirement: 'required', level: 'ts-sci', polygraph: 'polygraph' });
  });
});

describe('detectClearance: preferred', () => {
  it.each([
    'Active Secret clearance is a plus.',
    'Active TS/SCI preferred.',
    'Clearance holders are encouraged to apply.',
  ])('%s', (text) => {
    expect(requirement(text)).toBe('preferred');
  });

  it('reads a clearance under a "Preferred Qualifications" heading as preferred', () => {
    expect(job('Basic Qualifications:\n- 3+ years of Java\n\nPreferred Qualifications\n- Active TS/SCI')).toMatchObject({
      requirement: 'preferred',
      level: 'ts-sci',
    });
  });

  it('lets a requirement elsewhere win over a preference', () => {
    expect(job('- Must be able to obtain a Secret clearance\n\nNice to have:\n- Active TS/SCI')).toMatchObject({
      requirement: 'sponsored',
      level: 'secret',
    });
    expect(requirement('Ability to obtain a Secret clearance; active clearance highly desired.')).toBe('sponsored');
  });

  it('does not report a polygraph that is only preferred', () => {
    expect(job('Active TS/SCI required. CI polygraph preferred.')).toEqual({
      requirement: 'active',
      level: 'ts-sci',
      evidence: 'Active TS/SCI required.',
    });
  });
});

describe('detectClearance: levels and polygraphs', () => {
  it.each([
    ['Active Top Secret clearance required.', 'top-secret'],
    ['Must hold an active DOE Q clearance.', 'doe-q'],
    ['Must hold an active L clearance.', 'doe-l'],
    ['Ability to obtain a Public Trust clearance.', 'public-trust'],
    ['Active Top Secret clearance with SCI eligibility required.', 'ts-sci'],
    ['Must have an active Confidential clearance.', 'confidential'],
  ])('%s → %s', (text, level) => {
    expect(job(text)?.level).toBe(level);
  });

  it('notes the polygraph kind', () => {
    expect(job('Active TS/SCI with CI Poly required.')?.polygraph).toBe('ci');
    expect(job('Active TS/SCI required. Must be able to pass a full-scope polygraph.')?.polygraph).toBe('full-scope');
    expect(job('Active TS/SCI required. Degree from Cal Poly a plus.')?.polygraph).toBeUndefined();
  });

  it('quotes the deciding sentence, shortened', () => {
    const long = `Must have an active Secret clearance ${'and a great deal of other experience '.repeat(10)}.`;
    expect(job(long)!.evidence!.length).toBeLessThanOrEqual(220);
  });
});
