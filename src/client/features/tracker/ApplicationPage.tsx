import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { FileQuestion, Trash2 } from 'lucide-react';
import { STATUS_LABELS } from '../../../shared/constants';
import type { ApplicationDetail } from '../../../shared/types';
import { ApiRequestError, errorMessage } from '../../api/client';
import { Page } from '../../components/layout/Page';
import { Badge, Button, EmptyState, ErrorState, IconButton, PageHeader, Skeleton, SkeletonText, useConfirm, useToast } from '../../components/ui';
import { useDocumentTitle, useNow } from '../../lib/hooks';
import { ApplyKitPanel } from '../applykit';
import { ChecklistSection } from './application/ChecklistSection';
import { ContactsSection } from './application/ContactsSection';
import { DocumentsSection } from './application/DocumentsSection';
import { ApplyButton, JobPanel } from './application/JobPanel';
import { NotesSection } from './application/NotesSection';
import { StatusSection } from './application/StatusSection';
import { TimelineSection } from './application/TimelineSection';
import { useApplication, useDeleteApplication, usePatchApplication } from './queries';
import { STATUS_TONES } from './status';

const LAYOUT = 'grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]';

/** Where "Back to tracker" goes: the board as the user left it (filters included), or the plain tracker. */
function useBackPath(): string {
  const state: unknown = useLocation().state;
  const from = typeof state === 'object' && state !== null && 'from' in state ? (state as { from: unknown }).from : undefined;
  return typeof from === 'string' && from.startsWith('/tracker') ? from : '/tracker';
}

function ApplicationSkeleton({ back }: { back: string }) {
  return (
    <Page width="wide" aria-busy="true" aria-label="Loading application">
      <PageHeader back={{ to: back, label: 'Back to tracker' }} title={<Skeleton className="h-7 w-72" />} description={<Skeleton className="mt-1 h-4 w-48" />} />
      <div className={LAYOUT}>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-36 rounded-card" />
          <div className="rounded-card border border-border bg-surface p-4">
            <SkeletonText lines={8} />
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-44 rounded-card" />
          <Skeleton className="h-56 rounded-card" />
          <Skeleton className="h-32 rounded-card" />
        </div>
      </div>
    </Page>
  );
}

function ApplicationView({ app, back }: { app: ApplicationDetail; back: string }) {
  const now = useNow(60_000);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const remove = useDeleteApplication();
  const patch = usePatchApplication(app.id);
  const meta = [app.job.company, app.job.locationText].filter(Boolean).join(' · ');

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Delete this application?',
      description: `${app.job.title} at ${app.job.company}, with its notes, contacts, timeline and documents. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    remove.mutate(app.id, {
      onSuccess: () => {
        toast.success('Application deleted');
        void navigate(back);
      },
      onError: (err) => toast.error('Could not delete the application', { description: errorMessage(err) }),
    });
  };

  // Opening the employer's form is the moment to offer moving a saved job along.
  const onApply = () => {
    if (app.status !== 'saved') return;
    toast.info('Applied?', {
      description: 'Mark it as applied to start the follow-up reminder.',
      action: { label: 'Mark as applied', onClick: () => patch.mutate({ status: 'applied' }) },
      duration: 12_000,
    });
  };

  return (
    <Page width="wide">
      <PageHeader
        back={{ to: back, label: 'Back to tracker' }}
        title={app.job.title}
        titleAddon={<Badge tone={STATUS_TONES[app.status]}>{STATUS_LABELS[app.status]}</Badge>}
        description={meta || undefined}
        actions={
          <>
            <ApplyButton app={app} onApply={onApply} />
            <IconButton variant="secondary" size="md" label="Delete application" icon={<Trash2 />} onClick={() => void onDelete()} loading={remove.isPending} />
          </>
        }
      />
      <div className={LAYOUT}>
        <div className="flex min-w-0 flex-col gap-6">
          <JobPanel app={app} />
          <section aria-label="Apply kit" className="rounded-card border border-border bg-surface px-4 pt-3 pb-5">
            <ApplyKitPanel target={{ applicationId: app.id, ...(app.jobId ? { jobId: app.jobId } : {}) }} company={app.job.company} />
          </section>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <StatusSection app={app} now={now} />
          <ChecklistSection app={app} />
          <NotesSection key={app.id} app={app} />
          <ContactsSection app={app} />
          <TimelineSection app={app} now={now} />
          <DocumentsSection app={app} now={now} />
        </div>
      </div>
    </Page>
  );
}

export function ApplicationPage() {
  const { id = '' } = useParams();
  const back = useBackPath();
  const detail = useApplication(id);
  useDocumentTitle(detail.data?.job.title ?? 'Application');

  if (detail.isPending) return <ApplicationSkeleton back={back} />;
  if (detail.isError) {
    const missing = detail.error instanceof ApiRequestError && detail.error.status === 404;
    return (
      <Page width="narrow">
        <PageHeader back={{ to: back, label: 'Back to tracker' }} title="Application" />
        {missing ? (
          <EmptyState
            bordered
            icon={<FileQuestion />}
            title="This application is not in your tracker"
            description="It may have been deleted. Your other applications are on the tracker."
            action={
              <Button asChild variant="primary">
                <Link to="/tracker">Go to tracker</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState title="Could not load this application" error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />
        )}
      </Page>
    );
  }
  return <ApplicationView app={detail.data} back={back} />;
}
