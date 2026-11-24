/**
 * Location understanding, backed by the bundled gazetteer
 * (loadReference('gazetteer') from ../data). No network.
 */
import type { JobLocation, Place } from '../../shared/types';
import { notImplemented } from './not-implemented';

export interface LocationInput {
  /** Raw location strings from the source. */
  locations: string[];
  /** Explicit structured hint from the source, when it has one. */
  remote?: 'remote' | 'hybrid' | 'onsite';
  title?: string;
  /** Plain-text description; only used for remote/hybrid detection and remote scope. */
  descriptionText?: string;
  tags?: string[];
}

export interface ParsedLocation {
  location: JobLocation;
  /** Display string, e.g. "Austin, TX · Hybrid", "Remote (US, Canada)", "London, UK +2 more". */
  text: string;
}

/**
 * Turn a source's location strings into structured places plus a work-arrangement.
 *
 * Each raw string may hold several places and remote markers, e.g.
 *   "New York, NY", "NYC or Remote (US)", "San Francisco Bay Area", "London, UK / Berlin, Germany",
 *   "Remote - EMEA", "Remote, USA", "United States", "Anywhere", "Worldwide", "München",
 *   "Austin, TX; Denver, CO; Remote", "Hybrid - Toronto, ON", "US-Remote", "Remote (PST hours)",
 *   "Bengaluru, Karnataka, India", "Singapore", "Washington, D.C.", "Cambridge, MA" vs "Cambridge, UK".
 * Rules:
 *  - Split on the separators sources really use ("/", ";", "|", " or ", " and ", " • ", newlines), but
 *    never split "City, ST" or "City, Country" pairs.
 *  - Resolve each part with the gazetteer: prefer exact city+admin1+country, then city+country, then alias,
 *    then city alone (most populous; but if the string also names an admin1/country, it must agree).
 *    Country-only and admin1-only strings become kind 'country' / 'admin1'. Named hiring regions become kind
 *    'region' with their member countries. Unresolvable text becomes kind 'unknown' (kept for display/search).
 *  - Remote: source hint wins; otherwise detect from the location strings first ("remote", "work from home",
 *    "WFH", "distributed", "anywhere", "telecommute"), then the title, then (conservatively) the description
 *    ("this is a fully remote role" yes; "remote-first culture" alone or "no remote" no). "hybrid" likewise.
 *    When physical places are given and nothing indicates remote/hybrid, the mode is 'onsite' ONLY if the
 *    source hint says so; otherwise 'unknown' — never guess on-site.
 *  - remoteScope: countries a remote worker may be in, from "Remote (US)", "Remote - EMEA", "US only",
 *    "must be based in Canada", etc. A remote job whose only place is a country/region is scoped to it.
 *    "Anywhere"/"Worldwide" -> empty scope. Places that are purely a remote scope should not also be listed
 *    as physical places.
 */
export function parseJobLocation(input: LocationInput): ParsedLocation {
  return notImplemented(`parseJobLocation(${JSON.stringify(input.locations)})`);
}

/** Resolve user-typed location text ("austin tx", "NYC", "Germany", "EMEA", "remote") to a single Place. */
export function resolvePlace(text: string): Place | undefined {
  return notImplemented(`resolvePlace(${text})`);
}

/**
 * Autocomplete for the location box: cities (by population), admin1s, countries and
 * regions whose name or alias starts with (or, failing that, contains) the query. Diacritic-insensitive.
 */
export function suggestPlaces(query: string, limit = 8): Place[] {
  return notImplemented(`suggestPlaces(${query}, ${limit})`);
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PlaceMatchKind =
  | 'city' // same city
  | 'radius' // within the radius of the target city
  | 'area' // target is an admin1/country/region and the job is inside it
  | 'remote' // remote job that may be done from the target
  | 'none';

export interface PlaceMatch {
  kind: PlaceMatchKind;
  distanceKm?: number;
}

/**
 * Does a job's location satisfy a target place?
 *  - target city:    job has that city, or a city within `radiusKm` (when > 0). A job listed only as an
 *                    admin1/country that contains the city does NOT match as on-site (too vague) unless it is remote.
 *  - target admin1:  job has a place in that admin1.
 *  - target country: job has a place in that country.
 *  - target region:  job has a place in any member country.
 *  - remote jobs (`includeRemote`): match when remoteScope is empty or includes the target's country
 *    (for a region: intersects its countries). A remote job with no scope matches any target.
 * Returns the best match kind.
 */
export function matchPlace(
  job: JobLocation,
  target: Place,
  opts: { radiusKm?: number; includeRemote?: boolean } = {},
): PlaceMatch {
  return notImplemented(`matchPlace(${job.places.length}, ${target.label}, ${JSON.stringify(opts)})`);
}

/** English country name for an ISO alpha-2 code. */
export function countryName(code: string): string | undefined {
  return notImplemented(`countryName(${code})`);
}

/** Short display label for a place: "Austin, TX", "Ontario, Canada", "Germany", "EMEA", "Anywhere". */
export function placeLabel(place: Omit<Place, 'label'>): string {
  return notImplemented(`placeLabel(${place.raw})`);
}
