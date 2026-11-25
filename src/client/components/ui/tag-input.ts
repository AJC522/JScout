/** Pure helpers behind TagInput: splitting typed or pasted text into tags and merging them without duplicates. */

/** Characters that end a tag when typed or pasted. */
const SEPARATORS = /[,;\n\r\t]+/;

/** Longest tag kept; longer pasted fragments are almost always a mistake (a whole sentence). */
export const MAX_TAG_LENGTH = 80;

/** Trim and collapse inner whitespace: "  React   Native " -> "React Native". */
export function normalizeTag(tag: string): string {
  return tag.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
}

/** "a, b;c\nd" -> ["a", "b", "c", "d"]; empty pieces are dropped. */
export function splitTags(text: string): string[] {
  return text.split(SEPARATORS).map(normalizeTag).filter((tag) => tag !== '');
}

/**
 * Splits what is in the text box while typing: complete pieces (followed by a separator)
 * become tags, the unfinished remainder stays in the box. "go, rust, ty" -> { tags: [go, rust], rest: "ty" }.
 */
export function splitTyped(text: string): { tags: string[]; rest: string } {
  const pieces = text.split(SEPARATORS);
  if (pieces.length < 2) return { tags: [], rest: text };
  const rest = pieces.pop() ?? '';
  return { tags: pieces.map(normalizeTag).filter((tag) => tag !== ''), rest: rest.trimStart() };
}

export function hasTag(tags: readonly string[], tag: string): boolean {
  const key = normalizeTag(tag).toLowerCase();
  return tags.some((existing) => existing.toLowerCase() === key);
}

export interface MergeResult {
  tags: string[];
  /** Newly added, in order. */
  added: string[];
  /** Already present (case-insensitive) or repeated in the input. */
  duplicates: string[];
  /** Dropped because `max` was reached. */
  overflow: string[];
}

/** Append `incoming` to `existing`, skipping blanks and case-insensitive duplicates, up to `max` tags. */
export function mergeTags(existing: readonly string[], incoming: readonly string[], max = Number.POSITIVE_INFINITY): MergeResult {
  const tags = [...existing];
  const result: MergeResult = { tags, added: [], duplicates: [], overflow: [] };
  for (const raw of incoming) {
    const tag = normalizeTag(raw);
    if (tag === '') continue;
    if (hasTag(tags, tag)) result.duplicates.push(tag);
    else if (tags.length >= max) result.overflow.push(tag);
    else {
      tags.push(tag);
      result.added.push(tag);
    }
  }
  return result;
}
