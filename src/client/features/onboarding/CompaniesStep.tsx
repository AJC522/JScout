import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { Link } from 'react-router';
import type { Profile } from '../../../shared/types';
import { api, errorMessage } from '../../api/client';
import { Button, Chip, ErrorState, Skeleton, useToast } from '../../components/ui';
import { formatNumber } from '../../lib/format';
import { qk } from '../../lib/query';
import { aboutCount, downloadEstimate, industryLabel, preselectIndustries } from './industries';
import { StepLayout } from './StepLayout';

interface CompaniesStepProps {
  profile: Profile;
  onBack: () => void;
  onNext: () => void;
}

/** The registry queries only need their facets and totals, not the boards themselves. */
const FACETS_QUERY = { limit: 1 } as const;
/** Its industry facet lists the industries with at least one followed company. */
const FOLLOWED_QUERY = { enabled: true, limit: 1 } as const;

/** Choose which industries' employer job boards JScout follows. This decides how much the first sync downloads. */
export function CompaniesStep({ profile, onBack, onNext }: CompaniesStepProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const companies = useQuery({
    queryKey: qk.companies(FACETS_QUERY),
    queryFn: ({ signal }) => api('GET /api/companies', { query: FACETS_QUERY, signal }),
  });
  const followedQuery = useQuery({
    queryKey: qk.companies(FOLLOWED_QUERY),
    queryFn: ({ signal }) => api('GET /api/companies', { query: FOLLOWED_QUERY, signal }),
  });
  const industries = companies.data?.industries ?? [];
  /** Followed companies per industry. */
  const followedCounts = new Map((followedQuery.data?.industries ?? []).map((i) => [i.value, i.count]));
  const followed = [...followedCounts.keys()];
  const [selected, setSelected] = useState<string[] | null>(null);
  // Someone coming back to setup keeps what they already follow; a first run starts from their titles.
  const chosen = selected ?? (followed.length > 0 ? followed : preselectIndustries(profile.preferences.targetTitles, industries.map((i) => i.value)));
  // An industry already followed stays as it is (perhaps only some of its companies); a new one is followed in full.
  const chosenIndustries = industries.filter((i) => chosen.includes(i.value));
  const chosenCount = chosenIndustries.reduce((sum, i) => sum + (followedCounts.get(i.value) ?? i.count), 0);
  const addedCount = chosenIndustries.reduce((sum, i) => sum + (followedCounts.has(i.value) ? 0 : i.count), 0);
  const [saving, setSaving] = useState(false);

  const toggle = (value: string) => setSelected(chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value]);

  const next = async () => {
    if (!companies.data) {
      onNext();
      return;
    }
    setSaving(true);
    try {
      // Only industries whose choice changed are touched, so companies followed one by one on the
      // Companies page stay followed. Unfollowing switches off JScout's own boards, never ones the user added.
      await Promise.all([
        ...chosen
          .filter((industry) => !followed.includes(industry))
          .map((industry) => api('POST /api/companies/bulk', { body: { enabled: true, industry } })),
        ...followed
          .filter((industry) => !chosen.includes(industry))
          .map((industry) => api('POST /api/companies/bulk', { body: { enabled: false, industry, origin: 'seed' } })),
      ]);
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
          JScout already searches the big job boards. It can also check {aboutCount(companies.data?.total)} employers’ own career pages,
          which list many jobs that never reach those boards. Pick the industries you care about, or none for now: you can follow more, or
          add any company, from the{' '}
          <Link to="/companies" className="font-medium text-primary underline-offset-2 hover:underline">
            Companies
          </Link>{' '}
          page.
        </>
      }
      onBack={onBack}
      onSkip={onNext}
      primary={{ label: 'Next', onClick: () => void next(), loading: saving }}
    >
      {companies.isPending || followedQuery.isPending ? (
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
              {addedCount > 0 ? ` · ${downloadEstimate(addedCount)}` : ''}
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
          {chosen.length === 0 ? (
            <p className="text-sm text-muted">No industries picked: JScout will search the job boards only until you follow some companies.</p>
          ) : null}
        </div>
      )}
    </StepLayout>
  );
}
