import type { FormEvent, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button, Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui';

interface SectionCardProps {
  /** Anchor id, so completeness links and the section nav can jump here. */
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Present for form sections: renders a <form> with a Save/Discard footer. */
  form?: {
    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    onDiscard: () => void;
  };
}

/** One section of the profile: a card with an anchor, and for forms a save footer that never changes height. */
export function SectionCard({ id, title, description, actions, children, form }: SectionCardProps) {
  const headingId = `${id}-heading`;
  const header = (
    <CardHeader actions={actions}>
      <CardTitle id={headingId}>{title}</CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
    </CardHeader>
  );

  if (!form) {
    return (
      <section id={id} aria-labelledby={headingId} className="scroll-mt-20">
        <Card>
          {header}
          <CardBody>{children}</CardBody>
        </Card>
      </section>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form.dirty && !form.saving) form.onSave();
  };

  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-20">
      <Card>
        <form onSubmit={submit} noValidate>
          {header}
          <CardBody>{children}</CardBody>
          <CardFooter className="justify-between">
            <p className="flex items-center gap-1.5 text-sm text-muted" aria-live="polite">
              {form.dirty ? (
                <>
                  <span className="size-2 rounded-full bg-warning" aria-hidden />
                  Unsaved changes
                </>
              ) : (
                <>
                  <Check className="size-4 text-success" aria-hidden />
                  Saved
                </>
              )}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={form.onDiscard} disabled={!form.dirty || form.saving}>
                Discard
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={form.saving} disabled={!form.dirty}>
                Save
              </Button>
            </div>
          </CardFooter>
        </form>
      </Card>
    </section>
  );
}
