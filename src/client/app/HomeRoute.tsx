import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PageFallback } from '../components/layout/PageFallback';
import { useBootstrap } from './bootstrap';

const OFFERED_KEY = 'jscout.onboardingOffered';
/** Fallback when sessionStorage is unavailable: once per page load instead of once per tab session. */
let offeredInMemory = false;

function wasOffered(): boolean {
  try {
    return window.sessionStorage.getItem(OFFERED_KEY) === '1' || offeredInMemory;
  } catch {
    return offeredInMemory;
  }
}

function markOffered(): void {
  offeredInMemory = true;
  try {
    window.sessionStorage.setItem(OFFERED_KEY, '1');
  } catch {
    // Kept in memory instead.
  }
}

/**
 * The "/" route: sends a user who has not set up a profile to /welcome, at most once per
 * session (they may skip it), and otherwise renders the search page.
 */
export function HomeRoute({ children }: { children: ReactNode }) {
  const bootstrap = useBootstrap();
  const navigate = useNavigate();
  const offer = bootstrap.data !== undefined && !bootstrap.data.profile.onboarded && !wasOffered();

  useEffect(() => {
    if (!offer) return;
    markOffered();
    navigate('/welcome', { replace: true });
  }, [offer, navigate]);

  // Waiting for bootstrap avoids flashing the search page before a redirect. If it fails,
  // the page renders anyway (the API banner explains the problem).
  if (bootstrap.isPending || offer) return <PageFallback />;
  return <>{children}</>;
}
