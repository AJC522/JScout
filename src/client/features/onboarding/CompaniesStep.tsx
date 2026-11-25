import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { Link } from 'react-router';
import type { Profile } from '../../../shared/types';
import { api, errorMessage } from '../../api/client';
import { Button, Chip, ErrorState, Skeleton, useToast } from '../../components/ui';
import { formatNumber } from '../../lib/format';
import { qk } from '../../lib/query';
import { aboutCount, industryLabel, preselectIndustries } from './industries';
import { StepLayout } from './StepLayout';

interface CompaniesStepProps {
  profile: Profile;
  onBack: () => void;
  onNext: () => void;
}

/** The registry query only needs its facets and totals, not the boards themselves. */
const FACETS_QUERY = { limit: 1 } as const;

/** Choose which industries' employer job boards JScout follows. This decides how much the first sync downloads. */
export function CompaniesStep({ profile, onBack, onNext }: CompaniesStepProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const companies = useQuery({
    queryKey: qk.companies(FACETS_QUERY),
    queryFn: ({ signal }) => api('GET /api/companies', { query: FACETS_QUERY, signal }),
  });
  const industries = companies.data?.industries ?? [];
  const [selected, setSelected] = useState<string[] | null>(null);
  const chosen = selected ?? preselectIndustries(profile.preferences.targetTitles, industries.map((i) => i.value));
  const chosenCount = industries.filter((i) => chosen.includes(i.value)).reduce((sum, i) => sum + i.count, 0);
  const [saving, setSaving] = useState(false);

  const toggle = (value: string) => setSelected(chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value]);

  const next = async () => {
    if (!companies.data) {
      onNext();
      return;
    }
    setSaving(true);
    try {
      // Only boards from JScout's own list are switched off; companies the user added stay as they are.
      await Promise.all(
        industries.map((industry) =>
          chosen.includes(industry.value)
            ? api('POST /api/companies/bulk', { body: { enabled: true, industry: industry.value } })
            : api('POST /api/companies/bulk', { body: { enabled: false, industry: industry.value, origin: 'seed' } }),
        ),
      );
      void queryClient.invalidateQueries({ queryKey: qk.companies() });
      void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
      onNext();
    } catch (err) {
      toast.error('Could not update the companies you follow', { description: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepLayout
      title="Which companies should JScout follow?"
      description={
        <>
          Besides the big job boards, JScout checks {aboutCount(companies.data?.total)} employers’ own career pages
          directly. Pick the industries you care about. Fewer means a faster first sync, and you can add companies any time from the{' '}
          <Link to="/companies" className="font-medium text-primary underline-offset-2 hover:underline">
            Companies
          </Link>{' '}
          page.
        </>
      }
      onBack={onBack}
      onSkip={onNext}
      primary={{ label: 'Next', onClick: () => void next(), loading: saving, disabled: companies.isSuccess && chosen.length === 0 }}
    >
      {companies.isPending ? (
        <div className="flex flex-wrap gap-2" aria-busy="true" aria-label="Loading industries">
          {Array.from({ length: 14 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-32 rounded-full" />
          ))}
        </div>
      ) : companies.isError ? (
        <ErrorState
          compact
          title="The company list is not available right now"
          error="You can skip this step and choose companies later from the Companies page."
          onRetry={() => void companies.refetch()}
          retrying={companies.isFetching}
        />
      ) : industries.length === 0 ? (
        <div className="flex items-center gap-3 rounded-card border border-border p-4 text-sm text-muted">
          <Building2 className="size-5 shrink-0" aria-hidden />
          There are no companies to choose from yet. You can add the ones you like from the Companies page.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted" aria-live="polite">
              {formatNumber(chosenCount)} of {formatNumber(industries.reduce((sum, i) => sum + i.count, 0))} companies selected
            </p>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setSelected(industries.map((i) => i.value))}>
                Select all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Industries">
            {[...industries]
              .sort((a, b) => industryLabel(a.value).localeCompare(industryLabel(b.value)))
              .map((industry) => (
                <Chip key={industry.value} selected={chosen.includes(industry.value)} onSelectedChange={() => toggle(industry.value)} count={industry.count}>
                  {industryLabel(industry.value)}
                </Chip>
              ))}
          </div>
          {chosen.length === 0 ? <p className="text-sm text-warning">Pick at least one industry, or skip this step.</p> : null}
        </div>
      )}
    </StepLayout>
  );
}
