/** Small pieces of job presentation shared by the result cards and the detail view. */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { STATUS_LABELS } from '../../../shared/constants';
import type { ApplicationStatus, MatchExplanation, RemoteMode } from '../../../shared/types';
import { Badge, ScoreRing, Tooltip, type Tone } from '../../components/ui';
import { cn } from '../../lib/cn';

const STATUS_TONE: Record<ApplicationStatus, Tone> = {
  saved: 'primary',
  applied: 'info',
  screening: 'info',
  interviewing: 'accent',
  offer: 'success',
  accepted: 'success',
  rejected: 'neutral',
  withdrawn: 'neutral',
};

export function StatusBadge({ status, className }: { status: ApplicationStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} size="sm" dot className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** Remote and hybrid get a badge; on-site and unknown say enough through the location text. */
export function RemoteBadge({ mode, className }: { mode: RemoteMode; className?: string }) {
  if (mode === 'remote')
    return (
      <Badge tone="success" size="sm" className={className}>
        Remote
      </Badge>
    );
  if (mode === 'hybrid')
    return (
      <Badge tone="info" size="sm" className={className}>
        Hybrid
      </Badge>
    );
  return null;
}

/** Positive reasons first, strongest first. */
export function topReasons(match: MatchExplanation, limit = 3) {
  return match.reasons.filter((r) => r.points > 0).toSorted((a, b) => b.points - a.points).slice(0, limit);
}

/** Compact score ring whose tooltip (hover or keyboard focus) lists the main reasons for the score. */
export function MatchScore({ score, match, className }: { score: number; match: MatchExplanation; className?: string }) {
  const reasons = topReasons(match);
  const rounded = Math.round(score);
  return (
    <Tooltip
      side="left"
      content={
        <div className="max-w-60 space-y-1 py-0.5">
          <p className="font-medium">Match {rounded} of 100</p>
          {reasons.length > 0 ? (
            <ul className="space-y-0.5">
              {reasons.map((r) => (
                <li key={r.key}>{r.label}</li>
              ))}
            </ul>
          ) : (
            <p>Matches your search terms.</p>
          )}
        </div>
      }
    >
      <button
        type="button"
        aria-label={`Match ${rounded} of 100${reasons.length ? `: ${reasons.map((r) => r.label).join('; ')}` : ''}`}
        className={cn('shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none', className)}
      >
        <ScoreRing value={rounded} size="sm" />
      </button>
    </Tooltip>
  );
}

/** Plain-text list of where else a posting appears: "Remotive +2 other sources". */
export function sourceLine(sourceName: string, duplicates: number): string {
  if (duplicates <= 0) return sourceName;
  return `${sourceName} +${duplicates} other ${duplicates === 1 ? 'source' : 'sources'}`;
}

/** Icon-only link styled like a small ghost IconButton (the kit's IconButton renders a <button>). */
export function IconLink({ to, label, icon, external = false }: { to: string; label: string; icon: ReactNode; external?: boolean }) {
  const classes =
    'inline-flex size-7 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none [&_svg]:size-4';
  return (
    <Tooltip content={label}>
      {external ? (
        <a href={to} target="_blank" rel="noopener noreferrer" aria-label={label} className={classes}>
          {icon}
        </a>
      ) : (
        <Link to={to} aria-label={label} className={classes}>
          {icon}
        </Link>
      )}
    </Tooltip>
  );
}
