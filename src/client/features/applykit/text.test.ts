import { describe, expect, it } from 'vitest';
import type { QuickFillField } from '../../../shared/types';
import { answerTitle, groupQuickFill, wordCount } from './text';

describe('wordCount', () => {
  it('counts words across whitespace and newlines', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
    expect(wordCount('Dear team,\n\nI am  writing')).toBe(5);
  });
});

describe('groupQuickFill', () => {
  it('groups in a fixed order and drops empty groups', () => {
    const f = (key: string, group: QuickFillField['group']): QuickFillField => ({ key, label: key, value: key, group });
    const groups = groupQuickFill([f('linkedin', 'links'), f('email', 'contact'), f('phone', 'contact'), f('auth', 'other')]);
    expect(groups.map((g) => g.group)).toEqual(['contact', 'links', 'other']);
    expect(groups[0]?.fields.map((x) => x.key)).toEqual(['email', 'phone']);
    expect(groups[0]?.label).toBe('Contact');
  });
});

describe('answerTitle', () => {
  it('cleans and shortens questions', () => {
    expect(answerTitle('  Why   us? ')).toBe('Why us?');
    expect(answerTitle('')).toBe('Answer');
    expect(answerTitle('x'.repeat(100))).toHaveLength(78);
  });
});
