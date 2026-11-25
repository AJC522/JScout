import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui';

interface StepLayoutProps {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  onBack?: () => void;
  /** "Skip this step": moves on without saving what is on this step. */
  onSkip?: () => void;
  primary?: { label: string; onClick: () => void; loading?: boolean; disabled?: boolean };
}

/** One onboarding step: a heading that takes focus when the step opens, the content, and Back / Skip / Next. */
export function StepLayout({ title, description, children, onBack, onSkip, primary }: StepLayoutProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-fg outline-none sm:text-2xl">
          {title}
        </h1>
        {description ? <div className="text-base text-muted text-pretty">{description}</div> : null}
      </div>
      {children}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <div>
          {onBack ? (
            <Button variant="ghost" leadingIcon={<ArrowLeft />} onClick={onBack}>
              Back
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onSkip ? (
            <Button variant="ghost" onClick={onSkip}>
              Skip this step
            </Button>
          ) : null}
          {primary ? (
            <Button variant="primary" trailingIcon={<ArrowRight />} onClick={primary.onClick} loading={primary.loading} disabled={primary.disabled}>
              {primary.label}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
