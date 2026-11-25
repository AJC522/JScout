import { expect, test } from '@playwright/test';
import { getProfile, patchProfile, results, setOnboarded } from './support/app';

const RESUME = [
  'Jordan Rivera',
  'Austin, TX | jordan.rivera@example.com | (512) 555-0142',
  '',
  'EXPERIENCE',
  'Senior Software Engineer, Brightline Analytics, Austin, TX   Mar 2021 - Present',
  '- Led the rebuild of the customer dashboard in React and TypeScript.',
  '- Designed PostgreSQL schemas and Node.js services on AWS.',
  'Software Engineer, Coastal Payments, Remote   Jun 2018 - Feb 2021',
  '- Built payment APIs in Node.js and GraphQL.',
  '',
  'EDUCATION',
  'B.S. Computer Science, University of Texas at Austin   2014 - 2018',
  '',
  'SKILLS',
  'TypeScript, JavaScript, React, Node.js, GraphQL, PostgreSQL, AWS, Docker',
].join('\n');

test.describe('first-run setup', () => {
  test('is offered on first visit and can be skipped for good', async ({ page, request }) => {
    await setOnboarded(request, false);
    await page.goto('/');
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole('heading', { name: 'Welcome to JScout' })).toBeVisible();

    await page.getByRole('button', { name: 'Skip setup' }).click();
    await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible();
    expect((await getProfile(request)).onboardedAt).not.toBeNull();

    // Even in a new session, setup is not offered again.
    await page.evaluate('window.sessionStorage.clear()');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible();
    await expect(page).not.toHaveURL(/welcome/);
  });

  test('reads a résumé, saves preferences and opens a search built from the profile', async ({ page, request }) => {
    await setOnboarded(request, false);
    await request.delete('/api/profile/resume');
    // Start from an empty profile: tests share one server.
    await patchProfile(request, { personal: { fullName: '' }, preferences: { locations: [], targetTitles: [] } });
    await page.goto('/welcome');
    await page.getByRole('button', { name: 'Get started' }).click();

    await page.getByRole('button', { name: 'Paste text instead' }).click();
    await page.getByRole('textbox', { name: 'Paste your résumé' }).fill(RESUME);
    await page.getByRole('button', { name: 'Read this text' }).click();
    await expect(page.getByRole('heading', { name: 'Here is what JScout found' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Jordan Rivera');
    await expect(page.getByRole('button', { name: 'Software Engineer', pressed: true })).toBeVisible();
    await page.getByRole('button', { name: 'Use these' }).click();

    await expect(page.getByRole('heading', { name: 'What are you looking for?' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Locations' }).fill('Austin');
    await page.getByRole('option', { name: 'Austin, TX' }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    // The companies step keeps what is already followed; nothing changes when moving on.
    await expect(page.getByRole('heading', { name: 'Which companies should JScout follow?' })).toBeVisible();
    await expect(page.getByText(/companies selected/)).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByRole('heading', { name: 'You’re all set' })).toBeVisible();
    await expect(page.getByText(/^Résumé added/)).toBeVisible();
    await page.getByRole('button', { name: 'Start searching' }).click();

    await expect(page).toHaveURL(/q=Software\+Engineer/);
    await expect(page.getByRole('combobox', { name: 'Where: city, region or country' })).toHaveValue('Austin, TX');
    await expect(results(page).getByRole('article').first()).toBeVisible();

    const profile = await getProfile(request);
    expect(profile.onboardedAt).not.toBeNull();
    expect(profile.personal.fullName).toBe('Jordan Rivera');
    expect(profile.preferences.locations).toEqual(['Austin, TX']);
    expect(profile.preferences.targetTitles).toContain('Software Engineer');
    expect(profile.resume?.text).toContain('Brightline Analytics');
  });
});
