/** Settings → Sending applications: the user's own email account, used to send applications by email. */
import { useState } from 'react';
import { CheckCircle2, KeyRound, Mail, XCircle } from 'lucide-react';
import type { AppSettings, EmailAccountUpdate } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Badge, Button, Field, Input, Select, Switch, useConfirm, useToast } from '../../components/ui';
import { useTestEmail } from '../applykit/queries';
import { useProfile } from '../profile/profile-api';
import { SectionCard } from '../profile/SectionCard';
import { useUpdateSettings } from './settings-api';

interface Preset {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  help: string;
}

/** Common providers' outgoing servers. Each needs an app password once two-step sign-in is on. */
export const EMAIL_PRESETS: Preset[] = [
  { id: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true, help: 'Turn on 2-Step Verification for your Google account, then create an app password at myaccount.google.com/apppasswords.' },
  { id: 'outlook', label: 'Outlook / Hotmail', host: 'smtp-mail.outlook.com', port: 587, secure: false, help: 'Create an app password under account.microsoft.com → Security → Advanced security options.' },
  { id: 'yahoo', label: 'Yahoo Mail', host: 'smtp.mail.yahoo.com', port: 465, secure: true, help: 'Create an app password in your Yahoo account’s security settings.' },
  { id: 'icloud', label: 'iCloud Mail', host: 'smtp.mail.me.com', port: 587, secure: false, help: 'Create an app-specific password at account.apple.com → Sign-In and Security.' },
  { id: 'fastmail', label: 'Fastmail', host: 'smtp.fastmail.com', port: 465, secure: true, help: 'Create an app password in Fastmail under Settings → Privacy & Security.' },
];
const OTHER = 'other';
const PRESET_OPTIONS = [...EMAIL_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: OTHER, label: 'Other (enter the server)' }];

interface Form {
  preset: string;
  fromAddress: string;
  fromName: string;
  host: string;
  port: string;
  secure: boolean;
  user: string;
  password: string;
}

function presetFor(host: string): string {
  return EMAIL_PRESETS.find((p) => p.host === host)?.id ?? (host ? OTHER : 'gmail');
}

function toForm(settings: AppSettings): Form {
  const e = settings.email;
  const preset = presetFor(e?.host ?? '');
  const p = EMAIL_PRESETS.find((x) => x.id === preset);
  return {
    preset,
    fromAddress: e?.fromAddress ?? '',
    fromName: e?.fromName ?? '',
    host: e?.host ?? p?.host ?? '',
    port: String(e?.port ?? p?.port ?? 587),
    secure: e?.secure ?? p?.secure ?? false,
    user: e && e.user !== e.fromAddress ? e.user : '',
    password: '',
  };
}

