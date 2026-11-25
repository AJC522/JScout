/**
 * Apply by email from inside JScout: an editable email (to, subject, a cover letter as the body) with the
 * résumé attached, sent from the user's own account. Sending moves the job to Applied in the tracker.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, ExternalLink, Mail, Paperclip, Send, TriangleAlert } from 'lucide-react';
import type { EmailApplicationDraft, EmailApplicationResult } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Button, Checkbox, ErrorState, Field, Input, Skeleton, SkeletonText, Textarea, useConfirm, useToast } from '../../components/ui';
import { formatBytes, formatDateTime } from '../../lib/format';
import { type ApplyKitTarget, targetBody, useEmailDraft, useSendEmailApplication } from './queries';

const ADDRESS = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const addresses = (value: string) =>
  value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
const validList = (value: string, required: boolean) => {
  const list = addresses(value);
  return (required ? list.length > 0 : true) && list.every((a) => ADDRESS.test(a));
};

/** A "[Your earliest start date]" left from the template: never sent by accident. */
export function placeholderIn(text: string): string | undefined {
  return /\[[^\]\n]{3,200}\]/.exec(text)?.[0];
}

/** A mailto: link for people who'd rather send from their own mail app (they attach the résumé themselves). */
export function mailtoLink(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20');
  return `mailto:${addresses(to).map(encodeURIComponent).join(',')}?${params}`;
}

export interface EmailApplyPanelProps {
  target: ApplyKitTarget;
  onSent?: (result: EmailApplicationResult) => void;
}

export function EmailApplyPanel({ target, onSent }: EmailApplyPanelProps) {
  // Sending tracks the job, which gives it an application id (a new target and draft): the
  // confirmation lives here, above the keyed form, so that refresh doesn't wipe it.
  const [sent, setSent] = useState<EmailApplicationResult | undefined>();
  const draft = useEmailDraft(target, !sent);
  if (sent) return <SentNotice sent={sent} />;
  if (draft.isError) return <ErrorState title="Could not prepare the email" error={draft.error} onRetry={() => void draft.refetch()} retrying={draft.isFetching} />;
  if (!draft.data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <SkeletonText lines={6} />
      </div>
    );
  }
  // Keyed so a new draft (another job) starts a fresh form.
  const handleSent = (result: EmailApplicationResult) => {
    setSent(result);
    onSent?.(result);
  };
  return <Composer key={JSON.stringify(targetBody(target))} target={target} draft={draft.data} onSent={handleSent} />;
}

function SentNotice({ sent }: { sent: EmailApplicationResult }) {
  return (
    <div role="status" className="space-y-2 rounded-card border border-success/40 bg-success-soft/40 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-fg">
        <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
        Sent to {sent.to} · {formatDateTime(sent.sentAt)}
      </p>
      <p className="text-sm text-muted">The email is saved with the application, and the job is in your tracker as Applied with a follow-up reminder.</p>
      <Button asChild size="sm" variant="secondary">
        <Link to={`/tracker/${encodeURIComponent(sent.application.id)}`}>Open in tracker</Link>
      </Button>
    </div>
  );
}

