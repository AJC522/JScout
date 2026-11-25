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
 * Industries to preselect for these target titles: when every title clearly points at some
 * industries, their union; otherwise (no titles, or any title that fits everywhere) all of them.
 */
export function preselectIndustries(titles: readonly string[], available: readonly string[]): string[] {
  if (titles.length === 0) return [...available];
  const picked = new Set<string>();
  for (const title of titles) {
    const hints = TITLE_HINTS.filter((hint) => hint.pattern.test(title));
    if (hints.length === 0) return [...available];
    for (const hint of hints) for (const industry of hint.industries) picked.add(industry);
  }
  const matched = available.filter((industry) => picked.has(industry));
  return matched.length > 0 ? matched : [...available];
}
