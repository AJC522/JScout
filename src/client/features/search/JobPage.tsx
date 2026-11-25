/** /jobs/:id — one job on its own page, with the same detail view as the search page's split view. */
import { useParams } from 'react-router';
import { Page } from '../../components/layout/Page';
import { PageHeader, Skeleton } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';
import { JobDetailView } from './JobDetailView';
import { useJobDetail } from './queries';
import { useJobActions } from './use-job-actions';

export function JobPage() {
  const { id = '' } = useParams();
  // Shares the cache entry with the detail view below, so this costs no extra request.
  const detail = useJobDetail(id);
  const job = detail.data?.job;
  const actions = useJobActions();
  useDocumentTitle(job ? `${job.title} at ${job.company}` : 'Job details');

  return (
    <Page>
      <PageHeader
        back={{ to: '/', label: 'Search' }}
        title={job ? job.title : detail.isError ? 'Job details' : <Skeleton className="h-7 w-80 max-w-full" />}
        description={job ? [job.company, job.locationText].filter(Boolean).join(' · ') : undefined}
      />
      <div className="max-w-4xl">
        <JobDetailView jobId={id} actions={actions} variant="embedded" />
      </div>
    </Page>
  );
}
