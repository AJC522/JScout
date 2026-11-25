/** Re-casing of job titles that a source writes entirely in capitals (NEOGOV agencies, many USAJOBS announcements). */

/** Words kept in capitals when a title written in capitals is re-cased. */
const ACRONYMS = new Set(
  [
    // Roman numerals
    'I II III IV V VI VII VIII IX X XI XII XIII XIV XV',
    // technology, public safety and health
    'IT IS GIS CAD RMS CJIS NCIC HR EMS EMT EMD ADA ATS CDL CPA CSI DA DNA DOT DPW DUI ERP HVAC ICU ID LAN WAN LVN LPN RN CNA MD ' +
      'PC PIO PW QA QC SQL TV UAS US USA VA WIC 911 K9 AV IV CIO CTO CFO CISO OIT DOIT ITS IOD NCMEC MSM CSA GEMS MARS OCFO DMV ' +
      'DHS DOC DPS DJJ EOC PSAP RTCC SWAT UC AI ML OS ISSO ISSM SOC NOC RMF CMMC TS SCI EEO FOIA PMP',
    // federal IT specialist specialties (OPM series 2210)
    'INFOSEC APPSW SYSADMIN DATAMGT CUSTSPT PLCYPLN ENTARCH INET SYSANALYSIS',
    // federal agencies, components and pay plans
    'DOD DOJ DOE DOI DOL EPA FBI ATF DEA ICE CBP TSA HSI USCIS FEMA CISA USCG NASA NOAA IRS SSA HHS NIH CDC FDA FAA OPM GSA SBA USDA ' +
      'USGS NPS BLM BOP USMS OIG GS WG WL WS SES NF NAF AFB ANG USAF USMC USN NAVSEA NAVAIR NIWC DISA DLA DCMA DCAA NGA NSA DIA NRO ' +
      'MWR MCCS AAFES DODEA JAG ROTC USPFO AUSA GPC GSE CSMS FMS MCX SAPR SMO MVO USP',
  ]
    .join(' ')
    .split(/\s+/),
);
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/**
 * "INFORMATION TECHNOLOGY SPECIALIST II / EMERGENCY APPOINTMENT" -> "Information Technology Specialist II / Emergency Appointment";
 * "IT SPECIALIST (APPSW/DATAMGT)" -> "IT Specialist (APPSW/DATAMGT)". Titles with any lower-case letter are returned unchanged.
 */
export function recaseTitle(title: string): string {
  if (/\p{Ll}/u.test(title) || (title.match(/\p{L}/gu)?.length ?? 0) < 4) return title;
  let first = true;
  return title.replace(/[\p{L}\p{N}][\p{L}\p{N}'’.]*/gu, (word) => {
    const isFirst = first;
    first = false;
    const bare = word.replace(/[.'’]+$/, '');
    if (ACRONYMS.has(bare) || /\d/.test(word)) return word;
    const lower = word.toLowerCase();
    if (!isFirst && SMALL_WORDS.has(lower)) return lower;
    return lower.replace(/^\p{L}/u, (c) => c.toUpperCase());
  });
}
