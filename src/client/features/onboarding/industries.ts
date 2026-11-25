/** Industry labels for the company registry and a light guess at which industries fit a job search. */

const LABELS: Record<string, string> = {
  ai: 'AI',
  'biotech-pharma': 'Biotech and pharma',
  'climate-energy': 'Climate and energy',
  consumer: 'Consumer apps',
  'developer-tools': 'Developer tools',
  'ecommerce-retail': 'E-commerce and retail',
  education: 'Education',
  'enterprise-software': 'Business software',
  fintech: 'Finance and fintech',
  gaming: 'Gaming',
  government: 'Government and public safety',
  'govtech-defense': 'Govtech, defense and public-safety tech',
  'hardware-robotics': 'Hardware and robotics',
  healthcare: 'Healthcare',
  'logistics-mobility': 'Logistics and mobility',
  'media-entertainment': 'Media and entertainment',
  'nonprofit-research': 'Non-profit and research',
  'real-estate': 'Real estate',
  security: 'Security',
  'travel-hospitality': 'Travel and hospitality',
  other: 'Other',
};

export function industryLabel(value: string): string {
  const known = LABELS[value];
  if (known) return known;
  const words = value.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other';
}

/**
 * Titles that clearly point at particular industries. Titles not listed here (software engineer,
 * product manager, designer, analyst…) fit companies in every industry.
 */
const TITLE_HINTS: Array<{ pattern: RegExp; industries: string[] }> = [
  { pattern: /\b(nurse|nursing|physician|doctor|clinic(al|ian)?|medical|therap(ist|y)|pharmacist|dental|healthcare|caregiver)\b/i, industries: ['healthcare', 'biotech-pharma'] },
  { pattern: /\b(biolog\w*|chemist\w*|scientist|laboratory|lab tech\w*|pharma\w*|bioinformatic\w*|clinical research)\b/i, industries: ['biotech-pharma', 'healthcare', 'nonprofit-research'] },
  { pattern: /\b(teacher|tutor|instructor|curriculum|lecturer|professor|instructional)\b/i, industries: ['education'] },
  { pattern: /\b(game|gameplay|level designer|unreal|unity developer)\b/i, industries: ['gaming'] },
  { pattern: /\b(security|penetration|pentest\w*|soc analyst|threat|appsec|infosec)\b/i, industries: ['security'] },
  {
    pattern:
      /\b(police|sheriff|deputy|law enforcement|crime|criminal\w*|forensic\w*|investigat\w*|detective|trooper|corrections?|probation|parole|dispatch\w*|911|public safety|emergency management|government|public sector|public service|federal|municipal|civic|gs-?\d+|it specialist|infosec)\b/i,
    industries: ['government', 'govtech-defense'],
  },
  { pattern: /\b(clearance|cleared|intelligence analyst|intelligence officer|defen[cs]e|military|homeland|national security|ts\/sci)\b/i, industries: ['govtech-defense', 'government'] },
  { pattern: /\b(quant|underwrit\w*|actuar\w*|trader|trading|payments?|banking|credit risk)\b/i, industries: ['fintech'] },
  { pattern: /\b(robotics?|embedded|firmware|hardware|mechanical|electrical|manufacturing)\b/i, industries: ['hardware-robotics'] },
  { pattern: /\b(energy|solar|climate|sustainab\w*|battery|grid)\b/i, industries: ['climate-energy'] },
  { pattern: /\b(real estate|property|leasing|mortgage)\b/i, industries: ['real-estate'] },
  { pattern: /\b(hotel|hospitality|travel|chef|restaurant)\b/i, industries: ['travel-hospitality'] },
  { pattern: /\b(logistics|supply chain|warehouse|fleet|dispatch\w*|freight)\b/i, industries: ['logistics-mobility'] },
  { pattern: /\b(journalis\w*|reporter|editor|video|producer|animator|broadcast\w*)\b/i, industries: ['media-entertainment'] },
  { pattern: /\b(merchandis\w*|retail|store manager|buyer)\b/i, industries: ['ecommerce-retail'] },
  { pattern: /\b(grant|fundrais\w*|nonprofit|non-profit|policy)\b/i, industries: ['nonprofit-research'] },
];

/**
 * Industries to preselect for these target titles: those the titles clearly point at, and none
 * otherwise. Following every bundled company means a first sync of roughly half a gigabyte, so the
 * user opts in to industries rather than out of them.
 */
export function preselectIndustries(titles: readonly string[], available: readonly string[]): string[] {
  const picked = new Set<string>();
  for (const title of titles) {
    for (const hint of TITLE_HINTS) if (hint.pattern.test(title)) for (const industry of hint.industries) picked.add(industry);
  }
  return available.filter((industry) => picked.has(industry));
}

/** Averages over the bundled company list, measured on a real sync: open jobs and download size per company. */
const JOBS_PER_COMPANY = 78;
const MB_PER_COMPANY = 1.1;

/** "about 2,300 jobs, 30 MB to download": what following this many companies costs the first sync. */
export function downloadEstimate(companies: number): string {
  const jobs = Math.max(100, Math.round((companies * JOBS_PER_COMPANY) / 100) * 100);
  const mb = companies * MB_PER_COMPANY;
  const size = mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.max(10, Math.round(mb / 10) * 10)} MB`;
  return `about ${jobs.toLocaleString('en-US')} jobs, ${size} to download`;
}

/** "about 500" for a large registry, the exact number for a small one, "hundreds of" while unknown. */
export function aboutCount(total: number | undefined): string {
  if (total === undefined) return 'hundreds of';
  if (total < 100) return String(total);
  return `about ${Math.round(total / 50) * 50}`;
}
