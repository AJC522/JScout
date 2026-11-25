import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Bookmark, Building, CircleUserRound, FileCheck, Search, Settings, SquareKanban, Target, type LucideIcon } from 'lucide-react';
import type { Bootstrap } from '../../../shared/types';
import { useBootstrap } from '../../app/bootstrap';
import { cn } from '../../lib/cn';
import { formatCompactNumber } from '../../lib/format';
import { Tooltip } from '../ui/Tooltip';
import { Logo } from './Logo';
import { SyncStatus } from './SyncStatus';
import { ThemeToggle } from './ThemeToggle';

type BadgeTone = 'accent' | 'warning';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
  /** Count badge (hidden when 0) and its meaning for screen readers. */
  badge?: (bootstrap: Bootstrap) => { count: number; tone: BadgeTone; description: string } | null;
  /** Quiet text after the label, e.g. profile completeness. */
  hint?: (bootstrap: Bootstrap) => string | null;
}

const startsWith = (...prefixes: string[]) => (pathname: string) => prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Search', icon: Search, isActive: (pathname) => pathname === '/' || startsWith('/search', '/jobs')(pathname) },
  {
    to: '/saved',
    label: 'Saved searches',
    icon: Bookmark,
    isActive: startsWith('/saved'),
    badge: (b) => (b.savedSearches.newResults > 0 ? { count: b.savedSearches.newResults, tone: 'accent', description: 'new results' } : null),
  },
  {
    to: '/tracker',
    label: 'Tracker',
    icon: SquareKanban,
    isActive: startsWith('/tracker'),
    badge: (b) => (b.tracker.followUpsDue > 0 ? { count: b.tracker.followUpsDue, tone: 'warning', description: 'follow-ups due' } : null),
  },
  { to: '/resume', label: 'Résumé review', icon: FileCheck, isActive: startsWith('/resume') },
  { to: '/gaps', label: 'Skill gaps', icon: Target, isActive: startsWith('/gaps') },
  { to: '/companies', label: 'Companies', icon: Building, isActive: startsWith('/companies') },
  {
    to: '/profile',
    label: 'Profile',
    icon: CircleUserRound,
    isActive: startsWith('/profile'),
    hint: (b) => (b.profile.completeness < 100 ? `${Math.max(0, Math.round(b.profile.completeness))}% complete` : null),
  },
  { to: '/settings', label: 'Settings', icon: Settings, isActive: startsWith('/settings') },
];

const BADGE_TONES: Record<BadgeTone, string> = {
  accent: 'bg-accent text-on-accent',
  warning: 'bg-warning-soft text-warning',
};

function NavLinkItem({ item, rail, onNavigate }: { item: NavItem; rail: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const bootstrap = useBootstrap().data;
  const active = item.isActive(pathname);
  const badge = bootstrap ? (item.badge?.(bootstrap) ?? null) : null;
  const hint = bootstrap ? (item.hint?.(bootstrap) ?? null) : null;
  const Icon = item.icon;
  const srExtra = [badge ? `${badge.count} ${badge.description}` : null, hint ? `profile ${hint}` : null].filter(Boolean).join(', ');

  const link = (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center rounded-control text-base font-medium transition-colors',
        rail ? 'size-10 justify-center' : 'h-8.5 gap-2.5 px-2.5',
        active ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-hover hover:text-fg',
      )}
    >
      <Icon aria-hidden="true" className={cn('size-[1.125rem] shrink-0', active ? 'text-primary' : 'text-subtle group-hover:text-muted')} />
      {rail ? <span className="sr-only">{item.label}</span> : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {srExtra ? <span className="sr-only">({srExtra})</span> : null}
      {!rail && hint ? (
        <span aria-hidden="true" className="shrink-0 text-xs font-normal text-subtle tabular-nums">
          {hint}
        </span>
      ) : null}
      {badge ? (
        <span
          aria-hidden="true"
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums',
            BADGE_TONES[badge.tone],
            rail ? 'absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 text-[0.625rem] ring-2 ring-surface' : 'h-5 min-w-5 px-1.5 text-xs',
          )}
        >
          {formatCompactNumber(badge.count)}
        </span>
      ) : null}
      {rail && hint ? <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-subtle" /> : null}
    </Link>
  );

  if (!rail) return link;
  const tooltip: ReactNode = [item.label, badge ? `${badge.count} ${badge.description}` : null, hint].filter(Boolean).join(' · ');
  return (
    <Tooltip content={tooltip} side="right">
      {link}
    </Tooltip>
  );
}

export interface SidebarProps {
  /** Icon-only rail (tablet widths). */
  rail?: boolean;
  /** Called after a nav link is followed (closes the mobile drawer). */
  onNavigate?: () => void;
  /** Hide the logo row (the mobile drawer has its own header). */
  hideLogo?: boolean;
  className?: string;
}

/** App navigation with the index status and theme switch in its footer. */
export function Sidebar({ rail = false, onNavigate, hideLogo = false, className }: SidebarProps) {
  return (
    <div className={cn('flex h-full flex-col', rail ? 'w-16 items-center' : 'w-60', className)}>
      {hideLogo ? null : (
        <div className={cn('flex h-14 shrink-0 items-center', rail ? 'justify-center' : 'px-4.5')}>
          <Link to="/" onClick={onNavigate} className="rounded-control" aria-label="JScout home">
            <Logo showName={!rail} />
          </Link>
        </div>
      )}
      <nav aria-label="Main" className={cn('flex-1 overflow-y-auto', rail ? 'px-3 pt-2' : 'px-3 pt-2')}>
        <ul className={cn('flex flex-col', rail ? 'items-center gap-1.5' : 'gap-0.5')}>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLinkItem item={item} rail={rail} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>
      <div className={cn('shrink-0 border-t border-border', rail ? 'flex flex-col items-center gap-1 py-3' : 'flex flex-col gap-3 p-3')}>
        {rail ? (
          <>
            <SyncStatus compact />
            <ThemeToggle variant="menu" />
          </>
        ) : (
          <>
            <SyncStatus />
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-xs font-medium text-subtle">Theme</span>
              <ThemeToggle />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
