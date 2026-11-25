/** Status, key dates and priority for one application. */
import type { ApplicationDetail, ApplicationStatus } from '../../../../shared/types';
import { Field, Input, SegmentedControl, Select } from '../../../components/ui';
import { pluralize } from '../../../lib/format';
import { daysSince, fromDateInput, toDateInput } from '../board';
import { usePatchApplication } from '../queries';
import { PRIORITIES, PRIORITY_LABELS, STATUS_OPTIONS, isPriority } from '../status';
import { Section } from './Section';

const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: String(p), label: PRIORITY_LABELS[p] }));

export function StatusSection({ app, now }: { app: ApplicationDetail; now: number }) {
  const patch = usePatchApplication(app.id);

  const setDate = (field: 'appliedAt' | 'followUpAt', value: string) => {
    const iso = fromDateInput(value);
    // An incomplete date while typing is ignored; clearing the field removes the date.
    if (value && !iso) return;
    if (toDateInput(app[field]) === value) return;
    patch.mutate({ [field]: iso });
  };

  const days = daysSince(app.statusChangedAt, now);
  return (
    <Section title="Progress" meta={days === 0 ? 'Status changed today' : `${pluralize(days, 'day')} in this status`}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Status" className="sm:col-span-2">
          <Select
            value={app.status}
            options={STATUS_OPTIONS}
            onChange={(e) => patch.mutate({ status: e.target.value as ApplicationStatus })}
          />
        </Field>
        <Field label="Priority" className="sm:col-span-2">
          <SegmentedControl
            aria-label="Priority"
            options={PRIORITY_OPTIONS}
            value={String(app.priority)}
            onValueChange={(v) => {
              const n = Number(v);
              if (isPriority(n)) patch.mutate({ priority: n });
            }}
            fullWidth
          />
        </Field>
        <Field label="Applied on" optional>
          <Input type="date" value={toDateInput(app.appliedAt)} onChange={(e) => setDate('appliedAt', e.target.value)} />
        </Field>
        <Field label="Follow up on" optional hint={app.followUpAt ? undefined : 'Set a date and JScout will remind you.'}>
          <Input type="date" value={toDateInput(app.followUpAt)} onChange={(e) => setDate('followUpAt', e.target.value)} />
        </Field>
      </div>
    </Section>
  );
}
