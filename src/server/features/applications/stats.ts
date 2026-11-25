import { ACTIVE_STATUSES, APPLICATION_STATUSES } from '../../../shared/constants';
import type { ApplicationStats, ApplicationStatus } from '../../../shared/types';
import { type Db, placeholders } from '../../db';
import { isStatus, statusEventTitle } from './rows';

const DAY_MS = 86_400_000;
/** Statuses that mean the employer responded to an application. */
const RESPONDED: ApplicationStatus[] = ['screening', 'interviewing', 'offer', 'accepted'];
const RESPONDED_TITLES = RESPONDED.map(statusEventTitle);

export function computeStats(db: Db, now: Date): ApplicationStats {
  const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  let total = 0;
  for (const row of db.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM applications GROUP BY status')) {
    if (isStatus(row.status)) byStatus[row.status] = row.n;
    total += row.n;
  }

  // "Today or earlier" in the user's local day: the server runs on their own computer.
  const startOfTomorrow = new Date(now);
  startOfTomorrow.setHours(24, 0, 0, 0);
  const followUpsDue = Number(
    db.scalar(
      `SELECT COUNT(*) FROM applications
       WHERE status IN (${placeholders(ACTIVE_STATUSES.length)}) AND follow_up_at IS NOT NULL AND follow_up_at < ?`,
      ...ACTIVE_STATUSES,
      startOfTomorrow.toISOString(),
    ) ?? 0,
  );

  const nowIso = now.toISOString();
  const appliedSince = (days: number): number =>
    Number(
      db.scalar(
        'SELECT COUNT(*) FROM applications WHERE applied_at >= ? AND applied_at <= ?',
        new Date(now.getTime() - days * DAY_MS).toISOString(),
        nowIso,
      ) ?? 0,
    );

  const applied = Number(db.scalar('SELECT COUNT(*) FROM applications WHERE applied_at IS NOT NULL') ?? 0);
  // Reached a response stage now or at any point before (e.g. rejected after interviewing).
  const responded = Number(
    db.scalar(
      `SELECT COUNT(*) FROM applications a
       WHERE a.applied_at IS NOT NULL
         AND (a.status IN (${placeholders(RESPONDED.length)})
              OR EXISTS (SELECT 1 FROM application_events e
                         WHERE e.application_id = a.id AND e.type = 'status'
                           AND e.title IN (${placeholders(RESPONDED_TITLES.length)})))`,
      ...RESPONDED,
      ...RESPONDED_TITLES,
    ) ?? 0,
  );

  return {
    total,
    byStatus,
    followUpsDue,
    appliedLast7Days: appliedSince(7),
    appliedLast30Days: appliedSince(30),
    responseRate: applied === 0 ? null : responded / applied,
  };
}
