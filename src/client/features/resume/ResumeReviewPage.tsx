/**
 * Résumé review: the saved résumé on one side, the job to compare it with on the other (a tracked
 * application, or a pasted job description), and the review of the pair.
 */
import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ClipboardPaste, FileCheck, FileText, RefreshCw, SquareKanban, Target } from 'lucide-react';
import { STATUS_LABELS } from '../../../shared/constants';
import type { PastedPosting, ResumeScoreSummary, ResumeTarget } from '../../../shared/types';
import { Page } from '../../components/layout/Page';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  ScoreRing,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatBytes, formatRelativeTime } from '../../lib/format';
import { useDocumentTitle, useMediaQuery } from '../../lib/hooks';
import { useProfile } from '../profile/profile-api';
import { ResumeUpload } from '../profile/ResumeUpload';
import { STATUS_TONES } from '../tracker/status';
import { sortScores } from './model';
import { useResumeScores } from './queries';
import { ResumeReviewPanel } from './ResumeReviewPanel';

const MIN_DESCRIPTION_CHARS = 80;

function ResumeCard({ hasResume }: { hasResume: boolean }) {
  const profile = useProfile();
  const [replacing, setReplacing] = useState(false);
  const resume = profile.data?.resume ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your résumé</CardTitle>
        <CardDescription>Read on this computer; nothing is uploaded anywhere.</CardDescription>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {profile.isPending ? (
          <Skeleton className="h-14 rounded-card" />
        ) : !hasResume || replacing ? (
          <ResumeUpload
            onUploaded={() => setReplacing(false)}
            extraAction={
              replacing ? (
                <Button variant="ghost" onClick={() => setReplacing(false)}>
                  Cancel
                </Button>
              ) : undefined
            }
          />
        ) : resume ? (
          <div className="flex items-center gap-3 rounded-card border border-border bg-surface-2 p-3">
            <FileText className="size-7 shrink-0 text-subtle" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{resume.fileName || 'Résumé'}</p>
              <p className="text-xs text-muted">
                {resume.sizeBytes > 0 ? formatBytes(resume.sizeBytes) : 'Pasted text'} · updated {formatRelativeTime(resume.updatedAt)}
              </p>
            </div>
            <Button size="sm" variant="ghost" leadingIcon={<RefreshCw />} onClick={() => setReplacing(true)}>
              Replace
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ApplicationList({ selected, onSelect, enabled }: { selected?: string; onSelect: (id: string) => void; enabled: boolean }) {
  const scores = useResumeScores(enabled);
  const [sort, setSort] = useState<'score' | 'title'>('score');

  if (!enabled) return <p className="text-sm text-muted">Add your résumé to see how it scores against each application.</p>;
  if (scores.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Scoring your applications">
        <Skeleton className="h-14 rounded-card" />
        <Skeleton className="h-14 rounded-card" />
        <Skeleton className="h-14 rounded-card" />
      </div>
    );
  }
  if (scores.isError) {
    return <ErrorState compact title="Could not score your applications" error={scores.error} onRetry={() => void scores.refetch()} retrying={scores.isFetching} />;
  }
  if (scores.data.length === 0) {
    return (
      <EmptyState
        compact
        icon={<SquareKanban />}
        title="No active applications"
        description="Save jobs to your tracker from search to score your résumé against each one, or paste a job description."
        action={
          <Button asChild size="sm">
            <Link to="/">Find jobs</Link>
          </Button>
        }
      />
    );
  }
  const items = sortScores(scores.data, sort);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{scores.data.length} active</span>
        <Select
          aria-label="Sort applications"
          size="sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as 'score' | 'title')}
          options={[
            { value: 'score', label: 'Lowest score first' },
            { value: 'title', label: 'By job title' },
          ]}
          className="w-auto"
        />
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((s) => (
          <li key={s.applicationId}>
            <ApplicationButton item={s} selected={s.applicationId === selected} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApplicationButton({ item, selected, onSelect }: { item: ResumeScoreSummary; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(item.applicationId)}
      className={cn(
        'flex w-full items-center gap-3 rounded-card border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
        selected ? 'border-primary bg-primary-soft/40 ring-1 ring-primary' : 'border-border bg-surface hover:border-strong',
      )}
    >
      <ScoreRing value={item.score} size="md" label={`Résumé match ${item.score} out of 100`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
        <span className="block truncate text-xs text-muted">
          {item.company}
          {item.requiredTotal > 0 ? ` · ${item.requiredMet}/${item.requiredTotal} requirements` : ''}
          {item.limited ? ' · little description' : ''}
        </span>
      </span>
      <Badge size="sm" tone={STATUS_TONES[item.status]}>
        {STATUS_LABELS[item.status]}
      </Badge>
    </button>
  );
}

function PasteForm({ initial, onSubmit }: { initial?: PastedPosting; onSubmit: (posting: PastedPosting) => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [company, setCompany] = useState(initial?.company ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [tried, setTried] = useState(false);
  const titleError = tried && !title.trim() ? 'Enter the job title.' : undefined;
  const descriptionError =
    tried && description.trim().length < MIN_DESCRIPTION_CHARS ? 'Paste the full job description, including its requirements.' : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!title.trim() || description.trim().length < MIN_DESCRIPTION_CHARS) return;
    onSubmit({ title: title.trim(), ...(company.trim() ? { company: company.trim() } : {}), description: description.trim() });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Job title" error={titleError}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="e.g. Senior Data Analyst" />
      </Field>
      <Field label="Company" optional>
        <Input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={200} />
      </Field>
      <Field label="Job description" error={descriptionError} hint="Paste everything, especially the requirements and “nice to have” lists.">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} autoGrow maxRows={18} maxLength={60_000} />
      </Field>
      <Button type="submit" variant="primary" leadingIcon={<FileCheck />} className="self-start">
        Review against this job
      </Button>
    </form>
  );
}

function TargetCard({
  mode,
  setMode,
  applicationId,
  onSelectApplication,
  posting,
  onPosting,
  hasResume,
}: {
  mode: 'applications' | 'paste';
  setMode: (mode: 'applications' | 'paste') => void;
  applicationId?: string;
  onSelectApplication: (id: string) => void;
  posting?: PastedPosting;
  onPosting: (posting: PastedPosting) => void;
  hasResume: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compare with</CardTitle>
        <CardDescription>A job you are applying to, or any job description.</CardDescription>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <SegmentedControl
          aria-label="What to compare with"
          size="sm"
          fullWidth
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'applications', label: 'My applications', icon: <SquareKanban /> },
            { value: 'paste', label: 'Paste a job', icon: <ClipboardPaste /> },
          ]}
        />
        {mode === 'applications' ? (
          <ApplicationList selected={applicationId} onSelect={onSelectApplication} enabled={hasResume} />
        ) : (
          <PasteForm initial={posting} onSubmit={onPosting} />
        )}
      </CardBody>
    </Card>
  );
}

export function ResumeReviewPage() {
  useDocumentTitle('Résumé review');
  const profile = useProfile();
  const hasResume = Boolean(profile.data?.resume?.text.trim());
  const [params, setParams] = useSearchParams();
  const applicationId = params.get('application') ?? undefined;
  const jobId = params.get('job') ?? undefined;
  const [posting, setPosting] = useState<PastedPosting | undefined>();
  const [mode, setMode] = useState<'applications' | 'paste'>('applications');
  const reviewRef = useRef<HTMLDivElement>(null);
  const stacked = !useMediaQuery('(min-width: 1024px)');

  // A link from a job or application page names it; otherwise the user picks one or pastes a posting.
  const linked: ResumeTarget | undefined = applicationId ? { applicationId, ...(jobId ? { jobId } : {}) } : jobId ? { jobId } : undefined;
  const target: ResumeTarget | undefined = mode === 'paste' ? (posting ? { posting } : undefined) : linked;

  const reveal = () => {
    if (stacked) requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const selectApplication = (id: string) => {
    setParams({ application: id }, { replace: true });
    reveal();
  };
  const submitPosting = (next: PastedPosting) => {
    setPosting(next);
    if (params.toString() !== '') setParams({}, { replace: true });
    reveal();
  };

  return (
    <Page>
      <PageHeader
        title="Résumé review"
        description="Score your résumé against the jobs you're applying to, see which requirements it shows and what to change, then get a version tailored to each job."
        actions={
          <Button asChild leadingIcon={<Target />}>
            <Link to="/gaps">Skill gaps across jobs</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6">
          <ResumeCard hasResume={hasResume} />
          <TargetCard
            mode={mode}
            setMode={setMode}
            applicationId={applicationId}
            onSelectApplication={selectApplication}
            posting={posting}
            onPosting={submitPosting}
            hasResume={hasResume}
          />
        </div>
        <div ref={reviewRef} className="min-w-0 scroll-mt-4">
          <Card padded className="sm:p-5">
            {profile.isPending ? (
              <Skeleton className="h-64 rounded-card" />
            ) : !hasResume ? (
              <EmptyState
                icon={<FileCheck />}
                title="Start with your résumé"
                description="Upload it (PDF, Word or text) or paste its text. Then pick an application or paste a job description to see how well it matches."
              />
            ) : !target ? (
              <EmptyState
                icon={<FileCheck />}
                title="Pick a job to compare with"
                description="Choose one of your applications, or paste a job description, to see your score, the requirements your résumé shows and what to change."
              />
            ) : (
              <ResumeReviewPanel target={target} company={target.posting?.company} />
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
