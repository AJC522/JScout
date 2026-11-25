import { cn } from '../../lib/cn';
import type { Tone } from './Badge';

const SIZES = {
  sm: { box: 28, stroke: 3, text: 'text-[0.625rem]' },
  md: { box: 40, stroke: 3.5, text: 'text-xs' },
  lg: { box: 64, stroke: 5, text: 'text-lg' },
} as const;

const STROKE: Record<Tone, string> = {
  neutral: 'stroke-subtle',
  primary: 'stroke-primary-fg',
  accent: 'stroke-accent',
  success: 'stroke-success',
  warning: 'stroke-warning',
  danger: 'stroke-danger',
  info: 'stroke-info',
};

/** Colour band for a 0–100 match score. Exported so lists can colour related text the same way. */
export function scoreTone(score: number): Tone {
  if (score >= 80) return 'success';
  if (score >= 60) return 'primary';
  if (score >= 40) return 'warning';
  return 'danger';
}

export interface ScoreRingProps {
  /** 0–100; values outside are clamped. */
  value: number;
  size?: keyof typeof SIZES;
  /** Overrides the value-based colour. */
  tone?: Tone;
  /** Accessible description; defaults to "Score N out of 100". */
  label?: string;
  className?: string;
}

/** Circular 0–100 score (match quality, keyword coverage) with the number in the middle. */
export function ScoreRing({ value, size = 'md', tone, label, className }: ScoreRingProps) {
  const score = Math.round(Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0)));
  const { box, stroke, text } = SIZES[size];
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <span
      role="img"
      aria-label={label ?? `Score ${score} out of 100`}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: box, height: box }}
    >
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true" className="-rotate-90">
        <circle cx={box / 2} cy={box / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-surface-3" />
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          className={cn('transition-[stroke-dashoffset] duration-500 ease-out', STROKE[tone ?? scoreTone(score)])}
        />
      </svg>
      <span aria-hidden="true" className={cn('absolute font-semibold text-fg tabular-nums', text)}>
        {score}
      </span>
    </span>
  );
}
