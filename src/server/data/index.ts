/**
 * Bundled reference data (generated/curated JSON files in this directory).
 * Loaded lazily and cached; files are read from disk rather than imported so the
 * TypeScript compiler never has to type megabytes of JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AtsKind } from '../../shared/types';
import { findProjectRoot } from '../config';

export interface GazetteerData {
  version: 1;
  countries: Array<{ code: string; name: string; aliases: string[]; continent: string; region: 'AMER' | 'EMEA' | 'APAC' }>;
  admin1: Array<{ country: string; code: string; name: string; aliases?: string[] }>;
  /** [name, asciiName, admin1Code, countryCode, lat, lon, population], sorted by population descending. */
  cities: Array<[string, string, string, string, number, number, number]>;
  /** Lower-case alias -> an existing city row. */
  aliases: Array<{ alias: string; city: string; admin1: string; country: string }>;
  /** Named multi-country hiring regions (EMEA, DACH, ...). */
  regions: Array<{ name: string; aliases: string[]; countries: string[] }>;
}

export interface SkillEntry {
  name: string;
  aliases: string[];
  category: string;
  /** Collides with ordinary words; match case-sensitively and only in list-like contexts. */
  ambiguous?: boolean;
}
export interface SkillsData {
  version: 1;
  skills: SkillEntry[];
}

export interface RoleEntry {
  id: string;
  title: string;
  aliases: string[];
  related: string[];
  skills: string[];
}
export interface RoleFamily {
  id: string;
  name: string;
  roles: RoleEntry[];
}
export interface RolesData {
  version: 1;
  families: RoleFamily[];
}

export interface SeedCompany {
  name: string;
  ats: AtsKind;
  token: string;
  industry: string;
  jobs: number;
  /** Seed version that added this board (default 1); installs seeded earlier receive it on upgrade. */
  since?: number;
}

interface ReferenceFiles {
  gazetteer: GazetteerData;
  skills: SkillsData;
  roles: RolesData;
  'companies.seed': SeedCompany[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map<string, unknown>();

function resolveFile(name: string): string {
  const file = `${name}.json`;
  const candidates = [
    path.join(here, file), // src/server/data (dev, tests)
    path.join(here, 'data', file), // dist/server/data (bundled build)
    path.join(findProjectRoot(), 'src', 'server', 'data', file),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`Reference data file ${file} not found (looked in ${candidates.join(', ')})`);
  return found;
}

export function loadReference<K extends keyof ReferenceFiles>(name: K): ReferenceFiles[K] {
  let value = cache.get(name) as ReferenceFiles[K] | undefined;
  if (value === undefined) {
    value = JSON.parse(fs.readFileSync(resolveFile(name), 'utf8')) as ReferenceFiles[K];
    cache.set(name, value);
  }
  return value;
}

export function hasReference(name: keyof ReferenceFiles): boolean {
  try {
    resolveFile(name);
    return true;
  } catch {
    return false;
  }
}
