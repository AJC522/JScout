import { useState } from 'react';
import { Archive, Copy, Ellipsis, ExternalLink, Pencil, SlidersHorizontal, Trash } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  Drawer,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  Kbd,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  RichText,
  ScoreRing,
  Select,
  Textarea,
  Tooltip,
  useConfirm,
  useToast,
} from '../../components/ui';
import { Demo, KitSection } from './KitSection';
import { SAMPLE_JOB_HTML } from './sample';

export function OverlaysSection() {
  const toast = useToast();
  const confirm = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [name, setName] = useState('Remote frontend roles');
  const [showClosed, setShowClosed] = useState(false);
  const [lastAction, setLastAction] = useState('');

  return (
    <KitSection id="overlays" title="Overlays" description="Radix primitives underneath: focus is managed, Escape closes, and everything works from the keyboard.">
      <Demo label="Dialog">
        <Button variant="primary" onClick={() => setDialogOpen(true)}>
          Save search…
        </Button>
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Save this search"
          description="You will see new matching postings on the Saved searches page."
          footer={
            <>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button
                variant="primary"
                onClick={() => {
                  setDialogOpen(false);
                  toast.success('Search saved', { description: name });
                }}
              >
                Save search
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Name" required>
              <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
            </Field>
            <Field label="Check for new results">
              <Select defaultValue="daily" options={[{ value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' }, { value: 'never', label: 'Only when I open it' }]} />
            </Field>
            <Field label="Notes" optional>
              <Textarea rows={2} placeholder="Why this search matters" />
            </Field>
          </div>
        </Dialog>
        <Button
          variant="danger"
          onClick={async () => {
            const ok = await confirm({
              title: 'Delete this application?',
              description: 'Its notes, documents and timeline are removed from this computer. This cannot be undone.',
              confirmLabel: 'Delete application',
              tone: 'danger',
            });
            if (ok) toast.success('Application deleted', { action: { label: 'Undo', onClick: () => toast.info('Restored') } });
            else setLastAction('Delete cancelled');
          }}
        >
          Delete with confirm…
        </Button>
        {lastAction ? <span className="text-sm text-subtle">{lastAction}</span> : null}
      </Demo>

      <Demo label="Drawer">
        <Button onClick={() => setDrawerOpen(true)}>Open job details</Button>
        <Drawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          size="lg"
          title="Senior Frontend Engineer"
          description="Northwind Labs · Remote (Europe) · posted 3d ago"
          headerActions={<IconButton label="Open in new tab" icon={<ExternalLink />} size="sm" />}
          footer={
            <>
              <Button onClick={() => setDrawerOpen(false)}>Close</Button>
              <Button variant="primary">Apply on company site</Button>
            </>
          }
        >
          <div className="mb-5 flex items-center gap-3 rounded-card border border-border bg-surface-2/60 p-3">
            <ScoreRing value={86} />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-fg">Strong match</p>
              <p className="text-muted">Title matches; 8 of 11 keywords from your profile appear.</p>
            </div>
            <Badge tone="accent" variant="solid" className="ml-auto">
              New
            </Badge>
          </div>
          <RichText html={SAMPLE_JOB_HTML} />
        </Drawer>
      </Demo>

      <Demo label="Menu & popover">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Application actions" icon={<Ellipsis />} variant="secondary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Application</DropdownMenuLabel>
            <DropdownMenuItem icon={<Pencil />} shortcut={<Kbd combo="e" />} onSelect={() => setLastAction('Edit')}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy />} onSelect={() => setLastAction('Duplicate')}>
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={<Archive />}>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {['Applied', 'Interviewing', 'Offer', 'Rejected'].map((status) => (
                  <DropdownMenuItem key={status} onSelect={() => setLastAction(`Moved to ${status}`)}>
                    {status}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuCheckboxItem checked={showClosed} onCheckedChange={(value) => setShowClosed(value === true)}>
              Show closed postings
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="danger" icon={<Trash />} onSelect={() => setLastAction('Delete')}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <PopoverTrigger asChild>
            <Button leadingIcon={<SlidersHorizontal />}>Salary filter</Button>
          </PopoverTrigger>
          <PopoverContent className="flex flex-col gap-3">
            <Field label="Minimum yearly salary">
              <Input type="number" placeholder="100000" trailing="USD" />
            </Field>
            <Checkbox label="Include postings without a salary" defaultChecked />
            <div className="flex justify-end gap-2">
              <PopoverClose asChild>
                <Button size="sm" variant="primary">
                  Apply
                </Button>
              </PopoverClose>
            </div>
          </PopoverContent>
        </Popover>
        <Tooltip content="Tooltips show on hover and keyboard focus" shortcut={<Kbd combo="?" />}>
          <Button variant="ghost">Hover or focus me</Button>
        </Tooltip>
      </Demo>

      <Demo label="Toasts">
        <Button onClick={() => toast.success('Saved to tracker', { action: { label: 'Open tracker', onClick: () => setLastAction('Open tracker') } })}>Success</Button>
        <Button onClick={() => toast.error('Sync failed for Greenhouse: Acme', { description: 'The board returned 404. It may have moved.' })}>Error</Button>
        <Button onClick={() => toast.info('3 sources are syncing in the background')}>Info</Button>
        <Button variant="ghost" onClick={() => toast.dismiss()}>
          Dismiss all
        </Button>
      </Demo>
    </KitSection>
  );
}
