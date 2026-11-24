#!/usr/bin/env node
/*
 * build-gazetteer.mjs — generates src/server/data/gazetteer.json, the offline
 * gazetteer used to parse job location strings and to do radius filtering.
 *
 * Source packages (exact versions this file was generated with; data derived
 * from GeoNames, https://www.geonames.org/, licensed CC BY 4.0 — attribution
 * required, keep this notice wherever the JSON is shipped):
 *   - i18n-cities@1.2.0             code MIT; data GeoNames (CC BY 4.0).
 *       Main city list (dist/cities-1000-*.js: id, name, lat, lon, country,
 *       admin1, population; a 2026 GeoNames snapshot without PPLX
 *       neighbourhood rows) and the GeoNames country names.
 *   - cities-15000-structured@1.0.1 code MIT; data GeoNames cities15000 (CC BY 4.0).
 *       Raw GeoNames TSV (2023-03 snapshot): ASCII names and feature codes,
 *       used to flag national capitals (PPLC/PPLG) and to add the few tiny
 *       capitals that are missing from the i18n-cities list.
 *   - cities.json@1.1.66            licence CC-BY-4.0 (GeoNames admin1CodesASCII).
 *       admin1.json: first-level division names keyed "CC.code".
 *   - countries-list@3.4.1          MIT. Country English/native names, continent.
 *   - i18n-iso-countries@7.14.0     MIT. ISO alpha-3 codes and English name variants.
 * Hand-written tables in this file (aliases, abbreviations, region membership)
 * are project-authored.
 *
 * Re-run:
 *   mkdir -p /tmp/gaz && cd /tmp/gaz && npm init -y >/dev/null && \
 *     npm install i18n-cities@1.2.0 cities-15000-structured@1.0.1 \
 *       cities.json@1.1.66 countries-list@3.4.1 i18n-iso-countries@7.14.0
 *   node /path/to/JScout/scripts/build-gazetteer.mjs [srcDir] [outFile]
 *     srcDir  = directory containing node_modules with the packages above
 *               (default: current working directory)
 *     outFile = default <repo>/src/server/data/gazetteer.json
 * The output is deterministic for the same package versions. The script fails
 * loudly if an alias or abbreviation table entry no longer resolves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const srcDir = path.resolve(process.argv[2] || process.cwd());
const outFile = path.resolve(
  process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server', 'data', 'gazetteer.json'),
);
const nm = path.join(srcDir, 'node_modules');
const require = createRequire(path.join(srcDir, 'noop.js'));

const EXPECTED = {
  'i18n-cities': '1.2.0',
  'cities-15000-structured': '1.0.1',
  'cities.json': '1.1.66',
  'countries-list': '3.4.1',
  'i18n-iso-countries': '7.14.0',
};
for (const [pkg, ver] of Object.entries(EXPECTED)) {
  const v = JSON.parse(fs.readFileSync(path.join(nm, pkg, 'package.json'), 'utf8')).version;
  if (v !== ver) console.warn(`warning: ${pkg}@${v} installed, header documents ${ver}; output may differ`);
}

// ---------------------------------------------------------------- sources
const i18nDist = path.join(nm, 'i18n-cities', 'dist');
const i18nFile = fs.readdirSync(i18nDist).filter((f) => /^cities-1000-.*\.js$/.test(f)).sort()[0];
if (!i18nFile) throw new Error('i18n-cities cities-1000 data file not found');
const I = await import(pathToFileURL(path.join(i18nDist, i18nFile)).href);
const tsv = fs
  .readFileSync(path.join(nm, 'cities-15000-structured', 'dist', 'cities15000.txt'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('\t'));
const admin1Src = require('cities.json/admin1.json');
const { countries: CL } = require('countries-list');
const isoCountries = require('i18n-iso-countries');

// ---------------------------------------------------------------- helpers
const FOLD = { 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th', 'ł': 'l', 'Ł': 'L', 'ı': 'i', 'œ': 'oe', 'Œ': 'OE', 'ħ': 'h', 'Ħ': 'H', 'ə': 'a', 'Ə': 'A', 'ŧ': 't', 'ʻ': "'", 'ʼ': "'", '’': "'", '‘': "'", 'ʿ': "'", 'ʾ': "'", '′': "'", '–': '-', '—': '-' };
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7f]/g, (c) => FOLD[c] ?? '').replace(/\s+/g, ' ').trim();
const key = (s) => fold(s).toLowerCase();
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const uniqCI = (arr, exclude = []) => {
  const seen = new Set(exclude.map((s) => s.toLowerCase()));
  const out = [];
  for (const s of arr) {
    const t = s.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
};

// ---------------------------------------------------------------- cities
const tsvById = new Map(tsv.map((r) => [Number(r[0]), r]));
const capitalIds = new Set(tsv.filter((r) => r[7] === 'PPLC' || r[7] === 'PPLG').map((r) => Number(r[0])));
const OBSOLETE = new Set(['CS', 'AN']);
const picked = new Map(); // geonameid -> [id, name, ascii, admin1, cc, lat, lon, pop]
for (const [id, name, lat, lon, cc, a1, pop] of I.cities) {
  if (OBSOLETE.has(cc)) continue;
  if (pop >= 15000 || capitalIds.has(id)) {
    const t = tsvById.get(id);
    const ascii = t && t[1] === name && t[2] ? t[2] : fold(name);
    picked.set(id, [id, name, ascii, a1 || '', cc, r4(lat), r4(lon), pop]);
  }
}
for (const id of [...capitalIds].sort((a, b) => a - b)) {
  if (picked.has(id)) continue;
  const t = tsvById.get(id); // capitals absent from the i18n-cities >=1000 list (tiny territories, Vatican City, ...)
  picked.set(id, [id, t[1], t[2] || fold(t[1]), t[10] || '', t[8], r4(+t[4]), r4(+t[5]), Number(t[14]) || 0]);
}
const cityRows = [...picked.values()].sort((a, b) => b[7] - a[7] || a[0] - b[0]);
for (const r of cityRows) if (/[^\x20-\x7e]/.test(r[2])) r[2] = fold(r[2]);

// ---------------------------------------------------------------- countries
const EU27 = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ');
const CONTINENT_OVERRIDE = { RU: 'EU' }; // countries-list 3.4.1 files RU under AS; GeoNames uses EU
const MIDDLE_EAST = 'AE BH CY EG IL IQ IR JO KW LB OM PS QA SA SY TR YE'.split(' ');
const EMEA_FROM_ASIA = [...MIDDLE_EAST, 'AM', 'AZ', 'GE', 'KZ', 'KG', 'TJ', 'TM', 'UZ'];
const ANTARCTIC_REGION = { AQ: 'APAC', HM: 'APAC', BV: 'EMEA', TF: 'EMEA', GS: 'AMER' };
const COUNTRY_NAME_OVERRIDE = { US: 'United States', GB: 'United Kingdom' };
const COUNTRY_EXTRA = {
  US: ['USA', 'U.S.', 'U.S.A.', 'United States of America', 'America', 'the US', 'the USA', 'the United States'],
  GB: ['UK', 'U.K.', 'Great Britain', 'Britain', 'United Kingdom of Great Britain and Northern Ireland', 'the UK'],
  AE: ['UAE', 'U.A.E.', 'Emirates', 'the UAE'],
  KR: ['South Korea', 'Korea', 'Republic of Korea', 'Korea, Republic of'],
  KP: ['North Korea', "Democratic People's Republic of Korea"],
  CZ: ['Czechia', 'Czech Republic', 'Česko', 'Cesko', 'Česká republika'],
  NL: ['Holland', 'The Netherlands', 'Netherlands', 'Nederland'],
  DE: ['Deutschland'],
  ES: ['España', 'Espana'],
  BR: ['Brasil'],
  MX: ['México'],
  IT: ['Italia'],
  AT: ['Österreich', 'Oesterreich', 'Osterreich'],
  CH: ['Schweiz', 'Suisse', 'Svizzera', 'Swiss Confederation'],
  BE: ['België', 'Belgie', 'Belgique', 'Belgien'],
  PL: ['Polska'],
  SE: ['Sverige'],
  NO: ['Norge'],
  DK: ['Danmark'],
  FI: ['Suomi'],
  HU: ['Magyarország', 'Magyarorszag'],
  RO: ['România'],
  HR: ['Hrvatska'],
  GR: ['Hellas', 'Ellada'],
  TR: ['Turkey', 'Türkiye', 'Turkiye'],
  RU: ['Russian Federation'],
  CN: ['PRC', "People's Republic of China", 'Mainland China'],
  TW: ['Republic of China', 'Chinese Taipei'],
  HK: ['Hong Kong SAR', 'Hong Kong S.A.R.'],
  MO: ['Macau', 'Macao SAR', 'Macau SAR'],
  IE: ['Republic of Ireland', 'Éire', 'Eire'],
  IN: ['Bharat'],
  VN: ['Viet Nam'],
  LA: ['Lao PDR', "Lao People's Democratic Republic"],
  MM: ['Burma'],
  CI: ['Ivory Coast', "Côte d'Ivoire", "Cote d'Ivoire"],
  CV: ['Cape Verde', 'Cabo Verde'],
  SZ: ['Swaziland', 'Eswatini'],
  MK: ['Macedonia', 'North Macedonia'],
  TL: ['East Timor', 'Timor-Leste'],
  PS: ['Palestine', 'State of Palestine', 'Palestinian Territories'],
  VA: ['Holy See', 'Vatican City', 'Vatican'],
  CD: ['DRC', 'DR Congo', 'Congo-Kinshasa', 'Democratic Republic of the Congo'],
  CG: ['Congo-Brazzaville', 'Republic of the Congo'],
  SA: ['KSA', 'Kingdom of Saudi Arabia'],
  NZ: ['Aotearoa'],
  BA: ['Bosnia', 'Bosnia-Herzegovina'],
  PH: ['The Philippines'],
  BS: ['The Bahamas'],
  GM: ['The Gambia'],
  FM: ['Micronesia', 'Federated States of Micronesia'],
  BN: ['Brunei Darussalam'],
  SY: ['Syrian Arab Republic'],
  TZ: ['United Republic of Tanzania'],
  BO: ['Plurinational State of Bolivia'],
  VE: ['Bolivarian Republic of Venezuela'],
  MD: ['Republic of Moldova'],
};
const isLatin = (s) => /^[\p{Script=Latin}\s\-'’.,()]+$/u.test(s);
const enAll = isoCountries.getNames('en', { select: 'all' });
const codes = Object.keys(I.countries).filter((c) => !OBSOLETE.has(c)).sort();
const autoAliases = new Map();
const aliasCount = new Map();
for (const cc of codes) {
  const cl = CL[cc] || {};
  const set = uniqCI([I.countries[cc], cl.name || '', ...(cl.alias || []), ...(cl.native && isLatin(cl.native) ? [cl.native] : []), ...(enAll[cc] || [])]).filter((a) => a !== cc && !/\((Kingdom of the|the)\)$/.test(a));
  autoAliases.set(cc, set);
  for (const a of set) aliasCount.set(a.toLowerCase(), (aliasCount.get(a.toLowerCase()) || 0) + 1);
}
const manualOwner = new Map();
for (const [cc, list] of Object.entries(COUNTRY_EXTRA)) for (const a of list) manualOwner.set(a.toLowerCase(), cc);
const countries = codes.map((cc) => {
  const cl = CL[cc];
  if (!cl) throw new Error(`countries-list has no entry for ${cc}`);
  const name = COUNTRY_NAME_OVERRIDE[cc] || cl.name;
  const continent = CONTINENT_OVERRIDE[cc] || cl.continent;
  const region = ANTARCTIC_REGION[cc] || (continent === 'NA' || continent === 'SA' ? 'AMER' : continent === 'EU' || continent === 'AF' || EMEA_FROM_ASIA.includes(cc) ? 'EMEA' : 'APAC');
  const auto = autoAliases.get(cc).filter((a) => {
    const owner = manualOwner.get(a.toLowerCase());
    if (owner) return owner === cc;
    return aliasCount.get(a.toLowerCase()) === 1;
  });
  const a3 = isoCountries.alpha2ToAlpha3(cc);
  const aliases = uniqCI([...(COUNTRY_EXTRA[cc] || []), ...auto, ...(a3 ? [a3] : [])], [name, cc]);
  return { code: cc, name, aliases, continent, region };
});
const countryByCode = new Map(countries.map((c) => [c.code, c]));
{ // no alias may name two countries, nor another country's name
  const owner = new Map();
  for (const c of countries) for (const a of [c.name, ...c.aliases]) {
    const k = a.toLowerCase();
    if (owner.has(k) && owner.get(k) !== c.code) throw new Error(`country alias "${a}" claimed by ${owner.get(k)} and ${c.code}`);
    owner.set(k, c.code);
  }
}

// ---------------------------------------------------------------- admin1
// Abbreviation tables, keyed by the GeoNames admin1 *name* (resolved to the
// GeoNames code at build time, so a renamed division fails the build).
const A1 = {
  US: {
    Alabama: ['Ala.'], Alaska: [], Arizona: ['Ariz.'], Arkansas: ['Ark.'], California: ['Calif.', 'Cal.'], Colorado: ['Colo.'],
    Connecticut: ['Conn.'], Delaware: ['Del.'], 'District of Columbia': ['D.C.', 'Washington DC', 'Washington D.C.', 'Washington, D.C.'],
    Florida: ['Fla.'], Georgia: ['Ga.'], Hawaii: ["Hawai'i"], Idaho: [], Illinois: ['Ill.'], Indiana: ['Ind.'], Iowa: [],
    Kansas: ['Kan.', 'Kans.'], Kentucky: ['Ky.'], Louisiana: ['La.'], Maine: [], Maryland: ['Md.'], Massachusetts: ['Mass.'],
    Michigan: ['Mich.'], Minnesota: ['Minn.'], Mississippi: ['Miss.'], Missouri: ['Mo.'], Montana: ['Mont.'], Nebraska: ['Neb.', 'Nebr.'],
    Nevada: ['Nev.'], 'New Hampshire': ['N.H.'], 'New Jersey': ['N.J.'], 'New Mexico': ['N.M.', 'N.Mex.'], 'New York': ['N.Y.', 'New York State'],
    'North Carolina': ['N.C.'], 'North Dakota': ['N.D.', 'N.Dak.'], Ohio: [], Oklahoma: ['Okla.'], Oregon: ['Ore.', 'Oreg.'],
    Pennsylvania: ['Pa.', 'Penn.', 'Penna.'], 'Rhode Island': ['R.I.'], 'South Carolina': ['S.C.'], 'South Dakota': ['S.D.', 'S.Dak.'],
    Tennessee: ['Tenn.'], Texas: ['Tex.'], Utah: [], Vermont: ['Vt.'], Virginia: ['Va.'], Washington: ['Wash.', 'Washington State'],
    'West Virginia': ['W.Va.', 'W. Va.'], Wisconsin: ['Wis.', 'Wisc.'], Wyoming: ['Wyo.'],
  },
  CA: {
    Alberta: ['AB', 'Alta.'], 'British Columbia': ['BC', 'B.C.'], Manitoba: ['MB', 'Man.'], 'New Brunswick': ['NB', 'N.B.'],
    'Newfoundland and Labrador': ['NL', 'Newfoundland', 'Nfld.', 'NF'], 'Nova Scotia': ['NS', 'N.S.'], Ontario: ['ON', 'Ont.'],
    'Prince Edward Island': ['PE', 'PEI', 'P.E.I.'], Quebec: ['QC', 'Québec', 'Que.', 'PQ'], Saskatchewan: ['SK', 'Sask.'],
    Yukon: ['YT', 'Yukon Territory'], 'Northwest Territories': ['NT', 'NWT', 'N.W.T.'], Nunavut: ['NU'],
  },
  AU: {
    'Australian Capital Territory': ['ACT', 'A.C.T.'], 'New South Wales': ['NSW', 'N.S.W.'], 'Northern Territory': ['NT', 'N.T.'],
    Queensland: ['QLD', 'Qld', 'Qld.'], 'South Australia': ['SA', 'S.A.'], Tasmania: ['TAS', 'Tas.'], Victoria: ['VIC', 'Vic.'],
    'Western Australia': ['WA', 'W.A.'],
  },
  GB: { England: ['ENG'], Scotland: ['SCT'], Wales: ['WLS', 'Cymru'], 'Northern Ireland': ['NIR', 'NI', 'N. Ireland'] },
  DE: {
    'Baden-Wurttemberg': ['Baden-Württemberg', 'Baden-Wuerttemberg', 'BW'], Bavaria: ['Bayern', 'BY'], Bremen: ['Freie Hansestadt Bremen', 'HB'],
    Hamburg: ['Freie und Hansestadt Hamburg', 'HH'], Hesse: ['Hessen', 'HE'], 'Lower Saxony': ['Niedersachsen', 'NI'],
    'North Rhine-Westphalia': ['Nordrhein-Westfalen', 'NRW', 'NW'], 'Rheinland-Pfalz': ['Rhineland-Palatinate', 'RP'], Saarland: ['SL'],
    'Schleswig-Holstein': ['SH'], Brandenburg: ['BB'], 'Mecklenburg-Vorpommern': ['Mecklenburg-Western Pomerania', 'MV'],
    Saxony: ['Sachsen', 'SN'], 'Saxony-Anhalt': ['Sachsen-Anhalt', 'ST'], Thuringia: ['Thüringen', 'Thueringen', 'TH'], 'State of Berlin': ['Berlin', 'BE'],
  },
  IN: {
    'Andaman and Nicobar': ['Andaman and Nicobar Islands', 'AN'], 'Andhra Pradesh': ['AP'], Assam: ['AS'], Chandigarh: ['CH'],
    Delhi: ['DL', 'NCT of Delhi', 'National Capital Territory of Delhi'], Gujarat: ['GJ'], Haryana: ['HR'], 'Himachal Pradesh': ['HP'],
    'Jammu and Kashmir': ['JK', 'J&K'], Kerala: ['KL'], Lakshadweep: ['LD'], Maharashtra: ['MH'], Manipur: ['MN'], Meghalaya: ['ML'],
    Karnataka: ['KA'], Nagaland: ['NL'], Odisha: ['OD', 'Orissa'], Puducherry: ['PY', 'Pondicherry'], Punjab: ['PB'], Rajasthan: ['RJ'],
    'Tamil Nadu': ['TN'], Tripura: ['TR'], 'West Bengal': ['WB'], Sikkim: ['SK'], 'Arunachal Pradesh': ['AR'], Mizoram: ['MZ'], Goa: ['GA'],
    Bihar: ['BR'], 'Madhya Pradesh': ['MP'], 'Uttar Pradesh': ['UP'], Chhattisgarh: ['CT', 'CG'], Jharkhand: ['JH'], Uttarakhand: ['UT', 'Uttaranchal'],
    Telangana: ['TG', 'TS'], Ladakh: ['LA'], 'Dadra and Nagar Haveli and Daman and Diu': ['DH', 'DNHDD'],
  },
  BR: {
    Acre: ['AC'], Alagoas: ['AL'], 'Amapá': ['AP', 'Amapa'], Amazonas: ['AM'], Bahia: ['BA'], 'Ceará': ['CE', 'Ceara'],
    'Federal District': ['DF', 'Distrito Federal'], 'Espírito Santo': ['ES', 'Espirito Santo'], 'Mato Grosso do Sul': ['MS'], 'Maranhão': ['MA', 'Maranhao'],
    'Mato Grosso': ['MT'], 'Minas Gerais': ['MG'], 'Pará': ['PA', 'Para'], 'Paraíba': ['PB', 'Paraiba'], 'Paraná': ['PR', 'Parana'], 'Piauí': ['PI', 'Piaui'],
    'Rio de Janeiro': ['RJ'], 'Rio Grande do Norte': ['RN'], 'Rio Grande do Sul': ['RS'], 'Rondônia': ['RO', 'Rondonia'], Roraima: ['RR'],
    'Santa Catarina': ['SC'], 'São Paulo': ['SP', 'Sao Paulo'], Sergipe: ['SE'], 'Goiás': ['GO', 'Goias'], Pernambuco: ['PE'], Tocantins: ['TO'],
  },
  MX: {
    Aguascalientes: ['AGU', 'Ags.'], 'Baja California': ['BCN', 'B.C.'], 'Baja California Sur': ['BCS', 'B.C.S.'], Campeche: ['CAM', 'Camp.'],
    Chiapas: ['CHP', 'Chis.'], Chihuahua: ['CHH', 'Chih.'], Coahuila: ['COA', 'Coah.', 'Coahuila de Zaragoza'], Colima: ['COL', 'Col.'],
    'Mexico City': ['CMX', 'CDMX', 'Ciudad de México', 'Ciudad de Mexico', 'Distrito Federal', 'D.F.'], Durango: ['DUR', 'Dgo.'],
    Guanajuato: ['GUA', 'Gto.'], Guerrero: ['GRO', 'Gro.'], Hidalgo: ['HID', 'Hgo.'], Jalisco: ['JAL', 'Jal.'],
    'México': ['MEX', 'Estado de México', 'Estado de Mexico', 'State of Mexico', 'Edomex', 'Méx.'], 'Michoacán': ['MIC', 'Michoacan', 'Michoacán de Ocampo', 'Mich.'],
    Morelos: ['MOR', 'Mor.'], Nayarit: ['NAY', 'Nay.'], 'Nuevo León': ['NLE', 'Nuevo Leon', 'N.L.'], Oaxaca: ['OAX', 'Oax.'], Puebla: ['PUE', 'Pue.'],
    'Querétaro': ['QUE', 'Queretaro', 'Qro.'], 'Quintana Roo': ['ROO', 'Q. Roo', 'Q.R.'], 'San Luis Potosí': ['SLP', 'San Luis Potosi', 'S.L.P.'],
    Sinaloa: ['SIN', 'Sin.'], Sonora: ['SON', 'Son.'], Tabasco: ['TAB', 'Tab.'], Tamaulipas: ['TAM', 'Tamps.'], Tlaxcala: ['TLA', 'Tlax.'],
    Veracruz: ['VER', 'Ver.', 'Veracruz de Ignacio de la Llave'], 'Yucatán': ['YUC', 'Yucatan', 'Yuc.'], Zacatecas: ['ZAC', 'Zac.'],
  },
};
// US territories: GeoNames files these as their own countries (city rows use
// countryCode PR/GU/VI/AS/MP), so these US admin1 rows are for parsing
// strings like "San Juan, PR" and are not referenced by any US city row.
const US_TERRITORIES = [
  { code: 'PR', name: 'Puerto Rico', aliases: ['P.R.'] },
  { code: 'GU', name: 'Guam', aliases: [] },
  { code: 'VI', name: 'U.S. Virgin Islands', aliases: ['US Virgin Islands', 'USVI', 'Virgin Islands', 'V.I.'] },
  { code: 'AS', name: 'American Samoa', aliases: [] },
  { code: 'MP', name: 'Northern Mariana Islands', aliases: ['CNMI', 'Northern Marianas'] },
];
const FULL_ADMIN1 = Object.keys(A1);
const usedA1 = new Set(cityRows.filter((r) => r[3]).map((r) => `${r[4]}.${r[3]}`));
const admin1 = [];
const errors = [];
for (const { code, name } of admin1Src) {
  const [cc, ...rest] = code.split('.');
  const sub = rest.join('.');
  if (OBSOLETE.has(cc) || !countryByCode.has(cc)) continue;
  if (!FULL_ADMIN1.includes(cc) && !usedA1.has(code)) continue;
  const extra = A1[cc]?.[name] || [];
  const aliases = uniqCI([...(fold(name) !== name ? [fold(name)] : []), ...extra], [name, ...(cc === 'US' ? [] : [sub])]);
  admin1.push({ country: cc, code: sub, name, aliases });
}
for (const [cc, table] of Object.entries(A1)) for (const n of Object.keys(table)) if (!admin1.some((a) => a.country === cc && a.name === n)) errors.push(`admin1 table: no ${cc} division named "${n}"`);
for (const t of US_TERRITORIES) admin1.push({ country: 'US', ...t });
admin1.sort((a, b) => (a.country < b.country ? -1 : a.country > b.country ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

// ---------------------------------------------------------------- city aliases
// "alias1, alias2 > City | CC [| admin1 code or name]"  (City matches name or asciiName)
const ALIAS_SPEC = `
nyc, n.y.c., new york, new york ny, nyc metro, ny metro, new york metro, new york metropolitan area, greater new york, tri-state area, tristate area, tri-state, silicon alley, nueva york > New York City | US
manhattan ny, midtown manhattan, lower manhattan, midtown, downtown manhattan > Manhattan | US | NY
bronx > The Bronx | US
long island city > Queens | US | NY
sf, s.f., san fran, bay area, the bay area, sf bay area, s.f. bay area, san francisco bay area, sf bay, greater san francisco > San Francisco | US
silicon valley > San Jose | US | CA
east bay > Oakland | US | CA
la, l.a., greater los angeles, greater la, los angeles metro, dtla > Los Angeles | US
silicon beach > Santa Monica | US | CA
inland empire > Riverside | US | CA
dc, d.c., washington dc, washington d.c., dmv, dc metro, dc metro area, d.c. metro, greater washington, washington metropolitan area > Washington | US | DC
northern virginia, nova > Arlington | US | VA
philly, greater philadelphia > Philadelphia | US
vegas, las vegas valley > Las Vegas | US
nola > New Orleans | US
slc, salt lake > Salt Lake City | US
silicon slopes > Lehi | US | UT
atl, metro atlanta, greater atlanta > Atlanta | US
kc, kansas city metro > Kansas City | US | MO
chitown, chi-town, chicagoland, greater chicago > Chicago | US
dfw, dallas-fort worth, dallas/fort worth, dallas fort worth, dallas-ft. worth, dallas metroplex, the metroplex > Dallas | US
twin cities, minneapolis-st. paul, minneapolis-saint paul, minneapolis/st. paul > Minneapolis | US
st paul, st. paul > Saint Paul | US | MN
research triangle, research triangle park, rtp, the triangle, raleigh-durham, raleigh/durham, rdu > Raleigh | US
greater boston, boston metro, metro boston > Boston | US
greater seattle, seattle metro, puget sound > Seattle | US
pdx > Portland | US | OR
atx, greater austin, silicon hills > Austin | US | TX
htx, greater houston > Houston | US
phx, greater phoenix, valley of the sun > Phoenix | US
greater denver, denver metro > Denver | US
metro detroit, greater detroit > Detroit | US
greater miami, south florida, miami-dade > Miami | US
tampa bay > Tampa | US
greater orlando > Orlando | US
greater sacramento > Sacramento | US
hampton roads > Virginia Beach | US
north jersey > Newark | US | NJ
okc > Oklahoma City | US
abq > Albuquerque | US
jax > Jacksonville | US | FL
stl, st louis, saint louis, greater st. louis > St. Louis | US
pgh > Pittsburgh | US
clt > Charlotte | US | NC
cbus > Columbus | US | OH
indy > Indianapolis | US
cincy, greater cincinnati > Cincinnati | US
greater cleveland > Cleveland | US | OH
greater milwaukee > Milwaukee | US
gta, greater toronto area, greater toronto, toronto area > Toronto | CA
greater vancouver, metro vancouver, lower mainland > Vancouver | CA
greater montreal, grand montréal, grand montreal > Montréal | CA
quebec city, québec city, ville de québec > Québec | CA
ottawa-gatineau > Ottawa | CA
kitchener-waterloo, kw region, waterloo region > Kitchener | CA
greater london, ldn, london uk, central london, canary wharf, shoreditch, londres > London | GB
greater manchester > Manchester | GB
brum, west midlands > Birmingham | GB
greater glasgow > Glasgow | GB
hull > Kingston upon Hull | GB
londonderry > Derry | GB
greater dublin, dublin city > Dublin | IE
münchen, munchen, muenchen, múnich, munich area > Munich | DE
cologne, köln, koln, koeln, colonia > Köln | DE
nürnberg, nurnberg, nuernberg > Nuremberg | DE
frankfurt, frankfurt am main, frankfurt/main, frankfurt a.m., frankfurt (main), rhein-main, rhine-main, frankfurt rhine-main > Frankfurt am Main | DE
hanover > Hannover | DE
duesseldorf > Düsseldorf | DE
ruhr, ruhrgebiet, ruhr area > Essen | DE
wien, viena, vienne > Vienna | AT
zürich, zuerich, greater zurich, zurich area > Zürich | CH
genève, geneve, genf, ginebra > Geneva | CH
bâle > Basel | CH
berne > Bern | CH
praha, prag, praga > Prague | CZ
lisboa, lissabon > Lisbon | PT
oporto > Porto | PT
warszawa, warschau > Warsaw | PL
cracow > Kraków | PL
tricity, trójmiasto, trojmiasto > Gdańsk | PL
københavn, kobenhavn, koebenhavn, kopenhagen, copenhague, greater copenhagen > Copenhagen | DK
roma > Rome | IT
milano, mailand, milán > Milan | IT
napoli, neapel > Naples | IT
torino > Turin | IT
firenze, florenz > Florence | IT
venezia, venedig > Venice | IT
genova > Genoa | IT
bruxelles, brussel, brüssel, bruselas, brussels-capital > Brussels | BE
antwerpen, anvers > Antwerp | BE
ghent, gand > Gent | BE
den haag, 's-gravenhage, s-gravenhage > The Hague | NL
göteborg, goteborg > Gothenburg | SE
greater stockholm, stockholm area, estocolmo > Stockholm | SE
helsingfors, greater helsinki, helsinki metropolitan area > Helsinki | FI
athina, athína, atenas > Athens | GR
moskva, moscú, moskau > Moscow | RU
st petersburg, st. petersburg, sankt-peterburg, saint-petersburg > Saint Petersburg | RU
bucurești, bucuresti > Bucharest | RO
beograd > Belgrade | RS
sofiya > Sofia | BG
kiev > Kyiv | UA
kharkov > Kharkiv | UA
odessa > Odesa | UA
lvov, lwów, lwow, lemberg > Lviv | UA
dnipropetrovsk > Dnipro | UA
donostia, san sebastian, san sebastián > Donostia / San Sebastián | ES
bilbo > Bilbao | ES
saragossa > Zaragoza | ES
luxembourg city, luxemburg > Luxembourg | LU
lefkosia > Nicosia | CY
lemesos > Limassol | CY
tel aviv-yafo, tel-aviv, tel aviv-jaffa, tlv, gush dan, greater tel aviv > Tel Aviv | IL
joburg, jo'burg, jozi, jhb > Johannesburg | ZA
greater cairo > Cairo | EG
bangalore, blr > Bengaluru | IN
bombay, navi mumbai, greater mumbai, mumbai metropolitan region > Mumbai | IN
madras > Chennai | IN
calcutta > Kolkata | IN
delhi ncr, ncr delhi, delhi/ncr > Delhi | IN
gurgaon > Gurugram | IN
poona > Pune | IN
trivandrum > Thiruvananthapuram | IN
cochin > Kochi | IN
baroda > Vadodara | IN
mysore > Mysuru | IN
mangalore > Mangaluru | IN
pondicherry > Puducherry | IN
benares, banaras > Varanasi | IN
allahabad > Prayagraj | IN
simla > Shimla | IN
vizag > Visakhapatnam | IN
hitec city, hitech city, cyberabad > Hyderabad | IN
saigon, hcmc, hcm, ho chi minh, tp hcm, tp. hồ chí minh, thành phố hồ chí minh > Ho Chi Minh City | VN
hà nội, ha noi > Hanoi | VN
peking, pekín > Beijing | CN
rangoon > Yangon | MM
kl, klang valley, greater kuala lumpur > Kuala Lumpur | MY
subang jaya > Petaling Jaya | MY
metro manila > Manila | PH
bgc, bonifacio global city, fort bonifacio > Taguig | PH
makati > Makati City | PH
qc > Quezon City | PH
greater jakarta, jabodetabek > Jakarta | ID
krung thep > Bangkok | TH
greater tokyo, tokyo metropolis, tokio > Tokyo | JP
greater seoul, seoul capital area > Seoul | KR
taipei city > Taipei | TW
new taipei > New Taipei City | TW
kowloon > Kowloon City | HK
hong kong island, hk island > Hong Kong | HK
macao > Macau | MO
singapore city > Singapore | SG
dacca > Dhaka | BD
nur-sultan, nursultan > Astana | KZ
alma-ata > Almaty | KZ
greater sydney, sydney cbd, sydney metro > Sydney | AU
greater melbourne, melbourne cbd > Melbourne | AU
greater brisbane > Brisbane | AU
cdmx, ciudad de méxico, ciudad de mexico, méxico df, mexico df, méxico d.f., mexico d.f., greater mexico city > Mexico City | MX
mty > Monterrey | MX
greater são paulo, greater sao paulo, grande são paulo, grande sao paulo > São Paulo | BR
rio > Rio de Janeiro | BR
floripa > Florianópolis | BR
bogotá d.c., bogota d.c., bogota dc > Bogotá | CO
caba, capital federal, ciudad autónoma de buenos aires, ciudad autonoma de buenos aires, gba, gran buenos aires, greater buenos aires, amba > Buenos Aires | AR
santiago de chile > Santiago | CL
lima metropolitana > Lima | PE
ciudad de panamá, ciudad de panama > Panama City | PA
ciudad de guatemala > Guatemala City | GT
la habana > Havana | CU
`;
const rowsByKey = new Map();
for (const r of cityRows) for (const k of new Set([key(r[1]), r[2].toLowerCase()])) {
  if (!rowsByKey.has(k)) rowsByKey.set(k, []);
  rowsByKey.get(k).push(r);
}
const a1Lookup = (cc, hint) => {
  const h = hint.toLowerCase();
  const a = admin1.find((x) => x.country === cc && (x.code.toLowerCase() === h || x.name.toLowerCase() === h));
  return a ? a.code : hint;
};
const aliases = [];
const seenAlias = new Set();
for (const line of ALIAS_SPEC.split('\n').map((l) => l.trim()).filter(Boolean)) {
  const [lhs, rhs] = line.split(' > ');
  const [city, cc, hint] = rhs.split('|').map((s) => s.trim());
  const a1c = hint ? a1Lookup(cc, hint) : null;
  const cands = (rowsByKey.get(key(city)) || []).filter((r) => r[4] === cc && (!a1c || r[3] === a1c));
  if (!cands.length) {
    const near = cityRows.filter((r) => r[4] === cc && key(r[1]).includes(key(city).slice(0, 5))).slice(0, 4).map((r) => `${r[1]}[${r[3]}]`);
    errors.push(`alias target not found: "${city}" ${cc}${hint ? ' ' + hint : ''} (near: ${near.join(', ') || '-'})`);
    continue;
  }
  const t = cands[0]; // highest population (cityRows is sorted)
  for (const raw of lhs.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (seenAlias.has(raw)) { errors.push(`duplicate alias "${raw}"`); continue; }
    seenAlias.add(raw);
    if (raw === t[1].toLowerCase() || raw === t[2].toLowerCase()) continue; // no-op alias
    aliases.push({ alias: raw, city: t[1], admin1: t[3], country: t[4] });
  }
}
aliases.sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));

// ---------------------------------------------------------------- regions
const by = (pred) => countries.filter(pred).map((c) => c.code);
const L = (s) => s.split(' ');
const regions = [
  { name: 'EMEA', aliases: ['europe, middle east and africa', 'europe, middle east & africa', 'europe middle east africa', 'emea region'], countries: by((c) => c.region === 'EMEA') },
  { name: 'APAC', aliases: ['asia pacific', 'asia-pacific', 'asia/pacific', 'asia & pacific', 'apj', 'apj region', 'apac region'], countries: by((c) => c.region === 'APAC') },
  { name: 'AMER', aliases: ['americas', 'the americas', 'amer region', 'north and south america'], countries: by((c) => c.region === 'AMER') },
  { name: 'LATAM', aliases: ['latin america', 'latam region', 'latin america and the caribbean', 'lac', 'latinoamérica', 'latinoamerica', 'américa latina', 'america latina'],
    countries: L('MX GT BZ SV HN NI CR PA CO VE EC PE BO CL AR UY PY BR GY SR GF CU DO PR HT') },
  { name: 'North America', aliases: ['noram', 'n. america', 'northern america'], countries: L('US CA MX') },
  { name: 'Europe', aliases: ['european', 'europe region', 'continental europe'], countries: by((c) => c.continent === 'EU' || EU27.includes(c.code)) },
  { name: 'EU', aliases: ['european union', 'e.u.', 'eu member states', 'eu countries'], countries: EU27 },
  { name: 'EEA', aliases: ['european economic area', 'e.e.a.'], countries: [...EU27, 'IS', 'LI', 'NO'] },
  { name: 'DACH', aliases: ['d-a-ch', 'dach region', 'germany, austria, switzerland'], countries: L('DE AT CH') },
  { name: 'Nordics', aliases: ['nordic', 'nordic countries', 'nordic region', 'nordics region', 'scandinavia', 'scandinavian countries'], countries: L('DK FI IS NO SE FO GL AX') },
  { name: 'Benelux', aliases: ['benelux countries', 'benelux region', 'low countries'], countries: L('BE NL LU') },
  { name: 'UK & Ireland', aliases: ['uk and ireland', 'uk & ireland', 'uk/ireland', 'uk & i', 'uki', 'uk&i', 'british isles', 'ireland and uk', 'ireland & uk'], countries: L('GB IE IM JE GG') },
  { name: 'Middle East', aliases: ['middle-east', 'mideast', 'the middle east'], countries: MIDDLE_EAST },
  { name: 'MENA', aliases: ['middle east and north africa', 'middle east & north africa', 'mena region'], countries: [...MIDDLE_EAST, 'DZ', 'LY', 'MA', 'TN', 'MR', 'SD', 'EH'].filter((v, i, a) => a.indexOf(v) === i) },
  { name: 'Africa', aliases: ['african', 'african continent'], countries: by((c) => c.continent === 'AF') },
  { name: 'Sub-Saharan Africa', aliases: ['ssa', 'subsaharan africa', 'sub saharan africa'], countries: by((c) => c.continent === 'AF' && !L('DZ EG LY MA TN EH SD').includes(c.code)) },
  { name: 'Asia', aliases: ['asian'], countries: by((c) => c.continent === 'AS') },
  { name: 'Southeast Asia', aliases: ['south east asia', 'south-east asia', 'sea', 'sea region', 'asean'], countries: L('BN KH ID LA MY MM PH SG TH TL VN') },
  { name: 'South Asia', aliases: ['indian subcontinent'], countries: L('AF BD BT IN MV NP PK LK') },
  { name: 'East Asia', aliases: ['north asia', 'northeast asia'], countries: L('CN HK MO TW JP KR KP MN') },
  { name: 'ANZ', aliases: ['australia and new zealand', 'australia & new zealand', 'australia/new zealand', 'a/nz', 'anz region'], countries: L('AU NZ') },
  { name: 'Oceania', aliases: ['australasia', 'pacific islands'], countries: by((c) => c.continent === 'OC') },
  { name: 'Central America', aliases: ['centroamérica', 'centroamerica', 'américa central', 'america central'], countries: L('BZ CR SV GT HN NI PA') },
  { name: 'South America', aliases: ['sudamérica', 'sudamerica', 'suramérica', 'américa del sur', 'america do sul'], countries: by((c) => c.continent === 'SA') },
  { name: 'Caribbean', aliases: ['the caribbean', 'caribbean islands', 'west indies'], countries: L('AG AI AW BB BL BQ BS CU CW DM DO GD GP HT JM KN KY LC MF MQ MS PR SX TC TT VC VG VI') },
  { name: 'CEE', aliases: ['central and eastern europe', 'central & eastern europe', 'central eastern europe', 'cee region', 'central europe'], countries: L('AL BA BG BY CZ EE HR HU LT LV MD ME MK PL RO RS SI SK UA XK') },
  { name: 'Eastern Europe', aliases: ['east europe', 'eastern european'], countries: L('BG BY CZ HU MD PL RO RU SK UA') },
  { name: 'Western Europe', aliases: ['west europe', 'western european'], countries: L('AD AT BE CH DE FR GB IE LI LU MC NL') },
  { name: 'Southern Europe', aliases: ['south europe', 'mediterranean europe'], countries: L('AD AL BA CY ES GI GR HR IT ME MK MT PT RS SI SM VA XK') },
  { name: 'Northern Europe', aliases: ['north europe'], countries: L('DK EE FI FO GB GG IE IM IS JE LT LV NO SE AX SJ') },
  { name: 'Baltics', aliases: ['baltic states', 'baltic countries', 'baltic region', 'the baltics'], countries: L('EE LV LT') },
  { name: 'Balkans', aliases: ['the balkans', 'western balkans', 'balkan countries'], countries: L('AL BA BG HR ME MK RS SI XK GR RO') },
  { name: 'GCC', aliases: ['gulf cooperation council', 'gulf countries', 'gulf states', 'the gulf', 'gulf region'], countries: L('AE BH KW OM QA SA') },
];
for (const r of regions) {
  r.countries = [...new Set(r.countries)].sort();
  for (const c of r.countries) if (!countryByCode.has(c)) errors.push(`region ${r.name}: unknown country ${c}`);
}

// ---------------------------------------------------------------- validate + write
const a1Set = new Set(admin1.map((a) => `${a.country}.${a.code}`));
const rowSet = new Set(cityRows.map((r) => `${r[1]}|${r[3]}|${r[4]}`));
for (const a of aliases) if (!rowSet.has(`${a.city}|${a.admin1}|${a.country}`)) errors.push(`alias ${a.alias} does not resolve`);
for (const r of cityRows) {
  if (!countryByCode.has(r[4])) errors.push(`city ${r[1]} has unknown country ${r[4]}`);
  if (FULL_ADMIN1.includes(r[4]) && r[3] && !a1Set.has(`${r[4]}.${r[3]}`)) errors.push(`city ${r[1]} admin1 ${r[4]}.${r[3]} missing`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const J = JSON.stringify;
const block = (name, arr, last = false) => `${J(name)}:[\n${arr.map((x) => J(x)).join(',\n')}\n]${last ? '' : ','}\n`;
const out =
  `{"version":1,\n` +
  block('countries', countries) +
  block('admin1', admin1) +
  block('cities', cityRows.map((r) => r.slice(1))) +
  block('aliases', aliases) +
  block('regions', regions, true) +
  `}\n`;
JSON.parse(out);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out);
const noA1 = cityRows.filter((r) => r[3] && !a1Set.has(`${r[4]}.${r[3]}`)).length;
console.log(`wrote ${outFile} (${out.length} bytes): ${countries.length} countries, ${admin1.length} admin1, ${cityRows.length} cities, ${aliases.length} aliases, ${regions.length} regions; city rows with empty admin1: ${cityRows.filter((r) => !r[3]).length}, with admin1 code absent from admin1 list: ${noA1}`);
