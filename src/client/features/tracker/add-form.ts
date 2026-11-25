/** Validation for the "Add application" form (jobs found outside JScout). */
import type { ApplicationCreate } from '../../../shared/api';
import type { ApplicationStatus } from '../../../shared/types';

export interface ManualApplicationValues {
  title: string;
  company: string;
  url: string;
  location: string;
  salaryText: string;
  description: string;
  status: ApplicationStatus;
}

export type ManualApplicationErrors = Partial<Record<'title' | 'company' | 'url', string>>;

export const EMPTY_MANUAL_APPLICATION: ManualApplicationValues = {
  title: '',
  company: '',
  url: '',
  location: '',
  salaryText: '',
  description: '',
  status: 'saved',
};

/**
 * A usable http(s) link from what the user typed, adding "https://" to a bare domain
 * such as "jobs.example.com/123". Null when it cannot be a web address.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // A real host has a dot (or is localhost); this rejects things like "https://foo".
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Pasted plain text as simple paragraphs; the server sanitises descriptions again on save. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export function validateManualApplication(
  values: ManualApplicationValues,
): { ok: true; body: ApplicationCreate } | { ok: false; errors: ManualApplicationErrors } {
  const errors: ManualApplicationErrors = {};
  const title = values.title.trim();
  const company = values.company.trim();
  if (!title) errors.title = 'Add the job title.';
  if (!company) errors.company = 'Add the company name.';
  const url = values.url.trim() ? normalizeUrl(values.url) : '';
  if (url === null) errors.url = 'This does not look like a web address. Paste the full link to the posting.';
  if (Object.keys(errors).length > 0 || url === null) return { ok: false, errors };

  const description = values.description.trim();
  return {
    ok: true,
    body: {
      status: values.status,
      job: {
        title,
        company,
        url,
        locationText: values.location.trim(),
        ...(values.salaryText.trim() ? { salaryText: values.salaryText.trim() } : {}),
        ...(description ? { descriptionHtml: textToHtml(description) } : {}),
        source: 'manual',
        sourceName: 'Added by you',
      },
    },
  };
}
