/** "Add application" for jobs found outside JScout: type or paste the details. */
import { useState, type FormEvent } from 'react';
import type { ApplicationDetail } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Button, Dialog, Field, Input, Select, Textarea, useToast } from '../../components/ui';
import { EMPTY_MANUAL_APPLICATION, validateManualApplication, type ManualApplicationErrors, type ManualApplicationValues } from './add-form';
import { useCreateApplication } from './queries';
import { STATUS_OPTIONS } from './status';

export interface AddApplicationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: ApplicationDetail) => void;
}

const FORM_ID = 'add-application-form';

export function AddApplicationDialog({ open, onOpenChange, onCreated }: AddApplicationDialogProps) {
  const toast = useToast();
  const create = useCreateApplication();
  const [values, setValues] = useState<ManualApplicationValues>(EMPTY_MANUAL_APPLICATION);
  const [errors, setErrors] = useState<ManualApplicationErrors>({});

  const set = <K extends keyof ManualApplicationValues>(key: K, value: ManualApplicationValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setValues(EMPTY_MANUAL_APPLICATION);
      setErrors({});
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateManualApplication(values);
    if (!result.ok) {
      setErrors(result.errors);
      const first = (['title', 'company', 'url'] as const).find((k) => result.errors[k]);
      if (first) document.getElementById(`add-app-${first}`)?.focus();
      return;
    }
    create.mutate(result.body, {
      onSuccess: (created) => {
        toast.success('Application added', { description: `${created.job.title} at ${created.job.company}` });
        close(false);
        onCreated(created);
      },
      onError: (err) => toast.error('Could not add the application', { description: errorMessage(err) }),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title="Add an application"
      description="For a job you found somewhere else. Only the title and company are needed; you can fill in the rest later."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={FORM_ID} loading={create.isPending}>
            Add application
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Job title" required error={errors.title} id="add-app-title">
          <Input value={values.title} onChange={(e) => set('title', e.target.value)} maxLength={200} autoFocus />
        </Field>
        <Field label="Company" required error={errors.company} id="add-app-company">
          <Input value={values.company} onChange={(e) => set('company', e.target.value)} maxLength={200} />
        </Field>
        <Field label="Link to the posting" optional error={errors.url} id="add-app-url" className="sm:col-span-2">
          <Input type="url" inputMode="url" value={values.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" maxLength={2000} />
        </Field>
        <Field label="Location" optional>
          <Input value={values.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Remote, Berlin" maxLength={200} />
        </Field>
        <Field label="Salary" optional>
          <Input value={values.salaryText} onChange={(e) => set('salaryText', e.target.value)} placeholder="e.g. $90k–$110k" maxLength={120} />
        </Field>
        <Field label="Status">
          <Select value={values.status} onChange={(e) => set('status', e.target.value as ManualApplicationValues['status'])} options={STATUS_OPTIONS} />
        </Field>
        <Field label="Job description" optional hint="Paste it so it is kept even if the posting is taken down." className="sm:col-span-2">
          <Textarea value={values.description} onChange={(e) => set('description', e.target.value)} rows={5} autoGrow maxRows={12} />
        </Field>
      </form>
    </Dialog>
  );
}
