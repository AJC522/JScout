import { useState } from 'react';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import type { PersonalInfo, Profile } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Button, Combobox, Field, IconButton, Input, useToast } from '../../components/ui';
import { suggest, useSaveProfile } from './profile-api';
import { newId } from './profile-model';
import { SectionCard } from './SectionCard';
import { useDraft, useReportDirty } from './use-draft';
import { hasErrors, validatePersonal } from './validation';

const MAX_OTHER_LINKS = 20;

const LINK_FIELDS = [
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/you' },
  { key: 'github', label: 'GitHub', placeholder: 'github.com/you' },
  { key: 'portfolio', label: 'Portfolio', placeholder: 'dribbble.com/you' },
  { key: 'website', label: 'Website', placeholder: 'you.dev' },
] as const;

export function PersonalSection({ profile, onDirtyChange }: { profile: Profile; onDirtyChange: (dirty: boolean) => void }) {
  const draft = useDraft<PersonalInfo>(profile.personal);
  const save = useSaveProfile();
  const toast = useToast();
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const p = draft.value;
  const errors = validatePersonal(p);
  const show = (key: string) => submitted || touched.has(key);
  const touch = (key: string) => setTouched((current) => new Set(current).add(key));
  const set = <K extends keyof PersonalInfo>(key: K, value: PersonalInfo[K]) => draft.set((current) => ({ ...current, [key]: value }));

  useReportDirty(draft.dirty, onDirtyChange);

  const onSave = () => {
    setSubmitted(true);
    if (hasErrors(errors)) {
      toast.error('Check the highlighted fields', { description: 'Some details are not in a format JScout can save.' });
      return;
    }
    save.mutate(
      { personal: p },
      {
        onSuccess: (saved) => {
          draft.commit(saved.personal);
          setSubmitted(false);
          setTouched(new Set());
          toast.success('Personal details saved', { id: 'profile-saved' });
        },
        onError: (err) => toast.error('Could not save your details', { description: errorMessage(err) }),
      },
    );
  };

  return (
    <SectionCard
      id="personal"
      title="Personal"
      description="Used to fill in application forms. Only you can see it."
      form={{ dirty: draft.dirty, saving: save.isPending, onSave, onDiscard: draft.reset }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name">
          <Input value={p.fullName} onChange={(e) => set('fullName', e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Preferred name" optional hint="What people call you, if different.">
          <Input value={p.preferredName} onChange={(e) => set('preferredName', e.target.value)} autoComplete="nickname" />
        </Field>
        <Field label="Email" error={show('email') ? errors.email : undefined}>
          <Input type="email" value={p.email} onChange={(e) => set('email', e.target.value)} onBlur={() => touch('email')} autoComplete="email" />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={p.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" />
        </Field>
        <Field label="Where you live" className="sm:col-span-2" hint="City and region, as you would write it on an application.">
          <Combobox
            value={p.location}
            onValueChange={(value) => set('location', value)}
            loadOptions={suggest.locations}
            leadingIcon={<MapPin />}
            placeholder="e.g. Austin, TX"
            emptyMessage="No matching places. You can keep what you typed."
          />
        </Field>
        {LINK_FIELDS.map(({ key, label, placeholder }) => (
          <Field key={key} label={label} optional error={show(key) ? errors[key] : undefined}>
            <Input
              type="url"
              inputMode="url"
              value={p[key]}
              placeholder={placeholder}
              onChange={(e) => set(key, e.target.value)}
              onBlur={() => touch(key)}
            />
          </Field>
        ))}
      </div>

      <fieldset className="mt-5 flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-fg">Other links</legend>
        {p.otherLinks.length === 0 ? <p className="text-sm text-muted">Add anything else you share with employers, like a blog or publications.</p> : null}
        {p.otherLinks.map((link, index) => {
          const error = show(`link-${link.id}`) ? errors.otherLinks?.[link.id] : undefined;
          const update = (changes: Partial<typeof link>) =>
            set(
              'otherLinks',
              p.otherLinks.map((l) => (l.id === link.id ? { ...l, ...changes } : l)),
            );
          return (
            <div key={link.id} className="grid grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[12rem_1fr_auto]">
              <Field label={`Link ${index + 1} name`} hideLabel className="col-span-2 sm:col-span-1">
                <Input value={link.label} placeholder="Name, e.g. Blog" onChange={(e) => update({ label: e.target.value })} />
              </Field>
              <Field label={`Link ${index + 1} address`} hideLabel error={error}>
                <Input
                  type="url"
                  inputMode="url"
                  value={link.url}
                  placeholder="Address"
                  onChange={(e) => update({ url: e.target.value })}
                  onBlur={() => touch(`link-${link.id}`)}
                />
              </Field>
              <IconButton
                label={`Remove link ${index + 1}`}
                icon={<Trash2 />}
                onClick={() =>
                  set(
                    'otherLinks',
                    p.otherLinks.filter((l) => l.id !== link.id),
                  )
                }
              />
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          leadingIcon={<Plus />}
          disabled={p.otherLinks.length >= MAX_OTHER_LINKS}
          onClick={() => set('otherLinks', [...p.otherLinks, { id: newId(), label: '', url: '' }])}
        >
          Add a link
        </Button>
      </fieldset>
    </SectionCard>
  );
}
