import { Building } from 'lucide-react';
import { Page } from '../../components/layout/Page';
import { EmptyState, PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

export function CompaniesPage() {
  useDocumentTitle('Companies');
  return (
    <Page>
      <PageHeader title="Companies" description="Employer job boards JScout checks directly." />
      <EmptyState bordered icon={<Building />} title="No companies yet" description="Add an employer by its careers page link and JScout will include its openings in your searches." />
    </Page>
  );
}
