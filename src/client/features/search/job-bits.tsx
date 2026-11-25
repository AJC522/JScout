/** Small pieces of job presentation shared by the result cards and the detail view. */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { type ClearanceStanding, clearanceFit } from '../../../shared/clearance';
import { CLEARANCE_DESCRIPTIONS, CLEARANCE_LABELS, CLEARANCE_LEVEL_LABELS, STATUS_LABELS } from '../../../shared/constants';
import type {
  ApplicationStatus,
  HeldClearance,
  JobClearance,
  LocationFit,
  MatchExplanation,
  PolygraphKind,
  ProfileFit,
  RemoteMode,
} from '../../../shared/types';
import { useProfile } from '../profile/profile-api';
import { Badge, ScoreRing, Tooltip, type Tone } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatSalary } from '../../lib/format';

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

/** The clearance the user holds, from their profile (null = none or not loaded yet). */
export function useHeldClearance(): HeldClearance | null {
  return useProfile().data?.work.clearance ?? null;
}

const POLY_SHORT: Record<PolygraphKind, string> = { polygraph: 'poly', ci: 'CI poly', 'full-scope': 'FS poly' };

/** "Must hold TS/SCI + FS poly", "Sponsors Secret", "Clearance required", "No clearance needed". */
export function clearanceBadgeLabel(c: JobClearance): string {
  if (c.requirement === 'none') return 'No clearance needed';
  const level = c.level ? CLEARANCE_LEVEL_LABELS[c.level] : undefined;
  const poly = c.polygraph ? ` + ${POLY_SHORT[c.polygraph]}` : '';
  switch (c.requirement) {
    case 'active':
      return `Must hold ${level ?? 'clearance'}${poly}`;
    case 'sponsored':
      return `Sponsors ${level ?? 'clearance'}${poly}`;
    case 'preferred':
      return `${level ?? 'Clearance'} preferred`;
    default:
      return `${level ?? 'Clearance'} required${poly}`;
  }
}

const STANDING_TONE: Record<ClearanceStanding, Tone> = { meets: 'success', short: 'danger', sponsored: 'info', ask: 'warning', clear: 'neutral' };

function StandingIcon({ standing }: { standing: ClearanceStanding }) {
  if (standing === 'meets') return <ShieldCheck aria-hidden="true" />;
  if (standing === 'short' || standing === 'ask') return <ShieldAlert aria-hidden="true" />;
  return <Shield aria-hidden="true" />;
}

/**
 * What the posting asks for in the way of a security clearance, coloured by whether the user's own
 * clearance answers it: green (you hold it), red (you'd have to bring one), amber (unclear: ask),
 * blue (they sponsor it), grey (not needed or only preferred).
 */
export function ClearanceBadge({ clearance, held, className }: { clearance: JobClearance | undefined; held: HeldClearance | null; className?: string }) {
  if (!clearance) return null;
  const fit = clearanceFit(clearance, held);
  const label = clearanceBadgeLabel(clearance);
  return (
    <Tooltip
      content={
        <div className="max-w-72 space-y-1 py-0.5 font-normal">
          <p className="font-medium">{CLEARANCE_LABELS[clearance.requirement]}</p>
          <p>{CLEARANCE_DESCRIPTIONS[clearance.requirement]}</p>
          {held || fit.standing === 'meets' ? <p className="opacity-90">{fit.note}</p> : null}
          {clearance.evidence ? <p className="italic opacity-80">“{clearance.evidence}”</p> : null}
        </div>
      }
    >
      <Badge
        tone={STANDING_TONE[fit.standing]}
        size="sm"
        tabIndex={0}
        aria-label={`${label}. ${fit.note}`}
        icon={<StandingIcon standing={fit.standing} />}
        className={cn('cursor-default focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none', className)}
      >
        {label}
      </Badge>
    </Tooltip>
  );
}

/** Positive reasons first, strongest first. */
export function topReasons(match: MatchExplanation, limit = 3) {
  return match.reasons.filter((r) => r.points > 0).toSorted((a, b) => b.points - a.points).slice(0, limit);
}

/** A profile match with a percentage to show (the profile had something to compare). */
export function hasPercent(fit: ProfileFit | undefined): fit is ProfileFit & { percent: number } {
  return fit !== undefined && fit.percent !== null;
}

/** "$145k/yr" for the yearly pay used in ordering (the middle of the posted range). */
export function payLabel(fit: ProfileFit): string | undefined {
  if (!fit.pay) return undefined;
  const { annual, currency } = fit.pay;
  return formatSalary({ min: annual, max: annual, currency, period: 'year' });
}

/**
 * A short word on where the job is relative to the user, for result cards: the location text already
 * names the place and remote jobs have a badge, so only distance and "not where you are" are worth adding.
 */
export function locationNote(location: LocationFit): string | undefined {
  switch (location.kind) {
    case 'local':
      return location.distanceKm ? `${location.distanceKm} km away` : undefined;
    case 'area':
    case 'country':
    case 'abroad':
    case 'remote-elsewhere':
      return location.label;
    default:
      return undefined;
  }
}

/** Score ring for the profile match: the percentage, with the parts, location and pay in its tooltip. */
function ProfileMatchScore({ fit, className }: { fit: ProfileFit & { percent: number }; className?: string }) {
  const pay = payLabel(fit);
  const summary = `${fit.percent}% match: ${fit.parts.map((p) => p.label).join('; ')}`;
  return (
    <Tooltip
      side="left"
      content={
        <div className="max-w-64 space-y-1 py-0.5">
          <p className="font-medium">
            {fit.percent}% match <span className="font-normal opacity-80">· {fit.band}</span>
          </p>
          <ul className="space-y-0.5">
            {fit.parts.map((p) => (
              <li key={p.key}>{p.label}</li>
            ))}
          </ul>
          <p className="opacity-80">
            {fit.location.label}
            {pay ? ` · ${pay}` : ''}
          </p>
        </div>
      }
    >
      <button
        type="button"
        aria-label={summary}
        className={cn('shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none', className)}
      >
        <ScoreRing value={fit.percent} size="sm" label={`${fit.percent}% match`} />
      </button>
    </Tooltip>
  );
}

/**
 * Compact score ring whose tooltip (hover or keyboard focus) lists the main reasons for the score:
 * the profile match when there is one, else the search relevance.
 */
export function MatchScore({ score, match, fit, className }: { score: number; match: MatchExplanation; fit?: ProfileFit; className?: string }) {
  if (hasPercent(fit)) return <ProfileMatchScore fit={fit} className={className} />;
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
