import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Bookmark, Briefcase, Ellipsis, ExternalLink, MapPin, Pencil, Plus, Search, Send, Trash, Rows3, SquareKanban } from 'lucide-react';
import {
  Button,
  Checkbox,
  Combobox,
  Field,
  HighlightMatch,
  IconButton,
  Input,
  Kbd,
  RadioGroup,
  SegmentedControl,
  Select,
  Switch,
  TagInput,
  Textarea,
} from '../../components/ui';
import { formatNumber } from '../../lib/format';
import { Demo, KitSection } from './KitSection';
import { fakeLoader, PLACES, SKILLS, TITLES, type TitleOption } from './sample';

const loadTitles = fakeLoader(TITLES, (option) => option.title);
const loadPlaces = fakeLoader(PLACES, (place) => place);
const loadSkills = fakeLoader(SKILLS, (skill) => skill, 150);

export function ButtonsSection() {
  const [loading, setLoading] = useState(false);
  return (
    <KitSection id="buttons" title="Buttons" description="One primary action per view. Secondary for everything else, ghost inside toolbars and lists, danger only for destructive confirmations.">
      <Demo label="Variants">
        <Button variant="primary">Save search</Button>
        <Button>Export</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="link">View all</Button>
      </Demo>
      <Demo label="Sizes">
        <Button size="sm" variant="primary">
          Small
        </Button>
        <Button size="md" variant="primary">
          Medium
        </Button>
        <Button size="lg" variant="primary">
          Large
        </Button>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </Demo>
      <Demo label="Icons & states">
        <Button variant="primary" leadingIcon={<Search />}>
          Search
        </Button>
        <Button trailingIcon={<ArrowRight />}>Next</Button>
        <Button
          variant="primary"
          loading={loading}
          onClick={() => {
            setLoading(true);
            window.setTimeout(() => setLoading(false), 1500);
          }}
        >
          {loading ? 'Saving…' : 'Click to load'}
        </Button>
        <Button disabled>Disabled</Button>
        <Button asChild variant="secondary" trailingIcon={<ExternalLink />}>
          <Link to="/saved">Link as button</Link>
        </Button>
      </Demo>
      <Demo label="Icon buttons">
        <IconButton label="Edit" icon={<Pencil />} />
        <IconButton label="Save job" icon={<Bookmark />} variant="secondary" />
        <IconButton label="Add" icon={<Plus />} variant="primary" />
        <IconButton label="Delete" icon={<Trash />} variant="danger" />
        <IconButton label="More actions" icon={<Ellipsis />} size="sm" />
        <IconButton label="Notifications" icon={<Send />} indicator />
        <IconButton label="Working" icon={<Send />} loading variant="secondary" />
      </Demo>
    </KitSection>
  );
}

