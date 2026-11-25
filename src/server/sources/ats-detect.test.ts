import { describe, expect, it } from 'vitest';
import { parseAtsUrl, tokenCandidates } from './ats-detect';

describe('parseAtsUrl', () => {
  it.each([
    // GovernmentJobs (NEOGOV)
    ['https://www.governmentjobs.com/careers/seattle', 'governmentjobs', 'seattle'],
    ['governmentjobs.com/careers/HonoluluPD/jobs/4550695/police-communications-officer-i', 'governmentjobs', 'honolulupd'],
    ['https://www.governmentjobs.com/careers/washington?department[0]=Office%20of%20Financial%20Management', 'governmentjobs', 'washington'],
    ['https://agency.governmentjobs.com/lacounty/default.cfm', 'governmentjobs', 'lacounty'],
    ['https://www.governmentjobs.com/SearchEngine/JobsFeed?agency=michigan', 'governmentjobs', 'michigan'],
    // Greenhouse
    ['https://boards.greenhouse.io/stripe', 'greenhouse', 'stripe'],
    ['boards.greenhouse.io/stripe', 'greenhouse', 'stripe'],
    ['http://boards.greenhouse.io/Stripe/', 'greenhouse', 'stripe'],
    ['https://boards.greenhouse.io/airbnb/jobs/8365363', 'greenhouse', 'airbnb'],
    ['https://boards.greenhouse.io/airbnb/jobs/8365363?gh_jid=8365363#app', 'greenhouse', 'airbnb'],
    ['https://job-boards.greenhouse.io/discord/jobs/8945798002', 'greenhouse', 'discord'],
    ['job-boards.greenhouse.io/gitlab', 'greenhouse', 'gitlab'],
    ['https://boards.greenhouse.io/embed/job_board?for=duolingo', 'greenhouse', 'duolingo'],
    ['https://boards.greenhouse.io/embed/job_board?for=Duolingo&b=https%3A%2F%2Fcareers.duolingo.com', 'greenhouse', 'duolingo'],
    ['https://boards.greenhouse.io/embed/job_app?for=stripe&token=8172510', 'greenhouse', 'stripe'],
    ['https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true', 'greenhouse', 'stripe'],
    ['boards-api.greenhouse.io/v1/boards/doordashusa', 'greenhouse', 'doordashusa'],
    ['  https://www.boards.greenhouse.io/stripe  ', 'greenhouse', 'stripe'],
    // Lever
    ['https://jobs.lever.co/palantir', 'lever', 'palantir'],
    ['jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c', 'lever', 'palantir'],
    ['https://jobs.lever.co/Zoox/8befaec7-bb9f-4cf3-a48c-46b5e3886bf3/apply', 'lever', 'zoox'],
    ['https://jobs.lever.co/spotify?location=Stockholm&team=Engineering', 'lever', 'spotify'],
    ['https://api.lever.co/v0/postings/veeva?mode=json', 'lever', 'veeva'],
    ['https://api.lever.co/v0/postings/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c', 'lever', 'palantir'],
    // Ashby
    ['https://jobs.ashbyhq.com/ramp', 'ashby', 'ramp'],
    ['jobs.ashbyhq.com/Linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff', 'ashby', 'linear'],
    ['https://jobs.ashbyhq.com/openai/dbd5ae8a-7c01-4f17-be39-b8caa8fd95d5/application', 'ashby', 'openai'],
    ['https://api.ashbyhq.com/posting-api/job-board/notion?includeCompensation=true', 'ashby', 'notion'],
    // SmartRecruiters (case kept)
    ['https://jobs.smartrecruiters.com/Visa', 'smartrecruiters', 'Visa'],
    ['jobs.smartrecruiters.com/BoschGroup/744000012345678-software-engineer', 'smartrecruiters', 'BoschGroup'],
    ['https://careers.smartrecruiters.com/IKEA', 'smartrecruiters', 'IKEA'],
    ['https://jobs.smartrecruiters.com/oneclick-ui/company/Visa/publication/abc', 'smartrecruiters', 'Visa'],
    ['https://api.smartrecruiters.com/v1/companies/Visa/postings', 'smartrecruiters', 'Visa'],
    // Workable
    ['https://apply.workable.com/huggingface', 'workable', 'huggingface'],
    ['apply.workable.com/HuggingFace/j/1A2B3C4D5E/', 'workable', 'huggingface'],
    ['https://apply.workable.com/acme-corp/j/ABC123/apply', 'workable', 'acme-corp'],
  ])('%s -> %s:%s', (input, ats, token) => {
    expect(parseAtsUrl(input)).toEqual({ ats, token });
  });

  it.each([
    [''],
    ['   '],
    ['stripe'],
    ['https://stripe.com/jobs/search?gh_jid=8172510'],
    ['https://careers.duolingo.com/jobs/8883563002?gh_jid=8883563002'],
    ['https://greenhouse.io/stripe'],
    ['https://boards.greenhouse.io/'],
    ['https://boards.greenhouse.io/embed/job_board'],
    ['https://boards.greenhouse.io/embed/job_board?for='],
    ['https://boards-api.greenhouse.io/v1/'],
    ['https://boards-api.greenhouse.io/v1/boards/'],
    ['https://job-boards.eu.greenhouse.io/acme'],
    ['https://jobs.lever.co/'],
    ['https://jobs.eu.lever.co/acme'],
    ['https://api.lever.co/v1/postings/acme'],
    ['https://lever.co/palantir'],
    ['https://jobs.ashbyhq.com'],
    ['https://api.ashbyhq.com/posting-api/'],
    ['https://ashbyhq.com/ramp'],
    ['https://jobs.smartrecruiters.com/'],
    ['https://apply.workable.com/'],
    ['https://apply.workable.com/j/1A2B3C4D5E'],
    ['https://www.governmentjobs.com/'],
    ['https://www.governmentjobs.com/careers/'],
    ['https://www.governmentjobs.com/jobs/5559617-0/crime-analyst'],
    ['https://www.governmentjobs.com/careers/home/index'],
    ['https://www.governmentjobs.com/SearchEngine/JobsFeed'],
    ['https://agency.governmentjobs.com/'],
    ['ftp://boards.greenhouse.io/stripe'],
    ['javascript:alert(1)'],
    ['https://boards.greenhouse.io.evil.example/stripe'],
    ['https://evil.example/boards.greenhouse.io/stripe'],
    ['https://boards.greenhouse.io/%2E%2E'],
    ['https://jobs.lever.co/bad%20token'],
    ['boards.greenhouse.io/stripe and more'],
    ['https://boards.greenhouse.io/-stripe'],
  ])('rejects %s', (input) => {
    expect(parseAtsUrl(input)).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(parseAtsUrl(undefined as unknown as string)).toBeNull();
    expect(parseAtsUrl(42 as unknown as string)).toBeNull();
  });
});

