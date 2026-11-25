import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { SearchQuery } from '../../../shared/types';
import { qk } from '../../lib/query';
import { StartPanel } from './StartPanel';

function render(profileQuery: SearchQuery, onboarded = true): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.searchFromProfile(), profileQuery);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StartPanel onboarded={onboarded} onRun={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StartPanel', () => {
  it('offers setup instead of a dead "Search with my profile" button when the profile has nothing to search by', () => {
    const html = render({ q: '' });
    expect(html).not.toContain('Search with my profile');
    expect(html).toContain('Set up my profile');
    expect(html).toContain('href="/welcome"');
  });

  it('offers the profile search once the profile has titles or a place', () => {
    const html = render({ q: 'Data analyst', location: 'Berlin, Germany', radiusKm: 50 });
    expect(html).toContain('Search with my profile');
    expect(html).toContain('Data analyst');
    expect(html).not.toContain('Set up my profile');
  });

  it('offers setup before onboarding', () => {
    expect(render({ q: 'Data analyst' }, false)).toContain('Set up my profile');
  });
});
