import { expect, test } from '@playwright/test';
import { fakeSmtp } from '../../src/server/features/apply/testing';
import { deleteApplications, patchProfile, resultCard, setOnboarded } from './support/app';

const TITLE = 'Orbital Dynamics Engineer';
let smtp: Awaited<ReturnType<typeof fakeSmtp>>;

test.beforeEach(async ({ request }) => {
  smtp = await fakeSmtp({ password: 'app-pass' });
  await setOnboarded(request, true);
  await deleteApplications(request, TITLE);
  await patchProfile(request, {
    personal: { fullName: 'Maya Chen', email: 'maya.chen@example.org' },
    work: { summary: 'Flight dynamics engineer with five years of orbit determination and mission design work.' },
  });
  await request.put('/api/profile/resume/text', { data: { text: 'MAYA CHEN\nOrbital mechanics, Python, C++.' } });
});

// Tests share one server: leave the profile and settings as the other specs expect them.
test.afterEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { email: null } });
  await request.delete('/api/profile/resume');
  await patchProfile(request, { personal: { fullName: '', email: '' }, work: { summary: '' } });
  await deleteApplications(request, TITLE);
  await smtp.close();
});

test('applies by email from the job page and tracks the application', async ({ page, request }) => {
  const account = await request.patch('/api/settings', {
    data: { email: { host: '127.0.0.1', port: smtp.port, secure: false, fromAddress: 'maya@example.net', password: 'app-pass' } },
  });
  expect(account.ok()).toBe(true);

  await page.goto(`/search?q=${encodeURIComponent(TITLE)}`);
  await resultCard(page, TITLE).click();
  await page.getByRole('button', { name: 'Apply by email' }).click();

  const dialog = page.getByRole('dialog', { name: 'Apply by email' });
  await expect(dialog.getByLabel('To')).toHaveValue('jobs@lumen-orbital.example');
  // The posting asked for this subject line.
  await expect(dialog.getByLabel('Subject')).toHaveValue('Orbital Dynamics Engineer');
  await expect(dialog.getByLabel('Message')).toHaveValue(/^Dear Lumen Orbital hiring team,/);
  await expect(dialog.getByText(/Attach my résumé: Maya Chen Resume\.txt/)).toBeVisible();

  // A template placeholder left in the message blocks sending until it is filled in.
  const message = dialog.getByLabel('Message');
  const letter = await message.inputValue();
  await message.fill(`${letter}\n[Your earliest start date]`);
  await expect(dialog.getByText('Fill in or delete “[Your earliest start date]” before sending.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send application' })).toBeDisabled();
  await message.fill(letter);

  await dialog.getByRole('button', { name: 'Send application' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Send application' }).click();
  await expect(dialog.getByRole('status')).toContainText('Sent to jobs@lumen-orbital.example');

  expect(smtp.received).toHaveLength(1);
  expect(smtp.received[0]!.to).toEqual(['<jobs@lumen-orbital.example>']);
  expect(smtp.received[0]!.data).toContain('Subject: Orbital Dynamics Engineer');
  expect(smtp.received[0]!.data).toContain('filename="Maya Chen Resume.txt"');

  await dialog.getByRole('link', { name: 'Open in tracker' }).click();
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(page.getByText('Applied by email to jobs@lumen-orbital.example')).toBeVisible();
});

test('offers to set up an account, or to open the email in your own mail app', async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent(TITLE)}`);
  await resultCard(page, TITLE).click();
  await page.getByRole('button', { name: 'Apply by email' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply by email' });
  await expect(dialog.getByRole('link', { name: 'Settings → Sending applications' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send application' })).toBeDisabled();
  await expect(dialog.getByRole('link', { name: 'Open in my email app' })).toHaveAttribute('href', /^mailto:jobs%40lumen-orbital\.example\?subject=Orbital%20Dynamics%20Engineer&body=Dear/);
});
