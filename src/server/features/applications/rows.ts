/** Row shapes of the tracker tables and their mapping to domain types. */
import { APPLICATION_STATUSES, STATUS_LABELS } from '../../../shared/constants';
import type {
  Application,
  ApplicationContact,
  ApplicationDocument,
  ApplicationEvent,
  ApplicationStatus,
  ChecklistItem,
  JobSnapshot,
} from '../../../shared/types';
import { parseJson } from '../../db';
import { badRequest } from '../../errors';

export interface ApplicationRow {
  id: string;
  job_id: string | null;
  cluster_key: string | null;
  status: string;
  job_snapshot: string;
  notes: string;
  priority: number;
  contacts: string;
  checklist: string;
  follow_up_at: string | null;
  applied_at: string | null;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
  sort_order: number;
  /** Only present on queries that join the jobs table. */
  job_closed?: number;
}

export interface EventRow {
  id: string;
  application_id: string;
  at: string;
  type: string;
  title: string;
  detail: string;
}

export interface DocumentRow {
  id: string;
  application_id: string;
  kind: string;
  title: string;
  content: string;
  generated_by: string;
  created_at: string;
  updated_at: string;
}

const STATUS_SET = new Set<string>(APPLICATION_STATUSES);

export function isStatus(value: string): value is ApplicationStatus {
  return STATUS_SET.has(value);
}

/** Title of the event recorded on a status change; stats() relies on it to find past statuses. */
export function statusEventTitle(status: ApplicationStatus): string {
  return `Moved to ${STATUS_LABELS[status]}`;
}

/** `CASE` expression ranking a status column in pipeline order (values come from constants, not input). */
export function statusOrderSql(column: string): string {
  const whens = APPLICATION_STATUSES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ');
  return `CASE ${column} ${whens} ELSE ${APPLICATION_STATUSES.length} END`;
}

/** Normalise any parseable date to a canonical ISO string so that string comparison orders correctly. */
export function toIso(value: string, field = 'date'): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw badRequest(`${field} must be an ISO-8601 date`);
  return new Date(ms).toISOString();
}

const FALLBACK_SNAPSHOT: JobSnapshot = {
  title: 'Untitled job',
  company: '',
  locationText: '',
  remote: 'unknown',
  url: '',
  source: 'manual',
  sourceName: '',
  employmentType: 'unknown',
  skills: [],
  descriptionHtml: '',
};

function toPriority(value: number): Application['priority'] {
  return value === 1 || value === 2 || value === 3 ? value : 0;
}

export function toApplication(row: ApplicationRow): Application {
  const app: Application = {
    id: row.id,
    status: isStatus(row.status) ? row.status : 'saved',
    job: { ...FALLBACK_SNAPSHOT, ...parseJson<Partial<JobSnapshot>>(row.job_snapshot, {}) },
    notes: row.notes,
    priority: toPriority(row.priority),
    contacts: parseJson<ApplicationContact[]>(row.contacts, []),
    checklist: parseJson<ChecklistItem[]>(row.checklist, []),
    statusChangedAt: row.status_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order,
    jobClosed: row.job_closed === 1,
  };
  if (row.job_id) app.jobId = row.job_id;
  if (row.cluster_key) app.clusterKey = row.cluster_key;
  if (row.follow_up_at) app.followUpAt = row.follow_up_at;
  if (row.applied_at) app.appliedAt = row.applied_at;
  return app;
}

export function toEvent(row: EventRow): ApplicationEvent {
  return {
    id: row.id,
    applicationId: row.application_id,
    at: row.at,
    type: row.type as ApplicationEvent['type'],
    title: row.title,
    detail: row.detail,
  };
}

export function toDocument(row: DocumentRow): ApplicationDocument {
  return {
    id: row.id,
    applicationId: row.application_id,
    kind: row.kind as ApplicationDocument['kind'],
    title: row.title,
    content: row.content,
    generatedBy: row.generated_by as ApplicationDocument['generatedBy'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
