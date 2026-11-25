import { CircleUserRound } from 'lucide-react';
import { Page } from '../../components/layout/Page';
import { EmptyState, PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

export function ProfilePage() {
  useDocumentTitle('Profile');
  return (
    <Page>
      <PageHeader title="Profile" description="What you are looking for and what you bring. Used to rank results and fill applications." />
      <EmptyState bordered icon={<CircleUserRound />} title="Your profile is on its way" description="Your details, preferences and résumé will live here, stored only on this computer." />
    </Page>
  );
}
