/** What JScout found in a résumé, offered as suggestions the user edits and confirms. */
import { useState, type ReactNode } from 'react';
import { AlertTriangle, ClipboardPaste } from 'lucide-react';
import type { ProfilePatch } from '../../../shared/api';
import type { Profile, ResumeAnalysis } from '../../../shared/types';
import { Button, Checkbox, Chip, Field, Input, TagInput } from '../../components/ui';
import { formatYearMonth, pluralize } from '../../lib/format';
import { suggest } from './profile-api';
import { isEmptyPatch } from './profile-model';
import {
  CONTACT_FIELDS,
  CONTACT_LABELS,
  buildResumePatch,
  initialSelection,
  newEducation,
  newExperience,
  suggestsPaste,
  type ResumeSelection,
} from './resume-apply';
import { toggle } from './preferences-model';

interface ResumeSuggestionsProps {
  analysis: ResumeAnalysis;
  profile: Profile;
  onApply: (patch: ProfilePatch) => void;
  applying: boolean;
  applyLabel?: string;
  /** Offered when the text could not be read (e.g. a scanned PDF). */
  onPasteInstead?: () => void;
  /** Extra buttons next to the apply button (e.g. "Skip"). */
  secondaryAction?: ReactNode;
}

const PREVIEW_ENTRIES = 4;

export function ResumeSuggestions({
  analysis,
  profile,
  onApply,
  applying,
  applyLabel = 'Use these',
  onPasteInstead,
  secondaryAction,
}: ResumeSuggestionsProps) {
  const [selection, setSelection] = useState<ResumeSelection>(() => initialSelection(analysis, profile));
  const update = (changes: Partial<ResumeSelection>) => setSelection((current) => ({ ...current, ...changes }));
  const patch = buildResumePatch(selection, analysis, profile);
  const jobs = newExperience(profile.experience, analysis.experience);
  const schools = newEducation(profile.education, analysis.education);
  const contactFields = CONTACT_FIELDS.filter((field) => analysis.contact[field]);
  const foundNothing =
    contactFields.length === 0 && analysis.skills.length === 0 && analysis.suggestedTitles.length === 0 && jobs.length === 0 && schools.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {analysis.warnings.length > 0 ? (
        <div role="status" className="flex gap-3 rounded-card bg-warning-soft p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-1 text-fg">
              {analysis.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            {onPasteInstead && suggestsPaste(analysis) ? (
              <Button size="sm" variant="secondary" leadingIcon={<ClipboardPaste />} onClick={onPasteInstead} className="w-fit">
                Paste the text instead
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {foundNothing ? (
        <p className="text-sm text-muted">
          JScout could not find anything new to add from this résumé. You can fill in your details by hand, or paste the text if the file did not read well.
        </p>
      ) : null}

      {contactFields.length > 0 ? (
        <Group title="Contact details" hint="Check these and correct anything that was read wrong.">
          <div className="grid gap-4 sm:grid-cols-2">
            {contactFields.map((field) => (
              <Field key={field} label={CONTACT_LABELS[field]}>
                <Input
                  value={selection.contact[field] ?? ''}
                  onChange={(event) => update({ contact: { ...selection.contact, [field]: event.target.value } })}
                />
              </Field>
            ))}
          </div>
        </Group>
      ) : null}

      {analysis.skills.length > 0 ? (
        <Group title="Skills" hint="Remove any that do not fit, or add ones that are missing.">
          <TagInput
            aria-label="Skills from your résumé"
            value={selection.skills}
            onChange={(skills) => update({ skills })}
            loadSuggestions={suggest.skills}
            placeholder="Add a skill"
          />
        </Group>
      ) : null}

      {analysis.suggestedTitles.length > 0 ? (
        <Group title="Job titles to look for" hint="Pick the ones you want JScout to search for.">
          <div className="flex flex-wrap gap-2">
            {analysis.suggestedTitles.map((title) => (
              <Chip key={title} selected={selection.titles.includes(title)} onSelectedChange={() => update({ titles: toggle(selection.titles, title) })}>
                {title}
              </Chip>
            ))}
          </div>
        </Group>
      ) : null}

      {jobs.length > 0 || schools.length > 0 || analysis.yearsExperience !== null ? (
        <Group title="Experience and education">
          <div className="flex flex-col gap-4">
            {jobs.length > 0 ? (
              <EntryPreview
                label={`Add ${pluralize(jobs.length, 'job')} to your experience`}
                checked={selection.addExperience}
                onCheckedChange={(addExperience) => update({ addExperience })}
                lines={jobs.map((e) => ({
                  key: `${e.title}|${e.company}|${e.start}`,
                  main: [e.title, e.company].filter(Boolean).join(' · '),
                  dates: dateRange(e.start, e.current ? '' : e.end, e.current),
                }))}
              />
            ) : null}
            {schools.length > 0 ? (
              <EntryPreview
                label={`Add ${pluralize(schools.length, 'school')} to your education`}
                checked={selection.addEducation}
                onCheckedChange={(addEducation) => update({ addEducation })}
                lines={schools.map((e) => ({
                  key: `${e.school}|${e.degree}`,
                  main: [e.degree, e.field, e.school].filter(Boolean).join(' · '),
                  dates: dateRange(e.start, e.end, false),
                }))}
              />
            ) : null}
            {analysis.yearsExperience !== null ? (
              <Field label="Years of experience" className="max-w-48">
                <Input inputMode="decimal" value={selection.years} onChange={(event) => update({ years: event.target.value })} />
              </Field>
            ) : null}
          </div>
        </Group>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={applying} disabled={isEmptyPatch(patch)} onClick={() => onApply(patch)}>
          {applyLabel}
        </Button>
        {secondaryAction}
        {isEmptyPatch(patch) && !foundNothing ? <span className="text-sm text-muted">Your profile already has all of this.</span> : null}
      </div>
    </div>
  );
}

function dateRange(start: string, end: string, current: boolean): string {
  const from = start ? formatYearMonth(start) : '';
  const to = current ? 'now' : end ? formatYearMonth(end) : '';
  return from && to ? `${from} – ${to}` : from || to;
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

interface EntryPreviewProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  lines: Array<{ key: string; main: string; dates: string }>;
}

function EntryPreview({ label, checked, onCheckedChange, lines }: EntryPreviewProps) {
  const shown = lines.slice(0, PREVIEW_ENTRIES);
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border p-3">
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} label={label} />
      <ul className="flex flex-col gap-1 pl-7 text-sm">
        {shown.map((line) => (
          <li key={line.key} className="flex flex-wrap justify-between gap-x-3">
            <span className="min-w-0 text-fg">{line.main || 'Untitled'}</span>
            {line.dates ? <span className="text-muted tabular-nums">{line.dates}</span> : null}
          </li>
        ))}
        {lines.length > shown.length ? <li className="text-muted">and {lines.length - shown.length} more</li> : null}
      </ul>
    </div>
  );
}
