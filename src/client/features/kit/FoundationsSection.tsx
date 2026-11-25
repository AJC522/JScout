import { cn } from '../../lib/cn';
import { Demo, KitSection } from './KitSection';

const SURFACES = [
  { name: 'canvas', className: 'bg-canvas' },
  { name: 'surface', className: 'bg-surface' },
  { name: 'surface-2', className: 'bg-surface-2' },
  { name: 'surface-3', className: 'bg-surface-3' },
  { name: 'border', className: 'bg-border' },
  { name: 'border-strong', className: 'bg-border-strong' },
];

const TEXT = [
  { name: 'fg', className: 'text-fg' },
  { name: 'muted', className: 'text-muted' },
  { name: 'subtle', className: 'text-subtle' },
  { name: 'primary', className: 'text-primary' },
  { name: 'accent', className: 'text-accent' },
];

const PAIRS = [
  { name: 'primary', solid: 'bg-primary text-on-primary', soft: 'bg-primary-soft text-primary' },
  { name: 'accent', solid: 'bg-accent text-on-accent', soft: 'bg-accent-soft text-accent' },
  { name: 'success', solid: 'bg-success text-surface', soft: 'bg-success-soft text-success' },
  { name: 'warning', solid: 'bg-warning text-surface', soft: 'bg-warning-soft text-warning' },
  { name: 'danger', solid: 'bg-danger-solid text-on-danger', soft: 'bg-danger-soft text-danger' },
  { name: 'info', solid: 'bg-info text-surface', soft: 'bg-info-soft text-info' },
];

const TYPE = [
  { name: 'text-3xl · 28px', className: 'text-3xl font-semibold', sample: 'Find the right job, faster' },
  { name: 'text-2xl · 22px (h1)', className: 'text-2xl font-semibold', sample: 'Saved searches' },
  { name: 'text-xl · 18px', className: 'text-xl font-semibold', sample: 'Senior Frontend Engineer' },
  { name: 'text-lg · 16px', className: 'text-lg font-semibold', sample: 'Northwind Labs · Remote (Europe)' },
  { name: 'text-base · 14px', className: 'text-base', sample: 'Body text for descriptions, forms and lists.' },
  { name: 'text-sm · 13px', className: 'text-sm text-muted', sample: 'Secondary text: posted 3d ago via Greenhouse' },
  { name: 'text-xs · 12px', className: 'text-xs text-subtle', sample: 'Captions, counters and badges · 12,430' },
];

export function FoundationsSection() {
  return (
    <KitSection
      id="foundations"
      title="Foundations"
      description="Colours are CSS variables exposed as Tailwind utilities (bg-surface, text-muted, border-strong…). There is no stock Tailwind palette, so every class adapts to the dark theme."
    >
      <Demo label="Surfaces">
        {SURFACES.map((swatch) => (
          <div key={swatch.name} className="flex flex-col gap-1.5">
            <div className={cn('h-12 w-24 rounded-control border border-border', swatch.className)} />
            <code className="font-mono text-xs text-muted">{swatch.name}</code>
          </div>
        ))}
      </Demo>
      <Demo label="Text">
        {TEXT.map((swatch) => (
          <span key={swatch.name} className={cn('text-base font-medium', swatch.className)}>
            text-{swatch.name}
          </span>
        ))}
      </Demo>
      <Demo label="Semantic">
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {PAIRS.map((pair) => (
            <div key={pair.name} className="overflow-hidden rounded-control border border-border">
              <div className={cn('px-3 py-2 text-sm font-medium', pair.solid)}>{pair.name}</div>
              <div className={cn('px-3 py-2 text-sm font-medium', pair.soft)}>{pair.name}-soft</div>
            </div>
          ))}
        </div>
      </Demo>
      <Demo label="Type scale" stack>
        {TYPE.map((row) => (
          <div key={row.name} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
            <code className="w-44 shrink-0 font-mono text-xs text-subtle">{row.name}</code>
            <span className={cn('text-fg', row.className)}>{row.sample}</span>
          </div>
        ))}
      </Demo>
      <Demo label="Shape & depth">
        <div className="flex size-24 items-center justify-center rounded-control border border-border bg-surface text-xs text-muted">8px control</div>
        <div className="flex size-24 items-center justify-center rounded-card border border-border bg-surface text-xs text-muted">12px card</div>
        <div className="flex size-24 items-center justify-center rounded-card border border-border bg-surface text-xs text-muted shadow-overlay">overlay</div>
        <div className="flex size-24 items-center justify-center rounded-card border border-border bg-surface text-xs text-muted shadow-dialog">dialog</div>
      </Demo>
    </KitSection>
  );
}
