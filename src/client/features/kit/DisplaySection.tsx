import { useState } from 'react';
import { Bookmark, Building, CalendarClock, Inbox, MapPin, Sparkles, TrendingUp } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Chip,
  CopyButton,
  EmptyState,
  ErrorState,
  Kbd,
  PageHeader,
  ProgressBar,
  RichText,
  ScoreRing,
  Separator,
  Skeleton,
  SkeletonText,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type Tone,
} from '../../components/ui';
import { formatRelativeTime, formatSalary, pluralize } from '../../lib/format';
import { Demo, KitSection } from './KitSection';
import { SAMPLE_JOB_HTML } from './sample';

const TONES: Tone[] = ['neutral', 'primary', 'accent', 'success', 'warning', 'danger', 'info'];

export function DisplaySection() {
  const [remoteOnly, setRemoteOnly] = useState(true);
  const [keywords, setKeywords] = useState(['React', 'TypeScript', 'Design systems']);
  const [retrying, setRetrying] = useState(false);
  const postedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();

  return (
    <>
      <KitSection id="badges" title="Badges & chips" description="Badges label things; chips are interactive (filters, keywords). Amber is reserved for “new”.">
        <Demo label="Soft (default)">
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </Demo>
        <Demo label="Solid & outline">
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone} variant="solid">
              {tone}
            </Badge>
          ))}
          {TONES.slice(0, 4).map((tone) => (
            <Badge key={`o-${tone}`} tone={tone} variant="outline">
              {tone}
            </Badge>
          ))}
        </Demo>
        <Demo label="In context">
          <Badge tone="accent" variant="solid">
            New
          </Badge>
          <Badge tone="success" dot>
            Synced
          </Badge>
          <Badge tone="danger" dot>
            Sync failed
          </Badge>
          <Badge tone="info" icon={<MapPin />}>
            Remote · EU
          </Badge>
          <Badge size="sm" tone="primary">
            12
          </Badge>
          <Badge size="sm">Closed</Badge>
        </Demo>
        <Demo label="Chips">
          <Chip selected={remoteOnly} onSelectedChange={setRemoteOnly}>
            Remote only
          </Chip>
          <Chip selected={false} onSelectedChange={() => undefined} count="1.2k">
            Full-time
          </Chip>
          <Chip selected onSelectedChange={() => undefined} count={84}>
            Senior
          </Chip>
          {keywords.map((keyword) => (
            <Chip key={keyword} onRemove={() => setKeywords((current) => current.filter((k) => k !== keyword))}>
              {keyword}
            </Chip>
          ))}
          <Chip tone="accent" icon={<Sparkles />} size="sm">
            + “UI engineer”
          </Chip>
          <Chip tone="primary" size="sm">
            Synonym
          </Chip>
        </Demo>
      </KitSection>

      <KitSection id="cards" title="Cards & tabs">
        <Demo label="Cards" stack>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card interactive padded className="flex gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-control bg-surface-2 text-subtle">
                <Building className="size-5" aria-hidden="true" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate text-base font-semibold text-fg">Senior Frontend Engineer</h3>
                  <Badge tone="accent" variant="solid" size="sm">
                    New
                  </Badge>
                </div>
                <p className="text-sm text-muted">Northwind Labs · Remote (Europe)</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-subtle">
                  <span className="font-medium text-fg tabular-nums">{formatSalary({ min: 140000, max: 165000, currency: 'USD', period: 'year' })}</span>
                  <span>{formatRelativeTime(postedAt)}</span>
                  <span>Greenhouse</span>
                </div>
              </div>
              <ScoreRing value={86} size="md" />
            </Card>
            <Card>
              <CardHeader actions={<CopyButton text="Hello from JScout" iconOnly variant="ghost" label="Copy summary" />}>
                <CardTitle>This week</CardTitle>
                <CardDescription>Applications sent and replies received.</CardDescription>
              </CardHeader>
              <CardBody className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Applied', value: '7', icon: <Bookmark /> },
                  { label: 'Replies', value: '3', icon: <TrendingUp /> },
                  { label: 'Follow-ups', value: '2', icon: <CalendarClock /> },
                ].map((stat) => (
                  <div key={stat.label} className="flex flex-col gap-1">
                    <span className="flex items-center gap-1.5 text-sm text-muted [&_svg]:size-3.5">
                      {stat.icon}
                      {stat.label}
                    </span>
                    <span className="text-2xl font-semibold text-fg tabular-nums">{stat.value}</span>
                  </div>
                ))}
              </CardBody>
              <CardFooter>
                <Button size="sm" variant="ghost">
                  Dismiss
                </Button>
                <Button size="sm" variant="primary">
                  Open tracker
                </Button>
              </CardFooter>
            </Card>
          </div>
        </Demo>
        <Demo label="Tabs" stack>
          <Tabs defaultValue="description">
            <TabsList aria-label="Job sections">
              <TabsTrigger value="description">Description</TabsTrigger>
              <TabsTrigger value="fit" count={86}>
                Fit
              </TabsTrigger>
              <TabsTrigger value="company">Company</TabsTrigger>
              <TabsTrigger value="disabled" disabled>
                Disabled
              </TabsTrigger>
            </TabsList>
            <TabsContent value="description" className="text-base text-muted">
              Use arrow keys to move between tabs; the panel follows.
            </TabsContent>
            <TabsContent value="fit" className="text-base text-muted">
              Strong title match, 8 of 11 keywords covered.
            </TabsContent>
            <TabsContent value="company" className="text-base text-muted">
              Northwind Labs, 60 people, remote-first.
            </TabsContent>
          </Tabs>
        </Demo>
      </KitSection>

      <KitSection id="feedback" title="Progress & feedback">
        <Demo label="Score ring">
          <ScoreRing value={92} size="lg" />
          <ScoreRing value={71} size="lg" />
          <ScoreRing value={48} size="lg" />
          <ScoreRing value={18} size="lg" />
          <ScoreRing value={86} />
          <ScoreRing value={55} size="sm" />
        </Demo>
        <Demo label="Progress bar" stack className="max-w-md">
          <ProgressBar label="Profile completeness" value={72} showValue />
          <ProgressBar label="Keyword coverage" value={38} tone="warning" size="sm" />
          <ProgressBar label="Syncing sources" showValue />
        </Demo>
        <Demo label="Spinner & skeleton">
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" className="text-primary" />
          <div className="flex w-72 items-center gap-3 rounded-card border border-border bg-surface p-3">
            <Skeleton className="size-10 rounded-control" />
            <div className="flex-1">
              <Skeleton className="mb-2 h-3.5 w-3/4" />
              <SkeletonText lines={2} />
            </div>
          </div>
        </Demo>
        <Demo label="Kbd & copy">
          <span className="flex items-center gap-2 text-sm text-muted">
            Focus search <Kbd combo="/" />
          </span>
          <span className="flex items-center gap-2 text-sm text-muted">
            Command menu <Kbd combo="mod+k" />
          </span>
          <span className="flex items-center gap-2 text-sm text-muted">
            Submit <Kbd combo="mod+enter" />
          </span>
          <CopyButton text="jane.doe@example.com" label="Copy email" />
          <CopyButton text="https://example.com" iconOnly label="Copy link" />
        </Demo>
        <Demo label="Empty state" stack>
          <EmptyState
            bordered
            icon={<Inbox />}
            title="No applications yet"
            description="Save a job from search or add one you found elsewhere. JScout reminds you when it is time to follow up."
            action={
              <>
                <Button variant="primary">Find jobs</Button>
                <Button>Add manually</Button>
              </>
            }
          />
          <EmptyState compact bordered icon={<Bookmark />} title="Nothing saved" description="Compact variant for panels." />
        </Demo>
        <Demo label="Error state" stack>
          <ErrorState
            compact
            className="rounded-card border border-border bg-surface"
            error={new Error('Could not reach JScout. Is it still running in your terminal?')}
            retrying={retrying}
            onRetry={() => {
              setRetrying(true);
              window.setTimeout(() => setRetrying(false), 1200);
            }}
          />
        </Demo>
      </KitSection>

      <KitSection id="page-header" title="Page header & text">
        <Demo label="Page header" stack>
          <div className="rounded-card border border-dashed border-strong p-5">
            <PageHeader
              back={{ to: '/tracker', label: 'Tracker' }}
              title="Senior Frontend Engineer"
              titleAddon={<Badge tone="info">Interviewing</Badge>}
              description={`Northwind Labs · applied ${formatRelativeTime(postedAt)} · ${pluralize(3, 'document')}`}
              actions={
                <>
                  <Button>Edit</Button>
                  <Button variant="primary">Log follow-up</Button>
                </>
              }
              className="pb-0"
            />
          </div>
        </Demo>
        <Demo label="Separator">
          <div className="flex h-5 items-center gap-3 text-sm text-muted">
            Greenhouse <Separator orientation="vertical" /> 3d ago <Separator orientation="vertical" /> 124 applicants
          </div>
        </Demo>
        <Demo label="Rich text" stack>
          <Card padded className="max-w-[72ch] p-6">
            <RichText html={SAMPLE_JOB_HTML} />
          </Card>
        </Demo>
      </KitSection>
    </>
  );
}
