/** The apply kit as one tabbed panel: fit, cover letter, answers and quick-fill. */
import { ClipboardList, Gauge, MessageSquareText, PenLine } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui';
import { useLocalStorage } from '../../lib/hooks';
import { AnswerHelper } from './AnswerHelper';
import { CoverLetterPanel } from './CoverLetterPanel';
import { FitPanel } from './FitPanel';
import { QuickFillPanel } from './QuickFillPanel';
import type { ApplyKitTarget } from './queries';

const TABS = ['fit', 'letter', 'answers', 'quick-fill'] as const;
type ApplyKitTab = (typeof TABS)[number];

function isTab(value: string): value is ApplyKitTab {
  return (TABS as readonly string[]).includes(value);
}

export interface ApplyKitPanelProps {
  target: ApplyKitTarget;
  company?: string;
  className?: string;
}

export function ApplyKitPanel({ target, company, className }: ApplyKitPanelProps) {
  const [tab, setTab] = useLocalStorage<ApplyKitTab>('jscout.applykit.tab', 'fit');
  return (
    <Tabs value={isTab(tab) ? tab : 'fit'} onValueChange={(v) => isTab(v) && setTab(v)} className={className}>
      <TabsList aria-label="Apply kit">
        <TabsTrigger value="fit" icon={<Gauge />}>
          Fit
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
      {/* Kept mounted so a draft survives switching tabs. */}
      <TabsContent value="fit" forceMount className="data-[state=inactive]:hidden">
        <FitPanel target={target} />
      </TabsContent>
      <TabsContent value="letter" forceMount className="data-[state=inactive]:hidden">
        <CoverLetterPanel target={target} company={company} />
      </TabsContent>
      <TabsContent value="answers" forceMount className="data-[state=inactive]:hidden">
        <AnswerHelper target={target} />
      </TabsContent>
      <TabsContent value="quick-fill" forceMount className="data-[state=inactive]:hidden">
        <QuickFillPanel />
      </TabsContent>
    </Tabs>
  );
}
