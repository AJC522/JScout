import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Minus } from 'lucide-react';
import type { Profile } from '../../../shared/types';
import { api, errorMessage } from '../../api/client';
import { useToast } from '../../components/ui';
import { qk } from '../../lib/query';
import { useSaveProfile } from '../profile/profile-api';
import { StepLayout } from './StepLayout';

interface DoneStepProps {
  profile: Profile;
  onBack: () => void;
  /** Called once setup is marked finished; the page navigates to the search. */
  onFinished: () => void;
}

/** A recap, then: mark setup finished, start the first sync and open the search built from the profile. */
export function DoneStep({ profile, onBack, onFinished }: DoneStepProps) {
  const save = useSaveProfile();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const p = profile.preferences;

  const recap = [
    { done: profile.resume !== null, text: profile.resume ? `Résumé added (${profile.resume.fileName || 'pasted text'})` : 'No résumé yet' },
    { done: p.targetTitles.length > 0, text: p.targetTitles.length > 0 ? `Looking for ${listOf(p.targetTitles)}` : 'No job titles yet' },
    {
      done: p.locations.length > 0 || p.remote.length > 0,
      text:
        p.locations.length > 0
          ? `In ${listOf(p.locations)}${p.remote.includes('remote') ? ', or remote' : ''}`
          : p.remote.includes('remote')
            ? 'Remote jobs'
            : 'Any location',
    },
    { done: p.skills.length > 0, text: p.skills.length > 0 ? `${p.skills.length} skills to match against` : 'No skills yet' },
  ];

  const finish = async () => {
    setStarting(true);
    try {
      await save.mutateAsync({ onboardedAt: new Date().toISOString() });
    } catch (err) {
      setStarting(false);
      toast.error('Could not finish setup', { description: errorMessage(err) });
      return;
    }
    try {
      await api('POST /api/sync', { body: {} });
      void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
    } catch {
      toast.info('Jobs will download shortly', { description: 'JScout could not start syncing yet. It will try again on its own.' });
    }
    onFinished();
  };

  return (
    <StepLayout
      title="You’re all set"
      description="JScout is downloading jobs from the job boards and the companies you picked. The first sync takes a minute or two; results appear as they arrive."
      onBack={onBack}
      primary={{ label: 'Start searching', onClick: () => void finish(), loading: starting }}
    >
      <ul className="flex flex-col gap-2">
        {recap.map((item) => (
          <li key={item.text} className="flex items-start gap-2.5 text-base">
            {item.done ? (
              <Check className="mt-0.5 size-5 shrink-0 text-success" aria-label="Done" />
            ) : (
              <Minus className="mt-0.5 size-5 shrink-0 text-subtle" aria-label="Not yet" />
            )}
            <span className={item.done ? 'text-fg' : 'text-muted'}>{item.text}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">You can fill in the rest, like your experience and saved answers, on your profile whenever you like.</p>
    </StepLayout>
  );
}

function listOf(items: readonly string[]): string {
  const shown = items.slice(0, 3);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}
