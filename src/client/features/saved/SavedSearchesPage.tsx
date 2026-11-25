import { Bookmark } from 'lucide-react';
import { Page } from '../../components/layout/Page';
import { EmptyState, PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

export function SavedSearchesPage() {
  useDocumentTitle('Saved searches');
  return (
    <Page>
      <PageHeader title="Saved searches" description="Searches you run again, with new postings highlighted." />
      <EmptyState bordered icon={<Bookmark />} title="No saved searches yet" description="Save a search from the Search page to come back to it and see what is new since your last visit." />
    </Page>
  );
}
