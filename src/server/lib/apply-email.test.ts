import { describe, expect, it } from 'vitest';
import { findApplyEmail, postingApplyEmail } from './apply-email';

const find = (text: string, html = `<p>${text}</p>`) => findApplyEmail(html, text);

describe('findApplyEmail', () => {
  it('finds the address a posting says to send applications to', () => {
    expect(find('To apply, send your résumé and a short note to jobs@acme.dev.')).toEqual({
      address: 'jobs@acme.dev',
      evidence: 'To apply, send your résumé and a short note to jobs@acme.dev.',
      explicit: true,
    });
    expect(find('Please email your CV to hiring@northwind.io')?.address).toBe('hiring@northwind.io');
    expect(find('Applications should be sent to talent@globex.com by December 1.')?.explicit).toBe(true);
  });

  it('reads informal Hacker News style calls to action', () => {
    expect(find('Rust, Postgres, on-call light. Interested? Email jane@acme.dev')).toMatchObject({ address: 'jane@acme.dev', explicit: false });
    expect(find('Apply: careers@initech.com')?.address).toBe('careers@initech.com');
  });

  it('picks up the subject line the posting asks for', () => {
    expect(find('Send your resume to jobs@acme.dev with the subject line "Backend Engineer - HN".')?.subject).toBe('Backend Engineer - HN');
    expect(find('Email jobs@acme.dev. Subject: Data Analyst application')?.subject).toBe('Data Analyst application');
    const html = '<p>Interested in this role? <a href="mailto:jobs@acme.dev?subject=Platform%20Engineer">Apply by email</a>: jobs@acme.dev</p>';
    expect(findApplyEmail(html, 'Interested in this role? Apply by email: jobs@acme.dev')).toMatchObject({ address: 'jobs@acme.dev', subject: 'Platform Engineer' });
  });

  it('leaves addresses for other purposes alone', () => {
    expect(find('If you need a reasonable accommodation to apply, email accommodations@acme.dev.')).toBeUndefined();
    expect(find('Questions about our privacy notice? Write to privacy@acme.dev.')).toBeUndefined();
    expect(find('Report suspected recruitment fraud to security@acme.dev.')).toBeUndefined();
    expect(find('Recruiters and agencies: please do not email hr@acme.dev.')).toBeUndefined();
    expect(find('Our office address is 1 Main St. Contact info@acme.dev for press.')).toBeUndefined();
    expect(find('We build tools for teams. Our founder writes at founder@acme.dev about design.')).toBeUndefined();
  });

  it('prefers the explicit address when there are several', () => {
    const text = 'Questions about the role? Ask sam@acme.dev.\nTo apply, send your resume to jobs@acme.dev.';
    expect(findApplyEmail(`<p>${text}</p>`, text)?.address).toBe('jobs@acme.dev');
  });
});

describe('postingApplyEmail', () => {
  it('needs an explicit statement on employer job boards, which have their own form', () => {
    const vague = '<p>Questions about your application? Contact recruiting@acme.dev.</p>';
    expect(postingApplyEmail(vague, { hasForm: false })?.address).toBe('recruiting@acme.dev');
    expect(postingApplyEmail(vague, { hasForm: true })).toBeUndefined();
    expect(postingApplyEmail('<p>To apply, email your resume to recruiting@acme.dev.</p>', { hasForm: true })?.address).toBe('recruiting@acme.dev');
    expect(postingApplyEmail('', { hasForm: false })).toBeUndefined();
  });
});
