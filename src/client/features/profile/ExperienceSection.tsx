import { Briefcase, GraduationCap } from 'lucide-react';
import type { EducationEntry, ExperienceEntry, Profile } from '../../../shared/types';
import { Checkbox, Field, Input, Textarea } from '../../components/ui';
import { formatYearMonth } from '../../lib/format';
import { EntryList, type EntryFormProps } from './EntryList';
import { newId } from './profile-model';
import { DATE_ERROR, isYearMonth } from './validation';

const emptyJob = (): ExperienceEntry => ({
  id: newId(),
  title: '',
  company: '',
  location: '',
  start: '',
  end: '',
  current: false,
  summary: '',
  highlights: [],
});

const cleanHighlights = (job: ExperienceEntry): ExperienceEntry => ({
  ...job,
  highlights: job.highlights.map((h) => h.trim()).filter(Boolean),
});

const emptySchool = (): EducationEntry => ({ id: newId(), school: '', degree: '', field: '', start: '', end: '' });

function dates(start: string, end: string, current = false): string {
  const from = start ? formatYearMonth(start) : '';
  const to = current ? 'Present' : end ? formatYearMonth(end) : '';
  return [from, to].filter(Boolean).join(' – ');
}

function dateErrors(start: string, end: string, current: boolean) {
  const errors: { start?: string; end?: string } = {};
  if (!isYearMonth(start)) errors.start = DATE_ERROR;
  if (!current && !isYearMonth(end)) errors.end = DATE_ERROR;
  // "YYYY-MM" strings sort chronologically; when one side is only a year, compare just the years.
  const [a, b] = [start.trim(), end.trim()];
  const n = Math.min(a.length, b.length);
  if (!errors.start && !errors.end && !current && a && b && b.slice(0, n) < a.slice(0, n)) errors.end = 'The end is before the start';
  return errors;
}

function validateJob(job: ExperienceEntry): Partial<Record<keyof ExperienceEntry, string>> {
  const errors: Partial<Record<keyof ExperienceEntry, string>> = dateErrors(job.start, job.end, job.current);
  if (!job.title.trim() && !job.company.trim()) errors.title = 'Add a job title or a company';
  return errors;
}

function validateSchool(school: EducationEntry): Partial<Record<keyof EducationEntry, string>> {
  const errors: Partial<Record<keyof EducationEntry, string>> = dateErrors(school.start, school.end, false);
  if (!school.school.trim() && !school.degree.trim()) errors.school = 'Add a school or a qualification';
  return errors;
}

export function ExperienceSection({ profile }: { profile: Profile }) {
  return (
    <EntryList<ExperienceEntry>
      id="experience"
      title="Experience"
      description="Your jobs, most recent first. Used to fill applications and draft cover letters."
      items={profile.experience}
      toPatch={(experience) => ({ experience: experience.map(cleanHighlights) })}
      createEmpty={emptyJob}
      validate={validateJob}
      label={(job) => job.title || job.company || 'this job'}
      noun="job"
      max={60}
      empty={{
        icon: <Briefcase />,
        title: 'No jobs added yet',
        description: 'Add your recent roles, or upload a résumé above and add the jobs JScout finds.',
      }}
      renderSummary={(job) => (
        <>
          <p className="truncate text-sm font-medium text-fg">{[job.title, job.company].filter(Boolean).join(' · ')}</p>
          <p className="text-sm text-muted">
            {[dates(job.start, job.end, job.current), job.location].filter(Boolean).join(' · ') || 'No dates'}
          </p>
          {job.highlights.length > 0 ? (
            <p className="mt-0.5 text-sm text-subtle">
              {job.highlights.length === 1 ? '1 highlight' : `${job.highlights.length} highlights`}
            </p>
          ) : null}
        </>
      )}
      Form={JobForm}
    />
  );
}

