/**
 * The location part of a search, as SQL over job_places (see schema.ts for the row kinds).
 *
 *  - city:    city rows within radiusKm (bounding box on the lat/lon indexes, exact haversine after);
 *             radius 0 = the same city by name (+ admin1 when both have one) plus ~3 km for coordinate noise
 *  - admin1:  city/admin1 rows in that admin1
 *  - country: city/admin1/country/region rows in that country
 *  - region:  the same, for any member country
 *  - includeRemote: also remote jobs whose scope is unrestricted or includes the target country
 *  - anywhere: no filter; unresolved text: an FTS match on the location column instead
 */
import type { Place } from '../../shared/types';
import type { SqlValue } from '../db';
import { CITY_STATES } from '../lib/location-data';
import { resolvePlace } from '../lib/location';
import { tokenize } from '../lib/text';
import { ftsScope, ftsString } from './fts';

export interface SqlCond {
  sql: string;
  params: SqlValue[];
}

export interface LocationFilter {
  place?: Place;
  placeUnresolved: boolean;
  /** Condition on `j` (jobs) when the place resolved. */
  cond?: SqlCond;
  /** FTS expression on the location column when it did not. */
  fts?: string;
}

/** Coordinates jitter between gazetteer entries and sources; treat anything this close as the same city. */
export const SAME_CITY_KM = 3;
const KM_PER_DEG_LAT = 111.32;

const HAVERSINE = `6371.0 * 2 * asin(min(1, sqrt(
  pow(sin(radians(lat - ?) / 2), 2) + cos(radians(?)) * cos(radians(lat)) * pow(sin(radians(lon - ?) / 2), 2))))`;

/** City rows within `km` of a point: bounding box first (indexed), exact distance second. */
function nearSql(lat: number, lon: number, km: number): SqlCond {
  const dLat = km / KM_PER_DEG_LAT;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLon = cosLat > 0.01 ? km / (KM_PER_DEG_LAT * cosLat) : 360;
  const lonRange = lon - dLon >= -180 && lon + dLon <= 180;
  return {
    sql: `SELECT job_rid FROM job_places WHERE kind = 'city' AND lat BETWEEN ? AND ?
      ${lonRange ? 'AND lon BETWEEN ? AND ?' : ''} AND ${HAVERSINE} <= ?`,
    params: [lat - dLat, lat + dLat, ...(lonRange ? [lon - dLon, lon + dLon] : []), lat, lat, lon, km],
  };
}

function placeRowsSql(place: Place, radiusKm: number): SqlCond | undefined {
  const AREA_KINDS = `kind IN ('city', 'admin1', 'country', 'region')`;
  switch (place.kind) {
    case 'city': {
      if (!place.city || !place.country) return undefined;
      const parts: SqlCond[] = [
        {
          sql: `SELECT job_rid FROM job_places WHERE kind = 'city' AND country = ? AND city = ? COLLATE NOCASE
            AND (admin1 IS NULL OR ? IS NULL OR admin1 = ?)`,
          params: [place.country, place.city, place.admin1 ?? null, place.admin1 ?? null],
        },
      ];
      if (place.lat !== undefined && place.lon !== undefined) parts.push(nearSql(place.lat, place.lon, Math.max(radiusKm, SAME_CITY_KM)));
      // City-states are often listed as just the country ("Singapore").
      if (CITY_STATES.has(place.country)) parts.push({ sql: `SELECT job_rid FROM job_places WHERE kind = 'country' AND country = ?`, params: [place.country] });
      return { sql: parts.map((p) => p.sql).join(' UNION '), params: parts.flatMap((p) => p.params) };
    }
    case 'admin1':
      if (!place.admin1 || !place.country) return undefined;
      return {
        sql: `SELECT job_rid FROM job_places WHERE kind IN ('city', 'admin1') AND country = ? AND admin1 = ?`,
        params: [place.country, place.admin1],
      };
    case 'country':
      if (!place.country) return undefined;
      return { sql: `SELECT job_rid FROM job_places WHERE ${AREA_KINDS} AND country = ?`, params: [place.country] };
    case 'region':
      if (!place.countries?.length) return undefined;
      return {
        sql: `SELECT job_rid FROM job_places WHERE ${AREA_KINDS} AND country IN (SELECT value FROM json_each(?))`,
        params: [JSON.stringify(place.countries)],
      };
    default:
      return undefined;
  }
}

/** Countries a remote worker must be allowed to live in to match the place. */
function remoteCountries(place: Place): string[] {
  if (place.kind === 'region') return place.countries ?? [];
  return place.country ? [place.country] : [];
}

function remoteSql(place: Place): SqlCond {
  return {
    sql: `(j.remote = 'remote' AND (
      NOT EXISTS (SELECT 1 FROM job_places s WHERE s.job_rid = j.rid AND s.kind = 'scope')
      OR EXISTS (SELECT 1 FROM job_places s WHERE s.job_rid = j.rid AND s.kind = 'scope'
                 AND s.country IN (SELECT value FROM json_each(?)))))`,
    params: [JSON.stringify(remoteCountries(place))],
  };
}

/** Build the location filter for a place that is already resolved (or undefined for "anywhere"). */
export function placeFilter(place: Place, opts: { radiusKm: number; includeRemote: boolean }): SqlCond | undefined {
  if (place.kind === 'anywhere') return undefined;
  const rows = placeRowsSql(place, opts.radiusKm);
  const parts: SqlCond[] = [];
  // `+j.rid` keeps the planner on the covering search index instead of row-by-row table lookups.
  if (rows) parts.push({ sql: `+j.rid IN (${rows.sql})`, params: rows.params });
  if (opts.includeRemote) parts.push(remoteSql(place));
  if (parts.length === 0) return { sql: '0', params: [] };
  return { sql: `(${parts.map((p) => p.sql).join(' OR ')})`, params: parts.flatMap((p) => p.params) };
}

export function locationFilter(location: string | undefined, opts: { radiusKm: number; includeRemote: boolean }): LocationFilter {
  const text = location?.trim() ?? '';
  if (tokenize(text).length === 0) return { placeUnresolved: false };
  const place = resolvePlace(text);
  if (place && place.kind !== 'unknown') return { place, placeUnresolved: false, cond: placeFilter(place, opts) };
  return { placeUnresolved: true, fts: ftsScope(['location'], ftsString(text)) };
}
