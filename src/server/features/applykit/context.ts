/**
 * Resolves what the apply kit works on: the job (from the index or an application's
 * snapshot) and the user's profile, normalised into plain records the pure modules use.
 */
import type {
  ApplicationDetail,
  EmploymentType,
  JobClearance,
  JobDetail,
  JobLocation,
  PastedPosting,
  Profile,
  Salary,
  Seniority,
} from '../../../shared/types';
import { badRequest, notFound } from '../../errors';
import { postingClearance } from '../../ingest/normalize';
import { htmlToText, textToHtml } from '../../lib/html';
import { parseJobLocation } from '../../lib/location';
import { extractSalaryFromText, parseSalaryText } from '../../lib/salary';
import { extractSkills } from '../../lib/skills';
import { detectSeniority } from '../../lib/titles';
import { stableHash, uniqueFolded } from '../../lib/text';
import type { ProfileService, Services } from '../../services';
import { stemmedText } from './text';

export interface JobContext {
  /** Job or application id; seeds deterministic phrasing so letters for different jobs differ. */
  key: string;
  title: string;
  company: string;
  locationText: string;
  location: JobLocation;
  salary?: Salary;
  seniority: Seniority;
  employmentType: EmploymentType;
  /** Canonical skill names, most prominent first. */
  skills: string[];
  /** Security clearance the posting asks for, when it mentions one. */
  clearance?: JobClearance;
  descriptionText: string;
}

export interface Target {
  jobId?: string;
  applicationId?: string;
}

export function hasTarget(target: Target): boolean {
  return target.jobId !== undefined || target.applicationId !== undefined;
}

/**
 * An application is preferred when both ids are given: its snapshot is what the user tracked
 * and it survives the posting being purged from the index.
 */
export function resolveJob(services: Pick<Services, 'search' | 'applications' | 'jobs'>, target: Target): JobContext {
  if (target.applicationId !== undefined) {
    const app = services.applications.get(target.applicationId);
    if (app) return fromApplication(services, app);
    if (target.jobId === undefined) throw notFound('Application');
  }
  if (target.jobId !== undefined) {
    const detail = services.search.jobDetail(target.jobId);
    if (detail) return fromJobDetail(detail);
    throw notFound('Job');
  }
  throw badRequest('jobId or applicationId is required');
}

function fromJobDetail(detail: JobDetail): JobContext {
  const { job } = detail;
  const text = htmlToText(detail.descriptionHtml) || job.snippet;
  const country = job.location.places.find((p) => p.country)?.country;
  return {
    key: job.id,
    title: job.title,
    company: job.company,
    locationText: job.locationText,
    location: job.location,
    salary: job.salary ?? extractSalaryFromText(text, { country }),
    seniority: job.seniority,
    employmentType: job.employmentType,
    skills: job.skills.length > 0 ? job.skills : extractSkills(`${job.title}\n${text}`),
    ...(job.clearance ? { clearance: job.clearance } : {}),
    descriptionText: text,
  };
}

function fromApplication(services: Pick<Services, 'jobs'>, app: ApplicationDetail): JobContext {
  const snap = app.job;
  // Manually added applications may have no description; the index can still hold it.
  const html = snap.descriptionHtml || (app.jobId ? services.jobs.getDescriptionHtml(app.jobId) : '');
  const text = htmlToText(html);
  const { location } = parseJobLocation({
    // Snapshot location text is a display string ("Austin, TX · Hybrid"); split its segments.
    locations: snap.locationText ? snap.locationText.split('·').map((s) => s.trim()) : [],
    remote: snap.remote === 'unknown' ? undefined : snap.remote,
    title: snap.title,
    descriptionText: text,
  });
  const country = location.places.find((p) => p.country)?.country;
  return {
    key: app.id,
    title: snap.title,
    company: snap.company,
    locationText: snap.locationText,
    location,
    salary: snap.salaryText ? parseSalaryText(snap.salaryText, { country }) : extractSalaryFromText(text, { country }),
    seniority: detectSeniority(snap.title, undefined, text),
    employmentType: snap.employmentType,
    skills: snap.skills.length > 0 ? snap.skills : extractSkills(`${snap.title}\n${text}`),
    ...withClearance(snap.clearance ?? postingClearance(snap.source, snap.title, [], text)),
    descriptionText: text,
  };
}

const withClearance = (clearance: JobClearance | undefined) => (clearance ? { clearance } : {});

/**
 * A posting the user pasted. Its text goes through the HTML round trip so bullets ("•", "*",
 * "1.") become the "- " list lines the requirement and keyword readers expect.
 */
export function fromPastedPosting(posting: PastedPosting): JobContext {
  const text = htmlToText(textToHtml(posting.description));
  const title = posting.title.trim();
  const { location } = parseJobLocation({ locations: [], title, descriptionText: text });
  const country = location.places.find((p) => p.country)?.country;
  return {
    key: `pasted:${stableHash(title, posting.company ?? '', text).slice(0, 16)}`,
    title,
    company: posting.company?.trim() ?? '',
    locationText: '',
    location,
    salary: extractSalaryFromText(text, { country }),
    seniority: detectSeniority(title, undefined, text),
    employmentType: 'unknown',
    skills: extractSkills(`${title}\n${text}`),
    ...withClearance(postingClearance('pasted', title, [], text)),
    descriptionText: text,
  };
}

/** A job, an application, or a pasted posting: whichever the request names (pasted text wins). */
export function resolveTarget(services: Pick<Services, 'search' | 'applications' | 'jobs'>, target: Target & { posting?: PastedPosting }): JobContext {
  return target.posting ? fromPastedPosting(target.posting) : resolveJob(services, target);
}

export interface ProfileContext {
  profile: Profile;
  /** Canonical skills: listed, found in the résumé, or named in the summary and experience. */
  skills: string[];
  resumeText: string;
  /** Stemmed text of everything the user has told us about their background. */
  corpus: string;
  /** The same as a list of stems, for proximity matching. */
  corpusStems: string[];
  /** Stemmed résumé text alone ('' when there is no résumé). */
  resumeCorpus: string;
}

export function loadProfile(profiles: ProfileService): ProfileContext {
  const profile = profiles.get();
  const resumeText = profiles.resumeText();
  const { work, preferences } = profile;
  // effectiveSkills covers the skills list and the résumé; the summary and experience
  // entries can name more. extractSkills knows which names are ambiguous ("Go", "Excel").
  const described = [work.summary, ...profile.experience.flatMap((e) => [e.title, e.summary, ...e.highlights])]
    .filter(Boolean)
    .join('\n');
  const skills = uniqueFolded([...profiles.effectiveSkills(), ...(described ? extractSkills(described) : [])]);
  const parts = [
    resumeText,
    work.summary,
    work.currentTitle,
    ...preferences.targetTitles,
    ...skills,
    ...profile.experience.flatMap((e) => [e.title, e.summary, ...e.highlights]),
    ...profile.education.flatMap((e) => [e.degree, e.field]),
  ];
  const corpus = stemmedText(parts.filter(Boolean).join('\n'));
  return {
    profile,
    skills,
    resumeText,
    corpus,
    corpusStems: corpus.trim().split(' '),
    resumeCorpus: resumeText ? stemmedText(resumeText) : '',
  };
}
