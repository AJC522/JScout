import { useState } from 'react';
import type { Profile } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { useToast } from '../../components/ui';
import { PreferencesFields, type PreferencesValue } from '../profile/PreferencesFields';
import { useSaveProfile } from '../profile/profile-api';
import { sameJson } from '../profile/profile-model';
import { StepLayout } from './StepLayout';

interface PreferencesStepProps {
  profile: Profile;
  onBack: () => void;
  onNext: () => void;
}

function pick(profile: Profile): PreferencesValue {
  const { targetTitles, locations, radiusKm, remote, salaryMin, salaryCurrency, employmentTypes, seniority } = profile.preferences;
  return { targetTitles, locations, radiusKm, remote, salaryMin, salaryCurrency, employmentTypes, seniority };
}

/** Titles, places, arrangement, pay and level: the core of the first search. Saved when the user moves on. */
export function PreferencesStep({ profile, onBack, onNext }: PreferencesStepProps) {
  const [initial] = useState(() => pick(profile));
  const [value, setValue] = useState(initial);
  const save = useSaveProfile();
  const toast = useToast();

  const next = () => {
    if (sameJson(value, initial)) {
      onNext();
      return;
    }
    save.mutate(
      { preferences: value },
      {
        onSuccess: onNext,
        onError: (err) => toast.error('Could not save your preferences', { description: errorMessage(err) }),
      },
    );
  };

  return (
    <StepLayout
      title="What are you looking for?"
      description="Fill in what you know. Everything is optional and you can change it any time on your profile."
      onBack={onBack}
      onSkip={onNext}
      primary={{ label: 'Next', onClick: next, loading: save.isPending }}
    >
      <PreferencesFields value={value} onChange={setValue} />
    </StepLayout>
  );
}
