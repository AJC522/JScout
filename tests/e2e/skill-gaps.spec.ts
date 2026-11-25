import { expect, test } from '@playwright/test';
import type { GapAnalysis } from '../../src/shared/types';
import { getProfile, patchProfile, setOnboarded } from './support/app';

const RESUME = `Jane Doe
Austin, TX | jane.doe@example.com

EXPERIENCE
Software Engineer, Brightline Health
Mar 2022 – Present
- Built React dashboards used by 200 support staff
- Wrote Python services that reconcile nightly payment files

SKILLS
Python, React
`;

/** A skill name as literal text inside a RegExp ("C++", "Node.js"). */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.beforeEach(async ({ request }) => {
  await setOnboarded(request, true);
  await patchProfile(request, {
    preferences: { targetTitles: ['Software Engineer'], skills: ['Python', 'React', 'TypeScript'], certifications: [] },
    work: { yearsExperience: 4, currentTitle: '' },
  });
  expect((await request.put('/api/profile/resume/text', { data: { text: RESUME } })).ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  await request.delete('/api/profile/resume');
  await patchProfile(request, { preferences: { targetTitles: [], skills: [], certifications: [] }, work: { yearsExperience: null } });
});

test('pinpoints what the target jobs ask for, and "I have it" adds a skill to the profile', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Skill gaps' }).click();
  await expect(page.getByRole('heading', { name: 'Skill gaps', level: 1 })).toBeVisible();
  await expect(page.getByText(/Based on \d+ jobs?:/)).toContainText('Software Engineer');

  await expect(page.getByText('Average match')).toBeVisible();
  // TypeScript is on the profile but not the résumé, and the target jobs ask for it. (Earlier tests on this
  // shared server may have left more profile skills the résumé lacks, so others can be named with it.)
  await expect(page.getByText(/^Put .*\bTypeScript\b.* on your résumé$/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Résumé review' })).toHaveAttribute('href', '/resume');

  // The most impactful missing skill, with its demand bar and what it would add.
  const analysis = (await (await request.post('/api/gaps', { data: { scope: 'profile' } })).json()) as GapAnalysis;
  const top = analysis.missingSkills[0]!;
  const list = page.getByRole('region', { name: 'Skills they ask for' });
  await expect(list.getByRole('meter', { name: new RegExp(`^${literal(top.name)}: listed by ${top.share}%`) })).toBeVisible();

  await list.getByRole('button', { name: `I have ${top.name}: add it to my skills` }).click();
  await expect(page.getByText(`Added ${top.name} to your skills`)).toBeVisible();
  // The analysis is redone without it.
  await expect(list.getByRole('meter', { name: new RegExp(`^${literal(top.name)}: listed by`) })).toHaveCount(0);
  expect((await getProfile(request)).preferences.skills).toContain(top.name);
});

test('opens from search results for that search', async ({ page }) => {
  await page.goto('/search?q=Software+Engineer');
  await page.getByRole('region', { name: 'Results' }).getByRole('link', { name: 'Skill gaps' }).click();
  await expect(page).toHaveURL(/\/gaps\?.*scope=search/);
  await expect(page.getByRole('radio', { name: 'This search' })).toBeChecked();
  await expect(page.getByText(/Based on \d+ jobs?:/)).toContainText('Software Engineer');
});

test('explains what is needed when there is nothing to analyse', async ({ page, request }) => {
  await page.goto('/gaps?scope=applications');
  await expect(page.getByRole('radio', { name: 'My applications' })).toBeChecked();
  const apps = (await (await request.get('/api/applications')).json()) as unknown[];
  if (apps.length === 0) await expect(page.getByText('No active applications')).toBeVisible();

  await patchProfile(request, { preferences: { targetTitles: [] }, work: { currentTitle: '' } });
  await page.goto('/gaps');
  await expect(page.getByText('Tell JScout which jobs you want')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add target titles' })).toHaveAttribute('href', '/profile#preferences');
});
