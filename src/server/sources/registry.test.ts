import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { atsKindSchema } from '../../shared/schemas';
import { SOURCES, getSource } from './registry';
import type { JobSource } from './types';

const here = path.dirname(fileURLToPath(import.meta.url));

function isJobSource(value: unknown): value is JobSource {
  const def = (value as { def?: { id?: unknown } } | null)?.def;
  return typeof def?.id === 'string';
}

describe('source registry', () => {
  it('lists the core adapters first, in display order', () => {
    expect(SOURCES.slice(0, 9).map((s) => s.def.id)).toEqual([
      'greenhouse',
      'lever',
      'ashby',
      'remotive',
      'remoteok',
      'jobicy',
      'weworkremotely',
      'workingnomads',
      'himalayas',
    ]);
  });

  it('registers every adapter module that exports a JobSource', async () => {
    const files = fs
      .readdirSync(here)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !['registry.ts', 'testing.ts'].includes(f));
    const exported: string[] = [];
    for (const file of files) {
      const mod = (await import(`./${file.replace(/\.ts$/, '')}.ts`)) as Record<string, unknown>;
      for (const value of Object.values(mod)) if (isJobSource(value)) exported.push(value.def.id);
    }
    expect(exported.length).toBeGreaterThan(0);
    expect(SOURCES.map((s) => s.def.id).sort()).toEqual([...exported].sort());
  });

  it('has unique kebab-case ids and finds sources by id', () => {
    const ids = SOURCES.map((s) => s.def.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(getSource(id)?.def.id).toBe(id);
    }
    expect(getSource('no-such-source')).toBeUndefined();
  });

  it.each(SOURCES.map((s) => [s.def.id, s] as const))('%s has a complete, consistent definition', (_id, source) => {
    const def = source.def;
    expect(def.name.trim()).not.toBe('');
    expect(def.description.trim().length).toBeGreaterThan(20);
    expect(def.homepage).toMatch(/^https:\/\/[^\s]+$/);
    expect(['board', 'ats', 'aggregator', 'community']).toContain(def.kind);
    expect(def.defaultTtlMinutes).toBeGreaterThanOrEqual(15);
    expect(def.defaultTtlMinutes).toBeLessThanOrEqual(10_080);
    expect(def.minRequestIntervalMs).toBeGreaterThanOrEqual(0);
    if (def.closeGraceMinutes !== undefined) {
      expect(def.closeGraceMinutes).toBeGreaterThan(0);
      expect(def.fullSnapshot).toBe(true);
    }
    if (def.attribution !== undefined) expect(def.attribution.trim()).not.toBe('');

    const keys = def.configFields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const field of def.configFields) {
      expect(field.key).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      expect(field.label.trim()).not.toBe('');
    }
    // A source that cannot work without the user's key must not be on out of the box.
    if (def.configFields.some((f) => f.required)) expect(def.defaultEnabled).toBe(false);

    if (def.mode === 'feed') expect(typeof source.fetchFeed).toBe('function');
    else {
      expect(typeof source.search).toBe('function');
      expect(def.fullSnapshot).toBe(false);
      expect(def.perCompany).toBe(false);
    }

    if (def.perCompany) {
      expect(def.kind).toBe('ats');
      expect(def.mode).toBe('feed');
      expect(atsKindSchema.options).toContain(def.ats);
      // Feed keys and company ids are both "<ats>:<token>", so the source id must be the ATS name.
      expect(def.id).toBe(def.ats);
      expect(typeof source.probeBoard).toBe('function');
    } else {
      expect(def.ats).toBeUndefined();
      expect(source.probeBoard).toBeUndefined();
    }
  });

  it('has at most one adapter per ATS', () => {
    const ats = SOURCES.flatMap((s) => (s.def.ats ? [s.def.ats] : []));
    expect(new Set(ats).size).toBe(ats.length);
  });
});
