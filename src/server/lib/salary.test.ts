import { describe, expect, it } from 'vitest';
import type { Salary } from '../../shared/types';
import { annualize, extractSalaryFromText, formatSalary, normalizeSalary, parseSalaryText } from './salary';

type Expect = Partial<Salary>;

/** min/max/currency/period of a result, for compact assertions. */
function core(s: Salary | undefined): Expect | undefined {
  if (!s) return undefined;
  const out: Expect = {};
  if (s.min !== undefined) out.min = s.min;
  if (s.max !== undefined) out.max = s.max;
  if (s.currency !== undefined) out.currency = s.currency;
  if (s.period !== undefined) out.period = s.period;
  return out;
}

/** Invariants every returned Salary must satisfy. */
function checkInvariants(s: Salary | undefined): void {
  if (!s) return;
  expect(s.min !== undefined || s.max !== undefined).toBe(true);
  for (const v of [s.min, s.max, s.annualMin, s.annualMax]) {
    if (v !== undefined) expect(Number.isFinite(v) && v > 0).toBe(true);
  }
  if (s.min !== undefined && s.max !== undefined) expect(s.min).toBeLessThanOrEqual(s.max);
  if (s.currency !== undefined) expect(s.currency).toMatch(/^[A-Z]{3}$/);
  expect(['year', 'month', 'week', 'day', 'hour']).toContain(s.period);
  if (s.min !== undefined && s.period) expect(s.annualMin).toBeCloseTo(annualize(s.min, s.period), 2);
  if (s.max !== undefined && s.period) expect(s.annualMax).toBeCloseTo(annualize(s.max, s.period), 2);
  const f = formatSalary(s);
  expect(f).not.toMatch(/undefined|NaN|null|Infinity/);
  expect(f.length).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// parseSalaryText
// ---------------------------------------------------------------------------

describe('parseSalaryText: documented examples', () => {
  it.each<[string, Expect]>([
    ['$120k – $150k', { min: 120000, max: 150000, currency: 'USD', period: 'year' }],
    ['$120,000-$150,000 a year', { min: 120000, max: 150000, currency: 'USD', period: 'year' }],
    ['USD 100,000+', { min: 100000, currency: 'USD', period: 'year' }],
    ['up to £65,000 per annum', { max: 65000, currency: 'GBP', period: 'year' }],
    ['€60-70K', { min: 60000, max: 70000, currency: 'EUR', period: 'year' }],
    ['60.000 € – 75.000 €', { min: 60000, max: 75000, currency: 'EUR', period: 'year' }],
    ['CA$95,000', { min: 95000, max: 95000, currency: 'CAD', period: 'year' }],
    ['A$120k', { min: 120000, max: 120000, currency: 'AUD', period: 'year' }],
    ['₹18-25 LPA', { min: 1800000, max: 2500000, currency: 'INR', period: 'year' }],
    ['$45/hr', { min: 45, max: 45, currency: 'USD', period: 'hour' }],
    ['$40 - $55 per hour', { min: 40, max: 55, currency: 'USD', period: 'hour' }],
    ['£450 per day', { min: 450, max: 450, currency: 'GBP', period: 'day' }],
    ['$8,000/month', { min: 8000, max: 8000, currency: 'USD', period: 'month' }],
    ['120k-150k', { min: 120000, max: 150000, period: 'year' }],
    ['$150K + equity + bonus', { min: 150000, max: 150000, currency: 'USD', period: 'year' }],
    ['From $90,000', { min: 90000, currency: 'USD', period: 'year' }],
  ])('%j', (text, expected) => {
    const r = parseSalaryText(text);
    expect(core(r)).toEqual(expected);
    expect(r?.text).toBe(text);
    checkInvariants(r);
  });

  it('"Competitive" and other non-salaries -> undefined', () => {
    for (const t of ['Competitive', 'Competitive salary', 'DOE', 'Negotiable', '', '   ', '2026', '150 employees', '3 years experience', '10', '7-figure', '401(k) match up to 6%', '$2k sign-on bonus', 'Up to $10,000 bonus', '50 employees, $10M ARR', '$100 per 30-second video', '$0.10/word']) {
      expect(parseSalaryText(t), t).toBeUndefined();
    }
  });

  it('fills annualMin/annualMax and keeps text', () => {
    expect(parseSalaryText('$40 - $55 per hour')).toEqual({
      min: 40, max: 55, currency: 'USD', period: 'hour', annualMin: 83200, annualMax: 114400, text: '$40 - $55 per hour',
    });
    expect(parseSalaryText('  $8,000/month ')).toEqual({
      min: 8000, max: 8000, currency: 'USD', period: 'month', annualMin: 96000, annualMax: 96000, text: '$8,000/month',
    });
    expect(parseSalaryText('USD 100,000+')).toEqual({ min: 100000, currency: 'USD', period: 'year', annualMin: 100000, text: 'USD 100,000+' });
    expect(parseSalaryText('up to £65,000 per annum')).toEqual({ max: 65000, currency: 'GBP', period: 'year', annualMax: 65000, text: 'up to £65,000 per annum' });
  });
});

describe('parseSalaryText: period inference by magnitude', () => {
  it.each<[string, Expect['period']]>([
    ['$45', 'hour'],
    ['$499', 'hour'],
    ['$500', 'day'],
    ['$1,500', 'day'],
    ['$1,999', 'day'],
    ['$2k', 'year'], // a k-suffix means yearly... and is then rejected below the bounds (tested separately)
    ['$1.5k', 'year'],
    ['$60,000', 'year'],
    ['$2,000', 'year'],
  ])('%j -> %s', (text, period) => {
    const r = parseSalaryText(text);
    if (period === 'year' && (r?.annualMin ?? 0) < 5000) {
      expect(r).toBeUndefined();
      return;
    }
    expect(r?.period).toBe(period);
  });

  it('explicit unit wins over magnitude', () => {
    expect(parseSalaryText('$5,000 per month')?.period).toBe('month');
    expect(parseSalaryText('$150/day')?.period).toBe('day');
    expect(parseSalaryText('$40,000 annually')?.period).toBe('year');
    expect(parseSalaryText('$90 per year')).toBeUndefined(); // explicit but implausible
  });
});

describe('parseSalaryText: currencies', () => {
  it.each<[string, string | undefined, string | undefined]>([
    ['US$120k', undefined, 'USD'],
    ['USD$100,000', undefined, 'USD'],
    ['CA$90,000', undefined, 'CAD'],
    ['C$90,000', undefined, 'CAD'],
    ['A$150k', undefined, 'AUD'],
    ['AU$150k', undefined, 'AUD'],
    ['NZ$100k', undefined, 'NZD'],
    ['S$8,000/month', undefined, 'SGD'],
    ['HK$50,000 per month', undefined, 'HKD'],
    ['£45,000', undefined, 'GBP'],
    ['€55k', undefined, 'EUR'],
    ['120k €', undefined, 'EUR'],
    ['¥8,000,000', undefined, 'JPY'],
    ['¥8,000,000', 'JP', 'JPY'],
    ['¥300,000/month', 'CN', 'CNY'],
    ['₹12,00,000', undefined, 'INR'],
    ['R$12.000 por mês', undefined, 'BRL'],
    ['CHF 120000', undefined, 'CHF'],
    ['120 000 CHF', undefined, 'CHF'],
    ['kr 600 000', 'SE', 'SEK'],
    ['600 000 kr', 'NO', 'NOK'],
    ['600 000 kr', 'DK', 'DKK'],
    ['kr 600 000', undefined, undefined], // "kr" without a Nordic country is ambiguous
    ['10 000 zł miesięcznie', 'PL', 'PLN'],
    ['R 600,000', 'ZA', 'ZAR'],
    ['R 600,000', undefined, undefined], // bare "R" only means rand in South Africa
    ['R 600,000', 'US', 'USD'], // ... otherwise the country default applies
    ['$100k', undefined, 'USD'],
    ['$100k', 'US', 'USD'],
    ['$100k', 'CA', 'CAD'],
    ['$100k', 'AU', 'AUD'],
    ['$100k', 'NZ', 'NZD'],
    ['$100k', 'SG', 'SGD'],
    ['$100k', 'HK', 'HKD'],
    ['$100k', 'MX', 'MXN'],
    ['$100k', 'GB', 'USD'], // "$" is never the local currency in the UK
    ['$100k', 'ca', 'CAD'], // country codes are case-insensitive
    ['US$100k', 'CA', 'USD'], // explicit symbol beats country
    ['100,000', 'GB', 'GBP'], // no currency: obvious country default
    ['120.000', 'DE', 'EUR'],
    ['100000', undefined, undefined], // no currency, no country: unknown
    ['120 000 EUR', undefined, 'EUR'],
    ['JPY 6M-9M', undefined, 'JPY'],
    ['50K – 60K GBP', undefined, 'GBP'],
    ['$16-$24/h USD', undefined, 'USD'],
  ])('%j (country %s) -> %s', (text, country, currency) => {
    const r = parseSalaryText(text, country ? { country } : {});
    expect(r, text).toBeDefined();
    expect(r?.currency).toBe(currency);
    checkInvariants(r);
  });
});

describe('parseSalaryText: number formats', () => {
  it.each<[string, Expect]>([
    ['$120,000', { min: 120000, max: 120000 }],
    ['€120.000', { min: 120000, max: 120000 }],
    ['$ 120 000', { min: 120000, max: 120000 }],
    ['CHF 120\'000 – 140\'000', { min: 120000, max: 140000 }],
    ['$120k', { min: 120000, max: 120000 }],
    ['$120K', { min: 120000, max: 120000 }],
    ['$1.2M', { min: 1200000, max: 1200000 }],
    ['$85.5k', { min: 85500, max: 85500 }],
    ['$45.50/hr', { min: 45.5, max: 45.5 }],
    ['$35,3k- $52k', { min: 35300, max: 52000 }],
    ['$75,000.00 - $95,000.00', { min: 75000, max: 95000 }],
    ['€ 60.000,00 - 70.000,00', { min: 60000, max: 70000 }],
    ['$75.000,00', { min: 75000, max: 75000 }],
    ['₹12,00,000', { min: 1200000, max: 1200000 }],
    ['$120,000-$150,000', { min: 120000, max: 150000 }],
    ['$120,000 – $150,000', { min: 120000, max: 150000 }],
    ['$120,000 — $150,000', { min: 120000, max: 150000 }],
    ['$120,000 to $150,000', { min: 120000, max: 150000 }],
    ['between $25 and $30 per hour', { min: 25, max: 30 }],
    ['$120k+', { min: 120000 }],
    ['$120,000 +', { min: 120000 }],
    ['up to $90k', { max: 90000 }],
    ['max $90k', { max: 90000 }],
    ['Maximum: $90,000', { max: 90000 }],
    ['from $60,000', { min: 60000 }],
    ['starting at $60,000', { min: 60000 }],
    ['min $50k', { min: 50000 }],
    ['₹25 lakh', { min: 2500000, max: 2500000 }],
    ['₹25 lakhs per annum', { min: 2500000, max: 2500000 }],
    ['₹1.2 Cr per annum', { min: 12000000, max: 12000000 }],
    ['12 LPA', { min: 1200000, max: 1200000 }],
    ['₹8-12 LPA', { min: 800000, max: 1200000 }],
  ])('%j', (text, expected) => {
    const r = parseSalaryText(text);
    expect(r).toMatchObject(expected);
    if (expected.max === undefined) expect(r?.max).toBeUndefined();
    if (expected.min === undefined) expect(r?.min).toBeUndefined();
    checkInvariants(r);
  });
});

describe('parseSalaryText: periods', () => {
  it.each<[string, Expect['period']]>([
    ['$90,000 per year', 'year'],
    ['$90,000 per annum', 'year'],
    ['$90,000 annually', 'year'],
    ['$90,000/yr', 'year'],
    ['$90,000 a year', 'year'],
    ['£45,000 pa', 'year'],
    ['€55k p.a.', 'year'],
    ['£45,000 p/a', 'year'],
    ['$150k OTE', 'year'],
    ['OTE $200,000', 'year'],
    ['$5,000 per month', 'month'],
    ['$5000/mo', 'month'],
    ['$5000 monthly', 'month'],
    ['£2,500 pcm', 'month'],
    ['EUR 4.500 brutto/Monat', 'month'],
    ['4.500 € monatlich', 'month'],
    ['R$12.000 por mês', 'month'],
    ['3 500 € par mois', 'month'],
    ['$1,200 per week', 'week'],
    ['$1,200/wk', 'week'],
    ['$1,200 weekly', 'week'],
    ['$300 per day', 'day'],
    ['$300 daily', 'day'],
    ['£500 p/d', 'day'],
    ['£500 day rate', 'day'],
    ['$40 per hour', 'hour'],
    ['$40/hr', 'hour'],
    ['$40 hourly', 'hour'],
    ['$40/h', 'hour'],
    ['$65 - $85 /h', 'hour'],
    ['£12.50 ph', 'hour'],
    ['60 € pro Stunde', 'hour'],
    ['65.000 € brutto jährlich', 'year'],
    ['55 000 € par an', 'year'],
  ])('%j -> %s', (text, period) => {
    const r = parseSalaryText(text);
    expect(r?.period).toBe(period);
    checkInvariants(r);
  });

  it('does not take bi-weekly or semi-monthly as weekly/monthly', () => {
    expect(parseSalaryText('$90,000, paid bi-weekly')?.period).toBe('year');
    expect(parseSalaryText('$90,000, paid semi-monthly')?.period).toBe('year');
  });
});

describe('parseSalaryText: sanity', () => {
  it('swaps inverted ranges', () => {
    expect(core(parseSalaryText('$150,000 - $120,000'))).toEqual({ min: 120000, max: 150000, currency: 'USD', period: 'year' });
    expect(core(parseSalaryText('$150-120k'))).toEqual({ min: 120000, max: 150000, currency: 'USD', period: 'year' });
  });

  it('applies a one-sided k/M/LPA multiplier to both bounds', () => {
    expect(core(parseSalaryText('120-150k'))).toEqual({ min: 120000, max: 150000, period: 'year' });
    expect(core(parseSalaryText('$90 - 110k'))).toEqual({ min: 90000, max: 110000, currency: 'USD', period: 'year' });
    expect(core(parseSalaryText('$120k-150'))).toEqual({ min: 120000, max: 150000, currency: 'USD', period: 'year' });
    expect(core(parseSalaryText('£35-40k'))).toEqual({ min: 35000, max: 40000, currency: 'GBP', period: 'year' });
    expect(core(parseSalaryText('JPY 6-9M'))).toEqual({ min: 6000000, max: 9000000, currency: 'JPY', period: 'year' });
    // Grouped numbers are complete on their own and never multiplied.
    expect(core(parseSalaryText('$90,000 - 110k'))).toEqual({ min: 90000, max: 110000, currency: 'USD', period: 'year' });
  });

  it('rejects implausible results (annualised outside 5,000-5,000,000)', () => {
    for (const t of ['$10,000,000', '$999,999,999', '$1/hr', '$50/year', '$200,000/hr', '$0 - $0', 'Salary: $0', '$2026', '$3,000/year', '$1 - $100,000']) {
      expect(parseSalaryText(t), t).toBeUndefined();
    }
    expect(parseSalaryText('$4,999 per year')).toBeUndefined();
    expect(parseSalaryText('$5,000 per year')?.annualMin).toBe(5000);
    expect(parseSalaryText('$5,000,000')?.annualMax).toBe(5000000);
    expect(parseSalaryText('$5,000,001')).toBeUndefined();
  });

  it('scales the bounds for low-value currencies instead of rejecting real salaries', () => {
    expect(core(parseSalaryText('¥ 6,000,000 - 9,000,000'))).toEqual({ min: 6000000, max: 9000000, currency: 'JPY', period: 'year' });
    expect(core(parseSalaryText('₹1.2 Cr per annum'))).toMatchObject({ min: 12000000, currency: 'INR' });
    expect(parseSalaryText('₹3,000 per year')).toBeUndefined();
  });

  it('ignores equity/bonus/benefit amounts but keeps them in text', () => {
    const r = parseSalaryText('$80k-$100k + equity + 401(k) + $10k signing bonus');
    expect(core(r)).toEqual({ min: 80000, max: 100000, currency: 'USD', period: 'year' });
    expect(r?.text).toBe('$80k-$100k + equity + 401(k) + $10k signing bonus');
    expect(core(parseSalaryText('$60–80k, plus bonus'))).toEqual({ min: 60000, max: 80000, currency: 'USD', period: 'year' });
    expect(core(parseSalaryText('Bonus: $20,000. Salary: $120,000'))).toMatchObject({ min: 120000, max: 120000 });
    expect(core(parseSalaryText('OTE $150K+ uncapped'))).toEqual({ min: 150000, currency: 'USD', period: 'year' });
    // "+ commission" adds to the amount; it does not make it open-ended.
    expect(core(parseSalaryText('$150K + uncapped commission'))).toEqual({ min: 150000, max: 150000, currency: 'USD', period: 'year' });
  });

  it('is not fooled by years, headcounts, durations and identifiers', () => {
    expect(core(parseSalaryText('2026: $90,000'))).toMatchObject({ min: 90000 });
    expect(core(parseSalaryText('2 openings - $80,000'))).toMatchObject({ min: 80000, max: 80000 });
    expect(core(parseSalaryText('Level 3 - $120,000'))).toMatchObject({ min: 120000, max: 120000 });
    expect(parseSalaryText('40 hours per week')).toBeUndefined();
    expect(parseSalaryText('Q4 2026')).toBeUndefined();
    expect(parseSalaryText('H1B sponsorship')).toBeUndefined();
    expect(parseSalaryText('24/7')).toBeUndefined();
    expect(parseSalaryText('99.9%')).toBeUndefined();
    // Lower-case words that happen to be ISO codes are not currencies in free text.
    expect(extractSalaryFromText('We pay you to try 100 recipes a month.')).toBeUndefined();
    expect(parseSalaryText('try 100 times')).toBeUndefined();
    expect(core(parseSalaryText('100,000 usd'))).toEqual({ min: 100000, max: 100000, period: 'year' });
    expect(normalizeSalary({ min: 100000, currency: 'usd' })?.currency).toBe('USD');
  });

  it('never throws on hostile input', () => {
    for (const t of [null, undefined, 42, {}, '$'.repeat(10000), '9'.repeat(5000), '$1'.repeat(3000), '\u0000$100k', `${'1,'.repeat(1000)}000`]) {
      expect(() => parseSalaryText(t as never)).not.toThrow();
      checkInvariants(parseSalaryText(t as never));
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeSalary
// ---------------------------------------------------------------------------

describe('normalizeSalary', () => {
  it('uses structured numbers and fills annual figures', () => {
    expect(normalizeSalary({ min: 120000, max: 150000, currency: 'USD', period: 'year' })).toEqual({
      min: 120000, max: 150000, currency: 'USD', period: 'year', annualMin: 120000, annualMax: 150000,
    });
    expect(normalizeSalary({ min: 40, max: 55, currency: 'usd', period: 'hour' })).toEqual({
      min: 40, max: 55, currency: 'USD', period: 'hour', annualMin: 83200, annualMax: 114400,
    });
    expect(normalizeSalary({ min: 100000, currency: '$' })).toMatchObject({ min: 100000, currency: 'USD', period: 'year' });
    expect(normalizeSalary({ max: 90000, currency: 'GBP', period: 'year' })).toEqual({ max: 90000, currency: 'GBP', period: 'year', annualMax: 90000 });
  });

  it('fills currency and period from the text, then from the country', () => {
    expect(normalizeSalary({ min: 100000, max: 120000, text: '£100k-£120k' })).toEqual({
      min: 100000, max: 120000, currency: 'GBP', period: 'year', annualMin: 100000, annualMax: 120000, text: '£100k-£120k',
    });
    expect(core(normalizeSalary({ min: 50, max: 70, currency: 'GBP', text: '£50-£70 per day' }))).toEqual({ min: 50, max: 70, currency: 'GBP', period: 'day' });
    expect(core(normalizeSalary({ min: 100000, max: 120000 }, { country: 'CA' }))).toEqual({ min: 100000, max: 120000, currency: 'CAD', period: 'year' });
    expect(core(normalizeSalary({ min: 60000, max: 80000 }, { country: 'DE' }))).toEqual({ min: 60000, max: 80000, currency: 'EUR', period: 'year' });
    expect(core(normalizeSalary({ min: 100000, max: 120000, currency: '$' }, { country: 'AU' }))).toEqual({ min: 100000, max: 120000, currency: 'AUD', period: 'year' });
    expect(normalizeSalary({ min: 100000, max: 120000 })?.currency).toBeUndefined();
  });

  it('parses the text when no usable numbers are given', () => {
    expect(core(normalizeSalary({ text: '$120k – $150k' }))).toEqual({ min: 120000, max: 150000, currency: 'USD', period: 'year' });
    expect(core(normalizeSalary({ min: 0, max: 0, text: '$100k' }))).toEqual({ min: 100000, max: 100000, currency: 'USD', period: 'year' });
    expect(normalizeSalary({ text: 'Competitive' })).toBeUndefined();
    expect(normalizeSalary({ text: '   ' })).toBeUndefined();
  });

  it('treats 0, negatives, NaN and junk as "not stated"', () => {
    expect(normalizeSalary({ min: 0, max: 0 })).toBeUndefined();
    expect(normalizeSalary({ min: 0, max: 0, currency: 'USD', period: 'year' })).toBeUndefined();
    expect(normalizeSalary({ min: NaN, max: Infinity })).toBeUndefined();
    expect(core(normalizeSalary({ min: 0, max: 120000, currency: 'USD' }))).toEqual({ max: 120000, currency: 'USD', period: 'year' });
    expect(core(normalizeSalary({ min: -5, max: 100000, currency: 'USD' }))).toEqual({ max: 100000, currency: 'USD', period: 'year' });
    expect(normalizeSalary(undefined)).toBeUndefined();
    expect(normalizeSalary(null as never)).toBeUndefined();
    expect(normalizeSalary({})).toBeUndefined();
  });

  it('accepts numeric strings from loosely typed APIs', () => {
    expect(core(normalizeSalary({ min: '90000' as never, max: ' 110000 ' as never, currency: 'USD' }))).toEqual({
      min: 90000, max: 110000, currency: 'USD', period: 'year',
    });
    expect(normalizeSalary({ min: '90k' as never })).toBeUndefined();
  });

  it('swaps min > max', () => {
    expect(core(normalizeSalary({ min: 150000, max: 120000, currency: 'USD', period: 'year' }))).toEqual({
      min: 120000, max: 150000, currency: 'USD', period: 'year',
    });
  });

  it('re-reads figures whose declared period cannot be right', () => {
    // Monthly figures in a field documented as yearly.
    expect(core(normalizeSalary({ min: 4000, max: 4500, currency: 'EUR', period: 'year' }))).toEqual({ min: 4000, max: 4500, currency: 'EUR', period: 'month' });
    // Hourly figures labelled yearly.
    expect(core(normalizeSalary({ min: 45, max: 60, currency: 'USD', period: 'year' }))).toEqual({ min: 45, max: 60, currency: 'USD', period: 'hour' });
    // Yearly figures labelled hourly / monthly.
    expect(core(normalizeSalary({ min: 120000, currency: 'USD', period: 'hour' }))).toEqual({ min: 120000, currency: 'USD', period: 'year' });
    expect(core(normalizeSalary({ min: 90000, max: 120000, currency: 'GBP', period: 'month' }))).toEqual({ min: 90000, max: 120000, currency: 'GBP', period: 'year' });
    // A plausible monthly figure stays monthly.
    expect(core(normalizeSalary({ min: 8000, max: 9000, currency: 'USD', period: 'month' }))).toEqual({ min: 8000, max: 9000, currency: 'USD', period: 'month' });
  });

  it('infers a missing period from magnitude as documented', () => {
    expect(normalizeSalary({ min: 45, max: 60, currency: 'USD' })?.period).toBe('hour');
    expect(normalizeSalary({ min: 500, max: 700, currency: 'GBP' })?.period).toBe('day');
    expect(normalizeSalary({ min: 90000, max: 120000, currency: 'USD' })?.period).toBe('year');
    // Below the yearly minimum: a monthly figure.
    expect(normalizeSalary({ min: 3000, max: 4000, currency: 'EUR' })?.period).toBe('month');
  });

  it('falls back to the text when the numbers stay implausible, else undefined', () => {
    expect(core(normalizeSalary({ min: 99999999, currency: 'USD', text: '$99k' }))).toEqual({ min: 99000, max: 99000, currency: 'USD', period: 'year' });
    expect(normalizeSalary({ min: 99999999, currency: 'USD' })).toBeUndefined();
  });

  it('ignores unknown currencies and periods', () => {
    expect(normalizeSalary({ min: 100000, max: 120000, currency: 'XYZ' })?.currency).toBeUndefined();
    expect(normalizeSalary({ min: 60000, max: 80000, currency: 'EUR', period: 'decade' as never })?.period).toBe('year');
  });

  it('scales sanity checks for low-value currencies', () => {
    expect(core(normalizeSalary({ min: 1200000, max: 1800000, currency: 'INR' }))).toEqual({ min: 1200000, max: 1800000, currency: 'INR', period: 'year' });
    expect(core(normalizeSalary({ min: 6000000, max: 9000000, currency: 'JPY', period: 'year' }))).toEqual({
      min: 6000000, max: 9000000, currency: 'JPY', period: 'year',
    });
  });
});

// ---------------------------------------------------------------------------
// extractSalaryFromText
// ---------------------------------------------------------------------------

const POSITIVE: Array<[string, Expect, string?]> = [
  ['The base salary range for this role is $142,000 - $198,000 USD, plus equity and benefits.', { min: 142000, max: 198000, currency: 'USD', period: 'year' }],
  ['Pay range: $28.50–$34.00 per hour. Shift differentials apply.', { min: 28.5, max: 34, currency: 'USD', period: 'hour' }],
  [
    'The annual salary range for this position in California is $160,000 to $210,000. Actual compensation depends on experience.',
    { min: 160000, max: 210000, currency: 'USD', period: 'year' },
  ],
  ['Compensation: US$120k – US$150k base + bonus + equity. We raised $40M Series B in 2025.', { min: 120000, max: 150000, currency: 'USD', period: 'year' }],
  ['The expected hourly rate for this role is between $45 and $60/hr.', { min: 45, max: 60, currency: 'USD', period: 'hour' }],
  ['Salary: £55,000 - £65,000 per annum, plus 10% bonus and 25 days holiday.', { min: 55000, max: 65000, currency: 'GBP', period: 'year' }],
  ['We offer a competitive salary of €70.000 – €85.000 gross per year.', { min: 70000, max: 85000, currency: 'EUR', period: 'year' }],
  ['Gehalt: 65.000 € bis 80.000 € brutto jährlich', { min: 65000, max: 80000, currency: 'EUR', period: 'year' }],
  ['Salary range: CA$95,000 - CA$120,000 CAD annually', { min: 95000, max: 120000, currency: 'CAD', period: 'year' }],
  ['This role pays $8,000/month for the duration of the contract.', { min: 8000, max: 8000, currency: 'USD', period: 'month' }],
  ['Daily rate: £450–£550 per day, outside IR35.', { min: 450, max: 550, currency: 'GBP', period: 'day' }],
  ['Salary is up to $130,000 depending on experience.', { max: 130000, currency: 'USD', period: 'year' }],
  ['Starting salary from £32,000 per year.', { min: 32000, currency: 'GBP', period: 'year' }],
  ['The salary for this role is ₹18-25 LPA.', { min: 1800000, max: 2500000, currency: 'INR', period: 'year' }, 'IN'],
  ['Remuneration: A$140k–A$160k + super', { min: 140000, max: 160000, currency: 'AUD', period: 'year' }, 'AU'],
  ['Hourly pay: $22/hr, weekly pay, overtime available.', { min: 22, max: 22, currency: 'USD', period: 'hour' }],
  ['Pay: $60,000.00 - $75,000.00 per year\n\nBenefits:\n401(k)\nDental insurance', { min: 60000, max: 75000, currency: 'USD', period: 'year' }],
  ['Job Type: Full-time\nPay: $25.00 - $30.00 per hour\nExpected hours: 40 per week', { min: 25, max: 30, currency: 'USD', period: 'hour' }],
  [
    'The pay range for this position at commencement of employment is expected to be between $123,800 and $185,700 per year; however, base pay offered may vary.',
    { min: 123800, max: 185700, currency: 'USD', period: 'year' },
  ],
  ['Salary Range: $100k-$130k (depending on experience)', { min: 100000, max: 130000, currency: 'USD', period: 'year' }],
  ['Our salary ranges are based on market data. For this role: $95,000 – $115,000.', { min: 95000, max: 115000, currency: 'USD', period: 'year' }],
  ['Base pay: 120-150k USD', { min: 120000, max: 150000, currency: 'USD', period: 'year' }],
  ['Annual base salary: SGD 96,000 – 132,000', { min: 96000, max: 132000, currency: 'SGD', period: 'year' }, 'SG'],
  ['Salary: CHF 120\'000 – 140\'000 p.a.', { min: 120000, max: 140000, currency: 'CHF', period: 'year' }],
  ['Lön: 45 000 – 55 000 kr/mån', { min: 45000, max: 55000, currency: 'SEK', period: 'month' }, 'SE'],
  ['Wynagrodzenie: 15 000 - 20 000 zł brutto miesięcznie', { min: 15000, max: 20000, currency: 'PLN', period: 'month' }, 'PL'],
  ['Salaire : 55 000 € à 65 000 € par an', { min: 55000, max: 65000, currency: 'EUR', period: 'year' }],
  ['Base salary for this sales role: $80k–$100k, plus uncapped commission.', { min: 80000, max: 100000, currency: 'USD', period: 'year' }],
  ['Salary range adjusted for cost of living: $120,000 - $150,000', { min: 120000, max: 150000, currency: 'USD', period: 'year' }],
  ['We are well funded by top investors and pay $150k–$180k for this role.', { min: 150000, max: 180000, currency: 'USD', period: 'year' }],
  ['OTE: $180,000 (50/50 split).', { min: 180000, max: 180000, currency: 'USD', period: 'year' }],
  ['Total compensation $200k-$250k including equity.', { min: 200000, max: 250000, currency: 'USD', period: 'year' }],
  ['Our engineers earn between $150k and $200k.', { min: 150000, max: 200000, currency: 'USD', period: 'year' }],
  ['Compensation\n\n$120,000', { min: 120000, max: 120000, currency: 'USD', period: 'year' }],
  ['Rate: $80-100/hr', { min: 80, max: 100, currency: 'USD', period: 'hour' }],
  ['Salary: $100,000 - $120,000\nBonus: $10,000 - $20,000', { min: 100000, max: 120000, currency: 'USD', period: 'year' }],
  ['<p>Compensation</p>\nThe salary range for this role is $90,000 - $110,000 per year, plus a $5,000 sign-on bonus.', { min: 90000, max: 110000, currency: 'USD', period: 'year' }],
];

const NEGATIVE: string[] = [
  'We raised $50M in Series B funding led by top investors.',
  'Our platform processes $2B in payments annually.',
  'We serve 10,000 customers in 40 countries.',
  'Enjoy a $1,000 home office stipend and $500 learning budget.',
  'Sign-on bonus of $10,000 for qualified candidates.',
  '401(k) with 4% company match.',
  'Founded in 2015, we have 250 employees.',
  'Call us at 1-800-555-0199 or (415) 555-0123.',
  '24/7 support coverage; 99.9% uptime.',
  'Revenue grew 300% to $120M ARR last year.',
  'We have $25,000 in annual travel credits for the team.',
  'Equity grants worth up to $100,000 vest over 4 years.',
  'Valued at $1.2B after our latest round.',
  'Must lift 50 lbs. Requires 5+ years of experience.',
  'Our customers save $150,000 per year on average.',
  'Wellness allowance of $100/month and phone reimbursement of $50/month.',
  'Version 2.3.1 released on 2026-11-23.',
  'Referral bonus: $5,000 per hire.',
  'The salary is competitive and depends on experience.',
  'We price our product at $99/month per seat.',
  'Salary: 120,000 - 150,000', // no currency anywhere: too risky in a description
  'In 2025 we closed a $30M round and hired 120 people.',
  'Up to $2,000 per year for conferences.',
  'Salary is competitive. Up to $1,000 per month for coworking.',
  'Clients pay $50 - $100 per hour for our services.',
  'We cover up to $500 per month for internet and phone.',
  'Projects range from $5,000 - $50,000.',
  'The role offers $150k incl. bonus.', // a lone amount needs pay vocabulary in its sentence
];

describe('extractSalaryFromText', () => {
  it(`finds the pay in ${POSITIVE.length} realistic snippets`, () => {
    expect(POSITIVE.length).toBeGreaterThanOrEqual(25);
    for (const [text, expected, country] of POSITIVE) {
      const r = extractSalaryFromText(text, country ? { country } : {});
      expect(core(r), text).toEqual(expected);
      expect(r?.inferred, text).toBe(true);
      expect(r?.text, text).toBeTruthy();
      checkInvariants(r);
    }
  });

  it(`ignores ${NEGATIVE.length} amounts that are not pay`, () => {
    expect(NEGATIVE.length).toBeGreaterThanOrEqual(10);
    for (const text of NEGATIVE) expect(extractSalaryFromText(text), text).toBeUndefined();
  });

  it('merges overlapping location/zone ranges into the widest range', () => {
    const r = extractSalaryFromText(
      'Compensation ranges by location — Zone 1: $150,000—$200,000; Zone 2: $135,000—$180,000; Zone 3: $120,000—$160,000.',
    );
    expect(core(r)).toEqual({ min: 120000, max: 200000, currency: 'USD', period: 'year' });
    expect(r?.text).toBe('$150,000—$200,000; $135,000—$180,000; $120,000—$160,000');
  });

  it('keeps the first range when later ranges do not overlap it (base vs OTE, levels)', () => {
    expect(core(extractSalaryFromText('Base salary $90,000 - $110,000. OTE $150,000 - $180,000.'))).toEqual({
      min: 90000, max: 110000, currency: 'USD', period: 'year',
    });
    expect(core(extractSalaryFromText('Salary: Senior $150k–$180k; Staff $185k–$220k'))).toEqual({
      min: 150000, max: 180000, currency: 'USD', period: 'year',
    });
  });

  it('only merges ranges in the same currency and period as the first', () => {
    const r = extractSalaryFromText('US Pay Range\n$176,000—$264,000 USD\nCanada Pay Range\nCA$161,000—CA$242,000 CAD');
    expect(core(r)).toEqual({ min: 176000, max: 264000, currency: 'USD', period: 'year' });
    const h = extractSalaryFromText('Pay: $25–$30 per hour (about $52,000–$62,400 per year).');
    expect(core(h)).toEqual({ min: 25, max: 30, currency: 'USD', period: 'hour' });
  });

  it('prefers a range over an earlier single amount', () => {
    expect(core(extractSalaryFromText('Salary $5,000 relocation package. The salary range is $100,000 - $120,000.'))).toEqual({
      min: 100000, max: 120000, currency: 'USD', period: 'year',
    });
  });

  it('handles empty, non-string and huge input quickly', () => {
    expect(extractSalaryFromText('')).toBeUndefined();
    expect(extractSalaryFromText(undefined as never)).toBeUndefined();
    const filler = 'We build software for teams. Our customers love us. '.repeat(3000); // ~156 KB
    const t = performance.now();
    const r = extractSalaryFromText(`${filler} The salary range is $100,000 - $120,000. ${'$5 '.repeat(20000)}`);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(core(r)).toEqual({ min: 100000, max: 120000, currency: 'USD', period: 'year' });
    // Only the first 200,000 characters are scanned.
    expect(extractSalaryFromText(`${'x '.repeat(100_001)}Salary: $100,000 - $120,000`)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatSalary
// ---------------------------------------------------------------------------

describe('formatSalary', () => {
  it.each<[Salary, string]>([
    [{ min: 120000, max: 150000, currency: 'USD', period: 'year' }, '$120k–$150k/yr'],
    [{ min: 450, max: 450, currency: 'GBP', period: 'day' }, '£450/day'],
    [{ min: 60000, currency: 'EUR', period: 'year' }, 'From €60k/yr'],
    [{ max: 45, currency: 'USD', period: 'hour' }, 'Up to $45/hr'],
    [{ min: 142000, max: 198000, currency: 'USD', period: 'year' }, '$142k–$198k/yr'],
    [{ min: 63800, max: 70000, currency: 'USD', period: 'year' }, '$63.8k–$70k/yr'],
    [{ min: 28.5, max: 34, currency: 'USD', period: 'hour' }, '$28.50–$34/hr'],
    [{ min: 8000, max: 8000, currency: 'USD', period: 'month' }, '$8k/mo'],
    [{ min: 1200, max: 1500, currency: 'USD', period: 'week' }, '$1.2k–$1.5k/wk'],
    [{ min: 1800000, max: 2500000, currency: 'INR', period: 'year' }, '₹18L–₹25L/yr'],
    [{ min: 12000000, currency: 'INR', period: 'year' }, 'From ₹1.2Cr/yr'],
    [{ min: 95000, max: 120000, currency: 'CAD', period: 'year' }, 'CA$95k–CA$120k/yr'],
    [{ min: 120000, currency: 'AUD', period: 'year' }, 'From A$120k/yr'],
    [{ min: 6000000, max: 9000000, currency: 'JPY', period: 'year' }, '¥6M–¥9M/yr'],
    [{ min: 120000, max: 140000, currency: 'CHF', period: 'year' }, 'CHF 120k–140k/yr'],
    [{ min: 45000, max: 55000, currency: 'SEK', period: 'month' }, 'SEK 45k–55k/mo'],
    [{ max: 90000, currency: 'PLN', period: 'year' }, 'Up to PLN 90k/yr'],
    [{ min: 100000, max: 120000, currency: 'usd', period: 'year' }, '$100k–$120k/yr'],
    [{ min: 120000, max: 150000, period: 'year' }, '120k–150k/yr'],
    [{ min: 1250000, max: 1250000, currency: 'USD', period: 'year' }, '$1.25M/yr'],
    [{ min: 999999, currency: 'USD', period: 'year' }, 'From $1M/yr'],
    [{ min: 100000 }, 'From 100k'],
    [{ min: NaN, max: 120000, currency: 'USD', period: 'year' }, 'Up to $120k/yr'],
    [{ text: 'Competitive' }, 'Competitive'],
    [{ min: NaN, text: ' $DOE ' }, '$DOE'],
    [{}, ''],
    [{ min: 100000, currency: 'X$Y', period: 'year' }, 'From 100k/yr'],
    [{ min: 100000, currency: 'USD', period: 'fortnight' as never }, 'From $100k'],
  ])('%j -> %s', (salary, expected) => {
    expect(formatSalary(salary)).toBe(expected);
  });

  it('never prints undefined/NaN, even for garbage', () => {
    for (const s of [null, undefined, 5, 'x', { min: Infinity }, { max: -1 }, { currency: 'USD' }, { period: 'year' }]) {
      const out = formatSalary(s as never);
      expect(out).not.toMatch(/undefined|NaN|null|Infinity/);
    }
  });

  it('round-trips the documented parse examples into compact strings', () => {
    const cases: Array<[string, string]> = [
      ['$120,000-$150,000 a year', '$120k–$150k/yr'],
      ['up to £65,000 per annum', 'Up to £65k/yr'],
      ['From $90,000', 'From $90k/yr'],
      ['$45/hr', '$45/hr'],
      ['₹18-25 LPA', '₹18L–₹25L/yr'],
      ['60.000 € – 75.000 €', '€60k–€75k/yr'],
    ];
    for (const [text, out] of cases) expect(formatSalary(parseSalaryText(text) ?? {})).toBe(out);
  });
});

// ---------------------------------------------------------------------------
// Fuzzing
// ---------------------------------------------------------------------------

describe('fuzzing', () => {
  it('random salary-ish text never throws and always yields consistent results', () => {
    let seed = 99;
    const r = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const bits = ['$', '£', '€', '₹', 'USD', 'CA$', 'kr', 'R', '120', '1,000', '45.50', '120.000', '9', 'k', 'K', 'M', 'LPA', ' ', '-', '–', ' to ', '+', 'up to ', 'from ', '/hr', ' per month', ' a year', ' bonus', ' equity', ' 401(k)', '2026', ' employees', '%', '/', '.', ',', 'salary: ', 'raised ', '\n', 'and', 'between '];
    for (let n = 0; n < 3000; n++) {
      let s = '';
      const len = 1 + Math.floor(r() * 14);
      for (let k = 0; k < len; k++) s += bits[Math.floor(r() * bits.length)] ?? '';
      const country = ['US', 'CA', 'SE', 'ZA', 'IN', undefined][n % 6];
      const opts = country ? { country } : {};
      checkInvariants(parseSalaryText(s, opts));
      checkInvariants(extractSalaryFromText(s, opts));
      checkInvariants(normalizeSalary({ min: Math.floor(r() * 300000), max: Math.floor(r() * 300000), text: s }, opts));
    }
  });
});
