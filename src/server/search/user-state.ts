import { z } from 'zod';
import type { DataExport } from '../../shared/api';
import { isoDateSchema } from '../../shared/schemas';
import type { JobUserState } from '../../shared/types';
import { ApiError, badRequest } from '../errors';
import type { AppContext, UserStateService } from '../services';
import { parse } from '../validate';

const hiddenImportSchema = z.array(
  z.object({
    clusterKey: z.string().trim().min(1).max(200),
    hiddenAt: isoDateSchema,
  }),
);

/**
 * Hidden and viewed jobs, keyed by cluster so every copy of a job shares the state.
 * Cluster keys are passed as one JSON parameter (json_each), which has no bound-variable
 * limit however many results a page decorates.
 */
export function createUserStateService(ctx: AppContext): UserStateService {
  const { db } = ctx;

  function forClusters(clusterKeys: string[]): Map<string, JobUserState> {
    const result = new Map<string, JobUserState>();
    const keys = [...new Set(clusterKeys)];
    for (const key of keys) result.set(key, { hidden: false });
    const present = keys.filter(Boolean);
    if (present.length === 0) return result;
    const json = JSON.stringify(present);

    for (const { cluster_key } of db.all<{ cluster_key: string }>(
      'SELECT cluster_key FROM hidden_jobs WHERE cluster_key IN (SELECT value FROM json_each(?))',
      json,
    )) {
      const state = result.get(cluster_key);
      if (state) state.hidden = true;
    }
    for (const { cluster_key, viewed_at } of db.all<{ cluster_key: string; viewed_at: string }>(
      'SELECT cluster_key, viewed_at FROM job_views WHERE cluster_key IN (SELECT value FROM json_each(?))',
      json,
    )) {
      const state = result.get(cluster_key);
      if (state) state.viewedAt = viewed_at;
    }
    for (const [key, app] of ctx.services.applications.stateByCluster(present)) {
      const state = result.get(key);
      if (state) {
        state.applicationId = app.applicationId;
        state.applicationStatus = app.status;
      }
    }
    return result;
  }

  return {
    forClusters,

    forCluster(clusterKey) {
      return forClusters([clusterKey]).get(clusterKey) ?? { hidden: false };
    },

    hide(job) {
      // Re-hiding keeps the original timestamp but remembers the copy hidden most recently.
      db.run(
        `INSERT INTO hidden_jobs (cluster_key, job_id, hidden_at) VALUES (?, ?, ?)
         ON CONFLICT (cluster_key) DO UPDATE SET job_id = excluded.job_id`,
        job.clusterKey,
        job.id,
        ctx.now().toISOString(),
      );
    },

    unhide(clusterKey) {
      db.run('DELETE FROM hidden_jobs WHERE cluster_key = ?', clusterKey);
    },

    markViewed(job) {
      db.run(
        `INSERT INTO job_views (cluster_key, job_id, viewed_at) VALUES (?, ?, ?)
         ON CONFLICT (cluster_key) DO UPDATE SET job_id = excluded.job_id, viewed_at = MAX(viewed_at, excluded.viewed_at)`,
        job.clusterKey,
        job.id,
        ctx.now().toISOString(),
      );
    },

    exportHidden(): DataExport['hiddenJobs'] {
      return db
        .all<{ cluster_key: string; hidden_at: string }>('SELECT cluster_key, hidden_at FROM hidden_jobs ORDER BY hidden_at, cluster_key')
        .map((r) => ({ clusterKey: r.cluster_key, hiddenAt: r.hidden_at }));
    },

    importHidden(items) {
      let parsed: z.infer<typeof hiddenImportSchema>;
      try {
        parsed = parse(hiddenImportSchema, items);
      } catch (err) {
        if (err instanceof ApiError) throw badRequest(`hiddenJobs.${err.message}`, err.details);
        throw err;
      }
      db.tx(() => {
        for (const item of parsed) {
          db.run(
            `INSERT INTO hidden_jobs (cluster_key, job_id, hidden_at) VALUES (?, NULL, ?)
             ON CONFLICT (cluster_key) DO UPDATE SET hidden_at = excluded.hidden_at`,
            item.clusterKey,
            new Date(item.hiddenAt).toISOString(),
          );
        }
      });
      return parsed.length;
    },

    clear() {
      db.tx(() => {
        db.run('DELETE FROM hidden_jobs');
        db.run('DELETE FROM job_views');
      });
    },
  };
}
