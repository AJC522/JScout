/** Pure helpers for editing a Profile on the client: applying patches, merging lists, reordering. */
import type { ProfilePatch } from '../../../shared/api';
import type { Profile } from '../../../shared/types';

/** What the server will store for `patch`, so the cache can show it before the request finishes. */
export function applyProfilePatch(profile: Profile, patch: ProfilePatch): Profile {
  return {
    ...profile,
    personal: patch.personal ? { ...profile.personal, ...patch.personal } : profile.personal,
    work: patch.work ? { ...profile.work, ...patch.work } : profile.work,
    preferences: patch.preferences ? { ...profile.preferences, ...patch.preferences } : profile.preferences,
    experience: patch.experience ?? profile.experience,
    education: patch.education ?? profile.education,
    answers: patch.answers ?? profile.answers,
    onboardedAt: patch.onboardedAt !== undefined ? patch.onboardedAt : profile.onboardedAt,
  };
}

export function isEmptyPatch(patch: ProfilePatch): boolean {
  return Object.values(patch).every((value) => value === undefined);
}

const key = (value: string) => value.trim().toLowerCase();

/** `existing` followed by the additions it does not already contain (case-insensitive), trimmed and de-duplicated. */
export function mergeUnique(existing: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set(existing.map(key));
  const out = [...existing];
  for (const raw of additions) {
    const value = raw.trim();
    if (!value || seen.has(key(value))) continue;
    seen.add(key(value));
    out.push(value);
  }
  return out;
}

/** Items of `additions` that `existing` lacks (case-insensitive). */
export function missingFrom(existing: readonly string[], additions: readonly string[]): string[] {
  return mergeUnique(existing, additions).slice(existing.length);
}

/** A copy of `list` with the item at `from` moved to `to`; out-of-range moves return the list unchanged. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [item] = out.splice(from, 1);
  if (item !== undefined) out.splice(to, 0, item);
  return out;
}

/** Replace the item with the same id, or append it when it is new. */
export function upsertById<T extends { id: string }>(list: readonly T[], item: T): T[] {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) return [...list, item];
  return list.map((entry, i) => (i === index ? item : entry));
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Structural equality for plain JSON values (drafts vs. saved data). */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
