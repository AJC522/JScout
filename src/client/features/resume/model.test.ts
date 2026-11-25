import { describe, expect, it } from 'vitest';
import type { RequirementCheck, ResumeScoreSummary } from '../../../shared/types';
import { draftFileName, formatDelta, groupRequirements, sortScores, targetKey } from './model';

const req = (text: string, level: RequirementCheck['level'], status: RequirementCheck['status']): RequirementCheck => ({
  text,
  level,
  status,
  kind: 'skill',
  matched: [],
  missing: [],
});

const score = (applicationId: string, title: string, value: number): ResumeScoreSummary => ({
  applicationId,
  title,
  company: 'Acme',
  status: 'applied',
  score: value,
  band: '',
  requiredMet: 0,
  requiredTotal: 0,
  limited: false,
});

describe('résumé review model', () => {
  it('keys targets so a new job starts a fresh draft', () => {
    expect(targetKey({})).toBe('');
    expect(targetKey({ jobId: 'j1' })).toBe('job:j1');
    expect(targetKey({ applicationId: 'a1', jobId: 'j1' })).toBe('application:a1');
    const a = targetKey({ posting: { title: 'Analyst', description: 'SQL' } });
    expect(a).not.toBe(targetKey({ posting: { title: 'Analyst', description: 'SQL, Python' } }));
  });

  it('groups requirements, gaps first, keeping posting order within a status', () => {
    const { required, preferred } = groupRequirements([
      req('A', 'required', 'met'),
      req('B', 'required', 'missing'),
      req('C', 'preferred', 'partial'),
      req('D', 'required', 'partial'),
      req('E', 'required', 'missing'),
    ]);
    expect(required.map((r) => r.text)).toEqual(['B', 'E', 'D', 'A']);
    expect(preferred.map((r) => r.text)).toEqual(['C']);
  });

  it('sorts applications by score (lowest first) or title', () => {
    const items = [score('1', 'Data Analyst', 70), score('2', 'Backend Engineer', 40), score('3', 'Analyst', 70)];
    expect(sortScores(items, 'score').map((s) => s.applicationId)).toEqual(['2', '3', '1']);
    expect(sortScores(items, 'title').map((s) => s.applicationId)).toEqual(['3', '2', '1']);
  });

  it('names downloads safely and formats score changes', () => {
    expect(draftFileName({ title: 'Engineer', company: 'Lumen/Pay: "Core"' })).toBe('Résumé – Lumen Pay Core.txt');
    expect(draftFileName({ title: 'Engineer', company: '' })).toBe('Résumé – Engineer.txt');
    expect(formatDelta(12)).toBe('+12');
    expect(formatDelta(-4)).toBe('−4');
    expect(formatDelta(0)).toBe('±0');
  });
});
