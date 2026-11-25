/**
 * Test support for the apply kit: realistic profiles and postings (software, nursing, sales)
 * and small stand-ins for the skills/titles/location libraries, which other features own.
 * Test files install the stand-ins with vi.mock(..., () => import('./test-fixtures').then(...)).
 */
import { emptyProfile } from '../../../shared/constants';
import type {
  ApplicationDetail,
  JobDetail,
  JobLocation,
  JobPosting,
  Place,
  Profile,
  SavedAnswer,
  Seniority,
} from '../../../shared/types';
import type { PlaceMatch } from '../../lib/location';
import { escapeRegExp, foldText, normalizeText } from '../../lib/text';
import type { RoleRef, TitleInfo } from '../../lib/titles';

const NOW = '2026-11-20T12:00:00.000Z';

// --- library stand-ins ---------------------------------------------------------------

const SKILLS: Array<[string, string[]]> = [
  ['TypeScript', []],
  ['JavaScript', []],
  ['React', []],
  ['Node.js', ['nodejs']],
  ['PostgreSQL', ['postgres']],
  ['Kubernetes', ['k8s']],
  ['Docker', []],
  ['AWS', ['amazon web services']],
  ['Kafka', []],
  ['Terraform', []],
  ['Patient Care', []],
  ['Electronic Health Records', ['ehr']],
  ['Epic', []],
  ['Medication Administration', []],
  ['BLS', ['basic life support']],
  ['ACLS', []],
  ['Salesforce', []],
  ['Cold Calling', []],
  ['Negotiation', []],
  ['SaaS', []],
  ['HubSpot', []],
  ['Pipeline Management', []],
];
const skillPattern = (name: string) => new RegExp(`(?<![\\w.])${escapeRegExp(name)}(?![\\w])`, 'i');

export const fakeSkills = {
  extractSkills(text: string): string[] {
    return SKILLS.map(([name, aliases]) => ({
      name,
      at: Math.min(...[name, ...aliases].map((n) => text.search(skillPattern(n))).filter((i) => i >= 0)),
    }))
      .filter((s) => Number.isFinite(s.at))
      .sort((a, b) => a.at - b.at)
      .map((s) => s.name);
  },
  canonicalSkill(name: string): string | undefined {
    return SKILLS.find(([n, aliases]) => [n, ...aliases].some((x) => foldText(x) === foldText(name)))?.[0];
  },
};

const role = (id: string, title: string, aliases: string[], related: string[]): RoleRef => ({
  id,
  title,
  familyId: 'f',
  family: 'Family',
  aliases,
  related,
  skills: [],
});
const ROLES = [
  role('software-engineer', 'Software Engineer', ['backend engineer', 'software developer', 'frontend engineer'], ['devops-engineer']),
  role('devops-engineer', 'DevOps Engineer', ['site reliability engineer', 'platform engineer'], ['software-engineer']),
  role('registered-nurse', 'Registered Nurse', ['rn', 'staff nurse', 'icu nurse'], ['nurse-practitioner']),
  role('nurse-practitioner', 'Nurse Practitioner', ['np'], ['registered-nurse']),
  role('account-executive', 'Account Executive', ['sales executive'], ['sales-development-representative']),
  role('sales-development-representative', 'Sales Development Representative', ['sdr', 'business development representative'], ['account-executive']),
];
const SENIORITY_WORDS: Array<[RegExp, Seniority]> = [
  [/\b(intern|internship)\b/, 'intern'],
  [/\b(junior|jr|graduate)\b/, 'entry'],
  [/\b(senior|sr)\b/, 'senior'],
  [/\b(lead|staff|principal)\b/, 'lead'],
  [/\bdirector\b/, 'director'],
];

function findRole(text: string): RoleRef | undefined {
  const n = normalizeText(text);
  return ROLES.find((r) => [r.title, ...r.aliases].some((a) => n === normalizeText(a) || n.startsWith(`${normalizeText(a)} `)));
}

export const fakeTitles = {
  analyzeTitle(raw: string): TitleInfo {
    const n = normalizeText(raw);
    const seniority = SENIORITY_WORDS.find(([re]) => re.test(n))?.[1] ?? 'unknown';
    const core = SENIORITY_WORDS.reduce((s, [re]) => s.replace(re, ' '), n).replace(/\s+/g, ' ').trim();
    return { raw, core, seniority, role: findRole(core) };
  },
  detectSeniority(title: string): Seniority {
    return fakeTitles.analyzeTitle(title).seniority;
  },
  findRole,
  rolesForSkills: (): RoleRef[] => [],
};

