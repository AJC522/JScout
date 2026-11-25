import { expect, test } from '@playwright/test';
import { resultCard, results, setOnboarded } from './support/app';

test.beforeEach(async ({ request }) => {
  await setOnboarded(request, true);
});

test.describe('search', () => {
  test('finds same-role titles nearby, and stops when similar titles are switched off', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'What: job title or keywords' }).fill('software engineer');
    await page.getByRole('combobox', { name: 'Where: city, region or country' }).fill('Austin');
    await page.getByRole('option', { name: 'Austin, TX' }).click();
    // The distance choice appears once the place is a city.
    await page.getByRole('combobox', { name: 'Distance from the city' }).selectOption({ label: 'Within 50 km' });
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(resultCard(page, 'Software Engineer').first()).toBeVisible();
    // "Software Developer" in Round Rock, 25 km away: a synonym within the radius.
    await expect(resultCard(page, 'Software Developer')).toBeVisible();
    // A remote job open only to people in Germany is not offered to someone in Austin.
    await expect(results(page).getByText('Initech')).toHaveCount(0);

    await page.getByRole('switch', { name: 'Similar titles' }).click();
    await expect(resultCard(page, 'Software Developer')).toHaveCount(0);
    await expect(resultCard(page, 'Software Engineer').first()).toBeVisible();
  });

  test('keeps title words apart: "accountant" does not find account executives', async ({ page }) => {
    await page.goto('/?q=accountant');
    await expect(resultCard(page, 'Senior Accountant')).toBeVisible();
    await expect(resultCard(page, 'Account Executive')).toHaveCount(0);
  });

  test('filters by work arrangement and facet, and widens a search that finds nothing', async ({ page }) => {
    await page.goto('/?q=software+engineer&l=Austin%2C+TX&r=50');
    await expect(resultCard(page, 'SWE, Platform')).toBeVisible();

    const seniority = page.getByRole('complementary', { name: 'Filters' }).getByRole('group', { name: 'Seniority' });
    // Facet boxes reflect the URL, which updates a moment after the click (so no check()).
    await seniority.getByRole('checkbox', { name: /^Senior \d/ }).click();
    await expect(page).toHaveURL(/sen=senior/);
    await expect(seniority.getByRole('checkbox', { name: /^Senior \d/ })).toBeChecked();
    await expect(resultCard(page, 'Senior Software Engineer')).toBeVisible();
    await expect(resultCard(page, 'Software Developer')).toHaveCount(0);
    await seniority.getByRole('checkbox', { name: /^Senior \d/ }).click();
    await expect(page).not.toHaveURL(/sen=/);

    await page.getByRole('search').getByRole('group', { name: 'Work arrangement' }).getByRole('button', { name: 'On-site' }).click();
    await expect(page).toHaveURL(/wm=onsite/);
    await expect(resultCard(page, 'SWE, Platform')).toHaveCount(0);
    await expect(resultCard(page, 'Senior Software Engineer')).toHaveCount(0);
    await expect(resultCard(page, 'Software Developer')).toBeVisible();

    // No exact title in the city itself once similar titles are off: offer ways to widen.
    await page.goto('/?q=software+developer&l=Austin%2C+TX&wm=onsite&syn=0');
    await expect(page.getByRole('heading', { name: 'No jobs match all of that yet' })).toBeVisible();
    await page.getByRole('button', { name: /Include similar titles/ }).click();
    await expect(page).not.toHaveURL(/syn=0/);
    await expect(resultCard(page, 'Software Engineer').first()).toBeVisible();
  });
});
