import { expect, test } from '@playwright/test';
import { getProfile, patchProfile, resultCard, results, setOnboarded } from './support/app';

const EMPTY = { targetTitles: [], skills: [], certifications: [], locations: [], remote: [] };

test.beforeEach(async ({ request }) => {
  await setOnboarded(request, true);
  await patchProfile(request, {
    work: { yearsExperience: 4 },
    preferences: {
      targetTitles: ['Software Engineer'],
      skills: ['TypeScript', 'React', 'PostgreSQL', 'AWS'],
      certifications: ['CompTIA Security+'],
      locations: ['Austin, TX'],
      radiusKm: 50,
    },
  });
});

// Tests share one server: leave the profile as the other specs expect it.
test.afterEach(async ({ request }) => {
  await patchProfile(request, { work: { yearsExperience: null }, preferences: EMPTY });
});

test('ranks results by profile match and explains the match', async ({ page }) => {
  await page.goto('/?q=software engineer');
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('match');

  // All four listed skills and the target role, in Austin: the first result, at 100%.
  const first = results(page).getByRole('article').first();
  await expect(first.getByRole('heading', { name: 'Software Engineer', exact: true })).toBeVisible();
  await expect(first.getByRole('img', { name: '100% match' })).toBeVisible();

  // A same-role job in Round Rock shows how far away it is.
  await expect(resultCard(page, 'Software Developer').getByText(/\d+ km away/)).toBeVisible();

  await first.click();
  const match = page.getByRole('region', { name: /% match with your profile/ });
  await expect(match).toBeVisible();
  await expect(match.getByText('You have 4 of 4 listed skills')).toBeVisible();
  await expect(match.getByText('Your target role: Software Engineer')).toBeVisible();

  // Relevance is still one click away.
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('relevance');
  await expect(page).toHaveURL(/sort=relevance/);
});

test('saves certifications on the profile page', async ({ page, request }) => {
  await page.goto('/profile');
  const preferences = page.getByRole('region', { name: 'Search preferences' });
  const field = preferences.getByRole('combobox', { name: /Certifications and licences/ });
  await field.fill('PMP');
  await field.press('Enter');
  await preferences.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(preferences.getByText('Saved', { exact: true })).toBeVisible();
  expect((await getProfile(request)).preferences.certifications).toEqual(['CompTIA Security+', 'PMP']);
});
