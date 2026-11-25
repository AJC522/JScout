import { FileText } from 'lucide-react';
import { Page } from '../../components/layout/Page';
import { EmptyState, PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

export function ApplicationPage() {
  useDocumentTitle('Application');
  return (
    <Page>
      <PageHeader title="Application" description="Status, notes, documents and contacts for one application." />
      <EmptyState bordered icon={<FileText />} title="Application details are on their way" description="This page will hold the timeline, cover letter, answers and contacts for an application." />
    </Page>
  );
}
