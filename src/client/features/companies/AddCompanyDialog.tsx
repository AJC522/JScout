/** Find an employer's job board from a careers-page link or a name, then follow it. */
import { useState, type FormEvent } from 'react';
import { Building2, Search } from 'lucide-react';
import type { CompanyDetection } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Input, Spinner, useToast } from '../../components/ui';
import { pluralize } from '../../lib/format';
import { ATS_LABELS, isDetectable } from './model';
import { useAddCompany, useDetectCompany, useRequestSync } from './queries';

export function AddCompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [input, setInput] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  const detect = useDetectCompany();
  const add = useAddCompany();
  const sync = useRequestSync();
  const toast = useToast();

  // Start fresh every time the dialog opens.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setInput('');
      detect.reset();
      add.reset();
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isDetectable(input) && !detect.isPending) detect.mutate(input);
  };

  const onAdd = (detection: CompanyDetection) =>
    add.mutate(
      { ats: detection.ats, token: detection.token, name: detection.name },
      {
        onSuccess: (company) => {
          onOpenChange(false);
          toast.success(`Following ${company.name}`, { description: 'Fetching its jobs now. They will show up in search shortly.' });
          sync.mutate([company.ats], {
            onError: (error) => toast.error('Could not start fetching its jobs', { description: errorMessage(error) }),
          });
        },
        onError: (error) => toast.error(`Could not add ${detection.name}`, { description: errorMessage(error) }),
      },
    );

  const searched = detect.variables ?? '';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Add a company"
      description="Paste a link to the company's careers page, or type its name. JScout checks Greenhouse, Lever and Ashby."
    >
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <Field label="Careers page or company name" className="min-w-0 flex-1">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. https://acme.com/careers or Acme" autoFocus />
        </Field>
        <Button type="submit" variant="primary" leadingIcon={<Search />} loading={detect.isPending} disabled={!isDetectable(input)}>
          Find
        </Button>
      </form>

      <div className="mt-4 min-h-24" aria-live="polite">
        {detect.isPending ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted">
            <Spinner size="sm" label={null} />
            Looking for job boards… this can take a few seconds.
          </p>
        ) : detect.isError ? (
          <ErrorState compact title="Could not check that" error={detect.error} onRetry={() => detect.mutate(searched)} />
        ) : detect.data && detect.data.length === 0 ? (
          <EmptyState
            compact
            icon={<Building2 />}
            title={`No job board found for “${searched}”`}
            description="JScout can follow companies that use Greenhouse, Lever or Ashby. Try the link from the company's Careers or Jobs page, or the job board's own address (for example boards.greenhouse.io/acme)."
          />
        ) : detect.data ? (
          <ul className="divide-y divide-border rounded-card border border-border">
            {detect.data.map((d) => (
              <li key={`${d.ats}:${d.token}`} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-fg">{d.name}</span>
                    <Badge size="sm">{ATS_LABELS[d.ats]}</Badge>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {d.jobs > 0 ? pluralize(d.jobs, 'open job') : 'No open jobs right now'} · {d.token}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => onAdd(d)} loading={add.isPending && add.variables?.token === d.token} disabled={add.isPending}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}
