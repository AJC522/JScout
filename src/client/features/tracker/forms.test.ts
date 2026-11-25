import { describe, expect, it } from 'vitest';
import type { Application } from '../../../shared/types';
import { EMPTY_MANUAL_APPLICATION, normalizeUrl, textToHtml, validateManualApplication } from './add-form';
import { nextSort, sortApplications } from './list-sort';

describe('normalizeUrl', () => {
  it('accepts http(s) links and adds https to bare domains', () => {
    expect(normalizeUrl('https://jobs.example.com/1')).toBe('https://jobs.example.com/1');
    expect(normalizeUrl('  jobs.example.com/role?id=3 ')).toBe('https://jobs.example.com/role?id=3');
    expect(normalizeUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
  });

  it('rejects things that are not web addresses', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('ftp://files.example.com')).toBeNull();
    expect(normalizeUrl('https://intranet')).toBeNull();
  });
});

describe('validateManualApplication', () => {
  it('requires title and company and checks the link', () => {
    const result = validateManualApplication({ ...EMPTY_MANUAL_APPLICATION, url: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['company', 'title', 'url']);
  });

  it('builds a create body with trimmed values and an HTML description', () => {
    const result = validateManualApplication({
      ...EMPTY_MANUAL_APPLICATION,
      title: ' Designer ',
      company: 'Acme ',
      url: 'acme.com/jobs/1',
      salaryText: '',
      description: 'Line one\nline two\n\n<b>Second</b> para',
      status: 'applied',
    });
    expect(result).toEqual({
      ok: true,
      body: {
        status: 'applied',
        job: {
          title: 'Designer',
          company: 'Acme',
          url: 'https://acme.com/jobs/1',
          locationText: '',
          descriptionHtml: '<p>Line one<br>line two</p>\n<p>&lt;b&gt;Second&lt;/b&gt; para</p>',
          source: 'manual',
          sourceName: 'Added by you',
        },
      },
    });
  });

  it('allows an empty link', () => {
    const result = validateManualApplication({ ...EMPTY_MANUAL_APPLICATION, title: 'A', company: 'B' });
    expect(result.ok && result.body.job?.url).toBe('');
  });

  it('textToHtml drops empty paragraphs', () => {
    expect(textToHtml('\n\n  \n')).toBe('');
  });
});

describe('list sorting', () => {
  const base = (id: string, extra: Partial<Application>): Application =>
    ({ id, priority: 0, status: 'saved', updatedAt: '2026-11-01T00:00:00.000Z', job: { title: id, company: 'Z' }, ...extra }) as Application;
  const apps = [
    base('b', { appliedAt: '2026-11-03T00:00:00.000Z', priority: 1 }),
    base('a', { priority: 3, status: 'offer' }),
    base('c', { appliedAt: '2026-11-05T00:00:00.000Z', job: { title: 'c', company: 'acme' } as Application['job'] }),
  ];

  it('sorts text case-insensitively and numbers by direction', () => {
    expect(sortApplications(apps, { key: 'title', dir: 'asc' }).map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(sortApplications(apps, { key: 'company', dir: 'asc' }).map((a) => a.id)[0]).toBe('c');
    expect(sortApplications(apps, { key: 'priority', dir: 'desc' }).map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(sortApplications(apps, { key: 'status', dir: 'desc' }).map((a) => a.id)[0]).toBe('a');
  });

  it('keeps rows without a date last in both directions', () => {
    expect(sortApplications(apps, { key: 'appliedAt', dir: 'desc' }).map((a) => a.id)).toEqual(['c', 'b', 'a']);
    expect(sortApplications(apps, { key: 'appliedAt', dir: 'asc' }).map((a) => a.id)).toEqual(['b', 'c', 'a']);
  });

  it('toggles direction on the same column and starts new columns at their natural direction', () => {
    expect(nextSort({ key: 'title', dir: 'asc' }, 'title')).toEqual({ key: 'title', dir: 'desc' });
    expect(nextSort({ key: 'title', dir: 'asc' }, 'updatedAt')).toEqual({ key: 'updatedAt', dir: 'desc' });
  });
});
