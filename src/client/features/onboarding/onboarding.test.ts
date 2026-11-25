import { describe, expect, it } from 'vitest';
import { aboutCount, downloadEstimate, industryLabel, preselectIndustries } from './industries';
import { STEPS, clampStep } from './steps';

const ALL = ['ai', 'healthcare', 'biotech-pharma', 'education', 'fintech', 'developer-tools', 'nonprofit-research'];

describe('preselectIndustries', () => {
  it('selects nothing when there are no titles or the titles fit every industry', () => {
    expect(preselectIndustries([], ALL)).toEqual([]);
    expect(preselectIndustries(['Software Engineer', 'Product Manager'], ALL)).toEqual([]);
  });

  it('selects the industries the titles clearly point at, in registry order', () => {
    expect(preselectIndustries(['Registered Nurse'], ALL)).toEqual(['healthcare', 'biotech-pharma']);
    expect(preselectIndustries(['Registered Nurse', 'Product Manager'], ALL)).toEqual(['healthcare', 'biotech-pharma']);
    expect(preselectIndustries(['Math Teacher', 'Curriculum Designer'], ALL)).toEqual(['education']);
  });

  it('ignores matched industries that are not in the registry', () => {
    expect(preselectIndustries(['Game Designer'], ALL)).toEqual([]);
  });
});

describe('labels and counts', () => {
  it('names known industries and tidies unknown slugs', () => {
    expect(industryLabel('developer-tools')).toBe('Developer tools');
    expect(industryLabel('space_tech')).toBe('Space tech');
    expect(industryLabel('')).toBe('Other');
  });

  it('estimates what following companies downloads', () => {
    expect(downloadEstimate(1)).toBe('about 100 jobs, 10 MB to download');
    expect(downloadEstimate(26)).toBe('about 2,000 jobs, 30 MB to download');
    expect(downloadEstimate(492)).toBe('about 38,400 jobs, 540 MB to download');
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
