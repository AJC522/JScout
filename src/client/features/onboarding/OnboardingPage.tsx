import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { Logo } from '../../components/layout/Logo';
import { Button, Card } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

export function OnboardingPage() {
  useDocumentTitle('Welcome');
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <Logo />
        <h1 className="mt-6 text-2xl font-semibold text-fg">Welcome to JScout</h1>
        <p className="mt-2 text-base text-muted">
          Tell JScout what you are looking for once, and every search, ranking and application draft uses it. Everything stays on this computer.
        </p>
        <div className="mt-8 flex flex-wrap justify-end gap-2">
          <Button asChild variant="ghost">
            <Link to="/">Skip for now</Link>
          </Button>
          <Button asChild variant="primary" trailingIcon={<ArrowRight />}>
            <Link to="/profile">Set up my profile</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
