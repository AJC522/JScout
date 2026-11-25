import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, HardDrive, Upload } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { DataExport } from '../../../shared/api';
import { api, errorMessage } from '../../api/client';
import { Button, Dialog, Field, Input, useConfirm, useToast } from '../../components/ui';
import { formatDate, pluralize } from '../../lib/format';
import { SectionCard } from '../profile/SectionCard';
import { STEP_STORAGE_KEY } from '../onboarding/steps';
import { backupFileName, matchesResetPhrase, readBackup, RESET_PHRASE, type BackupSummary } from './settings-model';

function download(data: unknown, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function describe(summary: BackupSummary): string {
  const parts = [
    pluralize(summary.savedSearches, 'saved search', 'saved searches'),
    pluralize(summary.applications, 'application'),
    pluralize(summary.userCompanies, 'added company', 'added companies'),
  ];
  return `${parts.join(', ')} and your profile`;
}

export function DataSection() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const exportData = useMutation({
    mutationFn: () => api('GET /api/data/export'),
    onSuccess: (data) => {
      download(data, backupFileName(new Date()));
      toast.success('Backup downloaded', { description: 'Keep it somewhere safe. It contains your profile and applications.' });
    },
    onError: (err) => toast.error('Could not export your data', { description: errorMessage(err) }),
  });

  const importData = useMutation({
    mutationFn: (backup: DataExport) => api('POST /api/data/import', { body: backup }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      toast.success('Backup imported', {
        description: `${result.profile ? 'Profile restored. ' : ''}Added ${pluralize(result.savedSearches, 'saved search', 'saved searches')}, ${pluralize(result.applications, 'application')} and ${pluralize(result.userCompanies, 'company', 'companies')}.`,
      });
    },
    onError: (err) => toast.error('Could not import that backup', { description: errorMessage(err) }),
  });

  const resetIndex = useMutation({
    mutationFn: () => api('POST /api/data/reset', { body: { scope: 'index' } }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success('Job index cleared', { description: 'Use Sync now to download jobs again.' });
    },
    onError: (err) => toast.error('Could not clear the job index', { description: errorMessage(err) }),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = readBackup(await file.text());
    if (!parsed.ok) {
      toast.error('That file cannot be imported', { description: parsed.error });
      return;
    }
    const { summary } = parsed;
    const ok = await confirm({
      title: 'Import this backup?',
      description: `${summary.exportedAt ? `Made on ${formatDate(summary.exportedAt, 'long')}. ` : ''}It has ${describe(summary)}. Your current profile is replaced by the one in the backup; the rest is added to what you have.`,
      confirmLabel: 'Import backup',
    });
    if (ok) importData.mutate(parsed.backup);
  };

  const onResetIndex = async () => {
    const ok = await confirm({
      title: 'Clear the job index?',
      description: 'All downloaded jobs are removed and downloaded again on the next sync. Your profile, saved searches and applications stay.',
      confirmLabel: 'Clear job index',
      tone: 'danger',
    });
    if (ok) resetIndex.mutate();
  };

  return (
    <SectionCard id="data" title="Your data" description="Everything JScout knows about you lives on this computer.">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 text-sm text-muted">
          <HardDrive className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
          <p>
            Your profile, résumé, applications and the job index are stored in JScout’s data folder next to the app. Nothing is uploaded anywhere.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">Backup</h3>
          <p className="text-sm text-muted">Download everything you entered as one file, to keep or to move JScout to another computer.</p>
          <div className="flex flex-wrap gap-2">
            <Button leadingIcon={<Download />} loading={exportData.isPending} onClick={() => exportData.mutate()}>
              Export data
            </Button>
            <Button leadingIcon={<Upload />} loading={importData.isPending} onClick={() => fileRef.current?.click()}>
              Import a backup
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose a backup file"
              onChange={(event) => {
                void onFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-5">
          <h3 className="text-sm font-semibold text-fg">Start over</h3>
          <div className="flex flex-wrap gap-2">
            <Button loading={resetIndex.isPending} onClick={() => void onResetIndex()}>
              Clear job index
            </Button>
            <Button variant="danger" onClick={() => setResetOpen(true)}>
              Delete everything
            </Button>
          </div>
          <p className="text-sm text-muted">Clearing the index keeps your own data. Deleting everything also removes your profile, résumé, saved searches and applications.</p>
        </div>
      </div>

      {resetOpen ? (
        <ResetEverythingDialog
          onClose={() => setResetOpen(false)}
          onDone={() => {
            queryClient.clear();
            try {
              window.localStorage.removeItem(STEP_STORAGE_KEY);
            } catch {
              // Storage unavailable: the step simply starts from the beginning anyway.
            }
            toast.success('Everything was deleted');
            navigate('/welcome');
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function ResetEverythingDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState('');
  const reset = useMutation({
    mutationFn: () => api('POST /api/data/reset', { body: { scope: 'everything' } }),
    onSuccess: onDone,
  });
  const ready = matchesResetPhrase(typed);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !reset.isPending) onClose();
      }}
      title="Delete everything?"
      description="Your profile, résumé, saved searches, applications, added companies and the job index are permanently deleted. Export a backup first if you might want them back."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!ready} loading={reset.isPending} onClick={() => reset.mutate()}>
            Delete everything
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) reset.mutate();
        }}
      >
        <Field
          label={
            <>
              Type <span className="font-mono">{RESET_PHRASE}</span> to confirm
            </>
          }
          error={reset.isError ? errorMessage(reset.error) : undefined}
        >
          <Input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}
