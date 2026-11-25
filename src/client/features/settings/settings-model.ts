/** Pure helpers for the settings page: optimistic settings updates, option lists, backup files. */
import type { DataExport } from '../../../shared/api';
import type { AppSettings, AppSettingsUpdate } from '../../../shared/types';

/** What the server will store for `update`; the key itself never reaches the client, only whether one is saved. */
export function applySettingsUpdate(settings: AppSettings, update: AppSettingsUpdate): AppSettings {
  const { ai, ...rest } = update;
  const next: AppSettings = { ...settings, ...rest, ai: { ...settings.ai } };
  if (ai?.model !== undefined) next.ai.model = ai.model;
  if (ai?.apiKey !== undefined) {
    const saved = ai.apiKey !== null && ai.apiKey.trim() !== '';
    // Optimistic guess; the server's reply says whether an environment key takes over after removal.
    next.ai.hasKey = saved;
    next.ai.keySource = saved ? 'saved' : null;
  }
  return next;
}

/**
 * What removing the saved key did, judged from the settings the server returned. With no key
 * saved, the server falls back to the ANTHROPIC_API_KEY environment variable, so a key can still
 * be in use afterwards; saying "removed" then would be wrong.
 */
export function keyRemovalResult(saved: AppSettings): 'removed' | 'env-key-in-use' {
  return saved.ai.keySource === 'environment' ? 'env-key-in-use' : 'removed';
}

/** Choices for a "days" setting, always including the current value so it is never shown wrongly. */
export function dayOptions(presets: readonly number[], current: number, zeroLabel: string): Array<{ value: string; label: string }> {
  return [...new Set([...presets, current])]
    .sort((a, b) => a - b)
    .map((days) => ({ value: String(days), label: days === 0 ? zeroLabel : days === 1 ? '1 day' : `${days} days` }));
}

/** "Every 6 hours"-style labels for a source's refresh interval. */
export function ttlOptions(current: number): Array<{ value: string; label: string }> {
  return [...new Set([30, 60, 180, 360, 720, 1440, current])]
    .sort((a, b) => a - b)
    .map((minutes) => ({ value: String(minutes), label: ttlLabel(minutes) }));
}

export function ttlLabel(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} minutes`;
  const hours = minutes / 60;
  if (hours === 1) return 'Every hour';
  if (hours < 24 || hours % 24 !== 0) return `Every ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
  return hours === 24 ? 'Once a day' : `Every ${hours / 24} days`;
}

/** "jscout-backup-2026-11-25.json", using the local date. */
export function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `jscout-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

export interface BackupSummary {
  exportedAt: string | null;
  savedSearches: number;
  applications: number;
  userCompanies: number;
  hiddenJobs: number;
}

/**
 * Check that a file is a JScout backup before sending it. The server validates it fully;
 * this only catches the wrong file early and describes what is in it for the confirmation.
 */
export function readBackup(text: string): { ok: true; backup: DataExport; summary: BackupSummary } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a JScout backup (it is not valid JSON).' };
  }
  if (typeof data !== 'object' || data === null || (data as { app?: unknown }).app !== 'jscout') {
    return { ok: false, error: 'This file is not a JScout backup.' };
  }
  const backup = data as DataExport;
  if (backup.formatVersion !== 1) return { ok: false, error: 'This backup was made by a different version of JScout and cannot be imported.' };
  if (typeof backup.profile !== 'object' || backup.profile === null) return { ok: false, error: 'This backup has no profile in it.' };
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  return {
    ok: true,
    backup,
    summary: {
      exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : null,
      savedSearches: count(backup.savedSearches),
      applications: count(backup.applications),
      userCompanies: count(backup.userCompanies),
      hiddenJobs: count(backup.hiddenJobs),
    },
  };
}

/** The phrase a user types to confirm deleting everything. */
export const RESET_PHRASE = 'delete everything';

export function matchesResetPhrase(typed: string): boolean {
  return typed.trim().toLowerCase() === RESET_PHRASE;
}
