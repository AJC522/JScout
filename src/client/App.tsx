import { lazy, Suspense, type ComponentType } from 'react';
import { Outlet, createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { EventsProvider } from './app/events';
import { HomeRoute } from './app/HomeRoute';
import { NotFoundPage } from './app/NotFoundPage';
import { ThemeProvider } from './app/theme';
import { AppLayout } from './components/layout/AppLayout';
import { ErrorBoundary, RouteErrorFallback } from './components/layout/ErrorBoundary';
import { PageFallback } from './components/layout/PageFallback';
import { ConfirmProvider } from './components/ui/ConfirmDialog';
import { ToastProvider } from './components/ui/Toast';
import { TooltipProvider } from './components/ui/Tooltip';
import { queryClient } from './lib/query';

/** Code-split a page module that uses a named export. */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => ({ default: (await load())[name] }));
}

const SearchPage = page(() => import('./features/search/SearchPage'), 'SearchPage');
const JobPage = page(() => import('./features/search/JobPage'), 'JobPage');
const SavedSearchesPage = page(() => import('./features/saved/SavedSearchesPage'), 'SavedSearchesPage');
const TrackerPage = page(() => import('./features/tracker/TrackerPage'), 'TrackerPage');
const ApplicationPage = page(() => import('./features/tracker/ApplicationPage'), 'ApplicationPage');
const ResumeReviewPage = page(() => import('./features/resume/ResumeReviewPage'), 'ResumeReviewPage');
const GapsPage = page(() => import('./features/gaps/GapsPage'), 'GapsPage');
const CompaniesPage = page(() => import('./features/companies/CompaniesPage'), 'CompaniesPage');
const ProfilePage = page(() => import('./features/profile/ProfilePage'), 'ProfilePage');
const SettingsPage = page(() => import('./features/settings/SettingsPage'), 'SettingsPage');
const OnboardingPage = page(() => import('./features/onboarding/OnboardingPage'), 'OnboardingPage');
const KitPage = page(() => import('./features/kit/KitPage'), 'KitPage');

const router = createBrowserRouter([
  {
    element: (
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
    ),
    errorElement: <RouteErrorFallback />,
    children: [
      { path: '/welcome', element: <OnboardingPage /> },
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: (
              <HomeRoute>
                <SearchPage />
              </HomeRoute>
            ),
          },
          { path: '/search', element: <SearchPage /> },
          { path: '/jobs/:id', element: <JobPage /> },
          { path: '/saved', element: <SavedSearchesPage /> },
          { path: '/tracker', element: <TrackerPage /> },
          { path: '/tracker/:id', element: <ApplicationPage /> },
          { path: '/resume', element: <ResumeReviewPage /> },
          { path: '/gaps', element: <GapsPage /> },
          { path: '/companies', element: <CompaniesPage /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/__kit', element: <KitPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <ErrorBoundary variant="app">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastProvider>
            <ConfirmProvider>
              <ThemeProvider>
                <EventsProvider>
                  <RouterProvider router={router} />
                </EventsProvider>
              </ThemeProvider>
            </ConfirmProvider>
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
