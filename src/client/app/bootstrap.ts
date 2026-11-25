import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { qk } from '../lib/query';

/**
 * App-wide status (index summary, profile completeness, tracker and saved-search counts).
 * While the API is unreachable it polls every 10s so the app recovers by itself when
 * the server is back; EventsProvider keeps the index part live in between.
 */
export function useBootstrap() {
  return useQuery({
    queryKey: qk.bootstrap(),
    queryFn: ({ signal }) => api('GET /api/bootstrap', { signal }),
    refetchInterval: (query) => (query.state.status === 'error' ? 10_000 : false),
  });
}
