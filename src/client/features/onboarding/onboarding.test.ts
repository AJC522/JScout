import { describe, expect, it } from 'vitest';
import { aboutCount, industryLabel, preselectIndustries } from './industries';
import { STEPS, clampStep } from './steps';

const ALL = ['ai', 'healthcare', 'biotech-pharma', 'education', 'fintech', 'developer-tools', 'nonprofit-research'];

describe('preselectIndustries', () => {
  it('selects everything when there are no titles or a title fits every industry', () => {
    expect(preselectIndustries([], ALL)).toEqual(ALL);
    expect(preselectIndustries(['Software Engineer'], ALL)).toEqual(ALL);
    expect(preselectIndustries(['Registered Nurse', 'Product Manager'], ALL)).toEqual(ALL);
  });

  it('narrows to the industries every title clearly points at', () => {
    expect(preselectIndustries(['Registered Nurse'], ALL)).toEqual(['healthcare', 'biotech-pharma']);
    expect(preselectIndustries(['Math Teacher', 'Curriculum Designer'], ALL)).toEqual(['education']);
  });

  it('falls back to everything when the matched industries are not in the registry', () => {
    expect(preselectIndustries(['Game Designer'], ALL)).toEqual(ALL);
  });
});

describe('labels and counts', () => {
  it('names known industries and tidies unknown slugs', () => {
    expect(industryLabel('developer-tools')).toBe('Developer tools');
    expect(industryLabel('space_tech')).toBe('Space tech');
    expect(industryLabel('')).toBe('Other');
  });

  it('rounds large company counts', () => {
    expect(aboutCount(492)).toBe('about 500');
    expect(aboutCount(42)).toBe('42');
    expect(aboutCount(undefined)).toBe('hundreds of');
  });
});

describe('clampStep', () => {
  it('keeps valid step indexes and resets anything else', () => {
    expect(clampStep(2)).toBe(2);
    expect(clampStep(STEPS.length)).toBe(0);
    expect(clampStep(-1)).toBe(0);
    expect(clampStep(1.5)).toBe(0);
    expect(clampStep('3')).toBe(0);
  });
});
