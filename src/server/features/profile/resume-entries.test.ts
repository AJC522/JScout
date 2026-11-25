import { describe, expect, it } from 'vitest';
import { parseExperience } from './resume-entries';

const NOW = new Date('2026-11-25T00:00:00.000Z');
const job = (line: string) => {
  const [first] = parseExperience([line, '- Built things'], NOW);
  return { title: first?.entry.title, company: first?.entry.company, location: first?.entry.location };
};

describe('parseExperience with the real gazetteer', () => {
  it('reads "Title, Company, City" with the city as the place, also when the city is also a state', () => {
    expect(job('Senior Software Engineer, Brightline Analytics, Berlin   Mar 2021 - Present')).toEqual({
      title: 'Senior Software Engineer', company: 'Brightline Analytics', location: 'Berlin',
    });
    expect(job('Financial Analyst, Goldman Sachs, New York   2019 - 2021')).toEqual({ title: 'Financial Analyst', company: 'Goldman Sachs', location: 'New York' });
    expect(job('Software Engineer, Stripe, California   2018 - 2019')).toEqual({ title: 'Software Engineer', company: 'Stripe', location: 'California' });
    expect(job('Data Analyst, Zalando, Hamburg   2013 - 2014')).toEqual({ title: 'Data Analyst', company: 'Zalando', location: 'Hamburg' });
    expect(job('Product Manager, Acme Corp, London   2017 - 2018')).toEqual({ title: 'Product Manager', company: 'Acme Corp', location: 'London' });
  });

  it('keeps "City, Region" places and team names as they were', () => {
    expect(job('Software Engineer, Zalando, Berlin, Germany   2016 - 2017')).toEqual({ title: 'Software Engineer', company: 'Zalando', location: 'Berlin, Germany' });
    expect(job('Engineer, Acme, Smallville, KS   2015 - 2016')).toEqual({ title: 'Engineer', company: 'Acme', location: 'Smallville, KS' });
    expect(job('Product Manager, Mobile   2014 - 2015').location).toBe('');
  });
});
