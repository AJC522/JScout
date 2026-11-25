import { expect, test } from '@playwright/test';
import type { AppSettings } from '../../src/shared/types';
import { getProfile, patchProfile, setOnboarded } from './support/app';

test.beforeEach(async ({ request }) => {
  await setOnboarded(request, true);
});

test('profile edits are saved and survive a reload', async ({ page, request }) => {
  await patchProfile(request, { personal: { fullName: 'Someone Else', phone: '' } });
  await page.goto('/profile');
  const personal = page.getByRole('region', { name: 'Personal' });
  await personal.getByRole('textbox', { name: 'Full name' }).fill('Ada Lovelace');
  await personal.getByRole('textbox', { name: 'Phone' }).fill('+44 20 7946 0000');
  await personal.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(personal.getByText('Saved', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('region', { name: 'Personal' }).getByRole('textbox', { name: 'Full name' })).toHaveValue('Ada Lovelace');
  const profile = await getProfile(request);
  expect(profile.personal).toMatchObject({ fullName: 'Ada Lovelace', phone: '+44 20 7946 0000' });
});

test('the theme setting applies at once and is remembered', async ({ page, request }) => {
  await page.goto('/settings');
  // The sidebar has a theme switch too; this is the one on the settings page.
  const theme = page.getByRole('main').getByRole('radiogroup', { name: 'Theme' });
  await theme.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(theme.getByRole('radio', { name: 'Dark' })).toBeChecked();
  expect(((await (await request.get('/api/settings')).json()) as AppSettings).theme).toBe('dark');

  await theme.getByRole('radio', { name: 'System' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
});
