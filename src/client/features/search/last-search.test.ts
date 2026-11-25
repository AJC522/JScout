import { afterEach, describe, expect, it } from 'vitest';
import { forgetSearch, rememberSearch, searchBackLink } from './last-search';

describe('last search', () => {
  afterEach(forgetSearch);

  it('falls back to the start page when no search was seen', () => {
    expect(searchBackLink()).toBe('/');
  });

  it('leads back to the last search with its query and filters', () => {
    rememberSearch('/search', '?q=data+analyst&l=Germany&wm=remote');
    expect(searchBackLink()).toBe('/search?q=data+analyst&l=Germany&wm=remote');
    rememberSearch('/', '?q=nurse');
    expect(searchBackLink()).toBe('/?q=nurse');
  });

  it('ignores blank searches', () => {
    rememberSearch('/search', '?q=designer');
    rememberSearch('/search', '');
    rememberSearch('/', '?');
    expect(searchBackLink()).toBe('/search?q=designer');
  });
});
