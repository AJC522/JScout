/** The "what you're looking for" controls, shared by onboarding and the profile page. */
import { useState, type ReactNode } from 'react';
import {
  EMPLOYMENT_LABELS,
  EMPLOYMENT_TYPES,
  RADIUS_OPTIONS_KM,
  REMOTE_LABELS,
  SENIORITY_LABELS,
  SENIORITY_ORDER,
} from '../../../shared/constants';
import type { EmploymentType, RemoteMode, SearchPreferences, Seniority } from '../../../shared/types';
import { Chip, Field, Input, Select, TagInput } from '../../components/ui';
import { suggest } from './profile-api';
import { CURRENCIES, MAX_SALARY, arrangementHint, formatSalaryInput, preferencesErrors, radiusLabel, toggle } from './preferences-model';
import { parseOptionalNumber } from './validation';

export type PreferencesValue = Pick<
  SearchPreferences,
  'targetTitles' | 'locations' | 'radiusKm' | 'remote' | 'salaryMin' | 'salaryCurrency' | 'employmentTypes' | 'seniority'
> &
  Partial<Pick<SearchPreferences, 'skills' | 'excludeCompanies' | 'excludeTerms'>>;

interface PreferencesFieldsProps<V extends PreferencesValue> {
  value: V;
  onChange: (next: V) => void;
  /** Also show skills and the exclusion lists (the profile page; onboarding keeps it short). */
  extended?: boolean;
}

const ARRANGEMENTS: RemoteMode[] = ['remote', 'hybrid', 'onsite'];
const JOB_TYPES = EMPLOYMENT_TYPES.filter((t): t is Exclude<EmploymentType, 'unknown'> => t !== 'unknown');

export function PreferencesFields<V extends PreferencesValue>({ value, onChange, extended = false }: PreferencesFieldsProps<V>) {
  const set = <K extends keyof PreferencesValue>(key: K, next: V[K]) => onChange({ ...value, [key]: next });
  // Limits are checked here rather than with TagInput's `max`, whose running counter would clutter every list.
  const errors = preferencesErrors(value);
  // The salary box keeps what was typed (e.g. "85,000") and stores it once it is a valid number.
  // A valid text that disagrees with the value means the value changed elsewhere (discard, reset).
  const [salaryText, setSalaryText] = useState(() => formatSalaryInput(value.salaryMin));
  const typedSalary = parseOptionalNumber(salaryText, 0, MAX_SALARY);
  if (typedSalary !== undefined && typedSalary !== value.salaryMin) setSalaryText(formatSalaryInput(value.salaryMin));
  const salaryValid = typedSalary !== undefined;

  const radiusOptions = [...new Set<number>([...RADIUS_OPTIONS_KM, value.radiusKm])]
    .sort((a, b) => a - b)
    .map((km) => ({ value: String(km), label: radiusLabel(km) }));
  const currencyOptions = [...new Set([...CURRENCIES, value.salaryCurrency])].map((c) => ({ value: c, label: c }));

  return (
    <div className="flex flex-col gap-5">
      <Field label="Job titles" hint="Add a few. JScout also finds jobs with similar titles." error={errors.targetTitles}>
        <TagInput
          value={value.targetTitles}
          onChange={(next) => set('targetTitles', next)}
          loadSuggestions={suggest.titles}
          placeholder="e.g. Product designer"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
        <Field label="Locations" hint="Cities, regions or countries you would work in." error={errors.locations}>
          <TagInput
            value={value.locations}
            onChange={(next) => set('locations', next)}
            loadSuggestions={suggest.locations}
            placeholder="e.g. Austin, TX"
          />
        </Field>
        <Field label="Distance">
          <Select
            value={String(value.radiusKm)}
            onChange={(event) => set('radiusKm', Number(event.target.value))}
            options={radiusOptions}
          />
        </Field>
      </div>

      <ChipGroup label="Work arrangement" hint={arrangementHint(value)}>
        {ARRANGEMENTS.map((mode) => (
          <Chip key={mode} selected={value.remote.includes(mode)} onSelectedChange={() => set('remote', toggle(value.remote, mode))}>
            {REMOTE_LABELS[mode]}
          </Chip>
        ))}
      </ChipGroup>

      <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
        <Field
          label="Minimum salary"
          optional
          hint={salaryValid ? 'Per year, before tax. Jobs that do not list pay are still shown.' : undefined}
          error={salaryValid ? undefined : 'Enter a yearly amount in numbers, like 85000'}
        >
          <Input
            inputMode="numeric"
            value={salaryText}
            placeholder="e.g. 85,000"
            onChange={(event) => {
              const text = event.target.value;
              setSalaryText(text);
              const parsed = parseOptionalNumber(text, 0, MAX_SALARY);
              if (parsed !== undefined) set('salaryMin', parsed);
            }}
            onBlur={() => {
              if (salaryValid) setSalaryText(formatSalaryInput(value.salaryMin));
            }}
          />
        </Field>
        <Field label="Currency">
          <Select value={value.salaryCurrency} onChange={(event) => set('salaryCurrency', event.target.value)} options={currencyOptions} />
        </Field>
      </div>

      <ChipGroup label="Job type" hint="Pick none to see every kind.">
        {JOB_TYPES.map((type) => (
          <Chip
            key={type}
            selected={value.employmentTypes.includes(type)}
            onSelectedChange={() => set('employmentTypes', toggle(value.employmentTypes, type))}
          >
            {EMPLOYMENT_LABELS[type]}
          </Chip>
        ))}
      </ChipGroup>

      <ChipGroup label="Seniority" hint="Pick the levels you would consider.">
        {SENIORITY_ORDER.map((level: Seniority) => (
          <Chip key={level} selected={value.seniority.includes(level)} onSelectedChange={() => set('seniority', toggle(value.seniority, level))}>
            {SENIORITY_LABELS[level]}
          </Chip>
        ))}
      </ChipGroup>

      {extended ? (
        <>
          <Field label="Skills" hint="Jobs that ask for these rank higher." error={errors.skills}>
            <TagInput
              value={value.skills ?? []}
              onChange={(next) => set('skills', next)}
              loadSuggestions={suggest.skills}
              placeholder="e.g. Figma"
            />
          </Field>
          <Field label="Companies to leave out" optional hint="Their jobs never show up in your results." error={errors.excludeCompanies}>
            <TagInput
              value={value.excludeCompanies ?? []}
              onChange={(next) => set('excludeCompanies', next)}
              loadSuggestions={suggest.companies}
              placeholder="Company name"
            />
          </Field>
          <Field label="Words to leave out" optional hint="Hide jobs whose title or description has any of these." error={errors.excludeTerms}>
            <TagInput value={value.excludeTerms ?? []} onChange={(next) => set('excludeTerms', next)} placeholder="e.g. unpaid" />
          </Field>
        </>
      ) : null}
    </div>
  );
}

/** A labelled row of toggle chips, announced as a group. */
function ChipGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-fg">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </fieldset>
  );
}