const city = (name: string, admin1: string, country: string, lat: number, lon: number): Place => ({
  kind: 'city',
  raw: name,
  city: name,
  admin1,
  country,
  lat,
  lon,
  label: `${name}, ${admin1}`,
});
const PLACES: Place[] = [
  city('Austin', 'TX', 'US', 30.27, -97.74),
  city('Round Rock', 'TX', 'US', 30.51, -97.68),
  city('Chicago', 'IL', 'US', 41.88, -87.63),
  city('Toronto', 'ON', 'CA', 43.65, -79.38),
  city('Seattle', 'WA', 'US', 47.61, -122.33),
  { kind: 'admin1', raw: 'Illinois', admin1: 'IL', country: 'US', label: 'Illinois, United States' },
  { kind: 'country', raw: 'United States', country: 'US', label: 'United States' },
];

function km(a: Place, b: Place): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat! - a.lat!);
  const dLon = rad(b.lon! - a.lon!);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat!)) * Math.cos(rad(b.lat!)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export const fakeLocation = {
  resolvePlace(text: string): Place | undefined {
    const n = normalizeText(text);
    return PLACES.find((p) => n === normalizeText(p.raw) || n.startsWith(`${normalizeText(p.raw)} `));
  },
  matchPlace(job: JobLocation, target: Place, opts: { radiusKm?: number; includeRemote?: boolean } = {}): PlaceMatch {
    for (const p of job.places) {
      if (target.kind === 'city' && p.kind === 'city') {
        if (p.city === target.city) return { kind: 'city' };
        const d = km(p, target);
        if (opts.radiusKm && d <= opts.radiusKm) return { kind: 'radius', distanceKm: d };
      }
      if (target.kind === 'country' && p.country === target.country) return { kind: 'area' };
    }
    const scoped = job.remoteScope.length === 0 || (target.country !== undefined && job.remoteScope.includes(target.country));
    return opts.includeRemote && job.remote === 'remote' && scoped ? { kind: 'remote' } : { kind: 'none' };
  },
  parseJobLocation(input: { locations: string[]; remote?: 'remote' | 'hybrid' | 'onsite' }) {
    const places = input.locations.map((l) => fakeLocation.resolvePlace(l)).filter((p) => p !== undefined);
    const remote = input.remote ?? (input.locations.some((l) => /remote/i.test(l)) ? 'remote' : 'unknown');
    return { location: { places, remote, remoteScope: [] } satisfies JobLocation, text: input.locations.join(' · ') };
  },
};

// --- postings --------------------------------------------------------------------------

function posting(over: Partial<JobPosting> & Pick<JobPosting, 'id' | 'title' | 'company'>): JobPosting {
  return {
    clusterKey: `cluster-${over.id}`,
    source: 'greenhouse',
    sourceName: 'Greenhouse',
    externalId: over.id,
    url: `https://jobs.example.com/${over.id}`,
    location: { places: [], remote: 'unknown', remoteScope: [] },
    locationText: '',
    employmentType: 'full-time',
    seniority: 'unknown',
    tags: [],
    skills: [],
    snippet: '',
    hasDescription: true,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    ...over,
  };
}

export function jobDetail(job: JobPosting, descriptionHtml: string): JobDetail {
  return {
    job,
    score: 50,
    match: { titleMatch: 'none', matchedTerms: [], skillsMatched: [], skillsMissing: [], reasons: [] },
    duplicates: [],
    userState: { hidden: false },
    descriptionHtml,
  };
}

export const softwareJob = jobDetail(
  posting({
    id: 'job-sw',
    title: 'Senior Backend Engineer',
    company: 'Lumen Pay',
    location: { places: [], remote: 'remote', remoteScope: ['US'] },
    locationText: 'Remote (US)',
    salary: { min: 160000, max: 190000, currency: 'USD', period: 'year', annualMin: 160000, annualMax: 190000 },
    seniority: 'senior',
    skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Kubernetes', 'Kafka', 'AWS'],
  }),
  `<p>Lumen Pay builds payments infrastructure for independent clinics. As a Senior Backend Engineer on the Payments team, you will design and scale the services that move money for thousands of clinics.</p>
<h3>What you'll do</h3>
<ul><li>Build and operate payments APIs in TypeScript and Node.js</li><li>Design event-driven services with Kafka</li><li>Run services on Kubernetes in AWS</li><li>Improve the reliability of our payments platform</li></ul>
<h3>What you'll bring</h3>
<ul><li>5+ years of backend engineering experience</li><li>Strong TypeScript and Node.js skills</li><li>Experience with PostgreSQL and distributed systems</li><li>Hands-on Kubernetes experience in production</li><li>Experience with payments or other distributed systems that move money</li></ul>
<h3>Nice to have</h3>
<ul><li>Kafka at scale</li><li>Terraform</li></ul>
<p>We are an equal opportunity employer and consider all applicants without regard to race, national origin or citizenship status.</p>`,
);

export const nursingJob = jobDetail(
  posting({
    id: 'job-rn',
    title: 'Registered Nurse - ICU',
    company: 'Mercy Valley Hospital',
    location: { places: [PLACES[2]!], remote: 'onsite', remoteScope: [] },
    locationText: 'Chicago, IL',
    seniority: 'unknown',
    skills: ['Patient Care', 'BLS', 'ACLS', 'Epic', 'Electronic Health Records'],
  }),
  `<p>Mercy Valley Hospital is seeking a Registered Nurse for our 24-bed ICU. You will provide patient care for critically ill adults and work closely with physicians and respiratory therapists.</p>
<p><strong>Requirements:</strong></p>
<ul><li>Active RN license in Illinois required</li><li>BLS and ACLS certification required</li><li>2+ years of ICU experience</li><li>Experience with Epic electronic health records</li></ul>
<p>This is an on-site position; remote work is not available. Must be able to work 12-hour night shifts.</p>
<p>Applicants must be authorized to work in the United States; we are unable to provide visa sponsorship.</p>`,
);

export const salesApplication: ApplicationDetail = {
  id: 'app-sales',
  status: 'saved',
  job: {
    title: 'Account Executive, Mid-Market',
    company: 'Brightwave Software',
    locationText: 'Toronto, ON · Hybrid',
    remote: 'hybrid',
    url: 'https://jobs.example.com/ae',
    source: 'lever',
    sourceName: 'Lever',
    salaryText: 'CA$90,000 - CA$110,000 per year',
    employmentType: 'full-time',
    skills: [],
    descriptionHtml: `<p>Brightwave Software sells scheduling SaaS to mid-market logistics companies. We're hiring an Account Executive to own the full sales cycle, from discovery to close.</p>
<h4>Requirements</h4>
<ul><li>3+ years of B2B SaaS sales experience</li><li>A track record of exceeding quota</li><li>Experience with Salesforce and pipeline management</li><li>Excellent negotiation skills</li><li>Valid driver's license; travel to client sites up to 25%</li></ul>
<p>Must be a Canadian citizen or permanent resident.</p>`,
  },
  notes: '',
  priority: 0,
  contacts: [],
  checklist: [],
  statusChangedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  sortOrder: 0,
  jobClosed: false,
  events: [],
  documents: [],
};

// --- profiles ----------------------------------------------------------------------------

export interface ProfileFixture {
  profile: Profile;
  skills: string[];
  resumeText: string;
}

function makeProfile(over: (p: Profile) => void, skills: string[], resumeText: string): ProfileFixture {
  const profile = emptyProfile(NOW);
  over(profile);
  profile.preferences.skills = skills;
  return { profile, skills, resumeText };
}

export const softwareProfile = makeProfile(
  (p) => {
    Object.assign(p.personal, { fullName: 'Maya Chen', email: 'maya@example.com', location: 'Austin, TX' });
    Object.assign(p.work, {
      currentTitle: 'Software Engineer',
      currentCompany: 'Brightline Health',
      yearsExperience: 6,
      workAuthorization: 'US citizen',
      requiresSponsorship: false,
      noticePeriod: '2 weeks',
      summary:
        'Backend engineer with 6 years of experience building payment and billing systems in TypeScript and Node.js. I care about reliable systems and clear documentation.',
    });
    Object.assign(p.preferences, {
      targetTitles: ['Backend Engineer', 'Software Engineer'],
      locations: ['Austin, TX'],
      remote: ['remote', 'hybrid'],
      salaryMin: 150000,
      salaryCurrency: 'USD',
      seniority: ['senior'],
    });
    p.experience = [
      {
        id: 'e1',
        title: 'Software Engineer',
        company: 'Brightline Health',
        location: 'Austin, TX',
        start: '2021-03',
        end: '',
        current: true,
        summary: '',
        highlights: [
          'Built a claims payment service in TypeScript and Node.js that processes $40M a month',
          'Led the migration of billing data to PostgreSQL with zero downtime',
          'Reduced API latency by 35% by introducing request caching',
        ],
      },
      {
        id: 'e2',
        title: 'Junior Developer',
        company: 'Cobalt Labs',
        location: 'Austin, TX',
        start: '2018-06',
        end: '2021-02',
        current: false,
        summary: '',
        highlights: [
          'Shipped React dashboards used by 200 enterprise customers',
          'Built the first automated test suite for the billing API',
        ],
      },
    ];
    p.education = [{ id: 'ed1', school: 'University of Texas at Austin', degree: 'BS', field: 'Computer Science', start: '2014', end: '2018' }];
  },
  ['TypeScript', 'Node.js', 'PostgreSQL', 'AWS', 'React'],
  `Maya Chen
Software Engineer, Brightline Health (2021 - present)
- Built a claims payment service in TypeScript, Node.js and PostgreSQL processing $40M a month
- Payments and billing APIs on AWS; distributed systems with strict consistency needs
Junior Developer, Cobalt Labs (2018 - 2021)
- React dashboards for enterprise customers`,
);

export const nursingProfile = makeProfile(
  (p) => {
    Object.assign(p.personal, { fullName: 'Daniel Okafor', location: 'Chicago, IL' });
    Object.assign(p.work, {
      currentTitle: 'Staff Nurse',
      currentCompany: 'Lakeshore Clinic',
      yearsExperience: 3,
      workAuthorization: 'F-1 OPT',
      requiresSponsorship: true,
    });
    Object.assign(p.preferences, { targetTitles: ['Registered Nurse'], locations: ['Chicago, IL'], remote: ['remote'] });
  },
  ['Patient Care', 'BLS', 'Epic', 'Medication Administration'],
  'Registered Nurse (RN), Illinois license. BLS certified. Patient care on a 30-bed medical-surgical unit; Epic charting; medication administration.',
);

export const salesProfile = makeProfile(
  (p) => {
    Object.assign(p.personal, { fullName: 'Priya Natarajan', location: 'Toronto, ON' });
    Object.assign(p.work, {
      currentTitle: 'Sales Development Representative',
      currentCompany: 'Northpeak',
      yearsExperience: 4,
      workAuthorization: 'Canadian permanent resident',
      requiresSponsorship: false,
    });
    Object.assign(p.preferences, {
      targetTitles: ['Account Executive'],
      locations: ['Toronto, ON'],
      remote: ['hybrid', 'onsite'],
      salaryMin: 100000,
      salaryCurrency: 'CAD',
    });
  },
  ['Salesforce', 'Cold Calling', 'Negotiation', 'SaaS', 'HubSpot'],
  'Sales Development Representative at Northpeak. Booked 40 qualified meetings a month for B2B SaaS account executives using Salesforce and HubSpot. Negotiation training.',
);

export function savedAnswer(id: string, question: string, answer: string, tags: string[] = []): SavedAnswer {
  return { id, question, answer, tags, updatedAt: NOW };
}

/**
 * A full résumé for the software profile, laid out the usual way: contact line, headed sections,
 * dated jobs with bullets. Some bullets are deliberately weak ("Responsible for…", "I wrote…").
 */
export const softwareResume = `Maya Chen
Austin, TX | maya@example.com | (512) 555-0134 | linkedin.com/in/mayachen

EXPERIENCE

Software Engineer, Brightline Health
Mar 2021 – Present
- Responsible for maintaining the internal admin dashboard used by support staff
- Worked on the patient onboarding flow with the design team
- Built a claims payment service in TypeScript and Node.js that processes $40M a month
- Led the migration of billing data to PostgreSQL with zero downtime

Junior Developer, Cobalt Labs
Jun 2018 – Feb 2021
- Helped build React dashboards for enterprise customers
- I wrote the first automated test suite for the billing API

EDUCATION
University of Texas at Austin, BS Computer Science, 2018

SKILLS
React, Docker, TypeScript, Node.js, PostgreSQL, AWS
`;
