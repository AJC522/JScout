import { describe, expect, it } from 'vitest';
import { clearanceFit, describeClearance, levelCovers } from './clearance';
import type { HeldClearance, JobClearance } from './types';

const active = (level: HeldClearance['level'], polygraph?: HeldClearance['polygraph']): HeldClearance => ({ level, status: 'active', ...(polygraph ? { polygraph } : {}) });

describe('clearanceFit', () => {
  const mustHold: JobClearance = { requirement: 'active', level: 'secret' };

  it('is clear when nothing is asked', () => {
    expect(clearanceFit(undefined, null).standing).toBe('clear');
    expect(clearanceFit({ requirement: 'none' }, null).standing).toBe('clear');
    expect(clearanceFit({ requirement: 'preferred', level: 'secret' }, null)).toEqual({ standing: 'clear', note: 'Secret preferred, not required.' });
  });

  it('says what a user without a clearance is up against', () => {
    expect(clearanceFit(mustHold, null)).toEqual({ standing: 'short', note: 'You must already hold an active Secret.' });
    expect(clearanceFit({ requirement: 'sponsored', level: 'secret' }, null).standing).toBe('sponsored');
    expect(clearanceFit({ requirement: 'required' }, null)).toEqual({ standing: 'ask', note: "Needs a clearance, but doesn't say whether they sponsor it." });
  });

  it('accepts a higher clearance and refuses a lower or lapsed one', () => {
    expect(clearanceFit(mustHold, active('ts-sci'))).toEqual({ standing: 'meets', note: 'Your active TS/SCI covers this.' });
    expect(clearanceFit({ requirement: 'active', level: 'top-secret' }, active('secret'))).toEqual({
      standing: 'short',
      note: 'They want an active Top Secret; you hold an active Secret.',
    });
    expect(clearanceFit(mustHold, { level: 'secret', status: 'inactive' }).note).toBe('They want an active Secret; yours is inactive. Ask whether it can be reinstated.');
  });

  it('checks the polygraph too', () => {
    const job: JobClearance = { requirement: 'active', level: 'ts-sci', polygraph: 'full-scope' };
    expect(clearanceFit(job, active('ts-sci', 'ci')).standing).toBe('short');
    expect(clearanceFit(job, active('ts-sci', 'full-scope')).standing).toBe('meets');
  });

  it('copes with a profile saved before clearances existed', () => {
    expect(clearanceFit(mustHold, undefined).standing).toBe('short');
  });
});

describe('helpers', () => {
  it('compares levels and describes them', () => {
    expect(levelCovers('doe-q', 'secret')).toBe(true);
    expect(levelCovers('public-trust', 'confidential')).toBe(false);
    expect(describeClearance({ level: 'ts-sci', polygraph: 'full-scope' })).toBe('TS/SCI with full-scope polygraph');
    expect(describeClearance({})).toBe('a clearance');
  });
});
