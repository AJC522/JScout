import { Page } from '../../components/layout/Page';
import { Badge, PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';
import { ButtonsSection, FormsSection } from './ControlsSection';
import { DisplaySection } from './DisplaySection';
import { FoundationsSection } from './FoundationsSection';
import { OverlaysSection } from './OverlaysSection';

const INDEX = [
  { id: 'foundations', label: 'Foundations' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'forms', label: 'Form controls' },
  { id: 'badges', label: 'Badges & chips' },
  { id: 'cards', label: 'Cards & tabs' },
  { id: 'feedback', label: 'Progress & feedback' },
  { id: 'page-header', label: 'Page header & text' },
  { id: 'overlays', label: 'Overlays' },
];

/** Living documentation of the UI kit: every primitive in its variants and states. Import paths: components/ui. */
export function KitPage() {
  useDocumentTitle('UI kit');
  return (
    <Page width="wide" className="xl:grid xl:grid-cols-[minmax(0,1fr)_12rem] xl:gap-10">
      <div className="min-w-0">
        <PageHeader
          title="UI kit"
          titleAddon={<Badge tone="primary">Internal</Badge>}
          description={
            <>
              Every component from <code className="font-mono text-sm">src/client/components/ui</code> in its variants and states. Switch the theme in the sidebar to review both palettes.
            </>
          }
        />
        <FoundationsSection />
        <ButtonsSection />
        <FormsSection />
        <DisplaySection />
        <OverlaysSection />
      </div>
      <nav aria-label="Kit sections" className="hidden xl:block">
        <ul className="sticky top-8 flex flex-col gap-0.5 border-l border-border">
          {INDEX.map((entry) => (
            <li key={entry.id}>
              <a href={`#${entry.id}`} className="-ml-px block border-l border-transparent py-1 pl-3 text-sm text-muted transition-colors hover:border-strong hover:text-fg">
                {entry.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </Page>
  );
}
