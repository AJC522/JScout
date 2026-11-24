import type { Salary, SalaryPeriod } from '../../shared/types';
import type { RawSalary } from '../sources/types';
import { notImplemented } from './not-implemented';

export interface SalaryOptions {
  /** ISO alpha-2 country of the job, used to disambiguate "$" (USD/CAD/AUD/…) and bare numbers. */
  country?: string;
}

/** Hours/weeks used to annualise: hour x 2080, day x 260, week x 52, month x 12. */
export function annualize(amount: number, period: SalaryPeriod): number {
  switch (period) {
    case 'hour':
      return amount * 2080;
    case 'day':
      return amount * 260;
    case 'week':
      return amount * 52;
    case 'month':
      return amount * 12;
    case 'year':
      return amount;
  }
}

/**
 * Parse a free-text salary. Must handle, at least:
 *   "$120k – $150k", "$120,000-$150,000 a year", "USD 100,000+", "up to £65,000 per annum",
 *   "€60-70K", "60.000 € – 75.000 €" (European thousands separators), "CA$95,000", "A$120k", "₹18-25 LPA",
 *   "$45/hr", "$40 - $55 per hour", "£450 per day", "$8,000/month", "120k-150k" (no currency),
 *   "$150K + equity + bonus", "From $90,000", "Competitive" (-> undefined).
 * Period defaults: explicit unit wins; otherwise infer from magnitude (< 500 -> hour, < 2,000 -> day
 * unless a k-suffix was used, otherwise year). Reject nonsense (min > max is swapped; annualised
 * values outside 5,000–5,000,000 return undefined; a lone year like "2026" or a headcount is not a salary).
 * Always fills annualMin/annualMax when min/max and period are known, and keeps `text`.
 */
export function parseSalaryText(text: string, opts: SalaryOptions = {}): Salary | undefined {
  return notImplemented(`parseSalaryText(${text}, ${opts.country ?? ''})`);
}

/**
 * Normalise what a source gave in structured form. Uses numbers when present
 * (filling currency/period from `raw.text` or the country when missing), otherwise
 * parses `raw.text`. Returns undefined when nothing usable is present.
 */
export function normalizeSalary(raw: RawSalary | undefined, opts: SalaryOptions = {}): Salary | undefined {
  return notImplemented(`normalizeSalary(${JSON.stringify(raw)}, ${opts.country ?? ''})`);
}

/**
 * Find a salary range stated in a description. Must be conservative: only accept
 * amounts with a currency symbol/code that sit near pay vocabulary ("salary", "compensation",
 * "pay range", "base", "per year", "OTE", "/hr" …); ignore funding amounts ("raised $50M"),
 * revenue, benefits stipends ("$1,000 home office stipend"), and sign-on bonuses.
 * The result has `inferred: true`.
 */
export function extractSalaryFromText(descriptionText: string, opts: SalaryOptions = {}): Salary | undefined {
  return notImplemented(`extractSalaryFromText(${descriptionText.length} chars, ${opts.country ?? ''})`);
}

/** Short display string, e.g. "$120k–$150k/yr", "£450/day", "From €60k/yr", "Up to $45/hr". */
export function formatSalary(salary: Salary): string {
  return notImplemented(`formatSalary(${JSON.stringify(salary)})`);
}
