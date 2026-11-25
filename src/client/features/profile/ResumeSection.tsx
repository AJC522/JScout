import { useState } from 'react';
import { ChevronDown, Download, FileText, RefreshCw, Trash2 } from 'lucide-react';
import type { ProfilePatch } from '../../../shared/api';
import { RESUME_FILE_PATH } from '../../../shared/api';
import type { Profile } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Button, ErrorState, SkeletonText, buttonClasses, useConfirm, useToast } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatBytes, formatRelativeTime } from '../../lib/format';
import { useDeleteResume, useResumeAnalysis, useSaveProfile } from './profile-api';
import { ResumeSuggestions } from './ResumeSuggestions';
import { ResumeUpload } from './ResumeUpload';
import { SectionCard } from './SectionCard';

type Panel = 'none' | 'replace' | 'paste';

export function ResumeSection({ profile }: { profile: Profile }) {
  const resume = profile.resume;
  const [panel, setPanel] = useState<Panel>('none');
  const [showFound, setShowFound] = useState(false);
  const remove = useDeleteResume();
  const confirm = useConfirm();
  const toast = useToast();

  const onUploaded = () => {
    setPanel('none');
    setShowFound(true);
    toast.success('Résumé saved', { description: 'Check what JScout found below and add it to your profile.' });
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Delete your résumé?',
      description: 'The file and its text are removed from JScout. Details you already added to your profile stay.',
      confirmLabel: 'Delete résumé',
      tone: 'danger',
    });
    if (!ok) return;
    remove.mutate(undefined, {
      onSuccess: () => {
        setShowFound(false);
        toast.success('Résumé deleted');
      },
      onError: (err) => toast.error('Could not delete your résumé', { description: errorMessage(err) }),
    });
  };

  if (!resume) {
    return (
      <SectionCard id="resume" title="Résumé" description="JScout reads it to suggest skills and titles, and uses it when drafting applications.">
        <ResumeUpload onUploaded={onUploaded} />
      </SectionCard>
    );
  }

  return (
    <SectionCard id="resume" title="Résumé" description="JScout reads it to suggest skills and titles, and uses it when drafting applications.">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface-2 p-3">
          <FileText className="size-8 shrink-0 text-subtle" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{resume.fileName || 'Résumé'}</p>
            <p className="text-sm text-muted">
              {resume.sizeBytes > 0 ? formatBytes(resume.sizeBytes) : 'Pasted text'} · updated {formatRelativeTime(resume.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {resume.hasFile ? (
              <a href={RESUME_FILE_PATH} download={resume.fileName} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                <Download aria-hidden />
                Download
              </a>
            ) : null}
            <Button variant="ghost" size="sm" leadingIcon={<RefreshCw />} onClick={() => setPanel(panel === 'replace' ? 'none' : 'replace')}>
              Replace
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPanel(panel === 'paste' ? 'none' : 'paste')}>
              Paste text
            </Button>
            <Button variant="ghost" size="sm" leadingIcon={<Trash2 />} loading={remove.isPending} onClick={() => void onDelete()}>
              Delete
            </Button>
          </div>
        </div>

        {panel !== 'none' ? (
          <ResumeUpload
            key={panel}
            startWithPaste={panel === 'paste'}
            onUploaded={onUploaded}
            extraAction={
              <Button variant="ghost" onClick={() => setPanel('none')}>
                Cancel
              </Button>
            }
          />
        ) : null}

        <div className="rounded-card border border-border">
          <button
            type="button"
            aria-expanded={showFound}
            aria-controls="resume-found"
            onClick={() => setShowFound(!showFound)}
            className="flex w-full items-center justify-between gap-2 rounded-card px-3 py-2.5 text-left text-sm font-medium text-fg hover:bg-hover"
          >
            What JScout found in your résumé
            <ChevronDown className={cn('size-4 text-muted transition-transform', showFound && 'rotate-180')} aria-hidden />
          </button>
          {showFound ? (
            <div id="resume-found" className="border-t border-border p-4">
              <FoundPanel profile={profile} onPasteInstead={() => setPanel('paste')} />
            </div>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}

function FoundPanel({ profile, onPasteInstead }: { profile: Profile; onPasteInstead: () => void }) {
  const analysis = useResumeAnalysis(true);
  const save = useSaveProfile();
  const toast = useToast();

  if (analysis.isPending) return <SkeletonText lines={5} />;
  if (analysis.isError) {
    return <ErrorState compact title="Could not read what was found" error={analysis.error} onRetry={() => void analysis.refetch()} retrying={analysis.isFetching} />;
  }

  const apply = (patch: ProfilePatch) =>
    save.mutate(patch, {
      onSuccess: () => toast.success('Added to your profile'),
      onError: (err) => toast.error('Could not update your profile', { description: errorMessage(err) }),
    });

  return (
    <ResumeSuggestions
      key={profile.resume?.updatedAt}
      analysis={analysis.data}
      profile={profile}
      onApply={apply}
      applying={save.isPending}
      applyLabel="Add to profile"
      onPasteInstead={onPasteInstead}
    />
  );
}
