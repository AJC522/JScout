import { Settings } from 'lucide-react';
import { Page } from '../../components/layout/Page';
import { EmptyState, PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

export function SettingsPage() {
  useDocumentTitle('Settings');
  return (
    <Page>
      <PageHeader title="Settings" description="Sources, syncing, appearance and your data." />
      <EmptyState bordered icon={<Settings />} title="Settings are on their way" description="Choose job sources, sync behaviour, theme and AI drafting, and export or reset your data." />
    </Page>
  );
}
