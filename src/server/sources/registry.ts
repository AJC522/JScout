import type { JobSource } from './types';

/**
 * Every adapter the app knows. Adapters are added here by importing their
 * module and listing the exported source; order is the display order in Settings.
 */
export const SOURCES: JobSource[] = [];

export function getSource(id: string): JobSource | undefined {
  return SOURCES.find((s) => s.def.id === id);
}
