import { useState } from 'react';
import { FileText } from 'lucide-react';
import type { ProfilePatch } from '../../../shared/api';
import type { Profile, ResumeAnalysis } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Button, ErrorState, SkeletonText, useToast } from '../../components/ui';
import { useResumeAnalysis, useSaveProfile } from '../profile/profile-api';
import { ResumeSuggestions } from '../profile/ResumeSuggestions';
import { ResumeUpload } from '../profile/ResumeUpload';
import { StepLayout } from './StepLayout';

interface ResumeStepProps {
  profile: Profile;
  onBack: () => void;
  onNext: () => void;
}

/** Upload or paste a résumé, then confirm what JScout found in it. */
export function ResumeStep({ profile, onBack, onNext }: ResumeStepProps) {
  // A résumé added earlier (e.g. before leaving setup halfway) is reviewed again rather than asked for twice.
  const [phase, setPhase] = useState<'upload' | 'paste' | 'review'>(profile.resume ? 'review' : 'upload');
  const [fresh, setFresh] = useState<ResumeAnalysis | null>(null);
  const stored = useResumeAnalysis(phase === 'review' && fresh === null && profile.resume !== null);
  const save = useSaveProfile();
  const toast = useToast();
  const analysis = fresh ?? stored.data;

  const apply = (patch: ProfilePatch) =>
    save.mutate(patch, {
      onSuccess: onNext,
      onError: (err) => toast.error('Could not save these details', { description: errorMessage(err) }),
    });

  if (phase !== 'review') {
    return (
      <StepLayout
        key="upload"
        title="Add your résumé"
        description="JScout reads it to suggest your skills and the titles to search for. You confirm everything before it is saved."
        onBack={onBack}
        onSkip={onNext}
      >
        <ResumeUpload
          key={phase}
          startWithPaste={phase === 'paste'}
          onUploaded={(result) => {
            setFresh(result.analysis);
            setPhase('review');
          }}
        />
      </StepLayout>
    );
  }

  return (
    <StepLayout
      key="review"
      title="Here is what JScout found"
      description="These are suggestions. Change anything that is not right, then choose “Use these”."
      onBack={onBack}
      onSkip={onNext}
    >
      {profile.resume ? (
        <div className="flex items-center gap-3 rounded-card border border-border bg-surface-2 px-3 py-2">
          <FileText className="size-5 shrink-0 text-subtle" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{profile.resume.fileName || 'Pasted résumé'}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFresh(null);
              setPhase('upload');
            }}
          >
            Use a different résumé
          </Button>
        </div>
      ) : null}
      {analysis ? (
        <ResumeSuggestions
          key={profile.resume?.updatedAt}
          analysis={analysis}
          profile={profile}
          onApply={apply}
          applying={save.isPending}
          onPasteInstead={() => {
            setFresh(null);
            setPhase('paste');
          }}
        />
      ) : stored.isError ? (
        <ErrorState compact title="Could not load what was found" error={stored.error} onRetry={() => void stored.refetch()} retrying={stored.isFetching} />
      ) : (
        <SkeletonText lines={6} />
      )}
    </StepLayout>
  );
}
