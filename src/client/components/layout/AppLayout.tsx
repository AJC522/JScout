import { Suspense, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Menu, X } from 'lucide-react';
import { useMediaQuery } from '../../lib/hooks';
import { ModalOverlay } from '../ui/Dialog';
import { IconButton } from '../ui/IconButton';
import { ApiBanner } from './ApiBanner';
import { ErrorBoundary } from './ErrorBoundary';
import { Logo } from './Logo';
import { PageFallback } from './PageFallback';
import { Sidebar } from './Sidebar';

/** Breakpoints of the shell: full sidebar ≥1024px, icon rail 640–1023px, top bar + drawer below 640px. */
export const DESKTOP_QUERY = '(min-width: 1024px)';
export const MOBILE_QUERY = '(max-width: 639.98px)';

function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-13 items-center gap-2 border-b border-border bg-surface/95 px-2 backdrop-blur-sm">
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <IconButton label="Open navigation" tooltip={false} icon={<Menu />} />
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <ModalOverlay />
          <DialogPrimitive.Content
            data-modal-layer=""
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-[17.5rem] max-w-[85vw] flex-col border-r border-border bg-surface shadow-dialog outline-none data-[state=closed]:animate-sheet-out-left data-[state=open]:animate-sheet-in-left"
          >
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <IconButton label="Close navigation" tooltip={false} icon={<X />} className="absolute top-2.5 right-2.5 z-10" />
            </DialogPrimitive.Close>
            <Sidebar className="w-full" onNavigate={() => setOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <Link to="/" className="rounded-control" aria-label="JScout home">
        <Logo />
      </Link>
    </header>
  );
}

/** The app shell: navigation plus the routed page, with an error boundary and the offline banner. */
export function AppLayout() {
  const { pathname } = useLocation();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const mobile = useMediaQuery(MOBILE_QUERY);

  return (
    <div className="flex min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface px-3 py-2 text-base font-medium text-fg shadow-overlay focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      {mobile ? null : (
        <aside className="sticky top-0 h-dvh shrink-0 border-r border-border bg-surface">
          <Sidebar rail={!desktop} />
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {mobile ? <MobileNav /> : null}
        <ApiBanner />
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