export function FormsSection() {
  const [query, setQuery] = useState('frontend');
  const [email, setEmail] = useState('not-an-email');
  const [notes, setNotes] = useState('Auto-growing textarea: type a few lines and it expands up to a limit.');
  const [remote, setRemote] = useState('remote');
  const [seniority, setSeniority] = useState('senior');
  const [checks, setChecks] = useState({ visa: true, relocate: false });
  const [autoSync, setAutoSync] = useState(true);
  const [view, setView] = useState('list');
  const [sort, setSort] = useState('relevance');
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [skills, setSkills] = useState<string[]>(['TypeScript', 'React', 'Accessibility']);
  const [lastPicked, setLastPicked] = useState<string | null>(null);

  const checkedCount = Number(checks.visa) + Number(checks.relocate);
  const allState = checkedCount === 2 ? true : checkedCount === 0 ? false : 'indeterminate';

  return (
    <KitSection id="forms" title="Form controls" description="Wrap a control in <Field> and it is labelled, described and marked invalid automatically.">
      <Demo label="Input" stack>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job title" hint="Leading icon, clear button (Escape clears too).">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery('')} leadingIcon={<Search />} placeholder="e.g. Product designer" />
          </Field>
          <Field label="Email" required error={email.includes('@') ? undefined : 'Enter an email address like name@example.com.'}>
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Minimum salary" optional>
            <Input type="number" inputMode="numeric" placeholder="90000" trailing="USD / yr" />
          </Field>
          <Field label="Disabled" disabled>
            <Input value="Read from your résumé" readOnly />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input size="sm" placeholder="Small" aria-label="Small input" wrapperClassName="w-40" />
          <Input size="md" placeholder="Medium" aria-label="Medium input" wrapperClassName="w-40" />
          <Input size="lg" placeholder="Large" aria-label="Large input" wrapperClassName="w-40" trailing={<Kbd combo="mod+k" />} />
        </div>
      </Demo>
      <Demo label="Textarea" stack>
        <Field label="Notes" hint={`${notes.length} characters`}>
          <Textarea autoGrow maxRows={8} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </Demo>
      <Demo label="Select">
        <Field label="Seniority" className="w-56">
          <Select
            value={seniority}
            onChange={(event) => setSeniority(event.target.value)}
            options={[
              { value: 'junior', label: 'Junior' },
              { value: 'mid', label: 'Mid-level' },
              { value: 'senior', label: 'Senior' },
              { value: 'lead', label: 'Lead / Staff' },
            ]}
          />
        </Field>
        <Field label="Posted" className="w-56">
          <Select size="sm" placeholder="Any time" options={[{ value: '1', label: 'Last 24 hours' }, { value: '7', label: 'Last week' }]} />
        </Field>
      </Demo>
      <Demo label="Checkbox & switch" stack>
        <div className="flex flex-col gap-3">
          <Checkbox
            label="All work authorisation options"
            checked={allState}
            onCheckedChange={(value) => setChecks({ visa: value === true, relocate: value === true })}
          />
          <div className="flex flex-col gap-3 pl-6.5">
            <Checkbox label="Needs visa sponsorship" checked={checks.visa} onCheckedChange={(value) => setChecks((c) => ({ ...c, visa: value === true }))} />
            <Checkbox
              label="Willing to relocate"
              description="Shows on-site roles outside your area too."
              checked={checks.relocate}
              onCheckedChange={(value) => setChecks((c) => ({ ...c, relocate: value === true }))}
            />
            <Checkbox label="Disabled option" disabled />
          </div>
        </div>
        <div className="flex max-w-md flex-col gap-4">
          <Switch label="Refresh sources automatically" description="Stale feeds are synced while JScout is open." checked={autoSync} onCheckedChange={setAutoSync} labelPosition="start" />
          <Switch label="Small switch" size="sm" defaultChecked />
        </div>
      </Demo>
      <Demo label="Radio group" stack>
        <Field label="Work arrangement">
          <RadioGroup
            value={remote}
            onValueChange={setRemote}
            orientation="horizontal"
            options={[
              { value: 'remote', label: 'Remote' },
              { value: 'hybrid', label: 'Hybrid' },
              { value: 'onsite', label: 'On-site' },
              { value: 'any', label: 'Any', disabled: true },
            ]}
          />
        </Field>
        <Field label="Cover letter length">
          <RadioGroup
            variant="cards"
            defaultValue="medium"
            className="grid gap-2 sm:grid-cols-3"
            options={[
              { value: 'short', label: 'Short', description: 'About 120 words. For quick applications.' },
              { value: 'medium', label: 'Medium', description: 'About 250 words. Works for most roles.' },
              { value: 'long', label: 'Long', description: 'About 400 words. When the role asks for detail.' },
            ]}
          />
        </Field>
      </Demo>
      <Demo label="Segmented control">
        <SegmentedControl
          aria-label="View"
          value={view}
          onValueChange={setView}
          options={[
            { value: 'list', label: 'List', icon: <Rows3 /> },
            { value: 'board', label: 'Board', icon: <SquareKanban /> },
          ]}
        />
        <SegmentedControl
          aria-label="Sort"
          size="sm"
          value={sort}
          onValueChange={setSort}
          options={[
            { value: 'relevance', label: 'Best match' },
            { value: 'date', label: 'Newest' },
            { value: 'salary', label: 'Salary' },
          ]}
        />
      </Demo>
      <Demo label="Combobox" stack>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What" hint="Async suggestions with counts. ↑ ↓ to move, Enter to pick, Esc to close.">
            <Combobox<TitleOption>
              value={title}
              onValueChange={setTitle}
              loadOptions={loadTitles}
              getOptionLabel={(option) => option.title}
              onSelect={(option) => setLastPicked(option.title)}
              leadingIcon={<Briefcase />}
              placeholder="Job title, skill or company"
              emptyMessage="No matching titles. Press Enter to search for it anyway."
              renderOption={(option, { query: typed }) => (
                <>
                  <span className="min-w-0 flex-1 truncate">
                    <HighlightMatch text={option.title} query={typed} />
                  </span>
                  <span className="text-sm text-subtle tabular-nums">{formatNumber(option.count)}</span>
                </>
              )}
            />
          </Field>
          <Field label="Where" hint={lastPicked ? `Last picked title: ${lastPicked}` : 'Free text is always allowed.'}>
            <Combobox value={place} onValueChange={setPlace} loadOptions={loadPlaces} leadingIcon={<MapPin />} placeholder="City, country or Remote" />
          </Field>
        </div>
      </Demo>
      <Demo label="Tag input" stack>
        <Field label="Skills" hint="Enter or comma adds; Backspace removes the last one; paste a list to add many.">
          <TagInput value={skills} onChange={setSkills} loadSuggestions={loadSkills} max={12} placeholder="Add a skill" />
        </Field>
      </Demo>
    </KitSection>
  );
}
