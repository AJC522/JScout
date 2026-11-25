import { arbeitnowSource } from './arbeitnow';
import { ashbySource } from './ashby';
import { greenhouseSource } from './greenhouse';
import { himalayasSource } from './himalayas';
import { hnHiringSource } from './hn-hiring';
import { jobicySource } from './jobicy';
import { leverSource } from './lever';
import { remoteokSource } from './remoteok';
import { remotiveSource } from './remotive';
import type { JobSource } from './types';
import { weworkremotelySource } from './weworkremotely';
import { workingnomadsSource } from './workingnomads';

/**
 * Every adapter the app knows. Adapters are added here by importing their
 * module and listing the exported source; order is the display order in Settings.
 */
export const SOURCES: JobSource[] = [
  greenhouseSource,
  leverSource,
  ashbySource,
  remotiveSource,
  remoteokSource,
  jobicySource,
  weworkremotelySource,
  workingnomadsSource,
  himalayasSource,
  arbeitnowSource,
  hnHiringSource,
];

export function getSource(id: string): JobSource | undefined {
  return SOURCES.find((s) => s.def.id === id);
}
