import { Link } from 'react-router';
import { Compass, Search } from 'lucide-react';
import { Page } from '../components/layout/Page';
import { Button, EmptyState } from '../components/ui';
import { useDocumentTitle } from '../lib/hooks';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <Page>
      <EmptyState
        icon={<Compass />}
        title="This page does not exist"
        description="The link may be out of date, or the item it pointed to was deleted."
        action={
          <Button asChild variant="primary" leadingIcon={<Search />}>
            <Link to="/">Go to search</Link>
          </Button>
        }
      />
    </Page>
  );
}
