/** The apply kit as one tabbed panel: fit, résumé review, cover letter, answers and quick-fill. */
import { useState, type ReactNode } from 'react';
import { ClipboardList, FileCheck, Gauge, MessageSquareText, PenLine } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui';
import { useLocalStorage } from '../../lib/hooks';
import { ResumeReviewPanel } from '../resume/ResumeReviewPanel';
import { AnswerHelper } from './AnswerHelper';
import { CoverLetterPanel } from './CoverLetterPanel';
import { FitPanel } from './FitPanel';
import { QuickFillPanel } from './QuickFillPanel';
import type { ApplyKitTarget } from './queries';

const TABS = ['fit', 'resume', 'letter', 'answers', 'quick-fill'] as const;
type ApplyKitTab = (typeof TABS)[number];

function isTab(value: string): value is ApplyKitTab {
  return (TABS as readonly string[]).includes(value);
}

/** The Résumé review page for the same target. */
function resumePageLink(target: ApplyKitTarget): string {
  const params = new URLSearchParams({
    ...(target.applicationId ? { application: target.applicationId } : {}),
    ...(target.jobId ? { job: target.jobId } : {}),
  });
  return `/resume?${params.toString()}`;
}

export interface ApplyKitPanelProps {
  target: ApplyKitTarget;
  company?: string;
  className?: string;
}

export function ApplyKitPanel({ target, company, className }: ApplyKitPanelProps) {
  const [stored, setTab] = useLocalStorage<ApplyKitTab>('jscout.applykit.tab', 'fit');
  const tab = isTab(stored) ? stored : 'fit';
  // Tabs mount when first opened (so text areas measure themselves while visible) and then stay
  // mounted, so a draft survives switching tabs.
  const [visited, setVisited] = useState<ReadonlySet<ApplyKitTab>>(() => new Set([tab]));
  const select = (value: string) => {
    if (!isTab(value)) return;
    setTab(value);
    setVisited((v) => (v.has(value) ? v : new Set(v).add(value)));
  };
  const panel = (value: ApplyKitTab, content: ReactNode) => (
    <TabsContent value={value} forceMount className="data-[state=inactive]:hidden">
      {visited.has(value) ? content : null}
    </TabsContent>
  );

  return (
    <Tabs value={tab} onValueChange={select} className={className}>
      <TabsList aria-label="Apply kit">
        <TabsTrigger value="fit" icon={<Gauge />}>
          Fit
        </TabsTrigger>
        <TabsTrigger value="resume" icon={<FileCheck />}>
          Résumé
        </TabsTrigger>
        <TabsTrigger value="letter" icon={<PenLine />}>
          Cover letter
        </TabsTrigger>
        <TabsTrigger value="answers" icon={<MessageSquareText />}>
          Answers
        </TabsTrigger>
        <TabsTrigger value="quick-fill" icon={<ClipboardList />}>
          Quick fill
        </TabsTrigger>
      </TabsList>
      {panel('fit', <FitPanel target={target} />)}
      {panel('resume', <ResumeReviewPanel target={target} company={company} fullPageLink={resumePageLink(target)} showJob={false} />)}
      {panel('letter', <CoverLetterPanel target={target} company={company} />)}
      {panel('answers', <AnswerHelper target={target} />)}
      {panel('quick-fill', <QuickFillPanel />)}
    </Tabs>
  );
}
