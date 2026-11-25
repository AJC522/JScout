import { Page } from '../../components/layout/Page';
import { Card, ErrorState, PageHeader, Skeleton, SkeletonText } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';
import { AboutSection } from './AboutSection';
import { AiSection } from './AiSection';
import { DataSection } from './DataSection';
import { AppearanceSection, SyncSection } from './GeneralSections';
import { useSettings } from './settings-api';
import { SourcesSection } from './SourcesSection';

const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'syncing', label: 'Syncing' },
  { id: 'sources', label: 'Sources' },
  { id: 'ai', label: 'AI drafting' },
  { id: 'data', label: 'Your data' },
  { id: 'about', label: 'About' },
] as const;

export function SettingsPage() {
  useDocumentTitle('Settings');
  const settings = useSettings();

  return (
    <Page width="narrow">
      <PageHeader title="Settings" description="Appearance, syncing, job sources, AI drafting and your data." />
      <nav aria-label="Settings sections" className="sticky top-13 z-20 -mx-4 mb-5 border-b border-border bg-canvas/95 px-4 backdrop-blur-sm sm:top-0 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="block rounded-control px-2.5 py-1 text-sm font-medium whitespace-nowrap text-muted hover:bg-hover hover:text-fg">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-col gap-5">
        <AppearanceSection />
        {settings.isPending ? (
          [0, 1].map((i) => (
            <Card key={i} padded aria-busy="true">
              <Skeleton className="mb-4 h-5 w-40" />
              <SkeletonText lines={3} />
            </Card>
          ))
        ) : settings.isError ? (
          <ErrorState title="Could not load your settings" error={settings.error} onRetry={() => void settings.refetch()} retrying={settings.isFetching} />
        ) : (
          <SyncSection settings={settings.data} />
        )}
        <SourcesSection />
        {settings.data ? <AiSection settings={settings.data} /> : null}
        <DataSection />
        <AboutSection />
      </div>
    </Page>
  );
}
