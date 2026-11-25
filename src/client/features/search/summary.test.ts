import { describe, expect, it } from 'vitest';
import type { BroadenSuggestion, SearchInterpretation } from '../../../shared/types';
import { broadenChips, describePlace, describeTitles, gainLabel, relatedRoleChips, roleLabel, summaryParts } from './summary';

const base: SearchInterpretation = { terms: ['software engineer'], excluded: [], titles: [], titleOnly: true };

const austin = { kind: 'city' as const, raw: 'Austin', city: 'Austin', admin1: 'TX', country: 'US', label: 'Austin, TX, United States' };

describe('interpretation summary', () => {
  it('describes the role with the number of similar titles', () => {
    const interpretation: SearchInterpretation = {
      ...base,
      role: { id: 'software-engineer', title: 'Software Engineer', family: 'Engineering' },
      titles: [
        { title: 'Software Engineer', via: 'query', roleId: 'software-engineer' },
        { title: 'Software Developer', via: 'synonym', roleId: 'software-engineer' },
        { title: 'SWE', via: 'synonym', roleId: 'software-engineer' },
      ],
    };
    expect(describeTitles(interpretation, { q: 'software engineer' })).toBe('Software Engineer + 2 similar titles');
  });

  it('falls back to keywords and then to "Any job"', () => {
    expect(describeTitles({ ...base, terms: ['react', 'rust'] }, { q: 'react rust' })).toBe('“react” and “rust”');
    expect(describeTitles({ ...base, terms: [] }, { q: '' })).toBe('Any job');
  });

  it('describes the place with radius and remote', () => {
    const interpretation = { ...base, place: austin };
    expect(describePlace(interpretation, { q: '', location: 'Austin', radiusKm: 50 })).toBe('Austin, TX, United States within 50 km + remote');
    expect(describePlace(interpretation, { q: '', location: 'Austin', includeRemote: false })).toBe('Austin, TX, United States');
    expect(describePlace({ ...base, place: { kind: 'unknown', raw: 'Atlantis', label: 'Atlantis' }, placeUnresolved: true }, { q: '', location: 'Atlantis' })).toBe(
      'Atlantis + remote',
    );
    expect(describePlace(base, { q: '', remote: ['remote'] })).toBe('Remote only');
    expect(describePlace(base, { q: '' })).toBe('Anywhere');
  });

  it('joins the parts with the total first', () => {
    expect(summaryParts(1, { ...base, excluded: ['sales'] }, { q: 'software engineer' })).toEqual([
      '1 job',
      '“software engineer”',
      'Anywhere',
      'without “sales”',
    ]);
  });
});

describe('related roles and broaden chips', () => {
  const suggestions: BroadenSuggestion[] = [
    { id: 's1', kind: 'related-role', label: 'Site Reliability Engineer', description: '', patch: { relatedRoles: ['devops', 'sre'] }, extraResults: 40 },
    { id: 's2', kind: 'radius', label: 'Within 100 km', description: '', patch: { radiusKm: 100 }, extraResults: 12 },
    { id: 's3', kind: 'include-remote', label: 'Include remote jobs', description: '', patch: { includeRemote: true }, extraResults: 300 },
    { id: 's4', kind: 'date', label: 'Any date', description: '', patch: { postedWithinDays: undefined } },
    { id: 's5', kind: 'related-role', label: 'DevOps Engineer', description: '', patch: { relatedRoles: ['devops'] }, extraResults: 5 },
  ];

  it('lists chosen roles first, then suggestions, once each', () => {
    const chips = relatedRoleChips([{ title: 'DevOps Engineer', via: 'related', roleId: 'devops' }], suggestions, { q: 'x', relatedRoles: ['devops', 'mlops'] });
    expect(chips.map((c) => [c.roleId, c.selected])).toEqual([
      ['devops', true],
      ['mlops', true],
      ['sre', false],
    ]);
    expect(chips[0]?.patch).toEqual({ relatedRoles: ['mlops'] });
    expect(chips[1]?.label).toBe('Mlops');
    expect(chips[2]?.extra).toBe(40);
  });

  it('orders broaden chips by gain and leaves related roles out', () => {
    expect(broadenChips(suggestions).map((s) => s.id)).toEqual(['s3', 's2', 's4']);
    expect(broadenChips([{ id: 'z', kind: 'date', label: 'Any date', description: '', patch: {}, extraResults: 0 }])).toEqual([]);
  });

  it('formats labels', () => {
    expect(gainLabel(1234)).toBe('+1,234 jobs');
    expect(gainLabel(0)).toBe('');
    expect(gainLabel(undefined)).toBe('');
    expect(roleLabel('site-reliability-engineer')).toBe('Site reliability engineer');
  });
});
