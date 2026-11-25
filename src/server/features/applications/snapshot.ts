/** Building and editing the job snapshot an application keeps. */
import type { JobPosting, JobSnapshot, Salary } from '../../../shared/types';
import { badRequest } from '../../errors';
import { sanitizeHtml } from '../../lib/html';
import { formatSalary } from '../../lib/salary';
import { toIso } from './rows';
import { isHttpUrl } from './schemas';

export const MANUAL_SOURCE = 'manual';
export const MANUAL_SOURCE_NAME = 'Added manually';

/** Short display string such as "$120k–$150k/yr", "From €50k/yr", or the source's own text; the same wording search results use. */
export function salaryDisplay(salary: Salary | undefined): string | undefined {
  if (!salary) return undefined;
  const text = formatSalary(salary).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 120) : undefined;
}

export function snapshotFromPosting(posting: JobPosting, descriptionHtml: string): JobSnapshot {
  const snapshot: JobSnapshot = {
    title: posting.title,
    company: posting.company,
    locationText: posting.locationText,
    remote: posting.location.remote,
    url: posting.url,
    source: posting.source,
    sourceName: posting.sourceName,
    employmentType: posting.employmentType,
    skills: [...posting.skills],
    descriptionHtml,
  };
  if (posting.applyUrl) snapshot.applyUrl = posting.applyUrl;
  if (posting.clearance) snapshot.clearance = { ...posting.clearance };
  const salaryText = salaryDisplay(posting.salary);
  if (salaryText) snapshot.salaryText = salaryText;
  if (posting.postedAt) snapshot.postedAt = posting.postedAt;
  return snapshot;
}

function checkedUrl(value: string, field: string): string {
  const url = value.trim();
  if (url !== '' && !isHttpUrl(url)) throw badRequest(`${field} must be an http(s) URL`);
  return url;
}

function requiredText(value: string, field: string): string {
  const text = value.trim();
  if (!text) throw badRequest(`${field} is required`);
  return text;
}

/**
 * Apply snapshot edits. '' clears applyUrl and salaryText; a pasted description is
 * sanitised here because it is rendered as HTML.
 */
export function mergeSnapshot(base: JobSnapshot, patch: Partial<JobSnapshot>): JobSnapshot {
  const next: JobSnapshot = { ...base };
  if (patch.title !== undefined) next.title = requiredText(patch.title, 'Job title');
  if (patch.company !== undefined) next.company = requiredText(patch.company, 'Company');
  if (patch.locationText !== undefined) next.locationText = patch.locationText.trim();
  if (patch.remote !== undefined) next.remote = patch.remote;
  if (patch.url !== undefined) next.url = checkedUrl(patch.url, 'url');
  if (patch.applyUrl !== undefined) {
    const applyUrl = checkedUrl(patch.applyUrl, 'applyUrl');
    if (applyUrl) next.applyUrl = applyUrl;
    else delete next.applyUrl;
  }
  if (patch.source !== undefined) next.source = patch.source.trim() || MANUAL_SOURCE;
  if (patch.sourceName !== undefined) next.sourceName = patch.sourceName.trim();
  if (patch.salaryText !== undefined) {
    const salaryText = patch.salaryText.trim();
    if (salaryText) next.salaryText = salaryText;
    else delete next.salaryText;
  }
  if (patch.employmentType !== undefined) next.employmentType = patch.employmentType;
  if (patch.postedAt !== undefined) next.postedAt = toIso(patch.postedAt, 'postedAt');
  if (patch.skills !== undefined) next.skills = [...new Set(patch.skills.map((s) => s.trim()).filter(Boolean))];
  if (patch.descriptionHtml !== undefined) next.descriptionHtml = sanitizeHtml(patch.descriptionHtml);
  return next;
}

/** Snapshot for a job the user typed in by hand. */
export function manualSnapshot(job: Partial<JobSnapshot> & { title: string; company: string }): JobSnapshot {
  const base: JobSnapshot = {
    title: '',
    company: '',
    locationText: '',
    remote: 'unknown',
    url: '',
    source: MANUAL_SOURCE,
    sourceName: MANUAL_SOURCE_NAME,
    employmentType: 'unknown',
    skills: [],
    descriptionHtml: '',
  };
  return mergeSnapshot(base, job);
}
