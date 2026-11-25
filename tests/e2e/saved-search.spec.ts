import { expect, test } from '@playwright/test';
import { deleteSavedSearches, results, setOnboarded } from './support/app';

test.beforeEach(async ({ request }) => {
  await setOnboarded(request, true);
  await deleteSavedSearches(request, 'Nursing jobs');
});

test('saves a search and runs it again from the saved searches page', async ({ page }) => {
  await page.goto('/?q=registered+nurse');
  await expect(results(page).getByRole('article').first()).toBeVisible();

  await page.getByRole('button', { name: 'Save search' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save this search' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Nursing jobs');
  await dialog.getByRole('button', { name: 'Save search' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('link', { name: /^Saved searches/ }).click();
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Nursing jobs' }) });
  await expect(row.getByText(/open jobs?/)).toBeVisible();

  await row.getByRole('button', { name: 'Run' }).click();
  await expect(page).toHaveURL(/q=registered\+nurse/);
  await expect(page.getByRole('combobox', { name: 'What: job title or keywords' })).toHaveValue('registered nurse');
  await expect(results(page).getByRole('article').first()).toBeVisible();
});
