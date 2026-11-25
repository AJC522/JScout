import { Check, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Logo } from '../../components/layout/Logo';
import { Button, Card, ErrorState, ProgressBar, Skeleton, SkeletonText } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useDocumentTitle, useLocalStorage } from '../../lib/hooks';
import { useProfile, useSaveProfile } from '../profile/profile-api';
import { CompaniesStep } from './CompaniesStep';
import { DoneStep } from './DoneStep';
import { PreferencesStep } from './PreferencesStep';
import { ResumeStep } from './ResumeStep';
import { StepLayout } from './StepLayout';
import { STEPS, STEP_STORAGE_KEY, clampStep } from './steps';

/**
 * First-run setup at /welcome, outside the app shell. Each step saves its own part of the profile
 * when the user moves on, and the current step is remembered, so leaving halfway loses nothing.
 */
export function OnboardingPage() {
  useDocumentTitle('Welcome');
  const navigate = useNavigate();
  const profile = useProfile();
  const save = useSaveProfile();
  const [storedStep, setStoredStep, clearStoredStep] = useLocalStorage<number>(STEP_STORAGE_KEY, 0);
  const step = clampStep(storedStep);
  const current = STEPS[step] ?? STEPS[0];

  const go = (index: number) => setStoredStep(clampStep(index));
  const back = () => go(step - 1);
  const next = () => go(step + 1);

  /** Leaving setup for good: it counts as done so it is not offered again; what was saved stays. */
  const leave = (to: string) => {
    clearStoredStep();
    if (profile.data && profile.data.onboardedAt === null) save.mutate({ onboardedAt: new Date().toISOString() });
    navigate(to);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Logo />
        <Button variant="ghost" size="sm" onClick={() => leave('/')}>
          Skip setup
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 pt-2 pb-10 sm:pt-6">
        <Progress step={step} />
        <Card className="p-5 sm:p-8">
          {profile.isPending ? (
            <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
              <Skeleton className="h-7 w-2/3" />
              <SkeletonText lines={4} />
            </div>
          ) : profile.isError ? (
            <div className="flex flex-col gap-4">
              <ErrorState title="Could not load your profile" error={profile.error} onRetry={() => void profile.refetch()} retrying={profile.isFetching} />
              <p className="text-center text-sm text-muted">
                You can also{' '}
                <Link to="/" className="font-medium text-primary underline-offset-2 hover:underline">
                  skip setup for now
                </Link>
                .
              </p>
            </div>
          ) : current.id === 'welcome' ? (
            <StepLayout
              key="welcome"
              title="Welcome to JScout"
              description="JScout searches hundreds of job boards and company career pages at once, ranks what fits you, and helps you apply. Setup takes about two minutes, and every step is optional."
              primary={{ label: 'Get started', onClick: next }}
            >
              <div className="flex items-start gap-3 rounded-card bg-primary-soft p-4 text-sm text-fg">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <p>
                  Everything you enter stays on this computer. JScout only contacts job sites to download postings, and an AI service only if you add
                  your own key and ask it to draft something.
                </p>
              </div>
            </StepLayout>
          ) : current.id === 'resume' ? (
            <ResumeStep key="resume" profile={profile.data} onBack={back} onNext={next} />
          ) : current.id === 'preferences' ? (
            <PreferencesStep key="preferences" profile={profile.data} onBack={back} onNext={next} />
          ) : current.id === 'companies' ? (
            <CompaniesStep key="companies" profile={profile.data} onBack={back} onNext={next} />
          ) : (
            <DoneStep
              key="done"
              profile={profile.data}
              onBack={back}
              onFinished={() => {
                clearStoredStep();
                navigate('/?from=profile');
              }}
            />
          )}
        </Card>
      </main>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  const current = STEPS[step] ?? STEPS[0];
  return (
    <nav aria-label="Setup progress">
      <p className="mb-2 text-sm text-muted sm:hidden">
        Step {step + 1} of {STEPS.length}: <span className="font-medium text-fg">{current.label}</span>
      </p>
      <ProgressBar className="sm:hidden" size="sm" value={((step + 1) / STEPS.length) * 100} label={`Step ${step + 1} of ${STEPS.length}`} />
      <ol className="hidden items-center gap-2 sm:flex">
        {STEPS.map((s, index) => {
          const done = index < step;
          const active = index === step;
          return (
            <li key={s.id} className="flex flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  done && 'bg-primary text-on-primary',
                  active && 'bg-primary-soft text-primary ring-2 ring-primary',
                  !done && !active && 'bg-surface-3 text-muted',
                )}
              >
                {done ? <Check className="size-3.5" aria-label="Done" /> : index + 1}
              </span>
              <span className={cn('truncate text-sm', active ? 'font-medium text-fg' : 'text-muted')}>{s.label}</span>
              {index < STEPS.length - 1 ? <span className="h-px min-w-3 flex-1 bg-border" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
