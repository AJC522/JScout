import type { Profile, SearchPreferences } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { useToast } from '../../components/ui';
import { PreferencesFields } from './PreferencesFields';
import { preferencesErrors } from './preferences-model';
import { useSaveProfile } from './profile-api';
import { SectionCard } from './SectionCard';
import { useDraft, useReportDirty } from './use-draft';
import { hasErrors } from './validation';

export function PreferencesSection({ profile, onDirtyChange }: { profile: Profile; onDirtyChange: (dirty: boolean) => void }) {
  const draft = useDraft<SearchPreferences>(profile.preferences);
  const save = useSaveProfile();
  const toast = useToast();

  useReportDirty(draft.dirty, onDirtyChange);

  const onSave = () => {
    if (hasErrors(preferencesErrors(draft.value))) {
      toast.error('Check the highlighted fields');
      return;
    }
    save.mutate(
      { preferences: draft.value },
      {
        onSuccess: (result) => {
          draft.commit(result.preferences);
          toast.success('Search preferences saved', { id: 'profile-saved', description: 'Your next profile search uses them.' });
        },
        onError: (err) => toast.error('Could not save your preferences', { description: errorMessage(err) }),
      },
    );
  };

  return (
    <SectionCard
      id="preferences"
      title="Search preferences"
      description="What you are looking for. JScout uses this to build your search and rank results."
      form={{ dirty: draft.dirty, saving: save.isPending, onSave, onDiscard: draft.reset }}
    >
      <PreferencesFields value={draft.value} onChange={draft.set} extended />
    </SectionCard>
  );
}