export function EmailSection({ settings }: { settings: AppSettings }) {
  const update = useUpdateSettings();
  const test = useTestEmail();
  const toast = useToast();
  const confirm = useConfirm();
  const profileName = useProfile().data?.personal.fullName ?? '';
  const [form, setForm] = useState<Form>(() => toForm(settings));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const account = settings.email;
  const preset = EMAIL_PRESETS.find((p) => p.id === form.preset);
  const port = Number(form.port);
  const portOk = Number.isInteger(port) && port > 0 && port < 65536;

  const choosePreset = (id: string) => {
    const p = EMAIL_PRESETS.find((x) => x.id === id);
    setForm((f) => (p ? { ...f, preset: id, host: p.host, port: String(p.port), secure: p.secure } : { ...f, preset: id }));
  };

  const save = () => {
    if (!portOk) return;
    const patch: EmailAccountUpdate = {
      host: form.host.trim(),
      port,
      secure: form.secure,
      fromAddress: form.fromAddress.trim(),
      fromName: form.fromName.trim(),
      user: form.user.trim() || form.fromAddress.trim(),
      ...(form.password.trim() ? { password: form.password } : {}),
    };
    update.mutate(
      { email: patch },
      {
        onSuccess: (saved) => {
          setForm({ ...toForm(saved), password: '' });
          test.reset();
          toast.success('Email account saved', { description: saved.email?.hasPassword ? 'Send a test email to check that it works.' : 'Add the password before sending.' });
        },
        onError: (err) => toast.error('Could not save the email account', { description: errorMessage(err) }),
      },
    );
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Remove this email account?',
      description: 'JScout will forget the server and password. Applications already sent stay in your tracker.',
      confirmLabel: 'Remove account',
      tone: 'danger',
    });
    if (!ok) return;
    update.mutate(
      { email: null },
      {
        onSuccess: (saved) => {
          setForm(toForm(saved));
          test.reset();
          toast.success('Email account removed');
        },
        onError: (err) => toast.error('Could not remove the account', { description: errorMessage(err) }),
      },
    );
  };

  return (
    <SectionCard
      id="email"
      title="Sending applications"
      description="Optional. Jobs that take applications by email can be applied to from inside JScout, sent from your own email account."
      actions={account?.hasPassword ? <Badge tone="success" dot>Ready to send</Badge> : account ? <Badge tone="warning">Needs a password</Badge> : <Badge>Off</Badge>}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-muted">
          JScout signs in to your provider’s outgoing mail server and sends only the emails you press Send on, with your résumé attached. The password
          is stored only on this computer and never shown again. Employer job boards (Greenhouse, Lever, Ashby…) don’t accept applications from other
          apps, so those are still made on the employer’s form.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email provider">
            <Select aria-label="Email provider" options={PRESET_OPTIONS} value={form.preset} onChange={(e) => choosePreset(e.target.value)} />
          </Field>
          <Field label="Your email address" hint="Applications are sent from this address.">
            <Input type="email" autoComplete="email" value={form.fromAddress} onChange={(e) => set('fromAddress', e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label={account?.hasPassword ? 'Replace password' : 'App password'} hint={preset?.help ?? 'The password for your mail server (an app password if your provider offers them).'} className="sm:col-span-2">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              leadingIcon={<KeyRound />}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              placeholder={account?.hasPassword ? '••••••••  saved' : 'abcd efgh ijkl mnop'}
            />
          </Field>
          <Field label="Name on your emails" hint={profileName ? `Leave empty to use your profile name (${profileName}).` : 'Leave empty to use your profile name.'}>
            <Input value={form.fromName} onChange={(e) => set('fromName', e.target.value)} />
          </Field>
          {form.preset === OTHER ? (
            <>
              <Field label="Outgoing mail server (SMTP)">
                <Input value={form.host} spellCheck={false} onChange={(e) => set('host', e.target.value)} placeholder="smtp.example.com" />
              </Field>
              <Field label="Port" error={portOk ? undefined : 'Enter a port from 1 to 65535'}>
                <Input inputMode="numeric" value={form.port} onChange={(e) => set('port', e.target.value)} />
              </Field>
              <Field label="Sign-in name" hint="Leave empty if it is your email address.">
                <Input value={form.user} spellCheck={false} autoComplete="username" onChange={(e) => set('user', e.target.value)} />
              </Field>
              <Switch
                className="sm:col-span-2"
                checked={form.secure}
                onCheckedChange={(on) => set('secure', on)}
                label="Secure connection from the start"
                description="Usually port 465. When off, the connection is secured with STARTTLS (usually port 587)."
              />
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" size="sm" leadingIcon={<Mail />} loading={update.isPending} disabled={!form.fromAddress.trim() || !form.host.trim() || !portOk}>
            Save account
          </Button>
          {account?.hasPassword ? (
            <Button
              type="button"
              size="sm"
              loading={test.isPending}
              onClick={() => test.mutate(undefined, { onSuccess: (r) => toast.success('Test email sent', { description: `Check the inbox of ${r.to}.` }) })}
            >
              Send a test email
            </Button>
          ) : null}
          {account ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => void remove()}>
              Remove account
            </Button>
          ) : null}
        </div>
        {test.isError ? (
          <p role="status" className="flex items-start gap-1.5 text-sm text-danger">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {errorMessage(test.error)}
          </p>
        ) : test.isSuccess ? (
          <p role="status" className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            Sent to {test.data.to}. If it arrived, JScout can send applications.
          </p>
        ) : null}
      </form>
    </SectionCard>
  );
}
