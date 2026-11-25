/**
 * Small deterministic stand-ins for lib/skills, lib/titles and lib/location, used by the profile
 * tests through vi.mock so they do not depend on the bundled reference data.
 */
import type { Place, SkillSuggestion } from '../../../shared/types';
import type { RoleRef } from '../../lib/titles';

const SKILLS: Array<[string, string[]]> = [
  ['TypeScript', ['ts']],
  ['JavaScript', ['js']],
  ['Go', ['golang']],
  ['Python', []],
  ['SQL', []],
  ['PostgreSQL', ['postgres']],
  ['Tableau', []],
  ['Excel', []],
  ['dbt', []],
  ['React', []],
  ['Node.js', ['nodejs']],
  ['AWS', []],
  ['Kubernetes', ['k8s']],
  ['Docker', []],
  ['Terraform', []],
  ['Epic', []],
  ['Patient care', []],
  ['IV therapy', []],
  ['QuickBooks', []],
  ['GAAP', []],
  ['SAP', []],
  ['Financial reporting', []],
  ['CompTIA Security+', ['Security+']],
  ['PMP', []],
];
const CASE_SENSITIVE = new Set(['Go', 'Epic', 'Excel', 'PMP']);
const CERTIFICATIONS = new Set(['CompTIA Security+', 'PMP']);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const skillsModule = {
  extractSkills(text: string, opts: { limit?: number } = {}): string[] {
    const found: Array<[number, string]> = [];
    for (const [name, aliases] of SKILLS) {
      const flags = CASE_SENSITIVE.has(name) ? '' : 'i';
      const index = Math.min(
        ...[name, ...aliases].map((n) => {
          const m = new RegExp(`(?<![\\w+#.])${escape(n)}(?![\\w+#])`, flags).exec(text);
          return m ? m.index : Number.POSITIVE_INFINITY;
        }),
      );
      if (Number.isFinite(index)) found.push([index, name]);
    }
    return found
      .sort((a, b) => a[0] - b[0])
      .map(([, name]) => name)
      .slice(0, opts.limit ?? Number.POSITIVE_INFINITY);
  },
  canonicalSkill(name: string): string | undefined {
    const n = name.trim().toLowerCase();
    return SKILLS.find(([canonical, aliases]) => canonical.toLowerCase() === n || aliases.includes(n))?.[0];
  },
  normalizeSkillList(names: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of names) {
      const name = skillsModule.canonicalSkill(raw) ?? raw.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push(name);
    }
    return out;
  },
  suggestSkills: (): SkillSuggestion[] => [],
  skillCategory: (name: string): string | undefined => (CERTIFICATIONS.has(name) ? 'certification-license' : undefined),
};

const role = (id: string, title: string, aliases: string[] = [], skills: string[] = []): RoleRef => ({
  id,
  title,
  familyId: 'f',
  family: 'Family',
  aliases,
  related: [],
  skills,
});

const ROLES: RoleRef[] = [
  role('software-engineer', 'Software Engineer', ['software developer', 'backend engineer', 'swe'], ['TypeScript', 'Go', 'Node.js']),
  role('frontend-engineer', 'Frontend Engineer', ['front-end developer'], ['React', 'TypeScript']),
  role('data-analyst', 'Data Analyst', ['reporting analyst'], ['SQL', 'Python', 'Tableau', 'Excel']),
  role('data-engineer', 'Data Engineer', [], ['SQL', 'Python', 'dbt']),
  role('registered-nurse', 'Registered Nurse', ['rn', 'staff nurse', 'charge nurse'], ['Patient care', 'Epic', 'IV therapy']),
  role('accountant', 'Accountant', ['staff accountant'], ['GAAP', 'QuickBooks', 'Excel']),
  role('bookkeeper', 'Bookkeeper', [], ['QuickBooks']),
  role('engineering-intern', 'Software Engineering Intern', ['software engineer intern', 'software engineering intern'], []),
];

const SENIORITY = /^(?:senior|sr\.?|junior|jr\.?|lead|staff|principal)\s+/i;

export const titlesModule = {
  findRole(text: string): RoleRef | undefined {
    const match = (t: string) => ROLES.find((r) => r.title.toLowerCase() === t || r.aliases.includes(t));
    const t = text.trim().toLowerCase();
    return match(t) ?? match(t.replace(SENIORITY, '').replace(/\s+(?:i{1,3}|iv)$/i, ''));
  },
  rolesForSkills(skills: string[], limit = 6): RoleRef[] {
    return ROLES.map((r) => ({ r, overlap: r.skills.filter((s) => skills.includes(s)).length }))
      .filter((x) => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, limit)
      .map((x) => x.r);
  },
};

const PLACES: Record<string, Omit<Place, 'raw' | 'label'>> = {
  'london, uk': { kind: 'city', city: 'London', country: 'GB' },
  'london, united kingdom': { kind: 'city', city: 'London', country: 'GB' },
  'toronto, canada': { kind: 'city', city: 'Toronto', country: 'CA' },
  'berlin, germany': { kind: 'city', city: 'Berlin', country: 'DE' },
  'manchester, uk': { kind: 'city', city: 'Manchester', country: 'GB' },
  'austin, texas': { kind: 'city', city: 'Austin', admin1: 'TX', country: 'US' },
};

export const locationModule = {
  resolvePlace(text: string): Place | undefined {
    const place = PLACES[text.trim().toLowerCase()];
    return place ? { ...place, raw: text, label: text } : undefined;
  },
};
