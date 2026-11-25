/** Small pure helpers behind the search-preference controls. */
import type { SearchPreferences } from '../../../shared/types';

/** Currencies offered first; any other stored code is added to the list as-is. */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'INR', 'SGD', 'JPY', 'BRL', 'MXN', 'ZAR'];

export const MAX_SALARY = 10_000_000;

const KM_PER_MILE = 1.609344;

export function radiusLabel(km: number): string {
  if (km === 0) return 'Only that place';
  return `Within ${km} km (${Math.round(km / KM_PER_MILE)} mi)`;
}

/** "85,000" for 85000; "" when not set. */
export function formatSalaryInput(value: number | null): string {
  return value === null ? '' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

/** `list` with `item` added, or removed when it is already there. */
export function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

type ListKey = 'targetTitles' | 'locations' | 'skills' | 'excludeCompanies' | 'excludeTerms';

/** The most items the server keeps in each list (src/server/features/profile/normalize.ts). */
export const LIST_LIMITS: Record<ListKey, number> = {
  targetTitles: 60,
  locations: 50,
  skills: 300,
  excludeCompanies: 200,
  excludeTerms: 100,
};

export type PreferencesErrors = Partial<Record<ListKey, string>>;

/** Lists that are longer than the server accepts, with a message for each. */
export function preferencesErrors(value: Partial<Pick<SearchPreferences, ListKey>>): PreferencesErrors {
  const errors: PreferencesErrors = {};
  for (const key of Object.keys(LIST_LIMITS) as ListKey[]) {
    const count = value[key]?.length ?? 0;
    const limit = LIST_LIMITS[key];
    if (count > limit) errors[key] = `Keep it to ${limit} or fewer (remove ${count - limit})`;
  }
  return errors;
}
