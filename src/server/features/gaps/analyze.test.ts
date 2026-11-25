import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../../../shared/constants';
import type { Profile, Seniority } from '../../../shared/types';
import { foldText } from '../../lib/text';
import { analyzeTitle } from '../../lib/titles';
import { buildMatchProfile } from '../../search/profile-match';
import { analyzeGaps, type GapJob, listNames } from './analyze';

const NOW = new Date('2026-11-24T12:00:00.000Z');

function profileWith(edit: (p: Profile) => void): Profile {
  const p = emptyProfile(NOW.toISOString());
  edit(p);
  return p;
}

/** A mid-level security analyst (4 years) with Python, Splunk, SIEM and Linux, holding Security+. */
const analyst = profileWith((p) => {
  p.preferences.targetTitles = ['Security Analyst'];
  p.preferences.skills = ['Python', 'Splunk', 'SIEM', 'Linux'];
  p.preferences.certifications = ['CompTIA Security+'];
  p.work.yearsExperience = 4;
});
const skillsOf = (p: Profile) => [...p.preferences.skills, ...p.preferences.certifications];
const mp = buildMatchProfile(analyst, skillsOf(analyst), NOW);
/** The résumé names everything except SIEM. */
const resumeSkills = new Set(['Python', 'Splunk', 'Linux', 'CompTIA Security+'].map(foldText));

const title = analyzeTitle('Security Analyst');
const job = (skills: string[], seniority: Seniority = 'senior'): GapJob => ({
  title: 'Security Analyst',
  titleCore: title.core,
  roleId: title.role?.id,
  skills,
  seniority,
});

/**
 * Six senior jobs that want Kubernetes on top of skills you have, two that want Terraform and the
 * CISSP, one at your level that wants Wireshark (and a soft skill), and one that lists nothing.
 */
const JOBS: GapJob[] = [
  ...Array.from({ length: 6 }, () => job(['Python', 'Splunk', 'Kubernetes', 'SIEM'])),
  job(['Splunk', 'Terraform', 'CISSP']),
  job(['Splunk', 'Terraform', 'CISSP']),
  job(['Communication', 'Wireshark'], 'mid'),
  job([], 'unknown'),
];

