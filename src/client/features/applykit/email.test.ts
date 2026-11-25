import { describe, expect, it } from 'vitest';
import { mailtoLink, placeholderIn } from './EmailApplyPanel';

describe('placeholderIn', () => {
  it('finds a template placeholder left in a draft', () => {
    expect(placeholderIn('Dear team,\n\n[A sentence or two about your background.]\n\nMaya')).toBe('[A sentence or two about your background.]');
    expect(placeholderIn('I can start immediately.')).toBeUndefined();
    // Short brackets are ordinary text ("[1]", "[x]").
    expect(placeholderIn('See [1] and [x].')).toBeUndefined();
  });
});

describe('mailtoLink', () => {
  it('encodes the recipients, subject and body for a mail app', () => {
    expect(mailtoLink('jobs@acme.dev, sam@acme.dev', 'Backend Engineer – Maya', 'Dear team,\n\nHello & thanks')).toBe(
      'mailto:jobs%40acme.dev,sam%40acme.dev?subject=Backend%20Engineer%20%E2%80%93%20Maya&body=Dear%20team%2C%0A%0AHello%20%26%20thanks',
    );
  });
});
