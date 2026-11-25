import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BroadenSuggestion, ExternalSearchLink } from '../../../shared/types';
import { AlsoSearchOn, WiderSearch, zeroResultsHint } from './WiderSearch';

const links: ExternalSearchLink[] = [
  { id: 'linkedin', name: 'LinkedIn', url: 'https://www.linkedin.com/jobs/search/?keywords=data%20analyst' },
  { id: 'indeed', name: 'Indeed', url: 'https://www.indeed.com/jobs?q=data+analyst' },
];
const radius: BroadenSuggestion = { id: 'r', kind: 'radius', label: 'Within 100 km', description: 'Search further out.', patch: { radiusKm: 100 }, extraResults: 4 };
const noop = () => undefined;

describe('zero-results hint', () => {
  it('points at the suggestions only when there are some', () => {
    expect(zeroResultsHint(true, true)).toBe('Try one of these, or run the same search on another site.');
    expect(zeroResultsHint(true, false)).toBe('Try one of these.');
    expect(zeroResultsHint(false, true)).toBe('Nothing close to it is in your index yet. Check the spelling or try other words, or run the same search on another site.');
    expect(zeroResultsHint(false, false)).not.toMatch(/one of these|another site/);
  });

  it('does not say "one of these" when no suggestion is worth showing', () => {
    const useless = { ...radius, extraResults: 0 };
    const html = renderToStaticMarkup(<WiderSearch query={{ q: 'underwater welder' }} total={0} suggestions={[useless]} externalLinks={links} onChange={noop} />);
    expect(html).not.toContain('one of these');
    expect(html).toContain('Check the spelling');
    expect(html).toContain('LinkedIn');
  });

  it('keeps "one of these" when suggestions are listed', () => {
    const html = renderToStaticMarkup(<WiderSearch query={{ q: 'designer' }} total={0} suggestions={[radius]} externalLinks={links} onChange={noop} />);
    expect(html).toContain('Try one of these');
    expect(html).toContain('Within 100 km');
  });
});

describe('AlsoSearchOn', () => {
  it('links to every external search in a new tab', () => {
    const html = renderToStaticMarkup(<AlsoSearchOn links={links} />);
    expect(html).toContain('Also search on');
    for (const link of links) expect(html).toContain(`href="${link.url.replace(/&/g, '&amp;')}"`);
    expect(html.match(/target="_blank"/g)).toHaveLength(links.length);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(links.length);
  });

  it('renders nothing without links', () => {
    expect(renderToStaticMarkup(<AlsoSearchOn links={[]} />)).toBe('');
  });
});
