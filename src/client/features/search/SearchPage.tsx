import { Search } from 'lucide-react';
import { Page } from '../../components/layout/Page';
import { EmptyState, PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

export function SearchPage() {
  useDocumentTitle('Search');
  return (
    <Page>
      <PageHeader title="Search" description="Search every job in your local index at once." />
      <EmptyState bordered icon={<Search />} title="Search is on its way" description="Type a job title and a place to search thousands of postings, ranked by how well they fit your profile." />
    </Page>
  );
}
