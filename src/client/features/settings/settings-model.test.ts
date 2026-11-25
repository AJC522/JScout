import { describe, expect, it } from 'vitest';
import type { AppSettings } from '../../../shared/types';
import { applySettingsUpdate, backupFileName, dayOptions, keyRemovalResult, matchesResetPhrase, readBackup, ttlLabel, ttlOptions } from './settings-model';

const settings: AppSettings = {
  theme: 'system',
  autoSync: true,
  closedRetentionDays: 30,
  maxPostingAgeDays: 60,
  ai: { hasKey: false, model: 'claude-opus-5-5' },
};

describe('keyRemovalResult', () => {
  it('does not report a removed key while the server still has one from ANTHROPIC_API_KEY', () => {
    expect(keyRemovalResult({ ...settings, ai: { ...settings.ai, hasKey: false } })).toBe('removed');
    expect(keyRemovalResult({ ...settings, ai: { ...settings.ai, hasKey: true } })).toBe('env-key-in-use');
  });
});

describe('applySettingsUpdate', () => {
  it('applies plain fields and turns a key into hasKey without storing it', () => {
    const next = applySettingsUpdate(settings, { autoSync: false, ai: { apiKey: 'sk-ant-123' } });
    expect(next).toEqual({ ...settings, autoSync: false, ai: { hasKey: true, model: 'claude-opus-5-5' } });
    expect(JSON.stringify(next)).not.toContain('sk-ant');
  });

  it('clears the key with null and keeps it when only the model changes', () => {
    const withKey = { ...settings, ai: { hasKey: true, model: 'm' } };
    expect(applySettingsUpdate(withKey, { ai: { apiKey: null } }).ai).toEqual({ hasKey: false, model: 'm' });
    expect(applySettingsUpdate(withKey, { ai: { model: 'n' } }).ai).toEqual({ hasKey: true, model: 'n' });
    expect(settings.ai.hasKey).toBe(false);
  });
});

describe('options', () => {
  it('includes the current value and labels zero', () => {
    expect(dayOptions([7, 30], 45, 'Never').map((o) => o.label)).toEqual(['7 days', '30 days', '45 days']);
    expect(dayOptions([0, 1], 1, 'Never').map((o) => o.label)).toEqual(['Never', '1 day']);
  });

  it('describes refresh intervals', () => {
    expect(ttlLabel(30)).toBe('Every 30 minutes');
    expect(ttlLabel(60)).toBe('Every hour');
    expect(ttlLabel(90)).toBe('Every 1.5 hours');
    expect(ttlLabel(1440)).toBe('Once a day');
    expect(ttlLabel(2880)).toBe('Every 2 days');
    expect(ttlOptions(45).map((o) => o.value)).toContain('45');
  });
});

describe('backups', () => {
  it('names the file by local date', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe('jscout-backup-2026-01-05.json');
  });

  it('accepts a JScout backup and summarises it', () => {
    const text = JSON.stringify({
      app: 'jscout',
      formatVersion: 1,
      exportedAt: '2026-11-01T00:00:00.000Z',
      profile: {},
      savedSearches: [{}, {}],
      applications: [{}],
      userCompanies: [],
      hiddenJobs: 'oops',
    });
    const result = readBackup(text);
    expect(result.ok && result.summary).toEqual({
      exportedAt: '2026-11-01T00:00:00.000Z',
      savedSearches: 2,
      applications: 1,
      userCompanies: 0,
      hiddenJobs: 0,
    });
  });

  it('rejects other files with a reason', () => {
    expect(readBackup('not json')).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) });
    expect(readBackup('{"app":"other"}')).toMatchObject({ ok: false });
    expect(readBackup('{"app":"jscout","formatVersion":2,"profile":{}}')).toMatchObject({ ok: false, error: expect.stringMatching(/version/) });
    expect(readBackup('{"app":"jscout","formatVersion":1}')).toMatchObject({ ok: false, error: expect.stringMatching(/profile/) });
  });

  it('matches the reset phrase loosely', () => {
    expect(matchesResetPhrase('  Delete Everything ')).toBe(true);
    expect(matchesResetPhrase('delete')).toBe(false);
  });
});
