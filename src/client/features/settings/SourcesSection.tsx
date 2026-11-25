import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router';
import type { SourceTestResult } from '../../../shared/api';
import type { SourceInfo, SyncStatus } from '../../../shared/types';
import { api, errorMessage } from '../../api/client';
import { Badge, Button, ErrorState, Field, Input, Select, Skeleton, Switch, useToast, type Tone } from '../../components/ui';
import { formatNumber, formatRelativeTime, pluralize } from '../../lib/format';
import { SectionCard } from '../profile/SectionCard';
import { usePatchSource, useSources } from './settings-api';
import { ttlOptions } from './settings-model';

export function SourcesSection() {
  const sources = useSources();
  return (
    <SectionCard
      id="sources"
      title="Job sources"
      description="Where JScout gets jobs. Turn off the ones you do not want; their jobs leave your results after the next sync."
    >
      {sources.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading sources">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
      ) : sources.isError ? (
        <ErrorState compact title="Could not load the job sources" error={sources.error} onRetry={() => void sources.refetch()} retrying={sources.isFetching} />
      ) : sources.data.length === 0 ? (
        <p className="text-sm text-muted">No job sources are available.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sources.data.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

const STATUS: Record<SyncStatus, { label: string; tone: Tone }> = {
  idle: { label: 'Waiting', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'info' },
  running: { label: 'Syncing', tone: 'info' },
  ok: { label: 'Working', tone: 'success' },
  error: { label: 'Problem', tone: 'danger' },
  disabled: { label: 'Off', tone: 'neutral' },
};

function SourceCard({ source }: { source: SourceInfo }) {
  const patch = usePatchSource();
  const toast = useToast();
  const status = source.enabled ? STATUS[source.sync.status] : STATUS.disabled;
  const feeds = source.sync.feeds;

  const update = (change: Parameters<typeof patch.mutate>[0]['patch'], success: string) =>
    patch.mutate(
      { id: source.id, patch: change },
      {
        onSuccess: () => toast.success(success, { id: `source-${source.id}` }),
        onError: (err) => toast.error(`Could not update ${source.name}`, { description: errorMessage(err) }),
      },
    );

  return (
    <li className="flex flex-col gap-3 rounded-card border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-fg">{source.name}</h3>
            <Badge size="sm" tone={status.tone} dot>
              {status.label}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted">{source.description}</p>
        </div>
        <Switch
          checked={source.enabled}
          aria-label={`Use ${source.name}`}
          onCheckedChange={(enabled) => update({ enabled }, enabled ? `${source.name} is on` : `${source.name} is off`)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>{pluralize(source.jobCount, 'open job')}</span>
        {source.sync.lastSuccessAt ? <span>Updated {formatRelativeTime(source.sync.lastSuccessAt)}</span> : <span>Not synced yet</span>}
        {feeds ? (
          <span>
            {formatNumber(feeds.ok)} of {pluralize(feeds.total, 'company board')} OK
            {feeds.error > 0 ? `, ${formatNumber(feeds.error)} with problems` : ''}
          </span>
        ) : null}
        <a href={source.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
          Website <ExternalLink className="size-3.5" aria-hidden />
        </a>
        {source.perCompany ? (
          <Link to="/companies" className="text-primary underline-offset-2 hover:underline">
            Choose companies
          </Link>
        ) : null}
      </div>

      {source.enabled && source.sync.status === 'error' && source.sync.error ? (
        <p role="status" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          {source.sync.error}
        </p>
      ) : null}
      {source.attribution ? <p className="text-xs text-subtle">{source.attribution}</p> : null}

      {source.configFields.length > 0 ? <SourceConfig source={source} /> : null}

      <Field label="Check for new jobs" className="max-w-56">
        <Select
          size="sm"
          value={String(source.ttlMinutes)}
          onChange={(event) => update({ ttlMinutes: Number(event.target.value) }, `${source.name} updated`)}
          options={ttlOptions(source.ttlMinutes)}
        />
      </Field>
    </li>
  );
}

/** Keys and other settings a source needs. Secret values are never shown, only whether one is saved. */
function SourceConfig({ source }: { source: SourceInfo }) {
  const patch = usePatchSource();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SourceTestResult | null>(null);
  const test = useMutation({
    mutationFn: () => api('POST /api/sources/:id/test', { params: { id: source.id } }),
    onSuccess: setResult,
    onError: (err) => setResult({ ok: false, message: errorMessage(err) }),
  });
  const typed = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));
  const missingRequired = source.configFields.filter((f) => f.required && !source.configuredKeys.includes(f.key) && !typed[f.key]);

  const save = (config: Record<string, string | null>, success: string) =>
    patch.mutate(
      { id: source.id, patch: { config } },
      {
        onSuccess: () => {
          setValues({});
          setResult(null);
          toast.success(success);
        },
        onError: (err) => toast.error('Could not save', { description: errorMessage(err) }),
      },
    );

  return (
    <form
      className="flex flex-col gap-3 rounded-card bg-surface-2 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (Object.keys(typed).length > 0) save(typed, `${source.name} settings saved`);
      }}
    >
      {!source.configured ? <p className="text-sm text-fg">This source needs a free account key before it can be used.</p> : null}
      {source.configFields.map((field) => {
        const saved = source.configuredKeys.includes(field.key);
        return (
          <Field
            key={field.key}
            label={field.label}
            hint={field.help}
            optional={!field.required}
            labelAction={
              saved ? (
                <span className="flex items-center gap-2">
                  <Badge size="sm" tone="success">
                    Saved
                  </Badge>
                  <Button type="button" variant="link" size="sm" onClick={() => save({ [field.key]: null }, `${field.label} removed`)}>
                    Remove
                  </Button>
                </span>
              ) : undefined
            }
          >
            <Input
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              spellCheck={false}
              value={values[field.key] ?? ''}
              placeholder={saved ? (field.secret ? 'Saved. Type a new value to replace it.' : 'Saved') : ''}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
            />
          </Field>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="primary" loading={patch.isPending} disabled={Object.keys(typed).length === 0}>
          Save
        </Button>
        <Button type="button" size="sm" loading={test.isPending} disabled={missingRequired.length > 0 || Object.keys(typed).length > 0} onClick={() => test.mutate()}>
          Test
        </Button>
        {Object.keys(typed).length > 0 ? <span className="text-sm text-muted">Save before testing.</span> : null}
      </div>
      {result ? (
        <p role="status" className={result.ok ? 'text-sm text-success' : 'text-sm text-danger'}>
          {result.message}
          {result.ok && result.sample !== undefined ? ` (${pluralize(result.sample, 'job')} found)` : ''}
        </p>
      ) : null}
    </form>
  );
}