describe('analyzeGaps', () => {
  const result = analyzeGaps(JOBS, mp, { hasResume: true, resumeSkills });

  it('the fixture job is the target role, so the numbers below follow from the match weights', () => {
    expect(title.role).toBeDefined();
    expect(mp.roles.get(title.role!.id)?.via).toBe('target');
  });

  it('counts the jobs, and measures demand over the jobs that list skills', () => {
    expect(result.jobs).toBe(10);
    expect(result.jobsWithSkills).toBe(9);
    expect(result.jobsMatched).toBe(10);
    const kubernetes = result.missingSkills.find((s) => s.name === 'Kubernetes')!;
    expect(kubernetes).toMatchObject({ kind: 'skill', category: 'cloud-devops', jobs: 6, share: 67 });
    expect(result.missingSkills.find((s) => s.name === 'Terraform')).toMatchObject({ jobs: 2, share: 22 });
  });

  it('estimates what each missing skill would add to the match', () => {
    // Each Kubernetes job: 3 of 4 skills (30 of 40 points) + target role (30) + a step above your level (9 of 15) = 69/85 = 81%.
    // With Kubernetes: 79/85 = 93%, a 12-point rise that crosses from the 80s to the 90s tier.
    expect(result.missingSkills.find((s) => s.name === 'Kubernetes')).toMatchObject({ avgGain: 12, tierUps: 6 });
    // Terraform jobs: 1 of 2 skills (20) + 0 of 1 certification (0 of 15) + role (30) + level (9) = 59/100; with it 79.
    expect(result.missingSkills.find((s) => s.name === 'Terraform')).toMatchObject({ avgGain: 20, tierUps: 2 });
  });

  it('ranks gaps by how many jobs they would improve, counting at most 10 points per job', () => {
    // Kubernetes: 6 jobs × 10 = 60. Terraform: 2 × 10 = 20. Wireshark: the only skill its one job lists, so
    // that job jumps 53% -> 100%, yet it still ranks last: one sparse posting must not outrank breadth.
    expect(result.missingSkills.map((s) => s.name)).toEqual(['Kubernetes', 'Terraform', 'Wireshark']);
    expect(result.missingSkills.find((s) => s.name === 'Wireshark')).toMatchObject({ jobs: 1, avgGain: 47 });
  });

  it('keeps certifications apart and ignores soft skills', () => {
    expect(result.missingCerts).toEqual([expect.objectContaining({ name: 'CISSP', kind: 'certification', jobs: 2, avgGain: 15 })]);
    expect([...result.missingSkills, ...result.strengths].some((s) => s.name === 'Communication')).toBe(false);
  });

  it('lists your skills that the jobs ask for most', () => {
    expect(result.strengths.map((s) => [s.name, s.jobs])).toEqual([
      ['Splunk', 8],
      ['Python', 6],
      ['SIEM', 6],
    ]);
  });

  it('finds skills you have that the jobs want but your résumé never names', () => {
    expect(result.resumeGaps).toEqual([{ name: 'SIEM', kind: 'skill', jobs: 6, share: 67 }]);
    expect(analyzeGaps(JOBS, mp, { hasResume: false }).resumeGaps).toEqual([]);
  });

  it('summarises the match and projects adding the top three gaps together', () => {
    // 6 × 81 + 2 × 59 + 53 (Wireshark job) + 71 (no skills listed: neutral 50% skills + role) = 728 / 10.
    expect(result.avgMatch).toBe(73);
    expect(result.strongJobs).toBe(7);
    expect(result.tiers.find((t) => t.low === 80)!.count).toBe(6);
    expect(result.tiers.reduce((n, t) => n + t.count, 0)).toBe(10);
    // Kubernetes, then the CISSP and Terraform (tied at 20; names break the tie). The Kubernetes jobs reach 93%,
    // the Terraform + CISSP jobs 94% (2/2 skills, 1/1 certification), the Wireshark job stays at 53%.
    expect(result.projection).toEqual({ added: ['Kubernetes', 'CISSP', 'Terraform'], avgMatch: 87, strongJobs: 9 });
  });

  it('compares the jobs’ level with yours', () => {
    expect(result.level).toEqual({ below: 0, at: 1, above: 8, wellAbove: 0, unknown: 1, yours: ['mid'], years: 4 });
  });

  it('recommends the cheapest, most effective changes first', () => {
    // Wireshark is listed by a single job, too few to recommend once several jobs list skills.
    expect(result.recommendations.map((r) => [r.id, r.priority])).toEqual([
      ['resume-skills', 'high'],
      ['learn-skill:Kubernetes', 'high'],
      ['get-certification:CISSP', 'medium'],
      ['learn-skill:Terraform', 'medium'],
      ['level-above', 'medium'],
    ]);
    const kubernetes = result.recommendations[1]!;
    expect(kubernetes.title).toBe('Learn Kubernetes, or add it if you already have it');
    expect(kubernetes.detail).toContain('Listed by 6 of the 9 jobs that name skills (67%)');
    expect(kubernetes.detail).toContain('about 12 points, moving 6 of them up a tier');
    // Linux, which you have, is in the same field (cloud and DevOps) even though no job here lists it.
    expect(kubernetes.detail).toContain('It sits next to skills you already have (Linux).');
    expect(kubernetes.impact).toBe('+12 on 6 jobs');
    expect(result.recommendations[0]!.title).toBe('Put SIEM on your résumé');
    expect(result.recommendations.at(-1)!.detail).toContain('89% of the jobs that state a level are above mid level (4 years of experience)');
  });

  it('asks for a résumé first when there is none', () => {
    const recs = analyzeGaps(JOBS, mp, { hasResume: false }).recommendations;
    expect(recs[0]).toMatchObject({ id: 'add-resume', priority: 'high' });
    expect(recs.some((r) => r.id === 'resume-skills')).toBe(false);
  });

  it('without any skills on file, asks for them and reports demand without estimating impact', () => {
    const blank = profileWith((p) => {
      p.preferences.targetTitles = ['Security Analyst'];
    });
    const out = analyzeGaps(JOBS, buildMatchProfile(blank, [], NOW), { hasResume: false });
    expect(out.recommendations.map((r) => r.id)).toEqual(expect.arrayContaining(['add-resume', 'add-skills']));
    expect(out.missingSkills[0]).toMatchObject({ name: 'Splunk', jobs: 8, avgGain: 0, tierUps: 0 });
    expect(out.projection).toBeUndefined();
    expect(out.recommendations.find((r) => r.id === 'learn-skill:Splunk')?.impact).toBeUndefined();
  });

  it('asks for years of experience when your level is unknown', () => {
    const noYears = profileWith((p) => {
      p.preferences.targetTitles = ['Security Analyst'];
      p.preferences.skills = ['Python'];
    });
    const out = analyzeGaps(JOBS, buildMatchProfile(noYears, ['Python'], NOW), { hasResume: true, resumeSkills });
    expect(out.level).toMatchObject({ unknown: 10, yours: [] });
    expect(out.recommendations.some((r) => r.id === 'add-experience')).toBe(true);
  });

  it('suggests target titles when the jobs were found with the current title', () => {
    expect(analyzeGaps(JOBS, mp, { hasResume: true, resumeSkills, suggestTargets: true }).recommendations.at(-1)?.id).toBe('add-targets');
  });

  it('ignores one-off mentions once there are enough jobs to tell a pattern', () => {
    const many = [...Array.from({ length: 25 }, () => job(['Python', 'Kubernetes'])), job(['Python', 'Fortran'])];
    const out = analyzeGaps(many, mp, { hasResume: true, resumeSkills });
    expect(out.missingSkills.map((s) => s.name)).toEqual(['Kubernetes']);
  });

  it('handles no jobs at all', () => {
    const out = analyzeGaps([], mp, { hasResume: true, resumeSkills });
    expect(out).toMatchObject({ jobs: 0, jobsWithSkills: 0, avgMatch: null, strongJobs: 0, missingSkills: [], recommendations: [] });
    expect(out.projection).toBeUndefined();
  });
});

describe('listNames', () => {
  it('joins names the way a sentence would', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['A'])).toBe('A');
    expect(listNames(['A', 'B'])).toBe('A and B');
    expect(listNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
