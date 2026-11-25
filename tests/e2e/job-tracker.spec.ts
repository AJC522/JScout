import { expect, test } from '@playwright/test';
import type { Application } from '../../src/shared/types';
import { deleteApplications, resultCard, setOnboarded } from './support/app';

const TITLE = 'Node.js Engineer';

test.beforeEach(async ({ request }) => {
  await setOnboarded(request, true);
  await deleteApplications(request, TITLE);
});

test('opens a job, saves it to the tracker and moves it to Applied', async ({ page, request }) => {
  await page.goto('/?q=node.js');
  await resultCard(page, TITLE).getByRole('link', { name: TITLE }).click();

  const detail = page.getByRole('main').getByRole('article').filter({ has: page.getByRole('tablist', { name: 'Job sections' }) });
  await expect(detail.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(detail.getByRole('region', { name: 'Why this job' })).toBeVisible();

  await detail.getByRole('tab', { name: 'Apply kit' }).click();
  await expect(detail.getByRole('tab', { name: 'Fit' })).toBeVisible();

  await detail.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail.getByRole('link', { name: 'Saved' })).toBeVisible();

  await page.goto('/tracker');
  const saved = page.getByRole('region', { name: 'Saved' });
  const applied = page.getByRole('region', { name: 'Applied' });
  await expect(saved.getByRole('link', { name: TITLE })).toBeVisible();

  // Drag the card by its handle onto the Applied column.
  const handle = saved.getByRole('button', { name: `Move ${TITLE}` });
  const from = (await handle.boundingBox())!;
  const to = (await applied.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 15 });
  await page.mouse.up();

  await expect(applied.getByRole('link', { name: TITLE })).toBeVisible();
  await expect(saved.getByRole('link', { name: TITLE })).toHaveCount(0);
  const apps = (await (await request.get('/api/applications')).json()) as Application[];
  const app = apps.find((a) => a.job.title === TITLE);
  expect(app).toMatchObject({ status: 'applied' });
  expect(app?.appliedAt).toBeTruthy();
});
