import { describe, expect, it } from 'vitest';
import { locationFilter } from './location-filter';

const opts = { radiusKm: 25, includeRemote: true };

describe('locationFilter', () => {
  it('no text, or only punctuation, means no filter', () => {
    expect(locationFilter(undefined, opts)).toEqual({ places: [], placeUnresolved: false });
    expect(locationFilter('  -- ', opts)).toEqual({ places: [], placeUnresolved: false });
    expect(locationFilter(' ; ', opts)).toEqual({ places: [], placeUnresolved: false });
  });

  it('"Anywhere" resolves but filters nothing', () => {
    const f = locationFilter('Anywhere', opts);
    expect(f.place?.kind).toBe('anywhere');
    expect(f.cond).toBeUndefined();
  });

  it('a city filters by radius and, unless switched off, remote jobs open to its country', () => {
    const f = locationFilter('Austin, TX', opts);
    expect(f.place).toMatchObject({ kind: 'city', city: 'Austin', country: 'US' });
    expect(f.cond!.sql).toContain('asin');
    expect(f.cond!.sql).toContain("j.remote = 'remote'");
    expect(f.cond!.params).toContain('["US"]');
    expect(locationFilter('Austin, TX', { radiusKm: 0, includeRemote: false }).cond!.sql).not.toContain("j.remote = 'remote'");
  });

  it('unresolved text falls back to a location-column text match', () => {
    expect(locationFilter('Xyzzyville', opts)).toEqual({ places: [], placeUnresolved: true, fts: 'location : ("Xyzzyville")' });
  });

  it('several places separated by ";" match a posting in any of them', () => {
    const f = locationFilter('Berlin, Germany; Munich, Germany; Xyzzyville', opts);
    expect(f.places.map((p) => p.city)).toEqual(['Berlin', 'Munich']);
    expect(f.place?.city).toBe('Berlin');
    expect(f.cond?.sql).toContain(' OR ');
    expect(locationFilter('Berlin, Germany; Anywhere', opts).cond).toBeUndefined();
  });
});
