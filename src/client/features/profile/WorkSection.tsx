import { useMemo } from 'react';
import type { Profile, WorkDetails } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Field, Input, SegmentedControl, Textarea, useToast } from '../../components/ui';
import { useSaveProfile } from './profile-api';
import { SectionCard } from './SectionCard';
import { useDraft, useReportDirty } from './use-draft';
import { parseOptionalNumber } from './validation';

type YesNo = 'yes' | 'no' | 'unset';
type WorkForm = Omit<WorkDetails, 'yearsExperience' | 'requiresSponsorship' | 'willingToRelocate'> & {
  years: string;
  sponsorship: YesNo;
  relocate: YesNo;
};

const YES_NO_OPTIONS: Array<{ value: YesNo; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unset', label: 'Not set' },
];

const toYesNo = (value: boolean | null): YesNo => (value === null ? 'unset' : value ? 'yes' : 'no');
const fromYesNo = (value: YesNo): boolean | null => (value === 'unset' ? null : value === 'yes');

function toForm({ yearsExperience, requiresSponsorship, willingToRelocate, ...rest }: WorkDetails): WorkForm {
  return {
    ...rest,
    years: yearsExperience === null ? '' : String(yearsExperience),
    sponsorship: toYesNo(requiresSponsorship),
    relocate: toYesNo(willingToRelocate),
  };
}

const SUMMARY_MAX = 5000;

export function WorkSection({ profile, onDirtyChange }: { profile: Profile; onDirtyChange: (dirty: boolean) => void }) {
  const saved = useMemo(() => toForm(profile.work), [profile.work]);
  const draft = useDraft<WorkForm>(saved);
  const save = useSaveProfile();
  const toast = useToast();
  const f = draft.value;
  const years = parseOptionalNumber(f.years, 0, 70);
  const set = <K extends keyof WorkForm>(key: K, value: WorkForm[K]) => draft.set((current) => ({ ...current, [key]: value }));

  useReportDirty(draft.dirty, onDirtyChange);

  const onSave = () => {
    if (years === undefined) {
      toast.error('Check the highlighted fields');
      return;
    }
    const { years: _years, sponsorship, relocate, ...rest } = f;
    const work: WorkDetails = { ...rest, yearsExperience: years, requiresSponsorship: fromYesNo(sponsorship), willingToRelocate: fromYesNo(relocate) };
    save.mutate(
      { work },
      {
        onSuccess: (result) => {
          draft.commit(toForm(result.work));
          toast.success('Work details saved', { id: 'profile-saved' });
        },
        onError: (err) => toast.error('Could not save your work details', { description: errorMessage(err) }),
      },
    );
  };

  return (
    <SectionCard
      id="work"
      title="Work"
      description="Your current role and the answers most application forms ask for."
      form={{ dirty: draft.dirty, saving: save.isPending, onSave, onDiscard: draft.reset }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Current or most recent title">
          <Input value={f.currentTitle} onChange={(e) => set('currentTitle', e.target.value)} autoComplete="organization-title" />
        </Field>
        <Field label="Company">
          <Input value={f.currentCompany} onChange={(e) => set('currentCompany', e.target.value)} autoComplete="organization" />
        </Field>
        <Field label="Years of experience" error={years === undefined ? 'Enter a number from 0 to 70' : undefined}>
          <Input inputMode="decimal" value={f.years} onChange={(e) => set('years', e.target.value)} placeholder="e.g. 6" />
        </Field>
        <Field label="Work authorisation" hint="e.g. US citizen, EU work permit, H-1B">
          <Input value={f.workAuthorization} onChange={(e) => set('workAuthorization', e.target.value)} />
        </Field>
        <Field label="Need visa sponsorship?">
          <SegmentedControl aria-label="Need visa sponsorship?" options={YES_NO_OPTIONS} value={f.sponsorship} onValueChange={(v) => set('sponsorship', v)} fullWidth />
        </Field>
        <Field label="Willing to relocate?">
          <SegmentedControl aria-label="Willing to relocate?" options={YES_NO_OPTIONS} value={f.relocate} onValueChange={(v) => set('relocate', v)} fullWidth />
        </Field>
        <Field label="Notice period" hint="e.g. 2 weeks">
          <Input value={f.noticePeriod} onChange={(e) => set('noticePeriod', e.target.value)} />
        </Field>
        <Field label="Earliest start" hint="e.g. Immediately, or March 2027">
          <Input value={f.earliestStart} onChange={(e) => set('earliestStart', e.target.value)} />
        </Field>
        <Field
          label="Professional summary"
          className="sm:col-span-2"
          hint={`Two or three sentences about what you do best. Reused in cover letters. ${f.summary.length} / ${SUMMARY_MAX}`}
          error={f.summary.length > SUMMARY_MAX ? `Keep it under ${SUMMARY_MAX} characters` : undefined}
        >
          <Textarea value={f.summary} onChange={(e) => set('summary', e.target.value)} autoGrow rows={4} maxRows={14} />
        </Field>
      </div>
    </SectionCard>
  );
}
