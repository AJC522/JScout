import { Briefcase } from 'lucide-react';
import { Page } from '../../components/layout/Page';
import { EmptyState, PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

export function JobPage() {
  useDocumentTitle('Job details');
  return (
    <Page>
      <PageHeader title="Job details" description="The full posting, how it matches your profile, and where to apply." />
      <EmptyState bordered icon={<Briefcase />} title="Job details are on their way" description="This page will show the complete description, salary, location and a fit analysis for the posting." />
    </Page>
  );
}
