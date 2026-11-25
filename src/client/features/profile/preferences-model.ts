/** Small pure helpers behind the search-preference controls. */
import type { RemoteMode, SearchPreferences } from '../../../shared/types';
import { isRemoteOnly } from '../saved/describe';

/** Currencies offered first; any other stored code is added to the list as-is. */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'INR', 'SGD', 'JPY', 'BRL', 'MXN', 'ZAR'];

export const MAX_SALARY = 10_000_000;

const KM_PER_MILE = 1.609344;

export function radiusLabel(km: number): string {
  if (km === 0) return 'Only that place';
  return `Within ${km} km (${Math.round(km / KM_PER_MILE)} mi)`;
}

/**
 * Where the profile search looks, worded the way it runs. Work arrangement is a filter, so a
 * location with only "Remote" ticked finds remote jobs open to it, not local jobs as well.
 * `places` is the locations already joined for display ("" for none).
 */
export function placeRecap(places: string, remote: readonly RemoteMode[]): string {
  if (!places) return isRemoteOnly(remote) ? 'Remote jobs' : 'Any location';
  if (isRemoteOnly(remote)) return `Remote jobs open to ${places}`;
  // No arrangement picked still includes remote jobs open to the place.
  return remote.length === 0 || remote.includes('remote') ? `In ${places}, or remote` : `In ${places}`;
}

/** The hint under the work-arrangement chips, warning when "Remote" alone hides local jobs. */
export function arrangementHint(value: Pick<SearchPreferences, 'locations' | 'remote'>): string {
  if (value.locations.some((l) => l.trim()) && isRemoteOnly(value.remote)) {
    return 'Only remote jobs will show. Pick none to also see on-site and hybrid jobs near you.';
  }
  return 'Pick none to see every kind.';
}

/** "85,000" for 85000; "" when not set. */
export function formatSalaryInput(value: number | null): string {
  return value === null ? '' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

/** `list` with `item` added, or removed when it is already there. */
export function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

type ListKey = 'targetTitles' | 'locations' | 'skills' | 'certifications' | 'excludeCompanies' | 'excludeTerms';

/** The most items the server keeps in each list (src/server/features/profile/normalize.ts). */
export const LIST_LIMITS: Record<ListKey, number> = {
  targetTitles: 60,
  locations: 50,
  skills: 300,
  certifications: 60,
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
