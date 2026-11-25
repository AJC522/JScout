/** People connected to an application: recruiters, hiring managers, referrals. */
import { useState, type FormEvent } from 'react';
import { Link2, Mail, Pencil, Phone, Plus, Trash2, UserRound } from 'lucide-react';
import type { ApplicationContact, ApplicationDetail } from '../../../../shared/types';
import { Button, Dialog, Field, IconButton, Input, Textarea, useConfirm } from '../../../components/ui';
import { initials } from '../../../lib/format';
import { normalizeUrl } from '../add-form';
import { usePatchApplication } from '../queries';
import { Section } from './Section';

const EMPTY_CONTACT: ApplicationContact = { id: '', name: '', role: '', email: '', phone: '', linkedin: '', notes: '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORM_ID = 'contact-form';

type ContactErrors = Partial<Record<'name' | 'email' | 'linkedin', string>>;

function validateContact(c: ApplicationContact): { contact: ApplicationContact; errors: ContactErrors } {
  const errors: ContactErrors = {};
  const trimmed: ApplicationContact = {
    id: c.id,
    name: c.name.trim(),
    role: c.role.trim(),
    email: c.email.trim(),
    phone: c.phone.trim(),
    linkedin: c.linkedin.trim(),
    notes: c.notes.trim(),
  };
  if (!trimmed.name) errors.name = 'Add a name.';
  if (trimmed.email && !EMAIL_RE.test(trimmed.email)) errors.email = 'This does not look like an email address.';
  if (trimmed.linkedin) {
    const url = normalizeUrl(trimmed.linkedin);
    if (url) trimmed.linkedin = url;
    else errors.linkedin = 'Paste the full link to their profile.';
  }
  return { contact: trimmed, errors };
}

function ContactDialog({
  open,
  initial,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initial: ApplicationContact;
  onOpenChange: (open: boolean) => void;
  onSave: (contact: ApplicationContact) => void;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<ContactErrors>({});
  const set = (key: keyof ApplicationContact, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { contact, errors: found } = validateContact(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    onSave(contact);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial.id ? 'Edit contact' : 'Add a contact'}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={FORM_ID}>
            {initial.id ? 'Save contact' : 'Add contact'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" required error={errors.name}>
          <Input value={values.name} onChange={(e) => set('name', e.target.value)} maxLength={200} autoFocus />
        </Field>
        <Field label="Role" optional>
          <Input value={values.role} onChange={(e) => set('role', e.target.value)} placeholder="e.g. Recruiter" maxLength={200} />
        </Field>
        <Field label="Email" optional error={errors.email}>
          <Input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} maxLength={320} />
        </Field>
        <Field label="Phone" optional>
          <Input type="tel" value={values.phone} onChange={(e) => set('phone', e.target.value)} maxLength={60} />
        </Field>
        <Field label="LinkedIn" optional error={errors.linkedin} className="sm:col-span-2">
          <Input value={values.linkedin} onChange={(e) => set('linkedin', e.target.value)} placeholder="linkedin.com/in/…" maxLength={500} />
        </Field>
        <Field label="Notes" optional className="sm:col-span-2">
          <Textarea value={values.notes} onChange={(e) => set('notes', e.target.value)} rows={3} autoGrow maxRows={8} maxLength={5000} />
        </Field>
      </form>
    </Dialog>
  );
}

function ContactRow({ contact, onEdit, onRemove }: { contact: ApplicationContact; onEdit: () => void; onRemove: () => void }) {
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
        {initials(contact.name) || <UserRound className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{contact.name}</p>
        {contact.role ? <p className="text-xs text-muted">{contact.role}</p> : null}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {contact.email ? (
            <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Mail aria-hidden="true" className="size-3" />
              {contact.email}
            </a>
          ) : null}
          {contact.phone ? (
            <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Phone aria-hidden="true" className="size-3" />
              {contact.phone}
            </a>
          ) : null}
          {contact.linkedin ? (
            <a href={contact.linkedin} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
              <Link2 aria-hidden="true" className="size-3" />
              LinkedIn
            </a>
          ) : null}
        </div>
        {contact.notes ? <p className="mt-1.5 text-sm whitespace-pre-line text-muted">{contact.notes}</p> : null}
      </div>
      <div className="flex shrink-0 items-start">
        <IconButton size="xs" label={`Edit ${contact.name}`} icon={<Pencil />} onClick={onEdit} />
        <IconButton size="xs" label={`Remove ${contact.name}`} icon={<Trash2 />} onClick={onRemove} />
      </div>
    </li>
  );
}

export function ContactsSection({ app }: { app: ApplicationDetail }) {
  const patch = usePatchApplication(app.id);
  const confirm = useConfirm();
  // `key` remounts the dialog so each opening starts from the right values.
  const [editing, setEditing] = useState<{ contact: ApplicationContact; key: number } | null>(null);

  const save = (contact: ApplicationContact) => {
    const exists = contact.id && app.contacts.some((c) => c.id === contact.id);
    const contacts = exists ? app.contacts.map((c) => (c.id === contact.id ? contact : c)) : [...app.contacts, { ...contact, id: crypto.randomUUID() }];
    patch.mutate({ contacts });
    setEditing(null);
  };

  const remove = async (contact: ApplicationContact) => {
    const ok = await confirm({ title: `Remove ${contact.name}?`, description: 'Their details will be removed from this application.', confirmLabel: 'Remove', tone: 'danger' });
    if (ok) patch.mutate({ contacts: app.contacts.filter((c) => c.id !== contact.id) });
  };

  return (
    <Section
      title="Contacts"
      actions={
        <Button size="sm" variant="ghost" leadingIcon={<Plus />} onClick={() => setEditing({ contact: EMPTY_CONTACT, key: Date.now() })}>
          Add
        </Button>
      }
    >
      {app.contacts.length === 0 ? (
        <p className="text-sm text-muted">Add the recruiter or hiring manager so their details are at hand when you follow up.</p>
      ) : (
        <ul className="divide-y divide-border">
          {app.contacts.map((c) => (
            <ContactRow key={c.id} contact={c} onEdit={() => setEditing({ contact: c, key: Date.now() })} onRemove={() => void remove(c)} />
          ))}
        </ul>
      )}
      {editing ? (
        <ContactDialog key={editing.key} open initial={editing.contact} onOpenChange={(open) => !open && setEditing(null)} onSave={save} />
      ) : null}
    </Section>
  );
}