describe('tokenCandidates', () => {
  it.each([
    ['Acme Robotics, Inc.', ['acmerobotics', 'acme-robotics', 'acme', 'acmeroboticsinc', 'acmeroboticshq']],
    ['Stripe', ['stripe', 'stripehq']],
    ['Stripe, Inc.', ['stripe', 'stripeinc', 'stripehq']],
    ['The Trade Desk', ['tradedesk', 'trade-desk', 'trade', 'thetradedesk', 'tradedeskhq']],
    ['Johnson & Johnson', ['johnsonandjohnson', 'johnson-and-johnson', 'johnson', 'jaj', 'johnsonandjohnsonhq']],
    ['Société Générale', ['societegenerale', 'societe-generale', 'societe', 'societegeneralehq']],
    ["Macy's", ['macys', 'macyshq']],
    ['C3.ai', ['c3ai', 'c3-ai', 'c3aihq']],
    ['23andMe', ['23andme', '23andmehq']],
    ['GE Healthcare', ['gehealthcare', 'ge-healthcare', 'gehealthcarehq']],
    ['Zoox GmbH', ['zoox', 'zooxgmbh', 'zooxhq']],
    ['International Business Machines Corporation', [
      'internationalbusinessmachines',
      'international-business-machines',
      'international',
      'internationalbusinessmachinescorporation',
      'ibm',
      'internationalbusinessmachineshq',
    ]],
    ['  Notion Labs  ', ['notionlabs', 'notion-labs', 'notion', 'notionlabshq']],
  ])('%s', (name, expected) => {
    expect(tokenCandidates(name)).toEqual(expected);
  });

  it('caps at six unique candidates', () => {
    const out = tokenCandidates('Alpha Beta Gamma Delta Epsilon Holdings Ltd');
    expect(out.length).toBeLessThanOrEqual(6);
    expect(new Set(out).size).toBe(out.length);
    expect(out[0]).toBe('alphabetagammadeltaepsilon');
  });

  it.each([[''], ['   '], ['!!!'], ['株式会社']])('returns nothing usable for %j', (name) => {
    expect(tokenCandidates(name)).toEqual([]);
  });

  it('never emits characters a board token cannot hold', () => {
    for (const name of ['Ben & Jerry’s', 'L’Oréal S.A.', 'AT&T Inc.', 'Yahoo!', 'C++ Shop, LLC', 'Coinbase Global, Inc.']) {
      for (const t of tokenCandidates(name)) expect(t).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
