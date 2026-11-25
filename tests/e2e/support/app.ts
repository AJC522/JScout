/** Shared steps for the end-to-end tests: API shortcuts for state a test needs but is not testing. */
import type { APIRequestContext, Page } from '@playwright/test';
import type { ProfilePatch } from '../../../src/shared/api';
import type { Application, Profile, SavedSearch } from '../../../src/shared/types';

export async function patchProfile(request: APIRequestContext, patch: ProfilePatch): Promise<Profile> {
  const res = await request.patch('/api/profile', { data: patch });
  if (!res.ok()) throw new Error(`PATCH /api/profile failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as Profile;
}

export async function getProfile(request: APIRequestContext): Promise<Profile> {
  return (await (await request.get('/api/profile')).json()) as Profile;
}

/** Mark first-run setup as done (or not), so "/" does (or does not) send the browser to /welcome. */
export async function setOnboarded(request: APIRequestContext, onboarded: boolean): Promise<void> {
  await patchProfile(request, { onboardedAt: onboarded ? new Date().toISOString() : null });
}

/** Remove tracker entries for a job title, so a test can save it afresh (tests share one server). */
export async function deleteApplications(request: APIRequestContext, title: string): Promise<void> {
  const apps = (await (await request.get('/api/applications')).json()) as Application[];
  for (const app of apps.filter((a) => a.job.title === title)) await request.delete(`/api/applications/${app.id}`);
}

/** Remove saved searches with this name, so a test can create it afresh. */
export async function deleteSavedSearches(request: APIRequestContext, name: string): Promise<void> {
  const saved = (await (await request.get('/api/saved-searches')).json()) as SavedSearch[];
  for (const s of saved.filter((x) => x.name === name)) await request.delete(`/api/saved-searches/${s.id}`);
}

export function results(page: Page) {
  return page.getByRole('feed', { name: 'Search results' });
}

/** A result card by its exact job title. */
export function resultCard(page: Page, title: string) {
  return results(page).getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}
