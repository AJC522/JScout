import { expect, test } from '@playwright/test';
import type { Application, JobPosting, SearchResponse } from '../../src/shared/types';
import { deleteApplications, setOnboarded } from './support/app';

const RESUME = `Maya Chen
Austin, TX | maya.chen@example.com | (512) 555-0134

EXPERIENCE

Software Engineer, Brightline Health
Mar 2021 – Present
- Responsible for maintaining the internal admin dashboard used by support staff
- Built a claims payment service in TypeScript and Node.js that processes $40M a month
- Maintained Python and SQL scripts that reconcile nightly payment files

Junior Developer, Cobalt Labs
Jun 2018 – Feb 2021
- Helped build React dashboards for enterprise customers

EDUCATION
University of Texas at Austin, BS in Computer Science, 2018

SKILLS
React, TypeScript, Node.js, PostgreSQL, AWS, Python, SQL
`;

const JOB_TITLE = 'Node.js Engineer';

test.beforeEach(async ({ request }) => {
  await setOnboarded(request, true);
  const res = await request.put('/api/profile/resume/text', { data: { text: RESUME } });
  expect(res.ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  await request.delete('/api/profile/resume');
  await deleteApplications(request, JOB_TITLE);
});

test('reviews the résumé against a pasted job, tailors it and scores the draft', async ({ page }) => {
  await page.goto('/resume');
  await page.getByRole('radio', { name: 'Paste a job' }).click();
  await page.getByLabel('Job title').fill('Data Engineer');
  await page.getByLabel('Company').fill('Northwind');
  await page.getByLabel('Job description').fill(`We are hiring a Data Engineer to build our payments data platform.

Requirements
• 4+ years of experience with Python and SQL
• Experience with Airflow or dbt
• Bachelor's degree in Computer Science or a related field

Nice to have
• Terraform`);
  await page.getByRole('button', { name: 'Review against this job' }).click();

  const review = page.getByRole('main');
  await expect(review.getByRole('heading', { name: /Data Engineer/ })).toBeVisible();
  await expect(review.getByRole('img', { name: /Résumé match \d+ out of 100/ }).first()).toBeVisible();
  // Requirements are checked one by one, with the résumé line that shows them.
  await expect(review.getByText('4+ years of experience with Python and SQL', { exact: true })).toBeVisible();
  await expect(review.getByText('Shown in: “Maintained Python and SQL scripts that reconcile nightly payment files”')).toBeVisible();
  await expect(review.getByText('Experience with Airflow or dbt', { exact: true })).toBeVisible();
  await expect(review.getByText('Start 2 bullets with an action verb')).toBeVisible();

  await review.getByRole('button', { name: 'Create tailored draft' }).click();
  await expect(review.getByText(/This draft scores \d+/)).toBeVisible();
  const draft = review.getByLabel('Your tailored résumé');
  await expect(draft).toHaveValue(/- Maintained the internal admin dashboard used by support staff/);
  await expect(draft).toHaveValue(/Built a claims payment service/);
  await expect(review.getByRole('radio', { name: /Your draft/ })).toBeChecked();

  // Editing the draft asks for a fresh score.
  await draft.fill(`${await draft.inputValue()}\nAirflow`);
  await expect(review.getByText('You have edited the draft since it was scored.')).toBeVisible();
  await review.getByRole('button', { name: 'Check score' }).click();
  await expect(review.getByText(/This draft scores \d+/)).toBeVisible();
});

test('scores applications and saves a tailored résumé to one from its apply kit', async ({ page, request }) => {
  await deleteApplications(request, JOB_TITLE);
  const search = (await (await request.post('/api/search', { data: { q: 'node.js' } })).json()) as SearchResponse;
  const job = search.items.map((i) => i.job).find((j: JobPosting) => j.title === JOB_TITLE)!;
  const created = (await (await request.post('/api/applications', { data: { jobId: job.id } })).json()) as Application;

  await page.goto('/resume');
  const pick = page.getByRole('button', { name: new RegExp(JOB_TITLE) });
  await expect(pick.getByRole('img', { name: /Résumé match \d+ out of 100/ })).toBeVisible();
  await pick.click();
  await expect(page).toHaveURL(new RegExp(`application=${created.id}`));
  await expect(page.getByRole('main').getByRole('heading', { name: new RegExp(JOB_TITLE) })).toBeVisible();

  await page.goto(`/tracker/${created.id}`);
  const kit = page.getByRole('region', { name: 'Apply kit' });
  await kit.getByRole('tab', { name: 'Résumé' }).click();
  await kit.getByRole('button', { name: 'Create tailored draft' }).click();
  await kit.getByRole('button', { name: 'Save to application' }).click();
  await expect(kit.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

  const saved = (await (await request.get(`/api/applications/${created.id}`)).json()) as { documents: Array<{ kind: string; content: string }> };
  expect(saved.documents).toEqual([expect.objectContaining({ kind: 'resume', content: expect.stringContaining('Maya Chen') })]);
  await expect(page.getByText(/^Tailored résumé · from template/)).toBeVisible();
});
