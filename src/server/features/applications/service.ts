import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ApplicationCreate, ApplicationEventCreate, ApplicationPatch, DocumentCreate } from '../../../shared/api';
import { STATUS_LABELS } from '../../../shared/constants';
import type {
  Application,
  ApplicationDetail,
  ApplicationDocument,
  ApplicationEvent,
  ApplicationStatus,
  DocumentKind,
  JobSnapshot,
} from '../../../shared/types';
import { ApiError, badRequest, notFound } from '../../errors';
import { foldText } from '../../lib/text';
import type { AppContext, ApplicationsService } from '../../services';
import { parse } from '../../validate';
import {
  type ApplicationRow,
  type DocumentRow,
  type EventRow,
  isStatus,
  statusEventTitle,
  statusOrderSql,
  toApplication,
  toDocument,
  toEvent,
  toIso,
} from './rows';
import { type ApplicationImport, applicationImportSchema } from './schemas';
import { manualSnapshot, mergeSnapshot, snapshotFromPosting } from './snapshot';
import { computeStats } from './stats';

/** Statuses that can only be reached after applying. */
const IMPLIES_APPLIED: ReadonlySet<ApplicationStatus> = new Set<ApplicationStatus>([
  'applied',
  'screening',
  'interviewing',
  'offer',
  'accepted',
]);
const DAY_MS = 86_400_000;
const FOLLOW_UP_AFTER_APPLYING_DAYS = 7;
const DEFAULT_CHECKLIST = ['Review the posting', 'Tailor résumé', 'Write cover letter', 'Submit application', 'Follow up'];
const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  'cover-letter': 'cover letter',
  answer: 'application answer',
  'resume-notes': 'résumé notes',
  email: 'email',
  other: 'document',
};

/**
 * jobClosed: the linked posting is closed. When that posting has left the index,
 * fall back to its cluster: closed only if every remaining copy is closed, so one
 * source dropping a job does not mark it closed while another still lists it.
 */
const SELECT_APPLICATIONS = `
  SELECT a.*,
    CASE
      WHEN j.id IS NOT NULL THEN j.closed_at IS NOT NULL
      WHEN a.cluster_key IS NOT NULL THEN
        EXISTS (SELECT 1 FROM jobs c WHERE c.cluster_key = a.cluster_key AND c.closed_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM jobs c WHERE c.cluster_key = a.cluster_key AND c.closed_at IS NULL)
      ELSE 0
    END AS job_closed
  FROM applications a
  LEFT JOIN jobs j ON j.id = a.job_id`;
const ORDER_APPLICATIONS = `ORDER BY ${statusOrderSql('a.status')}, a.sort_order, a.updated_at DESC`;

/** Give entries without an id (or with a duplicate one) a fresh id. */
function withIds<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.map((item) => {
    const id = item.id && !seen.has(item.id) ? item.id : randomUUID();
    seen.add(id);
    return { ...item, id };
  });
}

