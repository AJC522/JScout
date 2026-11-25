import { SquareKanban } from 'lucide-react';
import { Page } from '../../components/layout/Page';
import { EmptyState, PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

export function TrackerPage() {
  useDocumentTitle('Tracker');
  return (
    <Page>
      <PageHeader title="Tracker" description="Every application, from saved to offer, with follow-ups." />
      <EmptyState bordered icon={<SquareKanban />} title="Your tracker is empty" description="Jobs you save or apply to appear here so you can follow up at the right time." />
    </Page>
  );
}
