import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { ProfileCompleteness } from '../../../shared/types';
import { Page } from '../../components/layout/Page';
import { Card, ErrorState, PageHeader, ScoreRing, Skeleton, SkeletonText } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';
import { AnswersSection } from './AnswersSection';
import { EducationSection, ExperienceSection } from './ExperienceSection';
import { PersonalSection } from './PersonalSection';
import { PreferencesSection } from './PreferencesSection';
import { useCompleteness, useProfile } from './profile-api';
import { ResumeSection } from './ResumeSection';
import { useUnsavedChangesGuard } from './use-draft';
import { WorkSection } from './WorkSection';

const SECTIONS = [
  { id: 'personal', label: 'Personal' },
  { id: 'work', label: 'Work' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'resume', label: 'Résumé' },
  { id: 'experience', label: 'Experience' },
  { id: 'education', label: 'Education' },
  { id: 'answers', label: 'Answers' },
] as const;

type Missing = ProfileCompleteness['missing'][number];

/** Experience is checked under "work" by the server but has its own section here. */
const anchorFor = (item: Missing): string => (item.key === 'experience' ? 'experience' : item.section);

export function ProfilePage() {
  useDocumentTitle('Profile');
  const profile = useProfile();
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  useUnsavedChangesGuard(Object.values(dirty).some(Boolean));
  // Stable per-section callbacks, so sections can report unsaved edits from an effect.
  const [reporters] = useState(() => {
    const report = (id: string) => (value: boolean) => setDirty((current) => (current[id] === value ? current : { ...current, [id]: value }));
    return { personal: report('personal'), work: report('work'), preferences: report('preferences') };
  });

  return (
    <Page width="narrow">
      <PageHeader title="Profile" description="What you are looking for and what you bring. Used to rank results and fill in applications. Stored only on this computer." />
      {profile.isPending ? (
        <ProfileSkeleton />
      ) : profile.isError ? (
        <ErrorState title="Could not load your profile" error={profile.error} onRetry={() => void profile.refetch()} retrying={profile.isFetching} />
      ) : (
        <div className="flex flex-col gap-5">
          <CompletenessCard />
          <nav aria-label="Profile sections" className="sticky top-13 z-20 -mx-4 border-b border-border bg-canvas/95 px-4 backdrop-blur-sm sm:top-0 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block rounded-control px-2.5 py-1 text-sm font-medium whitespace-nowrap text-muted hover:bg-hover hover:text-fg">
                    {s.label}
                    {dirty[s.id] ? <span className="ml-1.5 inline-block size-1.5 rounded-full bg-warning align-middle" aria-label="(unsaved)" /> : null}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <PersonalSection profile={profile.data} onDirtyChange={reporters.personal} />
          <WorkSection profile={profile.data} onDirtyChange={reporters.work} />
          <PreferencesSection profile={profile.data} onDirtyChange={reporters.preferences} />
          <ResumeSection profile={profile.data} />
          <ExperienceSection profile={profile.data} />
          <EducationSection profile={profile.data} />
          <AnswersSection profile={profile.data} />
        </div>
      )}
    </Page>
  );
}

function CompletenessCard() {
  const completeness = useCompleteness();
  if (completeness.isPending) return <Skeleton className="h-28 rounded-card" />;
  // The profile itself loaded; a missing score is not worth an error box.
  if (completeness.isError) return null;
  const { percent, missing } = completeness.data;

  return (
    <Card padded className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <ScoreRing value={percent} size="lg" label={`Profile ${percent}% complete`} className="shrink-0" />
      <div className="min-w-0 flex-1">
        {missing.length === 0 ? (
          <p className="flex items-center gap-2 text-base font-medium text-fg">
            <CheckCircle2 className="size-5 text-success" aria-hidden />
            Your profile is complete
          </p>
        ) : (
          <>
            <p className="text-base font-medium text-fg">Your profile is {percent}% complete</p>
            <p className="text-sm text-muted">Adding these helps JScout rank jobs and fill in applications for you:</p>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {missing.map((item) => (
                <li key={item.key}>
                  <a href={`#${anchorFor(item)}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading your profile">
      <Skeleton className="h-28 rounded-card" />
      <Skeleton className="h-9 rounded-control" />
      {[0, 1, 2].map((i) => (
        <Card key={i} padded>
          <Skeleton className="mb-4 h-5 w-40" />
          <SkeletonText lines={4} />
        </Card>
      ))}
    </div>
  );
}