function matchesQuery(app: Application, terms: string[]): boolean {
  const haystack = foldText(`${app.job.title}\n${app.job.company}\n${app.notes}`);
  return terms.every((term) => haystack.includes(term));
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/**
 * Insert order for imported rows: oldest first, so rows sharing a timestamp keep their
 * order (reads tie-break on rowid). Exports list newest first, hence the reverse before
 * the stable sort.
 */
function oldestFirst<T>(items: T[], date: (item: T) => string): T[] {
  return [...items].reverse().sort((a, b) => (date(a) < date(b) ? -1 : date(a) > date(b) ? 1 : 0));
}

function importedSnapshot(job: ApplicationImport['job']): JobSnapshot {
  const { applyUrl, salaryText, postedAt, ...rest } = job;
  return mergeSnapshot(rest, {
    ...(applyUrl ? { applyUrl } : {}),
    ...(salaryText ? { salaryText } : {}),
    ...(postedAt ? { postedAt } : {}),
    // Backups can be edited by hand: never trust their HTML.
    descriptionHtml: rest.descriptionHtml,
  });
}

export function createApplicationsService(ctx: AppContext): ApplicationsService {
  const { db } = ctx;
  const nowIso = (): string => ctx.now().toISOString();

  function findRow(id: string): ApplicationRow | undefined {
    return db.get<ApplicationRow>(`${SELECT_APPLICATIONS} WHERE a.id = ?`, id);
  }

  function requireApplication(id: string): Application {
    const row = findRow(id);
    if (!row) throw notFound('Application');
    return toApplication(row);
  }

  function detail(id: string): ApplicationDetail {
    const app = requireApplication(id);
    const events = db
      .all<EventRow>('SELECT * FROM application_events WHERE application_id = ? ORDER BY at DESC, rowid DESC', id)
      .map(toEvent);
    const documents = db
      .all<DocumentRow>('SELECT * FROM documents WHERE application_id = ? ORDER BY created_at DESC, rowid DESC', id)
      .map(toDocument);
    return { ...app, events, documents };
  }

  /** sortOrder that puts an application above everything else in a status column. */
  function topOf(status: ApplicationStatus, excludeId = ''): number {
    const min = db.scalar<number | null>('SELECT MIN(sort_order) FROM applications WHERE status = ? AND id != ?', status, excludeId);
    return min === null || min === undefined ? 0 : min - 1;
  }

  function touch(id: string, at: string): void {
    db.run('UPDATE applications SET updated_at = ? WHERE id = ?', at, id);
  }

  function insertEvent(event: ApplicationEvent): void {
    db.run(
      'INSERT INTO application_events (id, application_id, at, type, title, detail) VALUES (?, ?, ?, ?, ?, ?)',
      event.id,
      event.applicationId,
      event.at,
      event.type,
      event.title,
      event.detail,
    );
  }

  function insertNew(input: {
    snapshot: JobSnapshot;
    status: ApplicationStatus;
    notes: string;
    jobId?: string;
    clusterKey?: string;
  }): ApplicationDetail {
    const id = randomUUID();
    const now = nowIso();
    const applied = input.status === 'applied';
    const hasApplied = IMPLIES_APPLIED.has(input.status);
    db.tx(() => {
      db.run(
        `INSERT INTO applications (id, job_id, cluster_key, status, job_snapshot, notes, priority, contacts, checklist,
           follow_up_at, applied_at, status_changed_at, created_at, updated_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, 0, '[]', ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.jobId ?? null,
        input.clusterKey ?? null,
        input.status,
        JSON.stringify(input.snapshot),
        input.notes,
        JSON.stringify(DEFAULT_CHECKLIST.map((label) => ({ id: randomUUID(), label, done: false }))),
        applied ? new Date(ctx.now().getTime() + FOLLOW_UP_AFTER_APPLYING_DAYS * DAY_MS).toISOString() : null,
        hasApplied ? now : null,
        now,
        now,
        now,
        topOf(input.status),
      );
      insertEvent({
        id: randomUUID(),
        applicationId: id,
        at: now,
        type: 'created',
        title: input.status === 'saved' ? 'Saved to tracker' : `Added as ${STATUS_LABELS[input.status]}`,
        detail: input.snapshot.sourceName ? `From ${input.snapshot.sourceName}` : '',
      });
    });
    return detail(id);
  }

  function createFromIndex(jobId: string, input: ApplicationCreate): ApplicationDetail {
    const jobs = ctx.services.jobs;
    const posting = jobs.getPosting(jobId);
    if (!posting) throw notFound('Job');
    // Saving is idempotent: any copy of the same job already tracked is returned as is.
    const existing = db.get<{ id: string }>(
      'SELECT id FROM applications WHERE cluster_key = ? OR job_id = ? ORDER BY updated_at DESC LIMIT 1',
      posting.clusterKey,
      jobId,
    );
    if (existing) return detail(existing.id);
    return insertNew({
      snapshot: snapshotFromPosting(posting, jobs.getDescriptionHtml(jobId)),
      status: input.status ?? 'saved',
      notes: input.notes ?? '',
      jobId,
      clusterKey: posting.clusterKey,
    });
  }

  function writeApplication(app: Application): void {
    db.run(
      `UPDATE applications SET status = ?, job_snapshot = ?, notes = ?, priority = ?, contacts = ?, checklist = ?,
         follow_up_at = ?, applied_at = ?, status_changed_at = ?, updated_at = ?, sort_order = ?
       WHERE id = ?`,
      app.status,
      JSON.stringify(app.job),
      app.notes,
      app.priority,
      JSON.stringify(app.contacts),
      JSON.stringify(app.checklist),
      app.followUpAt ?? null,
      app.appliedAt ?? null,
      app.statusChangedAt,
      app.updatedAt,
      app.sortOrder,
      app.id,
    );
  }

  function requireDocumentRow(id: string, docId: string): DocumentRow {
    requireApplication(id);
    const row = db.get<DocumentRow>('SELECT * FROM documents WHERE id = ? AND application_id = ?', docId, id);
    if (!row) throw notFound('Document');
    return row;
  }

  function upsertImported(item: ApplicationImport): void {
    const createdAt = toIso(item.createdAt, 'createdAt');
    const updatedAt = item.updatedAt ? toIso(item.updatedAt, 'updatedAt') : createdAt;
    db.run(
      `INSERT INTO applications (id, job_id, cluster_key, status, job_snapshot, notes, priority, contacts, checklist,
         follow_up_at, applied_at, status_changed_at, created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         job_id = excluded.job_id, cluster_key = excluded.cluster_key, status = excluded.status,
         job_snapshot = excluded.job_snapshot, notes = excluded.notes, priority = excluded.priority,
         contacts = excluded.contacts, checklist = excluded.checklist, follow_up_at = excluded.follow_up_at,
         applied_at = excluded.applied_at, status_changed_at = excluded.status_changed_at,
         created_at = excluded.created_at, updated_at = excluded.updated_at, sort_order = excluded.sort_order`,
      item.id,
      item.jobId || null,
      item.clusterKey || null,
      item.status,
      JSON.stringify(importedSnapshot(item.job)),
      item.notes,
      item.priority,
      JSON.stringify(withIds(item.contacts)),
      JSON.stringify(withIds(item.checklist)),
      item.followUpAt ? toIso(item.followUpAt, 'followUpAt') : null,
      item.appliedAt ? toIso(item.appliedAt, 'appliedAt') : null,
      item.statusChangedAt ? toIso(item.statusChangedAt, 'statusChangedAt') : updatedAt,
      createdAt,
      updatedAt,
      item.sortOrder,
    );
    const events = item.events.map((e) => ({ ...e, at: toIso(e.at, 'event.at') }));
    for (const e of oldestFirst(events, (e) => e.at)) {
      db.run(
        `INSERT INTO application_events (id, application_id, at, type, title, detail) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET application_id = excluded.application_id, at = excluded.at,
           type = excluded.type, title = excluded.title, detail = excluded.detail`,
        e.id,
        item.id,
        e.at,
        e.type,
        e.title,
        e.detail,
      );
    }
    const documents = item.documents.map((d) => ({ ...d, createdAt: toIso(d.createdAt, 'document.createdAt') }));
    for (const d of oldestFirst(documents, (d) => d.createdAt)) {
      db.run(
        `INSERT INTO documents (id, application_id, kind, title, content, generated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET application_id = excluded.application_id, kind = excluded.kind,
           title = excluded.title, content = excluded.content, generated_by = excluded.generated_by,
           created_at = excluded.created_at, updated_at = excluded.updated_at`,
        d.id,
        item.id,
        d.kind,
        d.title,
        d.content,
        d.generatedBy,
        d.createdAt,
        d.updatedAt ? toIso(d.updatedAt, 'document.updatedAt') : d.createdAt,
      );
    }
  }

  return {
    list(filter = {}) {
      const rows = filter.status
        ? db.all<ApplicationRow>(`${SELECT_APPLICATIONS} WHERE a.status = ? ${ORDER_APPLICATIONS}`, filter.status)
        : db.all<ApplicationRow>(`${SELECT_APPLICATIONS} ${ORDER_APPLICATIONS}`);
      const apps = rows.map(toApplication);
      const terms = foldText(filter.q ?? '').split(/\s+/).filter(Boolean);
      return terms.length > 0 ? apps.filter((app) => matchesQuery(app, terms)) : apps;
    },

    get(id) {
      return findRow(id) ? detail(id) : undefined;
    },

    create(input) {
      if (input.jobId !== undefined) return createFromIndex(input.jobId, input);
      if (input.job) {
        return insertNew({ snapshot: manualSnapshot(input.job), status: input.status ?? 'saved', notes: input.notes ?? '' });
      }
      throw badRequest('Provide either jobId or job details');
    },

    patch(id, input: ApplicationPatch) {
      return db.tx(() => {
        const current = requireApplication(id);
        // "Moving" to the current status is not a change (and must not reset its position).
        const patch = input.status === current.status ? { ...input, status: undefined } : input;
        if (!Object.values(patch).some((v) => v !== undefined)) return detail(id);
        const now = nowIso();
        const next: Application = { ...current, updatedAt: now };
        const statusChanged = patch.status !== undefined;

        if (patch.status !== undefined) {
          next.status = patch.status;
          next.statusChangedAt = now;
          next.sortOrder = topOf(patch.status, id);
          // Values given explicitly in the same patch win over these defaults.
          // Reaching screening or later means the user applied, even if they skipped the Applied column.
          if (IMPLIES_APPLIED.has(patch.status) && !current.appliedAt) next.appliedAt = now;
          if (patch.status === 'applied') {
            if (!current.followUpAt) {
              next.followUpAt = new Date(ctx.now().getTime() + FOLLOW_UP_AFTER_APPLYING_DAYS * DAY_MS).toISOString();
            }
          }
        }
        if (patch.notes !== undefined) next.notes = patch.notes;
        if (patch.priority !== undefined) next.priority = patch.priority;
        if (patch.contacts !== undefined) next.contacts = withIds(patch.contacts);
        if (patch.checklist !== undefined) next.checklist = withIds(patch.checklist);
        if (patch.followUpAt !== undefined) {
          if (patch.followUpAt === null) delete next.followUpAt;
          else next.followUpAt = toIso(patch.followUpAt, 'followUpAt');
        }
        if (patch.appliedAt !== undefined) {
          if (patch.appliedAt === null) delete next.appliedAt;
          else next.appliedAt = toIso(patch.appliedAt, 'appliedAt');
        }
        if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;
        if (patch.job !== undefined) next.job = mergeSnapshot(current.job, patch.job);

        writeApplication(next);
        if (statusChanged) {
          insertEvent({
            id: randomUUID(),
            applicationId: id,
            at: now,
            type: 'status',
            title: statusEventTitle(next.status),
            detail: `From ${STATUS_LABELS[current.status]}`,
          });
        }
        return detail(id);
      });
    },

    remove(id) {
      if (db.run('DELETE FROM applications WHERE id = ?', id).changes === 0) throw notFound('Application');
    },

    addEvent(id, input: ApplicationEventCreate) {
      requireApplication(id);
      const title = input.title.trim();
      if (!title) throw badRequest('Event title is required');
      const now = nowIso();
      const event: ApplicationEvent = {
        id: randomUUID(),
        applicationId: id,
        at: input.at ? toIso(input.at, 'at') : now,
        type: input.type,
        title,
        detail: input.detail ?? '',
      };
      db.tx(() => {
        insertEvent(event);
        touch(id, now);
      });
      return event;
    },

    removeEvent(id, eventId) {
      requireApplication(id);
      db.tx(() => {
        if (db.run('DELETE FROM application_events WHERE id = ? AND application_id = ?', eventId, id).changes === 0) {
          throw notFound('Event');
        }
        touch(id, nowIso());
      });
    },

    addDocument(id, input: DocumentCreate) {
      requireApplication(id);
      const title = input.title.trim();
      if (!title) throw badRequest('Document title is required');
      const now = nowIso();
      const doc: ApplicationDocument = {
        id: randomUUID(),
        applicationId: id,
        kind: input.kind,
        title,
        content: input.content,
        generatedBy: input.generatedBy,
        createdAt: now,
        updatedAt: now,
      };
      db.tx(() => {
        db.run(
          `INSERT INTO documents (id, application_id, kind, title, content, generated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          doc.id,
          id,
          doc.kind,
          doc.title,
          doc.content,
          doc.generatedBy,
          now,
          now,
        );
        insertEvent({
          id: randomUUID(),
          applicationId: id,
          at: now,
          type: 'document',
          title: `Added ${DOCUMENT_LABELS[doc.kind]}`,
          detail: doc.title,
        });
        touch(id, now);
      });
      return doc;
    },

    patchDocument(id, docId, patch) {
      const row = requireDocumentRow(id, docId);
      if (patch.title === undefined && patch.content === undefined) return toDocument(row);
      const title = patch.title === undefined ? row.title : patch.title.trim();
      if (!title) throw badRequest('Document title is required');
      const now = nowIso();
      const content = patch.content ?? row.content;
      db.tx(() => {
        db.run('UPDATE documents SET title = ?, content = ?, updated_at = ? WHERE id = ?', title, content, now, docId);
        touch(id, now);
      });
      return toDocument({ ...row, title, content, updated_at: now });
    },

    removeDocument(id, docId) {
      requireDocumentRow(id, docId);
      db.tx(() => {
        db.run('DELETE FROM documents WHERE id = ?', docId);
        touch(id, nowIso());
      });
    },

    stats() {
      return computeStats(db, ctx.now());
    },

    stateByCluster(clusterKeys) {
      const result = new Map<string, { applicationId: string; status: ApplicationStatus }>();
      const keys = [...new Set(clusterKeys.filter(Boolean))];
      if (keys.length === 0) return result;
      // One JSON parameter instead of an IN list: no bound-variable limit, one cached statement.
      const rows = db.all<{ id: string; cluster_key: string; status: string }>(
        `SELECT id, cluster_key, status FROM applications
         WHERE cluster_key IN (SELECT value FROM json_each(?))
         ORDER BY updated_at ASC, rowid ASC`,
        JSON.stringify(keys),
      );
      // Ascending order: the most recently updated application per cluster is set last and wins.
      for (const row of rows) {
        result.set(row.cluster_key, { applicationId: row.id, status: isStatus(row.status) ? row.status : 'saved' });
      }
      return result;
    },

    exportAll() {
      const apps = db.all<ApplicationRow>(`${SELECT_APPLICATIONS} ${ORDER_APPLICATIONS}`).map(toApplication);
      const events = groupBy(
        db.all<EventRow>('SELECT * FROM application_events ORDER BY at DESC, rowid DESC').map(toEvent),
        (e) => e.applicationId,
      );
      const documents = groupBy(
        db.all<DocumentRow>('SELECT * FROM documents ORDER BY created_at DESC, rowid DESC').map(toDocument),
        (d) => d.applicationId,
      );
      return apps.map((app) => ({ ...app, events: events.get(app.id) ?? [], documents: documents.get(app.id) ?? [] }));
    },

    importAll(items) {
      let parsed: ApplicationImport[];
      try {
        parsed = parse(z.array(applicationImportSchema), items);
      } catch (err) {
        if (err instanceof ApiError) throw badRequest(`applications.${err.message}`, err.details);
        throw err;
      }
      db.tx(() => {
        for (const item of parsed) upsertImported(item);
      });
      return parsed.length;
    },

    clear() {
      db.tx(() => {
        db.run('DELETE FROM application_events');
        db.run('DELETE FROM documents');
        db.run('DELETE FROM applications');
      });
    },
  };
}
