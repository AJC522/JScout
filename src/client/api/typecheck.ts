// Compile-time checks that the typed client enforces the API contract. Not imported at runtime.
import { api } from './client';

export async function contractChecks(): Promise<void> {
  await api('GET /api/bootstrap');
  await api('POST /api/search', { body: { q: 'engineer' } });
  await api('GET /api/jobs/:id', { params: { id: 'x' } });
  await api('GET /api/suggest/titles', { query: { q: 'eng' } });
  // @ts-expect-error body is required
  await api('POST /api/search');
  // @ts-expect-error params are required
  await api('GET /api/jobs/:id');
  // @ts-expect-error wrong body shape
  await api('POST /api/search', { body: { q: 1 } });
}