function Composer({ target, draft, onSent }: { target: ApplyKitTarget; draft: EmailApplicationDraft; onSent: (result: EmailApplicationResult) => void }) {
  const send = useSendEmailApplication();
  const confirm = useConfirm();
  const toast = useToast();
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [attach, setAttach] = useState(Boolean(draft.resume));

  const toOk = validList(to, true);
  const ccOk = validList(cc, false);
  const placeholder = placeholderIn(body) ?? placeholderIn(subject);
  const ready = draft.canSend && toOk && ccOk && subject.trim() !== '' && body.trim() !== '' && !placeholder;

  const submit = async () => {
    if (!ready) return;
    const recipients = addresses(to).join(', ');
    const ok = await confirm({
      title: `Send your application to ${recipients}?`,
      description: (
        <>
          It goes out from {draft.fromAddress}
          {attach && draft.resume ? ` with ${draft.resume.fileName} attached` : ' without a résumé attached'}, and can’t be unsent. JScout will move this job to
          Applied in your tracker.
        </>
      ),
      confirmLabel: 'Send application',
    });
    if (!ok) return;
    send.mutate(
      { ...targetBody(target), to: recipients, ...(cc.trim() ? { cc: addresses(cc).join(', ') } : {}), subject, body, attachResume: attach },
      {
        onSuccess: (result) => {
          toast.success(`Application sent to ${result.to}`, { description: 'Moved to Applied in your tracker.' });
          onSent(result);
        },
        onError: (err) => toast.error('The application was not sent', { description: errorMessage(err) }),
      },
    );
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {draft.applyEmail ? (
        <p className="flex items-start gap-2 rounded-control bg-info-soft/60 px-3 py-2 text-sm text-fg">
          <Mail className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <span>
            This posting takes applications by email: <span className="text-muted italic">“{draft.applyEmail.evidence}”</span>
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted">The posting doesn’t give an address to apply to. If you have a recruiter’s or hiring manager’s email, you can send your application to them here.</p>
      )}

      {!draft.canSend ? (
        <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            To send from JScout, set up your email account in{' '}
            <Link to="/settings#email" className="font-medium underline underline-offset-2">
              Settings → Sending applications
            </Link>
            . Or open the email in your own mail app below.
          </span>
        </p>
      ) : null}

      <div className="space-y-3">
        <Field label="To" error={to.trim() && !toOk ? 'Enter email addresses separated by commas' : undefined}>
          <Input type="text" inputMode="email" autoComplete="off" spellCheck={false} value={to} onChange={(e) => setTo(e.target.value)} placeholder="jobs@company.com" />
        </Field>
        {draft.suggestions.length > 0 ? (
          <ul className="-mt-1 flex flex-wrap gap-1.5" aria-label="Addresses you can use">
            {draft.suggestions.map((s) => (
              <li key={s.address}>
                <button
                  type="button"
                  onClick={() => setTo(s.address)}
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:border-strong hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                >
                  {s.label}: <span className="text-fg">{s.address}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {showCc ? (
          <Field label="Cc" error={cc.trim() && !ccOk ? 'Enter email addresses separated by commas' : undefined}>
            <Input type="text" inputMode="email" autoComplete="off" spellCheck={false} value={cc} onChange={(e) => setCc(e.target.value)} />
          </Field>
        ) : (
          <Button type="button" variant="link" size="sm" onClick={() => setShowCc(true)}>
            Add Cc
          </Button>
        )}
        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field
          label="Message"
          error={placeholder ? `Fill in or delete “${placeholder.length > 60 ? `${placeholder.slice(0, 57)}…]` : placeholder}” before sending.` : undefined}
          hint={draft.bodySource === 'saved-letter' ? 'Your saved cover letter for this application. Edit it as you like.' : 'A cover letter drafted from your profile. Edit it before you send; the Cover letter tab can write a different one.'}
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} autoGrow rows={10} maxRows={28} />
        </Field>
        {draft.resume ? (
          <Checkbox
            checked={attach}
            onCheckedChange={(on) => setAttach(on === true)}
            label={
              <span className="inline-flex items-center gap-1.5">
                <Paperclip className="size-3.5 text-muted" aria-hidden="true" />
                Attach my résumé: {draft.resume.fileName} ({formatBytes(draft.resume.sizeBytes)})
              </span>
            }
            description={draft.resume.fromText ? 'Your résumé text as a plain-text file. Upload a PDF or Word file on the Profile page to attach the original.' : undefined}
          />
        ) : (
          <p className="text-sm text-muted">
            No résumé to attach. <Link to="/profile#resume" className="text-primary hover:underline">Add one on your profile</Link> first, or send without it.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button type="submit" variant="primary" leadingIcon={<Send />} disabled={!ready} loading={send.isPending}>
          Send application
        </Button>
        <Button asChild variant="ghost" trailingIcon={<ExternalLink />}>
          <a href={mailtoLink(to, subject, body)}>Open in my email app</a>
        </Button>
        {draft.canSend ? <span className="text-xs text-muted">From {draft.fromAddress}</span> : null}
      </div>
      {send.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(send.error)}
        </p>
      ) : null}
    </form>
  );
}
