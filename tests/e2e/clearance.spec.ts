import { expect, test } from '@playwright/test';
import { patchProfile, resultCard, results, setOnboarded } from './support/app';

// The seeded index has a Northwind Defense posting for each clearance outcome (support/seed-index.ts).
test.beforeEach(async ({ request }) => {
  await setOnboarded(request, true);
  await patchProfile(request, { work: { clearance: null } });
});

// Tests share one server: leave the profile as the other specs expect it.
test.afterEach(async ({ request }) => {
  await patchProfile(request, { work: { clearance: null } });
});

test('flags what each job asks for in the way of a security clearance', async ({ page }) => {
  await page.goto('/search?q=satellite');
  await expect(results(page).getByRole('article')).toHaveCount(4);

  await expect(resultCard(page, 'Satellite Ground Systems Engineer').getByText('Must hold TS/SCI + CI poly')).toBeVisible();
  await expect(resultCard(page, 'Satellite Mission Planner').getByText('Sponsors Secret')).toBeVisible();
  await expect(resultCard(page, 'Satellite Data Analyst').getByText('Secret required')).toBeVisible();
  await expect(resultCard(page, 'Satellite Network Technician').getByText('No clearance needed')).toBeVisible();

  // The detail view explains it and quotes the posting.
  await resultCard(page, 'Satellite Ground Systems Engineer').click();
  const section = page.getByRole('region', { name: /Must already hold a clearance/ });
  await expect(section).toContainText('TS/SCI with CI polygraph');
  await expect(section).toContainText('The employer won’t sponsor it.');
  await expect(section).toContainText('“Must hold an active TS/SCI with CI polygraph.”');
});

test('filters to jobs you can get without a clearance of your own', async ({ page }) => {
  await page.goto('/search?q=satellite');
  await expect(results(page).getByRole('article')).toHaveCount(4);
  await page.getByRole('button', { name: 'Only jobs I can get without one' }).click();
  await expect(page).toHaveURL(/clr=none%2Cpreferred%2Csponsored|clr=none,preferred,sponsored/);
  await expect(results(page).getByRole('article')).toHaveCount(2);
  await expect(resultCard(page, 'Satellite Mission Planner')).toBeVisible();
  await expect(resultCard(page, 'Satellite Network Technician')).toBeVisible();
});

test('checks a job’s clearance against the one on your profile', async ({ page }) => {
  await page.goto('/profile#work');
  const work = page.getByRole('region', { name: 'Work' });
  await work.getByLabel('Security clearance').selectOption('ts-sci');
  await work.getByLabel('Polygraph').selectOption('ci');
  await work.getByRole('button', { name: 'Save' }).click();
  await expect(work.getByText('Saved')).toBeVisible();

  await page.goto('/search?q=satellite');
  await resultCard(page, 'Satellite Ground Systems Engineer').click();
  await expect(page.getByRole('region', { name: /Must already hold a clearance/ })).toContainText('Your active TS/SCI with CI polygraph covers this.');
});
