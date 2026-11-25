import { useMemo } from 'react';
import { CLEARANCE_LEVEL_LABELS, CLEARANCE_LEVELS } from '../../../shared/constants';
import type { ClearanceLevel, HeldClearance, PolygraphKind, Profile, WorkDetails } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Field, Input, SegmentedControl, Select, Textarea, useToast } from '../../components/ui';
import { useSaveProfile } from './profile-api';
import { SectionCard } from './SectionCard';
import { useDraft, useReportDirty } from './use-draft';
import { parseOptionalNumber } from './validation';

type YesNo = 'yes' | 'no' | 'unset';
type WorkForm = Omit<WorkDetails, 'yearsExperience' | 'requiresSponsorship' | 'willingToRelocate' | 'clearance'> & {
  years: string;
  sponsorship: YesNo;
  relocate: YesNo;
  /** '' = none. */
  clearanceLevel: ClearanceLevel | '';
  clearanceStatus: HeldClearance['status'];
  /** '' = none. */
  polygraph: PolygraphKind | '';
};

// Highest first: most people pick from the top.
const CLEARANCE_OPTIONS = CLEARANCE_LEVELS.toReversed().map((level) => ({ value: level, label: CLEARANCE_LEVEL_LABELS[level] }));
const POLYGRAPH_OPTIONS: Array<{ value: PolygraphKind; label: string }> = [
  { value: 'ci', label: 'Counterintelligence (CI)' },
  { value: 'full-scope', label: 'Full-scope / lifestyle' },
  { value: 'polygraph', label: 'Other polygraph' },
];
const STATUS_OPTIONS: Array<{ value: HeldClearance['status']; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

function toClearance(f: WorkForm): HeldClearance | null {
  if (!f.clearanceLevel) return null;
  return { level: f.clearanceLevel, status: f.clearanceStatus, ...(f.polygraph ? { polygraph: f.polygraph } : {}) };
}

const YES_NO_OPTIONS: Array<{ value: YesNo; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unset', label: 'Not set' },
];

const toYesNo = (value: boolean | null): YesNo => (value === null ? 'unset' : value ? 'yes' : 'no');
const fromYesNo = (value: YesNo): boolean | null => (value === 'unset' ? null : value === 'yes');

function toForm({ yearsExperience, requiresSponsorship, willingToRelocate, clearance, ...rest }: WorkDetails): WorkForm {
  return {
    ...rest,
    years: yearsExperience === null ? '' : String(yearsExperience),
    sponsorship: toYesNo(requiresSponsorship),
    relocate: toYesNo(willingToRelocate),
    clearanceLevel: clearance?.level ?? '',
    clearanceStatus: clearance?.status ?? 'active',
    polygraph: clearance?.polygraph ?? '',
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
    const { years: _years, sponsorship, relocate, clearanceLevel: _level, clearanceStatus: _status, polygraph: _poly, ...rest } = f;
    const work: WorkDetails = {
      ...rest,
      yearsExperience: years,
      requiresSponsorship: fromYesNo(sponsorship),
      willingToRelocate: fromYesNo(relocate),
      clearance: toClearance(f),
    };
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
        <Field label="Security clearance" hint="Jobs that ask for one are flagged against it.">
          <Select
            aria-label="Security clearance"
            placeholder="None"
            options={CLEARANCE_OPTIONS}
            value={f.clearanceLevel}
            onChange={(e) => set('clearanceLevel', e.target.value as WorkForm['clearanceLevel'])}
          />
        </Field>
        {f.clearanceLevel ? (
          <>
            <Field label="Clearance status" hint="Inactive: held before, now lapsed (often reinstatable within 2 years).">
              <SegmentedControl aria-label="Clearance status" options={STATUS_OPTIONS} value={f.clearanceStatus} onValueChange={(v) => set('clearanceStatus', v)} fullWidth />
            </Field>
            <Field label="Polygraph">
              <Select
                aria-label="Polygraph"
                placeholder="None"
                options={POLYGRAPH_OPTIONS}
                value={f.polygraph}
                onChange={(e) => set('polygraph', e.target.value as WorkForm['polygraph'])}
              />
            </Field>
          </>
        ) : null}
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
