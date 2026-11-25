import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Monitor, Moon, RefreshCw, Sun } from 'lucide-react';
import type { AppSettings, AppSettingsUpdate, ThemePreference } from '../../../shared/types';
import { api, errorMessage } from '../../api/client';
import { useSyncState } from '../../app/events';
import { useTheme } from '../../app/theme';
import { Button, Field, SegmentedControl, Select, Switch, useToast } from '../../components/ui';
import { formatNumber, formatRelativeTime, pluralize } from '../../lib/format';
import { SectionCard } from '../profile/SectionCard';
import { useUpdateSettings } from './settings-api';
import { dayOptions } from './settings-model';

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: <Monitor /> },
  { value: 'light', label: 'Light', icon: <Sun /> },
  { value: 'dark', label: 'Dark', icon: <Moon /> },
] satisfies Array<{ value: ThemePreference; label: string; icon: ReactNode }>;

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  return (
    <SectionCard id="appearance" title="Appearance" description="System follows your computer’s light or dark setting.">
      <Field label="Theme" hideLabel>
        <SegmentedControl<ThemePreference> aria-label="Theme" options={THEME_OPTIONS} value={theme} onValueChange={setTheme} className="self-start" />
      </Field>
    </SectionCard>
  );
}

/** Save one setting at once (settings apply immediately; the control itself shows the new state). */
export function useSaveSetting() {
  const update = useUpdateSettings();
  const toast = useToast();
  return {
    pending: update.isPending,
    save: (change: AppSettingsUpdate, success = 'Settings saved') =>
      update.mutate(change, {
        onSuccess: () => toast.success(success, { id: 'settings-saved' }),
        onError: (err) => toast.error('Could not save that setting', { description: errorMessage(err) }),
      }),
  };
}

export function SyncSection({ settings }: { settings: AppSettings }) {
  const { save } = useSaveSetting();
  const { syncing, pendingFeeds, index } = useSyncState();
  const toast = useToast();
  const sync = useMutation({
    mutationFn: () => api('POST /api/sync', { body: { force: true } }),
    onSuccess: ({ queued }) =>
      queued > 0
        ? toast.success('Sync started', { description: `Checking ${pluralize(queued, 'feed')} for new jobs.` })
        : toast.info('Nothing to sync', { description: 'Turn on a source or follow some companies first.' }),
    onError: (err) => toast.error('Could not start a sync', { description: errorMessage(err) }),
  });

  return (
    <SectionCard id="syncing" title="Syncing" description="JScout keeps a copy of open jobs on this computer, so searches are instant.">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-2 p-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <Stat label="Open jobs" value={index ? formatNumber(index.openJobs) : '–'} />
            <Stat label="Sources" value={index ? formatNumber(index.sources) : '–'} />
            <Stat label="Companies" value={index ? formatNumber(index.companies) : '–'} />
            <Stat
              label="Last sync"
              value={syncing ? `Syncing (${pluralize(pendingFeeds, 'feed')} left)` : index?.lastSyncAt ? formatRelativeTime(index.lastSyncAt) : 'Never'}
            />
          </dl>
          <Button leadingIcon={<RefreshCw />} loading={sync.isPending} disabled={syncing} onClick={() => sync.mutate()}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>

        <Switch
          checked={settings.autoSync}
          onCheckedChange={(autoSync) => save({ autoSync }, autoSync ? 'Automatic syncing is on' : 'Automatic syncing is off')}
          label="Sync automatically"
          description="Refresh sources in the background while JScout is open."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Remove closed jobs after" hint="Jobs that are no longer posted, unless you saved them.">
            <Select
              value={String(settings.closedRetentionDays)}
              onChange={(event) => save({ closedRetentionDays: Number(event.target.value) })}
              options={dayOptions([0, 7, 14, 30, 60, 90, 180, 365], settings.closedRetentionDays, 'Right away')}
            />
          </Field>
          <Field label="Hide jobs posted more than" hint="Older postings are often filled already.">
            <Select
              value={String(settings.maxPostingAgeDays)}
              onChange={(event) => save({ maxPostingAgeDays: Number(event.target.value) })}
              options={dayOptions([0, 14, 30, 60, 90, 180, 365], settings.maxPostingAgeDays, 'Never hide')}
            />
          </Field>
        </div>
      </div>
    </SectionCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-fg tabular-nums">{value}</dd>
    </div>
  );
}
