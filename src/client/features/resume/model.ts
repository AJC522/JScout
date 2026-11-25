/** Pure helpers for the résumé review: labels, ordering, the selected target, the download file name. */
import type {
  BulletIssue,
  RecommendationPriority,
  RequirementCheck,
  RequirementStatus,
  ResumeScoreSummary,
  ResumeTarget,
} from '../../../shared/types';
import type { Tone } from '../../components/ui';

/** A stable key for a target ('' when there is none), e.g. to reset drafts when the job changes. */
export function targetKey(target: ResumeTarget): string {
  if (target.posting) return `posting:${target.posting.title}\u0000${target.posting.company ?? ''}\u0000${target.posting.description}`;
  if (target.applicationId) return `application:${target.applicationId}`;
  if (target.jobId) return `job:${target.jobId}`;
  return '';
}

export const PRIORITY_LABELS: Record<RecommendationPriority, string> = { high: 'High impact', medium: 'Worth doing', low: 'Polish' };
export const PRIORITY_TONES: Record<RecommendationPriority, Tone> = { high: 'danger', medium: 'warning', low: 'neutral' };

export const STATUS_LABELS: Record<RequirementStatus, string> = { met: 'Shown', partial: 'Partly shown', missing: 'Not shown' };

export const ISSUE_LABELS: Record<BulletIssue, string> = {
  'weak-start': 'Weak opener',
  'no-metric': 'No number',
  'too-long': 'Long',
  'too-short': 'Very short',
  'first-person': 'Uses “I”',
  passive: 'Passive',
};

/** Required first, then nice-to-haves; within each, what needs attention first. */
export function groupRequirements(requirements: RequirementCheck[]): { required: RequirementCheck[]; preferred: RequirementCheck[] } {
  const order: Record<RequirementStatus, number> = { missing: 0, partial: 1, met: 2 };
  const sorted = (level: RequirementCheck['level']) =>
    requirements
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.level === level)
      .sort((a, b) => order[a.r.status] - order[b.r.status] || a.i - b.i)
      .map(({ r }) => r);
  return { required: sorted('required'), preferred: sorted('preferred') };
}

/** Applications ordered for picking: lowest score first, since those need the most work. */
export function sortScores(scores: ResumeScoreSummary[], by: 'score' | 'title'): ResumeScoreSummary[] {
  return [...scores].sort((a, b) =>
    by === 'score' ? a.score - b.score || a.title.localeCompare(b.title) : a.title.localeCompare(b.title) || a.score - b.score,
  );
}

/** "Résumé – Lumen Pay.txt": safe on every operating system. */
export function draftFileName(job: { title: string; company: string }): string {
  const name = (job.company || job.title || 'tailored')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `Résumé – ${name || 'tailored'}.txt`;
}

/** "+12", "−4", "±0". */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return '±0';
}