export function EducationSection({ profile }: { profile: Profile }) {
  return (
    <EntryList<EducationEntry>
      id="education"
      title="Education"
      description="Degrees, diplomas and certificates."
      items={profile.education}
      toPatch={(education) => ({ education })}
      createEmpty={emptySchool}
      validate={validateSchool}
      label={(school) => school.school || school.degree || 'this school'}
      noun="school"
      max={30}
      empty={{ icon: <GraduationCap />, title: 'No education added yet', description: 'Add the schools and qualifications employers usually ask about.' }}
      renderSummary={(school) => (
        <>
          <p className="truncate text-sm font-medium text-fg">{[school.degree, school.field].filter(Boolean).join(', ') || school.school}</p>
          <p className="text-sm text-muted">
            {[school.degree || school.field ? school.school : '', dates(school.start, school.end)].filter(Boolean).join(' · ') || 'No dates'}
          </p>
        </>
      )}
      Form={SchoolForm}
    />
  );
}

function JobForm({ value, onChange, errors }: EntryFormProps<ExperienceEntry>) {
  const set = <K extends keyof ExperienceEntry>(key: K, next: ExperienceEntry[K]) => onChange({ ...value, [key]: next });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Job title" error={errors.title}>
        <Input value={value.title} onChange={(e) => set('title', e.target.value)} autoFocus />
      </Field>
      <Field label="Company">
        <Input value={value.company} onChange={(e) => set('company', e.target.value)} />
      </Field>
      <Field label="Location" optional className="sm:col-span-2">
        <Input value={value.location} onChange={(e) => set('location', e.target.value)} />
      </Field>
      <Field label="Started" hint="YYYY-MM" error={errors.start}>
        <Input value={value.start} onChange={(e) => set('start', e.target.value)} placeholder="2021-04" inputMode="numeric" />
      </Field>
      <Field label="Ended" hint={value.current ? undefined : 'YYYY-MM'} error={errors.end}>
        <Input
          value={value.current ? '' : value.end}
          onChange={(e) => set('end', e.target.value)}
          placeholder={value.current ? 'Present' : '2024-01'}
          disabled={value.current}
          inputMode="numeric"
        />
      </Field>
      <Checkbox
        className="sm:col-span-2"
        checked={value.current}
        onCheckedChange={(checked) => onChange({ ...value, current: checked === true, end: checked === true ? '' : value.end })}
        label="I work here now"
      />
      <Field label="What you did" optional className="sm:col-span-2">
        <Textarea value={value.summary} onChange={(e) => set('summary', e.target.value)} autoGrow rows={3} maxRows={10} />
      </Field>
      <Field label="Highlights" optional className="sm:col-span-2" hint="One per line: results you are proud of, with numbers where you can.">
        <Textarea
          value={value.highlights.join('\n')}
          onChange={(e) => set('highlights', e.target.value.split('\n'))}
          onBlur={() => set('highlights', value.highlights.map((h) => h.trim()).filter(Boolean))}
          autoGrow
          rows={3}
          maxRows={12}
        />
      </Field>
    </div>
  );
}

function SchoolForm({ value, onChange, errors }: EntryFormProps<EducationEntry>) {
  const set = <K extends keyof EducationEntry>(key: K, next: EducationEntry[K]) => onChange({ ...value, [key]: next });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="School" error={errors.school} className="sm:col-span-2">
        <Input value={value.school} onChange={(e) => set('school', e.target.value)} autoFocus />
      </Field>
      <Field label="Qualification" hint="e.g. BSc, MBA, Diploma">
        <Input value={value.degree} onChange={(e) => set('degree', e.target.value)} />
      </Field>
      <Field label="Field of study" optional>
        <Input value={value.field} onChange={(e) => set('field', e.target.value)} />
      </Field>
      <Field label="Started" hint="YYYY or YYYY-MM" error={errors.start}>
        <Input value={value.start} onChange={(e) => set('start', e.target.value)} placeholder="2014" inputMode="numeric" />
      </Field>
      <Field label="Finished" hint="YYYY or YYYY-MM" error={errors.end}>
        <Input value={value.end} onChange={(e) => set('end', e.target.value)} placeholder="2018" inputMode="numeric" />
      </Field>
    </div>
  );
}
