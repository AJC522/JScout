import { describe, expect, it } from 'vitest';
import type { JobLocation, Place, RemoteMode } from '../../shared/types';
import { loadReference } from '../data';
import {
  countryName,
  countryShortName,
  distanceKm,
  locationIndexStats,
  makePlace,
  matchPlace,
  parseJobLocation,
  placeLabel,
  resolvePlace,
  suggestIndexStats,
  suggestPlaces,
  type LocationInput,
} from './location';

/** Compact, exact encoding of a place for table-driven expectations. */
function enc(p: Place): string {
  switch (p.kind) {
    case 'city':
      return `city:${p.city}/${p.admin1 ?? ''}/${p.country}`;
    case 'admin1':
      return `admin1:${p.admin1}/${p.country}${p.city ? `@${p.city}` : ''}`;
    case 'country':
      return `country:${p.country}${p.city ? `@${p.city}` : ''}`;
    case 'region':
      return `region:${p.region}`;
    case 'anywhere':
      return 'anywhere';
    default:
      return `unknown:${p.raw}`;
  }
}

function parse(locations: string | string[], extra: Omit<LocationInput, 'locations'> = {}) {
  return parseJobLocation({ locations: Array.isArray(locations) ? locations : [locations], ...extra });
}

function summary(r: ReturnType<typeof parseJobLocation>) {
  return {
    remote: r.location.remote,
    places: r.location.places.map(enc),
    scope: r.location.remoteScope,
    text: r.text,
  };
}

function regionCountries(name: string): string[] {
  const r = loadReference('gazetteer').regions.find((x) => x.name === name);
  if (!r) throw new Error(`no region ${name}`);
  return [...r.countries].sort();
}

function check(cases: Array<[string, RemoteMode, string[], string[] | number, string]>, extra: Omit<LocationInput, 'locations'> = {}) {
  it.each(cases)('%j', (input, remote, places, scope, text) => {
    const s = summary(parse(input, extra));
    expect({ remote: s.remote, places: s.places, text: s.text }).toEqual({ remote, places, text });
    if (typeof scope === 'number') expect(s.scope).toHaveLength(scope);
    else expect(s.scope).toEqual(scope);
  });
}

type Case = [input: string, remote: RemoteMode, places: string[], scope: string[] | number, text: string];

/** Every distinct location string in tests/fixtures/sources (plain country names thinned out). */
export const REAL_STRINGS: Case[] = [
    ["United States", 'unknown', ["country:US"], [], "United States"],
    ["Foster City, CA", 'unknown', ["city:Foster City/CA/US"], [], "Foster City, CA"],
    ["US", 'unknown', ["country:US"], [], "United States"],
    ["Anywhere in the World", 'remote', [], [], "Remote · Anywhere"],
    ["New York, NY", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["London, United Kingdom", 'unknown', ["city:London/ENG/GB"], [], "London, UK"],
    ["USA", 'unknown', ["country:US"], [], "United States"],
    ["New York, New York, United States", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["Canada", 'unknown', ["country:CA"], [], "Canada"],
    ["San Francisco, California, United States", 'unknown', ["city:San Francisco/CA/US"], [], "San Francisco, CA"],
    ["Pittsburgh, Pennsylvania, United States", 'unknown', ["city:Pittsburgh/PA/US"], [], "Pittsburgh, PA"],
    ["Denver, CO", 'unknown', ["city:Denver/CO/US"], [], "Denver, CO"],
    ["Stockholm", 'unknown', ["city:Stockholm/26/SE"], [], "Stockholm, Sweden"],
    ["North America", 'unknown', ["region:North America"], [], "North America"],
    ["San Francisco", 'unknown', ["city:San Francisco/CA/US"], [], "San Francisco, CA"],
    ["New York City", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["San Francisco, CA", 'unknown', ["city:San Francisco/CA/US"], [], "San Francisco, CA"],
    ["Seattle", 'unknown', ["city:Seattle/WA/US"], [], "Seattle, WA"],
    ["California", 'unknown', ["admin1:CA/US"], [], "California, US"],
    ["Philippines", 'unknown', ["country:PH"], [], "Philippines"],
    ["Brazil", 'unknown', ["country:BR"], [], "Brazil"],
    ["Worldwide", 'remote', [], [], "Remote · Anywhere"],
    ["Japan", 'unknown', ["country:JP"], [], "Japan"],
    ["Tokyo", 'unknown', ["city:Tokyo/40/JP"], [], "Tokyo, Japan"],
    ["United Kingdom", 'unknown', ["country:GB"], [], "United Kingdom"],
    ["Bangalore, India", 'unknown', ["city:Bengaluru/19/IN"], [], "Bengaluru, India"],
    ["France", 'unknown', ["country:FR"], [], "France"],
    ["Germany", 'unknown', ["country:DE"], [], "Germany"],
    ["Washington, D.C.", 'unknown', ["city:Washington/DC/US"], [], "Washington, DC"],
    ["Pittsburgh, PA", 'unknown', ["city:Pittsburgh/PA/US"], [], "Pittsburgh, PA"],
    ["Poland", 'unknown', ["country:PL"], [], "Poland"],
    ["Berlin", 'unknown', ["city:Berlin/16/DE"], [], "Berlin, Germany"],
    ["New York", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["London", 'unknown', ["city:London/ENG/GB"], [], "London, UK"],
    ["Bengaluru, Karnataka, India", 'unknown', ["city:Bengaluru/19/IN"], [], "Bengaluru, India"],
    ["Remote", 'remote', [], [], "Remote"],
    ["Ireland", 'unknown', ["country:IE"], [], "Ireland"],
    ["Spain", 'unknown', ["country:ES"], [], "Spain"],
    ["Los Angeles, California, United States", 'unknown', ["city:Los Angeles/CA/US"], [], "Los Angeles, CA"],
    ["Czechia", 'unknown', ["country:CZ"], [], "Czechia"],
    ["GB", 'unknown', ["country:GB"], [], "United Kingdom"],
    ["Singapore, Singapore", 'unknown', ["city:Singapore//SG"], [], "Singapore"],
    ["Abu Dhabi, United Arab Emirates", 'unknown', ["city:Abu Dhabi/01/AE"], [], "Abu Dhabi, UAE"],
    ["Boston, MA", 'unknown', ["city:Boston/MA/US"], [], "Boston, MA"],
    ["Sydney", 'unknown', ["city:Sydney/02/AU"], [], "Sydney, Australia"],
    ["Taiwan", 'unknown', ["country:TW"], [], "Taiwan"],
    ["Massachusetts - Boston", 'unknown', ["city:Boston/MA/US"], [], "Boston, MA"],
    ["Germany - Berlin", 'unknown', ["city:Berlin/16/DE"], [], "Berlin, Germany"],
    ["Japan - Tokyo", 'unknown', ["city:Tokyo/40/JP"], [], "Tokyo, Japan"],
    ["China - Suzhou", 'unknown', ["city:Suzhou/04/CN"], [], "Suzhou, China"],
    ["Wisconsin - Madison", 'unknown', ["city:Madison/WI/US"], [], "Madison, WI"],
    ["Hayward, CA", 'unknown', ["city:Hayward/CA/US"], [], "Hayward, CA"],
    ["Singapore", 'unknown', ["city:Singapore//SG"], [], "Singapore"],
    ["Europe", 'unknown', ["region:Europe"], [], "Europe"],
    ["New York, NY (HQ)", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["NY", 'unknown', ["admin1:NY/US"], [], "New York, US"],
    ["Mexico", 'unknown', ["country:MX"], [], "Mexico"],
    ["Anywhere", 'remote', [], [], "Remote · Anywhere"],
    ["Canada,  USA", 'unknown', ["country:CA","country:US"], [], "Canada +1 more"],
    ["🇺🇸 United States of America", 'unknown', ["country:US"], [], "United States"],
    ["Tokyo, Japan", 'unknown', ["city:Tokyo/40/JP"], [], "Tokyo, Japan"],
    ["Washington", 'unknown', ["admin1:WA/US"], [], "Washington, US"],
    ["US - Remote", 'remote', [], ["US"], "Remote · US"],
    ["San Fransisco", 'unknown', ["city:San Francisco/CA/US"], [], "San Francisco, CA"],
    ["Remote (UK)", 'remote', [], ["GB"], "Remote · UK"],
    ["Los Angeles, CA", 'unknown', ["city:Los Angeles/CA/US"], [], "Los Angeles, CA"],
    ["San Francisco Bay Area", 'unknown', ["city:San Francisco/CA/US"], [], "San Francisco, CA"],
    ["Remote (US)", 'remote', [], ["US"], "Remote · US"],
    ["Washington, District of Columbia, United States", 'unknown', ["city:Washington/DC/US"], [], "Washington, DC"],
    ["New York, NY; Pittsburgh, PA", 'unknown', ["city:New York City/NY/US","city:Pittsburgh/PA/US"], [], "New York, NY +1 more"],
    ["Beijing, China", 'unknown', ["city:Beijing/22/CN"], [], "Beijing, China"],
    ["Beijing Shi, China", 'unknown', ["city:Beijing/22/CN"], [], "Beijing, China"],
    ["Chicago, Illinois, United States", 'unknown', ["city:Chicago/IL/US"], [], "Chicago, IL"],
    ["US-Remote", 'remote', [], ["US"], "Remote · US"],
    ["Seattle, Washington, United States", 'unknown', ["city:Seattle/WA/US"], [], "Seattle, WA"],
    ["Ireland Locations", 'unknown', ["country:IE"], [], "Ireland"],
    ["JP", 'unknown', ["country:JP"], [], "Japan"],
    ["SE", 'unknown', ["country:SE"], [], "Sweden"],
    ["Miami, FL", 'unknown', ["city:Miami/FL/US"], [], "Miami, FL"],
    ["San Diego, CA", 'unknown', ["city:San Diego/CA/US"], [], "San Diego, CA"],
    ["Seattle, WA", 'unknown', ["city:Seattle/WA/US"], [], "Seattle, WA"],
    ["US Only", 'unknown', ["country:US"], [], "United States"],
    ["USA, Canada", 'unknown', ["country:US","country:CA"], [], "United States +1 more"],
    ["Europe Only", 'unknown', ["region:Europe"], [], "Europe"],
    ["USA Only", 'unknown', ["country:US"], [], "United States"],
    ["Stuttgart", 'unknown', ["city:Stuttgart/01/DE"], [], "Stuttgart, Germany"],
    ["Neumarkt in der Oberpfalz", 'unknown', ["city:Neumarkt in der Oberpfalz/02/DE"], [], "Neumarkt in der Oberpfalz, Germany"],
    ["Augsburg", 'unknown', ["city:Augsburg/02/DE"], [], "Augsburg, Germany"],
    ["Hybrid", 'hybrid', [], [], "Hybrid"],
    ["Paris, France; Barcelona, Spain", 'unknown', ["city:Paris/11/FR","city:Barcelona/56/ES"], [], "Paris, France +1 more"],
    ["Homeoffice", 'remote', [], [], "Remote"],
    ["Basel, Basel-Stadt, Switzerland", 'unknown', ["city:Basel/BS/CH"], [], "Basel, Switzerland"],
    ["Groningen", 'unknown', ["city:Groningen/04/NL"], [], "Groningen, Netherlands"],
    ["European Union", 'unknown', ["region:EU"], [], "EU"],
    ["Atlanta, Georgia", 'unknown', ["city:Atlanta/GA/US"], [], "Atlanta, GA"],
    ["Atlanta", 'unknown', ["city:Atlanta/GA/US"], [], "Atlanta, GA"],
    ["London, UK", 'unknown', ["city:London/ENG/GB"], [], "London, UK"],
    ["Greater London", 'unknown', ["city:London/ENG/GB"], [], "London, UK"],
    ["Toronto, ON", 'unknown', ["city:Toronto/08/CA"], [], "Toronto, ON"],
    ["Ontario", 'unknown', ["admin1:08/CA"], [], "Ontario, Canada"],
    ["Toronto", 'unknown', ["city:Toronto/08/CA"], [], "Toronto, ON"],
    ["Seattle, San Francisco, New York City", 'unknown', ["city:Seattle/WA/US","city:San Francisco/CA/US","city:New York City/NY/US"], [], "Seattle, WA +2 more"],
    ["Remote, United Kingdom", 'remote', [], ["GB"], "Remote · UK"],
    ["Remote, United States", 'remote', [], ["US"], "Remote · US"],
    ["United States of America", 'unknown', ["country:US"], [], "United States"],
    ["Remote, Canada; Remote, United States", 'remote', [], ["CA","US"], "Remote · Canada, US"],
    ["Remote Ireland; Remote, France; Remote, Germany; Remote, Italy; Remote, Spain; Remote, United Kingdom", 'remote', [], ["DE","ES","FR","GB","IE","IT"], "Remote · Ireland, France, Germany +3 more"],
    ["Los Angeles Metropolitan Area or New York City Metropolitan Area", 'unknown', ["city:Los Angeles/CA/US","city:New York City/NY/US"], [], "Los Angeles, CA +1 more"],
    ["Remote (California, Washington, and Oregon Only)", 'remote', [], ["US"], "Remote · US"],
    ["San Francisco Bay Area or Remote (U.S.)", 'remote', ["city:San Francisco/CA/US"], ["US"], "San Francisco, CA · Remote (US)"],
    ["Remote (U.S.)", 'remote', [], ["US"], "Remote · US"],
    ["London, England", 'unknown', ["city:London/ENG/GB"], [], "London, UK"],
    ["Japan Locations", 'unknown', ["country:JP"], [], "Japan"],
    ["San Francisco, CA; Chicago, IL & New York, NY", 'unknown', ["city:San Francisco/CA/US","city:Chicago/IL/US","city:New York City/NY/US"], [], "San Francisco, CA +2 more"],
    ["Chicago, Seattle, NYC, San Francisco, Remote", 'remote', ["city:Chicago/IL/US","city:Seattle/WA/US","city:New York City/NY/US","city:San Francisco/CA/US"], [], "Chicago, IL +3 more · Remote"],
    ["US-Chicago", 'unknown', ["city:Chicago/IL/US"], [], "Chicago, IL"],
    ["US-NYC", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["US-Seattle", 'unknown', ["city:Seattle/WA/US"], [], "Seattle, WA"],
    ["US-SF-HQ", 'unknown', ["city:San Francisco/CA/US"], [], "San Francisco, CA"],
    ["N/A", 'unknown', [], [], ""],
    ["Mexico Locations", 'unknown', ["country:MX"], [], "Mexico"],
    ["Bucharest", 'unknown', ["city:Bucharest/10/RO"], [], "Bucharest, Romania"],
    ["Barcelona, Spain", 'unknown', ["city:Barcelona/56/ES"], [], "Barcelona, Spain"],
    ["Gurugram, India", 'unknown', ["city:Gurugram/10/IN"], [], "Gurugram, India"],
    ["Bengaluru, India", 'unknown', ["city:Bengaluru/19/IN"], [], "Bengaluru, India"],
    ["Antigua and Barbuda", 'unknown', ["country:AG"], [], "Antigua and Barbuda"],
    ["Bonaire, Sint Eustatius and Saba", 'unknown', ["country:BQ"], [], "Bonaire"],
    ["Cayman Islands", 'unknown', ["country:KY"], [], "Cayman Islands"],
    ["Costa Rica", 'unknown', ["country:CR"], [], "Costa Rica"],
    ["Dominican Republic", 'unknown', ["country:DO"], [], "Dominican Republic"],
    ["El Salvador", 'unknown', ["country:SV"], [], "El Salvador"],
    ["Falkland Islands (Malvinas)", 'unknown', ["country:FK"], [], "Falkland Islands"],
    ["Puerto Rico", 'unknown', ["country:PR"], [], "Puerto Rico"],
    ["Saint Kitts and Nevis", 'unknown', ["country:KN"], [], "Saint Kitts and Nevis"],
    ["Saint Lucia", 'unknown', ["country:LC"], [], "Saint Lucia"],
    ["Saint Vincent and the Grenadines", 'unknown', ["country:VC"], [], "Saint Vincent and the Grenadines"],
    ["South Georgia and the South Sandwich Islands", 'unknown', ["country:GS"], [], "South Georgia and the South Sandwich Islands"],
    ["Trinidad and Tobago", 'unknown', ["country:TT"], [], "Trinidad and Tobago"],
    ["Turks and Caicos Islands", 'unknown', ["country:TC"], [], "Turks and Caicos Islands"],
    ["Virgin Islands, British", 'unknown', ["country:VG"], [], "British Virgin Islands"],
    ["Virgin Islands, U.S.", 'unknown', ["country:VI"], [], "U.S. Virgin Islands"],
    ["Monaco", 'unknown', ["city:Monaco/00/MC"], [], "Monaco"],
    ["canada", 'unknown', ["country:CA"], [], "Canada"],
    ["EMEA,  LATAM,  Canada,  USA", 'unknown', ["region:EMEA","region:LATAM","country:CA","country:US"], [], "EMEA +3 more"],
    ["Ireland,  Portugal,  UK", 'unknown', ["country:IE","country:PT","country:GB"], [], "Ireland +2 more"],
    ["Türkiye", 'unknown', ["country:TR"], [], "Türkiye"],
    ["APAC,  EMEA,  LATAM,  Canada,  USA", 'unknown', ["region:APAC","region:EMEA","region:LATAM","country:CA","country:US"], [], "APAC +4 more"],
    ["SG", 'unknown', ["city:Singapore//SG"], [], "Singapore"],
    ["AE", 'unknown', ["country:AE"], [], "United Arab Emirates"],
    ["AU", 'unknown', ["country:AU"], [], "Australia"],
    ["TW", 'unknown', ["country:TW"], [], "Taiwan"],
    ["DE", 'unknown', ["country:DE"], [], "Germany"],
    ["CN", 'unknown', ["country:CN"], [], "China"],
    ["Canada Only", 'unknown', ["country:CA"], [], "Canada"],
    ["MÃ¼nchen", 'unknown', ["city:Munich/02/DE"], [], "Munich, Germany"],
    ["Remote, EST United States", 'remote', [], ["US"], "Remote · US"],
    ["South Carolina", 'unknown', ["admin1:SC/US"], [], "South Carolina, US"],
    ["Ciudad de MÃ©xico, Mexico", 'unknown', ["city:Mexico City/09/MX"], [], "Mexico City, Mexico"],
    ["Black Bess,", 'unknown', ["unknown:Black Bess"], [], "Black Bess"],
    ["Budapest,", 'unknown', ["city:Budapest/05/HU"], [], "Budapest, Hungary"],
    ["Kathmandu,", 'unknown', ["city:Kathmandu/3/NP"], [], "Kathmandu, Nepal"],
    ["Stockholm, Stockholm, Stockholms lÃ¤n, Sverige", 'unknown', ["city:Stockholm/26/SE"], [], "Stockholm, Sweden"],
    ["Toronto, Ontario", 'unknown', ["city:Toronto/08/CA"], [], "Toronto, ON"],
    ["Kuala Lumpur, Kuala Lumpur, Wilayah Persekutuan Kuala Lumpur, Malaysia", 'unknown', ["city:Kuala Lumpur/14/MY"], [], "Kuala Lumpur, Malaysia"],
    ["Saint-Python,", 'unknown', ["unknown:Saint-Python"], [], "Saint-Python"],
    ["LATAM, Europe, USA, Canada, APAC", 'unknown', ["region:LATAM","region:Europe","country:US","country:CA","region:APAC"], [], "LATAM +4 more"],
    ["Europe, USA, Canada, Australia, Singapore, Mexico, Saudi Arabia", 'unknown', ["region:Europe","country:US","country:CA","country:AU","city:Singapore//SG","country:MX","country:SA"], [], "Europe +6 more"],
    ["🇲🇽 Mexico", 'unknown', ["country:MX"], [], "Mexico"],
    ["🇧🇷 Brazil", 'unknown', ["country:BR"], [], "Brazil"],
    ["Texas", 'unknown', ["admin1:TX/US"], [], "Texas, US"],
    ["🇨🇦 Canada, 🇵🇱 Poland, and 🇬🇧 United Kingdom of Great Britain and Northern Ireland", 'unknown', ["country:CA","country:PL","country:GB"], [], "Canada +2 more"],
    ["Zug", 'unknown', ["city:Zug/ZG/CH"], [], "Zug, Switzerland"],
    ["Delaware", 'unknown', ["admin1:DE/US"], [], "Delaware, US"],
    ["🇧🇴 Bolivia (Plurinational State of), 🇧🇷 Brazil, 🇨🇱 Chile, 🇨🇴 Colombia, 🇵🇪 Peru, and 🇺🇾 Uruguay", 'unknown', ["country:BO","country:BR","country:CL","country:CO","country:PE","country:UY"], [], "Bolivia +5 more"],
    ["New Jersey", 'unknown', ["admin1:NJ/US"], [], "New Jersey, US"],
    ["Africa Only", 'unknown', ["region:Africa"], [], "Africa"],
    ["Plzeňský kraj", 'unknown', ["unknown:Plzeňský kraj"], [], "Plzeňský kraj"],
    ["Global", 'remote', [], [], "Remote · Anywhere"],
    ["USA, Canada, Ireland and UK ONLY", 'unknown', ["country:US","country:CA","country:IE","country:GB"], [], "United States +3 more"],
    ["United States only (ShyftOff-approved states)", 'unknown', ["country:US"], [], "United States"],
    ["Time zone: CET (+/- 3 hours)", 'unknown', ["unknown:Time zone: CET (+/- 3 hours)"], [], "Time zone: CET (+/- 3 hours)"],
    ["Anywhere in the world", 'remote', [], [], "Remote · Anywhere"],
    ["Europe, USA, Canada, Australia, Singapore, Mexico", 'unknown', ["region:Europe","country:US","country:CA","country:AU","city:Singapore//SG","country:MX"], [], "Europe +5 more"],
    ["Latin America", 'unknown', ["region:LATAM"], [], "LATAM"],
    ["APAC", 'unknown', ["region:APAC"], [], "APAC"],
    ["UK", 'unknown', ["country:GB"], [], "United Kingdom"],
];

/** The same strings on remote-only boards (source hint remote). */
export const REMOTE_BOARD_STRINGS: Case[] = [
    ["Anywhere in the World", 'remote', [], [], "Remote · Anywhere"],
    ["Philippines", 'remote', [], ["PH"], "Remote · Philippines"],
    ["Brazil", 'remote', [], ["BR"], "Remote · Brazil"],
    ["Worldwide", 'remote', [], [], "Remote · Anywhere"],
    ["Poland", 'remote', [], ["PL"], "Remote · Poland"],
    ["Czechia", 'remote', [], ["CZ"], "Remote · Czechia"],
    ["Slovakia", 'remote', [], ["SK"], "Remote · Slovakia"],
    ["Anywhere", 'remote', [], [], "Remote · Anywhere"],
    ["Canada,  USA", 'remote', [], ["CA","US"], "Remote · Canada, US"],
    ["🇺🇸 United States of America", 'remote', [], ["US"], "Remote · US"],
    ["Hungary", 'remote', [], ["HU"], "Remote · Hungary"],
    ["Kazakhstan", 'remote', [], ["KZ"], "Remote · Kazakhstan"],
    ["US Only", 'remote', [], ["US"], "Remote · US"],
    ["USA, Canada", 'remote', [], ["CA","US"], "Remote · US, Canada"],
    ["Europe Only", 'remote', [], 53, "Remote · Europe"],
    ["USA Only", 'remote', [], ["US"], "Remote · US"],
    ["Anguilla", 'remote', [], ["AI"], "Remote · Anguilla"],
    ["Antigua and Barbuda", 'remote', [], ["AG"], "Remote · Antigua and Barbuda"],
    ["Argentina", 'remote', [], ["AR"], "Remote · Argentina"],
    ["Aruba", 'remote', [], ["AW"], "Remote · Aruba"],
    ["Bahamas", 'remote', [], ["BS"], "Remote · Bahamas"],
    ["Barbados", 'remote', [], ["BB"], "Remote · Barbados"],
    ["Belize", 'remote', [], ["BZ"], "Remote · Belize"],
    ["Bermuda", 'remote', [], ["BM"], "Remote · Bermuda"],
    ["Bolivia", 'remote', [], ["BO"], "Remote · Bolivia"],
    ["Bonaire, Sint Eustatius and Saba", 'remote', [], ["BQ"], "Remote · Caribbean Netherlands"],
    ["Cayman Islands", 'remote', [], ["KY"], "Remote · Cayman Islands"],
    ["Costa Rica", 'remote', [], ["CR"], "Remote · Costa Rica"],
    ["Dominican Republic", 'remote', [], ["DO"], "Remote · Dominican Republic"],
    ["El Salvador", 'remote', [], ["SV"], "Remote · El Salvador"],
    ["Falkland Islands (Malvinas)", 'remote', [], ["FK"], "Remote · Falkland Islands"],
    ["Puerto Rico", 'remote', [], ["PR"], "Remote · Puerto Rico"],
    ["Saint Kitts and Nevis", 'remote', [], ["KN"], "Remote · Saint Kitts and Nevis"],
    ["Saint Lucia", 'remote', [], ["LC"], "Remote · Saint Lucia"],
    ["Saint Vincent and the Grenadines", 'remote', [], ["VC"], "Remote · St Vincent & Grenadines"],
    ["South Georgia and the South Sandwich Islands", 'remote', [], ["GS"], "Remote · South Georgia"],
    ["Trinidad and Tobago", 'remote', [], ["TT"], "Remote · Trinidad and Tobago"],
    ["Turks and Caicos Islands", 'remote', [], ["TC"], "Remote · Turks & Caicos"],
    ["Virgin Islands, British", 'remote', [], ["VG"], "Remote · British Virgin Islands"],
    ["Virgin Islands, U.S.", 'remote', [], ["VI"], "Remote · US Virgin Islands"],
    ["canada", 'remote', [], ["CA"], "Remote · Canada"],
    ["EMEA,  LATAM,  Canada,  USA", 'remote', [], 163, "Remote · EMEA, LATAM, Canada +1 more"],
    ["Ireland,  Portugal,  UK", 'remote', [], ["GB","IE","PT"], "Remote · Ireland, Portugal, UK"],
    ["Türkiye", 'remote', [], ["TR"], "Remote · Türkiye"],
    ["APAC,  EMEA,  LATAM,  Canada,  USA", 'remote', [], 221, "Remote · APAC, EMEA, LATAM +2 more"],
    ["Canada Only", 'remote', [], ["CA"], "Remote · Canada"],
    ["MÃ¼nchen", 'remote', ["city:Munich/02/DE"], [], "Munich, Germany · Remote"],
    ["Remote, EST United States", 'remote', [], ["US"], "Remote · US"],
    ["South Carolina", 'remote', [], ["US"], "Remote · US"],
    ["Ciudad de MÃ©xico, Mexico", 'remote', ["city:Mexico City/09/MX"], [], "Mexico City, Mexico · Remote"],
    ["Black Bess,", 'remote', ["unknown:Black Bess"], [], "Black Bess · Remote"],
    ["Budapest,", 'remote', ["city:Budapest/05/HU"], [], "Budapest, Hungary · Remote"],
    ["Kathmandu,", 'remote', ["city:Kathmandu/3/NP"], [], "Kathmandu, Nepal · Remote"],
    ["Stockholm, Stockholm, Stockholms lÃ¤n, Sverige", 'remote', ["city:Stockholm/26/SE"], [], "Stockholm, Sweden · Remote"],
    ["Toronto, Ontario", 'remote', ["city:Toronto/08/CA"], [], "Toronto, ON · Remote"],
    ["Kuala Lumpur, Kuala Lumpur, Wilayah Persekutuan Kuala Lumpur, Malaysia", 'remote', ["city:Kuala Lumpur/14/MY"], [], "Kuala Lumpur, Malaysia · Remote"],
    ["Saint-Python,", 'remote', ["unknown:Saint-Python"], [], "Saint-Python · Remote"],
    ["LATAM, Europe, USA, Canada, APAC", 'remote', [], 138, "Remote · LATAM, Europe, US +2 more"],
    ["Europe, USA, Canada, Australia, Singapore, Mexico, Saudi Arabia", 'remote', [], 59, "Remote · Europe, US, Canada +4 more"],
    ["🇲🇽 Mexico", 'remote', [], ["MX"], "Remote · Mexico"],
    ["🇧🇷 Brazil", 'remote', [], ["BR"], "Remote · Brazil"],
    ["🇨🇦 Canada, 🇵🇱 Poland, and 🇬🇧 United Kingdom of Great Britain and Northern Ireland", 'remote', [], ["CA","GB","PL"], "Remote · Canada, Poland, UK"],
    ["Zug", 'remote', ["city:Zug/ZG/CH"], [], "Zug, Switzerland · Remote"],
    ["🇧🇴 Bolivia (Plurinational State of), 🇧🇷 Brazil, 🇨🇱 Chile, 🇨🇴 Colombia, 🇵🇪 Peru, and 🇺🇾 Uruguay", 'remote', [], ["BO","BR","CL","CO","PE","UY"], "Remote · Bolivia, Brazil, Chile +3 more"],
    ["New Jersey", 'remote', [], ["US"], "Remote · US"],
    ["Africa Only", 'remote', [], 58, "Remote · Africa"],
    ["Plzeňský kraj", 'remote', ["unknown:Plzeňský kraj"], [], "Plzeňský kraj · Remote"],
    ["Global", 'remote', [], [], "Remote · Anywhere"],
    ["USA, Canada, Ireland and UK ONLY", 'remote', [], ["CA","GB","IE","US"], "Remote · US, Canada, Ireland +1 more"],
    ["United States only (ShyftOff-approved states)", 'remote', [], ["US"], "Remote · US"],
    ["Time zone: CET (+/- 3 hours)", 'remote', ["unknown:Time zone: CET (+/- 3 hours)"], [], "Time zone: CET (+/- 3 hours) · Remote"],
    ["Anywhere in the world", 'remote', [], [], "Remote · Anywhere"],
    ["Europe, USA, Canada, Australia, Singapore, Mexico", 'remote', [], 58, "Remote · Europe, US, Canada +3 more"],
    ["Latin America", 'remote', [], 25, "Remote · LATAM"],
    ["APAC", 'remote', [], 58, "Remote · APAC"],
    ["UK", 'remote', [], ["GB"], "Remote · UK"],
];

/** The awkward inputs from the design notes. */
export const AWKWARD: Case[] = [
    ["Cambridge, MA", 'unknown', ["city:Cambridge/MA/US"], [], "Cambridge, MA"],
    ["Cambridge, UK", 'unknown', ["city:Cambridge/ENG/GB"], [], "Cambridge, UK"],
    ["Cambridge", 'unknown', ["city:Cambridge/ENG/GB"], [], "Cambridge, UK"],
    ["Paris, TX", 'unknown', ["city:Paris/TX/US"], [], "Paris, TX"],
    ["Paris", 'unknown', ["city:Paris/11/FR"], [], "Paris, France"],
    ["London, ON", 'unknown', ["city:London/08/CA"], [], "London, ON"],
    ["London", 'unknown', ["city:London/ENG/GB"], [], "London, UK"],
    ["Portland, ME", 'unknown', ["city:Portland/ME/US"], [], "Portland, ME"],
    ["Portland, OR", 'unknown', ["city:Portland/OR/US"], [], "Portland, OR"],
    ["Portland", 'unknown', ["city:Portland/OR/US"], [], "Portland, OR"],
    ["Birmingham, AL", 'unknown', ["city:Birmingham/AL/US"], [], "Birmingham, AL"],
    ["Birmingham, UK", 'unknown', ["city:Birmingham/ENG/GB"], [], "Birmingham, UK"],
    ["Birmingham", 'unknown', ["city:Birmingham/ENG/GB"], [], "Birmingham, UK"],
    ["Georgia", 'unknown', ["country:GE"], [], "Georgia"],
    ["Atlanta, Georgia", 'unknown', ["city:Atlanta/GA/US"], [], "Atlanta, GA"],
    ["GA", 'unknown', ["admin1:GA/US"], [], "Georgia, US"],
    ["Tbilisi, Georgia", 'unknown', ["city:Tbilisi/51/GE"], [], "Tbilisi, Georgia"],
    ["Washington", 'unknown', ["admin1:WA/US"], [], "Washington, US"],
    ["Washington, DC", 'unknown', ["city:Washington/DC/US"], [], "Washington, DC"],
    ["Washington, D.C.", 'unknown', ["city:Washington/DC/US"], [], "Washington, DC"],
    ["Washington State", 'unknown', ["admin1:WA/US"], [], "Washington, US"],
    ["Washington DC", 'unknown', ["city:Washington/DC/US"], [], "Washington, DC"],
    ["DC", 'unknown', ["city:Washington/DC/US"], [], "Washington, DC"],
    ["New York", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["New York, NY", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["New York State", 'unknown', ["admin1:NY/US"], [], "New York, US"],
    ["Upstate New York", 'unknown', ["admin1:NY/US"], [], "New York, US"],
    ["NYC", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["CA", 'unknown', ["country:CA"], [], "Canada"],
    ["IN", 'unknown', ["country:IN"], [], "India"],
    ["DE", 'unknown', ["country:DE"], [], "Germany"],
    ["ID", 'unknown', ["country:ID"], [], "Indonesia"],
    ["AR", 'unknown', ["country:AR"], [], "Argentina"],
    ["IL", 'unknown', ["country:IL"], [], "Israel"],
    ["PA", 'unknown', ["admin1:PA/US"], [], "Pennsylvania, US"],
    ["LA", 'unknown', ["city:Los Angeles/CA/US"], [], "Los Angeles, CA"],
    ["Los Angeles, CA", 'unknown', ["city:Los Angeles/CA/US"], [], "Los Angeles, CA"],
    ["LA, CA", 'unknown', ["city:Los Angeles/CA/US"], [], "Los Angeles, CA"],
    ["Baton Rouge, LA", 'unknown', ["city:Baton Rouge/LA/US"], [], "Baton Rouge, LA"],
    ["MA", 'unknown', ["country:MA"], [], "Morocco"],
    ["ME", 'unknown', ["admin1:ME/US"], [], "Maine, US"],
    ["OR", 'unknown', ["admin1:OR/US"], [], "Oregon, US"],
    ["Indianapolis, IN", 'unknown', ["city:Indianapolis/IN/US"], [], "Indianapolis, IN"],
    ["Remote in Canada", 'remote', [], ["CA"], "Remote · Canada"],
    ["Remote", 'remote', [], [], "Remote"],
    ["Hybrid", 'hybrid', [], [], "Hybrid"],
    ["Flexible", 'unknown', [], [], "Flexible"],
    ["Multiple Locations", 'unknown', [], [], "Multiple Locations"],
    ["Various", 'unknown', [], [], "Various"],
    ["Nationwide", 'unknown', [], [], "Nationwide"],
    ["Global", 'remote', [], [], "Remote · Anywhere"],
    ["HQ", 'unknown', [], [], "HQ"],
    ["Headquarters", 'unknown', [], [], "Headquarters"],
    ["Office", 'unknown', [], [], "Office"],
    ["TBD", 'unknown', [], [], ""],
    ["N/A", 'unknown', [], [], ""],
    ["Home", 'unknown', [], [], "Home"],
    ["Field", 'unknown', [], [], "Field"],
    ["Mobile", 'unknown', [], [], "Mobile"],
    ["Mobile, AL", 'unknown', ["city:Mobile/AL/US"], [], "Mobile, AL"],
    ["Reading", 'unknown', ["city:Reading/ENG/GB"], [], "Reading, UK"],
    ["Reading, UK", 'unknown', ["city:Reading/ENG/GB"], [], "Reading, UK"],
    ["Reading, Berkshire", 'unknown', ["city:Reading/ENG/GB"], [], "Reading, UK"],
    ["Bath", 'unknown', ["city:Bath/ENG/GB"], [], "Bath, UK"],
    ["Nice", 'unknown', ["city:Nice/93/FR"], [], "Nice, France"],
    ["Split", 'unknown', ["city:Split/15/HR"], [], "Split, Croatia"],
    ["Of", 'unknown', [], [], "Of"],
    ["Enterprise", 'unknown', [], [], "Enterprise"],
    ["Media", 'unknown', [], [], "Media"],
    ["Media, PA", 'unknown', ["admin1:PA/US@Media"], [], "Media, PA"],
    ["Normal", 'unknown', [], [], "Normal"],
    ["Normal, IL", 'unknown', ["city:Normal/IL/US"], [], "Normal, IL"],
    ["Industry", 'unknown', [], [], "Industry"],
    ["San Francisco, CA; New York, NY; Remote", 'remote', ["city:San Francisco/CA/US","city:New York City/NY/US"], [], "San Francisco, CA +1 more · Remote"],
    ["London / Berlin / Remote (EU)", 'remote', ["city:London/ENG/GB","city:Berlin/16/DE"], 27, "London, UK +1 more · Remote (EU)"],
    ["NYC or SF", 'unknown', ["city:New York City/NY/US","city:San Francisco/CA/US"], [], "New York, NY +1 more"],
    ["Austin, TX | Denver, CO", 'unknown', ["city:Austin/TX/US","city:Denver/CO/US"], [], "Austin, TX +1 more"],
    ["Toronto, ON, Canada or Vancouver, BC, Canada", 'unknown', ["city:Toronto/08/CA","city:Vancouver/02/CA"], [], "Toronto, ON +1 more"],
    ["US - CA - San Francisco", 'unknown', ["city:San Francisco/CA/US"], [], "San Francisco, CA"],
    ["USA-NY-New York", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["San Francisco, California, United States", 'unknown', ["city:San Francisco/CA/US"], [], "San Francisco, CA"],
    ["Greater Seattle Area", 'unknown', ["city:Seattle/WA/US"], [], "Seattle, WA"],
    ["Dallas-Fort Worth", 'unknown', ["city:Dallas/TX/US"], [], "Dallas, TX"],
    ["Minneapolis-St. Paul", 'unknown', ["city:Minneapolis/MN/US"], [], "Minneapolis, MN"],
    ["Raleigh-Durham", 'unknown', ["city:Raleigh/NC/US"], [], "Raleigh, NC"],
    ["Research Triangle Park, NC", 'unknown', ["city:Raleigh/NC/US"], [], "Raleigh, NC"],
    ["DMV", 'unknown', ["city:Washington/DC/US"], [], "Washington, DC"],
    ["Tri-State Area", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["Remote - US: Select locations", 'remote', [], ["US"], "Remote · US"],
    ["United States (Remote)", 'remote', [], ["US"], "Remote · US"],
    ["Anywhere in the world", 'remote', [], [], "Remote · Anywhere"],
    ["LATAM", 'unknown', ["region:LATAM"], [], "LATAM"],
    ["Europe", 'unknown', ["region:Europe"], [], "Europe"],
    ["EMEA or APAC", 'unknown', ["region:EMEA","region:APAC"], [], "EMEA +1 more"],
    ["UK & Ireland", 'unknown', ["region:UK & Ireland"], [], "UK & Ireland"],
    ["DACH", 'unknown', ["region:DACH"], [], "DACH"],
    ["Nordics", 'unknown', ["region:Nordics"], [], "Nordics"],
    ["North America", 'unknown', ["region:North America"], [], "North America"],
    ["EST/PST timezones", 'unknown', ["unknown:EST/PST timezones"], [], "EST/PST timezones"],
    ["+2 more", 'unknown', [], [], ""],
    ["London, UK +2 more", 'unknown', ["city:London/ENG/GB"], [], "London, UK"],
    ["New York, NY (HQ)", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["London Office", 'unknown', ["city:London/ENG/GB"], [], "London, UK"],
    ["Berlin HQ", 'unknown', ["city:Berlin/16/DE"], [], "Berlin, Germany"],
    ["San Francisco (SoMa)", 'unknown', ["city:San Francisco/CA/US"], [], "San Francisco, CA"],
    ["NYC - Flatiron", 'unknown', ["city:New York City/NY/US"], [], "New York, NY"],
    ["Remote (must reside in CO, NY, or CA)", 'remote', [], ["US"], "Remote · US"],
    ["Hybrid (3 days/week in Chicago)", 'hybrid', ["city:Chicago/IL/US"], [], "Chicago, IL · Hybrid"],
    ["Onsite - Austin", 'onsite', ["city:Austin/TX/US"], [], "Austin, TX · On-site"],
    ["München", 'unknown', ["city:Munich/02/DE"], [], "Munich, Germany"],
    ["Köln", 'unknown', ["city:Köln/07/DE"], [], "Köln, Germany"],
    ["Zürich", 'unknown', ["city:Zürich/ZH/CH"], [], "Zürich, Switzerland"],
    ["São Paulo", 'unknown', ["city:São Paulo/27/BR"], [], "São Paulo, Brazil"],
    ["Montréal, QC", 'unknown', ["city:Montréal/10/CA"], [], "Montréal, QC"],
    ["Kraków", 'unknown', ["city:Kraków/77/PL"], [], "Kraków, Poland"],
    ["Bogotá", 'unknown', ["city:Bogotá/34/CO"], [], "Bogotá, Colombia"],
    ["Deutschland", 'unknown', ["country:DE"], [], "Germany"],
    ["España", 'unknown', ["country:ES"], [], "Spain"],
    ["Österreich", 'unknown', ["country:AT"], [], "Austria"],
    ["Schweiz", 'unknown', ["country:CH"], [], "Switzerland"],
    ["Nederland", 'unknown', ["country:NL"], [], "Netherlands"],
    ["Italia", 'unknown', ["country:IT"], [], "Italy"],
    ["Polska", 'unknown', ["country:PL"], [], "Poland"],
    ["中国", 'unknown', ["unknown:中国"], [], "中国"],
    ["Remote - EMEA", 'remote', [], 136, "Remote · EMEA"],
    ["Remote, USA", 'remote', [], ["US"], "Remote · US"],
    ["Hybrid - Toronto, ON", 'hybrid', ["city:Toronto/08/CA"], [], "Toronto, ON · Hybrid"],
    ["Remote (PST hours)", 'remote', [], [], "Remote"],
    ["Austin, TX; Denver, CO; Remote", 'remote', ["city:Austin/TX/US","city:Denver/CO/US"], [], "Austin, TX +1 more · Remote"],
    ["London, UK / Berlin, Germany", 'unknown', ["city:London/ENG/GB","city:Berlin/16/DE"], [], "London, UK +1 more"],
    ["NYC or Remote (US)", 'remote', ["city:New York City/NY/US"], ["US"], "New York, NY · Remote (US)"],
    ["Perth, WA", 'unknown', ["city:Perth/08/AU"], [], "Perth, Australia"],
    ["Vancouver, WA", 'unknown', ["city:Vancouver/WA/US"], [], "Vancouver, WA"],
    ["Sydney, NSW", 'unknown', ["city:Sydney/02/AU"], [], "Sydney, Australia"],
    ["Munich, BY", 'unknown', ["city:Munich/02/DE"], [], "Munich, Germany"],
    ["Hyderabad, TG", 'unknown', ["city:Hyderabad/40/IN"], [], "Hyderabad, India"],
    ["Bengaluru, KA", 'unknown', ["city:Bengaluru/19/IN"], [], "Bengaluru, India"],
    ["Melbourne, VIC", 'unknown', ["city:Melbourne/07/AU"], [], "Melbourne, Australia"],
    ["Smallville, TX", 'unknown', ["admin1:TX/US@Smallville"], [], "Smallville, TX"],
    ["Paris, Ontario", 'unknown', ["admin1:08/CA@Paris"], [], "Paris, ON"],
    ["Orange County, CA", 'unknown', ["admin1:CA/US@Orange County"], [], "Orange County, CA"],
    ["Austin TX", 'unknown', ["city:Austin/TX/US"], [], "Austin, TX"],
    ["London UK", 'unknown', ["city:London/ENG/GB"], [], "London, UK"],
    ["Berlin Germany", 'unknown', ["city:Berlin/16/DE"], [], "Berlin, Germany"],
    ["Virgin Islands, British", 'unknown', ["country:VG"], [], "British Virgin Islands"],
    ["Korea, Republic of", 'unknown', ["country:KR"], [], "South Korea"],
    ["Bonaire, Sint Eustatius and Saba", 'unknown', ["country:BQ"], [], "Bonaire"],
    ["Georgia, Florida", 'unknown', ["admin1:GA/US","admin1:FL/US"], [], "Georgia, US +1 more"],
    ["Cambridge; Boston, MA", 'unknown', ["city:Cambridge/MA/US","city:Boston/MA/US"], [], "Cambridge, MA +1 more"],
    ["Paris; New York, NY", 'unknown', ["city:Paris/11/FR","city:New York City/NY/US"], [], "Paris, France +1 more"],
    ["Dublin; San Francisco, CA", 'unknown', ["city:Dublin/L/IE","city:San Francisco/CA/US"], [], "Dublin, Ireland +1 more"],
    ["CO, NY, CA", 'unknown', ["admin1:CO/US","admin1:NY/US","admin1:CA/US"], [], "Colorado, US +2 more"],
    ["US, CA", 'unknown', ["country:US","country:CA"], [], "United States +1 more"],
    ["Remote - Singapore", 'remote', [], ["SG"], "Remote · Singapore"],
    ["Silicon Valley", 'unknown', ["city:San Jose/CA/US"], [], "San Jose, CA"],
    ["Bay Area", 'unknown', ["city:San Francisco/CA/US"], [], "San Francisco, CA"],
    ["Columbus, OH", 'unknown', ["city:Columbus/OH/US"], [], "Columbus, OH"],
    ["Columbus", 'unknown', ["city:Columbus/OH/US"], [], "Columbus, OH"],
    ["Springfield", 'unknown', ["city:Springfield/MO/US"], [], "Springfield, MO"],
    ["Springfield, IL", 'unknown', ["city:Springfield/IL/US"], [], "Springfield, IL"],
    ["Kansas City, KS", 'unknown', ["city:Kansas City/KS/US"], [], "Kansas City, KS"],
    ["St. Louis", 'unknown', ["city:St. Louis/MO/US"], [], "St. Louis, MO"],
    ["Saint Louis, MO", 'unknown', ["city:St. Louis/MO/US"], [], "St. Louis, MO"],
    ["Ft. Lauderdale, FL", 'unknown', ["city:Fort Lauderdale/FL/US"], [], "Fort Lauderdale, FL"],
    ["Frankfurt", 'unknown', ["city:Frankfurt am Main/05/DE"], [], "Frankfurt am Main, Germany"],
    ["Frankfurt am Main", 'unknown', ["city:Frankfurt am Main/05/DE"], [], "Frankfurt am Main, Germany"],
    ["The Hague", 'unknown', ["city:The Hague/11/NL"], [], "The Hague, Netherlands"],
    ["Tel Aviv", 'unknown', ["city:Tel Aviv/05/IL"], [], "Tel Aviv, Israel"],
    ["Hong Kong", 'unknown', ["city:Hong Kong//HK"], [], "Hong Kong"],
    ["Hong Kong SAR", 'unknown', ["city:Hong Kong//HK"], [], "Hong Kong"],
    ["Macau", 'unknown', ["city:Macau//MO"], [], "Macau"],
    ["Remote (9AM-5PM EST)", 'remote', [], [], "Remote"],
    ["Remote - Americas", 'remote', [], 56, "Remote · AMER"],
    ["Americas, EMEA", 'unknown', ["region:AMER","region:EMEA"], [], "AMER +1 more"],
    ["Remote | Anywhere", 'remote', [], [], "Remote · Anywhere"],
    ["North Carolina", 'unknown', ["admin1:NC/US"], [], "North Carolina, US"],
    ["South Africa", 'unknown', ["country:ZA"], [], "South Africa"],
    ["Victoria, BC", 'unknown', ["city:Victoria/02/CA"], [], "Victoria, BC"],
    ["Quebec", 'unknown', ["admin1:10/CA"], [], "Quebec, Canada"],
    ["Quebec City", 'unknown', ["city:Québec/10/CA"], [], "Québec, QC"],
    ["Ontario", 'unknown', ["admin1:08/CA"], [], "Ontario, Canada"],
    ["Orange", 'unknown', ["unknown:Orange"], [], "Orange"],
    ["Remote: Global", 'remote', [], [], "Remote · Anywhere"],
    ["Distributed", 'remote', [], [], "Remote"],
    ["WFH", 'remote', [], [], "Remote"],
    ["In office - NYC", 'onsite', ["city:New York City/NY/US"], [], "New York, NY · On-site"],
    ["Seattle, WA (Hybrid)", 'hybrid', ["city:Seattle/WA/US"], [], "Seattle, WA · Hybrid"],
    ["Denver or Remote", 'remote', ["city:Denver/CO/US"], [], "Denver, CO · Remote"],
    ["Boston, MA / Remote", 'remote', ["city:Boston/MA/US"], [], "Boston, MA · Remote"],
    ["Remote US", 'remote', [], ["US"], "Remote · US"],
    ["USA (Remote)", 'remote', [], ["US"], "Remote · US"],
    ["Remote-EMEA", 'remote', [], 136, "Remote · EMEA"],
    ["Remote - LATAM", 'remote', [], 25, "Remote · LATAM"],
    ["Jersey City, NJ", 'unknown', ["city:Jersey City/NJ/US"], [], "Jersey City, NJ"],
    ["New Jersey", 'unknown', ["admin1:NJ/US"], [], "New Jersey, US"],
    ["Jersey", 'unknown', ["country:JE"], [], "Jersey"],
    ["Sunnyvale, CA", 'unknown', ["city:Sunnyvale/CA/US"], [], "Sunnyvale, CA"],
    ["Mountain View, California", 'unknown', ["city:Mountain View/CA/US"], [], "Mountain View, CA"],
    ["Palo Alto", 'unknown', ["city:Palo Alto/CA/US"], [], "Palo Alto, CA"],
    ["Menlo Park, CA", 'unknown', ["city:Menlo Park/CA/US"], [], "Menlo Park, CA"],
    ["San Jose", 'unknown', ["city:San Jose/CA/US"], [], "San Jose, CA"],
    ["San José, Costa Rica", 'unknown', ["city:San José/08/CR"], [], "San José, Costa Rica"],
    ["Santiago", 'unknown', ["city:Santiago/12/CL"], [], "Santiago, Chile"],
    ["Santiago, Chile", 'unknown', ["city:Santiago/12/CL"], [], "Santiago, Chile"],
    ["Valencia", 'unknown', ["city:Valencia/60/ES"], [], "Valencia, Spain"],
    ["Valencia, Spain", 'unknown', ["city:Valencia/60/ES"], [], "Valencia, Spain"],
    ["Hamburg", 'unknown', ["city:Hamburg/04/DE"], [], "Hamburg, Germany"],
    ["Mexico City", 'unknown', ["city:Mexico City/09/MX"], [], "Mexico City, Mexico"],
    ["Ciudad de México", 'unknown', ["city:Mexico City/09/MX"], [], "Mexico City, Mexico"],
    ["Delhi", 'unknown', ["city:Delhi/07/IN"], [], "Delhi, India"],
    ["New Delhi", 'unknown', ["city:New Delhi/07/IN"], [], "New Delhi, India"],
    ["Delhi NCR", 'unknown', ["city:Delhi/07/IN"], [], "Delhi, India"],
    ["Gurgaon", 'unknown', ["city:Gurugram/10/IN"], [], "Gurugram, India"],
    ["Noida, Uttar Pradesh", 'unknown', ["city:Noida/36/IN"], [], "Noida, India"],
    ["Remote, India", 'remote', [], ["IN"], "Remote · India"],
    ["Tokyo, JP", 'unknown', ["city:Tokyo/40/JP"], [], "Tokyo, Japan"],
    ["Seoul, South Korea", 'unknown', ["city:Seoul/11/KR"], [], "Seoul, South Korea"],
    ["Shanghai, CN", 'unknown', ["city:Shanghai/23/CN"], [], "Shanghai, China"],
    ["Taipei", 'unknown', ["city:Taipei/04/TW"], [], "Taipei, Taiwan"],
    ["Remote - Brazil", 'remote', [], ["BR"], "Remote · Brazil"],
    ["Brasil", 'unknown', ["country:BR"], [], "Brazil"],
    ["Lisbon, Portugal", 'unknown', ["city:Lisbon/14/PT"], [], "Lisbon, Portugal"],
    ["Lisboa", 'unknown', ["city:Lisbon/14/PT"], [], "Lisbon, Portugal"],
    ["Porto", 'unknown', ["city:Porto/17/PT"], [], "Porto, Portugal"],
    ["Remote — Canada", 'remote', [], ["CA"], "Remote · Canada"],
    ["Toronto–Waterloo", 'unknown', ["city:Toronto/08/CA","city:Waterloo/08/CA"], [], "Toronto, ON +1 more"],
    ["Kitchener-Waterloo, ON", 'unknown', ["city:Kitchener/08/CA"], [], "Kitchener, ON"],
    ["Winston-Salem, NC", 'unknown', ["city:Winston-Salem/NC/US"], [], "Winston-Salem, NC"],
    ["Wilkes-Barre, PA", 'unknown', ["city:Wilkes-Barre/PA/US"], [], "Wilkes-Barre, PA"],
    ["Aix-en-Provence", 'unknown', ["city:Aix-en-Provence/93/FR"], [], "Aix-en-Provence, France"],
    ["Remote (Anywhere)", 'remote', [], [], "Remote · Anywhere"],
    ["Anywhere (US)", 'remote', [], ["US"], "Remote · US"],
    ["Work from home - US", 'remote', [], ["US"], "Remote · US"],
    ["Telecommute", 'remote', [], [], "Remote"],
];

describe('parseJobLocation: real fixture strings', () => {
  check(REAL_STRINGS);
});

describe('parseJobLocation: real strings on remote-only boards', () => {
  check(REMOTE_BOARD_STRINGS, { remote: 'remote' });
});

describe('parseJobLocation: awkward inputs', () => {
  check(AWKWARD);
});

describe('parseJobLocation: ambiguity rules', () => {
  it('"City, XX" prefers a US state, then a Canadian province, then an ISO country, among places that have the city', () => {
    expect(summary(parse('Cambridge, MA')).places).toEqual(['city:Cambridge/MA/US']);
    expect(summary(parse('Cambridge, UK')).places).toEqual(['city:Cambridge/ENG/GB']);
    expect(summary(parse('London, ON')).places).toEqual(['city:London/08/CA']);
    expect(summary(parse('Toronto, CA')).places).toEqual(['city:Toronto/08/CA']); // no Toronto in California
    expect(summary(parse('Perth, WA')).places).toEqual(['city:Perth/08/AU']); // no Perth in Washington
    expect(summary(parse('Vancouver, WA')).places).toEqual(['city:Vancouver/WA/US']);
    expect(summary(parse('Munich, BY')).places).toEqual(['city:Munich/02/DE']); // BY is Belarus too, but has no Munich
    expect(summary(parse('Sydney, NSW')).places).toEqual(['city:Sydney/02/AU']);
  });

  it('a lone ambiguous city goes to the most populous candidate (deliberate)', () => {
    expect(summary(parse('Cambridge')).places).toEqual(['city:Cambridge/ENG/GB']);
    expect(summary(parse('Portland')).places).toEqual(['city:Portland/OR/US']);
    expect(summary(parse('Birmingham')).places).toEqual(['city:Birmingham/ENG/GB']);
    expect(summary(parse('Paris')).places).toEqual(['city:Paris/11/FR']);
    expect(summary(parse('Springfield')).places).toEqual(['city:Springfield/MO/US']);
  });

  it('the job\'s other places tip an ambiguous city towards their country when it is not tiny there', () => {
    expect(summary(parse(['Cambridge', 'Boston, MA'])).places).toEqual(['city:Cambridge/MA/US', 'city:Boston/MA/US']);
    expect(summary(parse('Birmingham; Atlanta, GA')).places[0]).toBe('city:Birmingham/AL/US');
    // Paris, TX and Dublin, CA are under 10% of their famous namesakes: no switch.
    expect(summary(parse('Paris; New York, NY')).places[0]).toBe('city:Paris/11/FR');
    expect(summary(parse('Dublin; San Francisco, CA')).places[0]).toBe('city:Dublin/L/IE');
    // A country-level US place is context for cities too.
    expect(summary(parse(['Cambridge', 'United States'])).places[0]).toBe('city:Cambridge/MA/US');
  });

  it('Georgia: country alone, state with Atlanta or with other US places', () => {
    expect(summary(parse('Georgia')).places).toEqual(['country:GE']);
    expect(summary(parse('Atlanta, Georgia')).places).toEqual(['city:Atlanta/GA/US']);
    expect(summary(parse('Tbilisi, Georgia')).places).toEqual(['city:Tbilisi/51/GE']);
    expect(summary(parse('GA')).places).toEqual(['admin1:GA/US']);
    expect(summary(parse(['Atlanta', 'Georgia'])).places).toEqual(['city:Atlanta/GA/US', 'admin1:GA/US']);
    expect(summary(parse('Georgia, United States')).places).toEqual(['admin1:GA/US']);
  });

  it('Washington and New York', () => {
    expect(summary(parse('Washington')).places).toEqual(['admin1:WA/US']);
    for (const s of ['Washington, DC', 'Washington, D.C.', 'Washington DC', 'DC', 'Washington, District of Columbia, United States']) {
      expect(summary(parse(s)).places, s).toEqual(['city:Washington/DC/US']);
    }
    expect(summary(parse('Washington State')).places).toEqual(['admin1:WA/US']);
    expect(summary(parse('Seattle, Washington')).places).toEqual(['city:Seattle/WA/US']);
    expect(summary(parse('New York')).places).toEqual(['city:New York City/NY/US']);
    expect(summary(parse('New York, NY')).places).toEqual(['city:New York City/NY/US']);
    expect(summary(parse('New York State')).places).toEqual(['admin1:NY/US']);
    expect(summary(parse('Upstate New York')).places).toEqual(['admin1:NY/US']);
  });

  it('lone two-letter codes: ISO country for big job markets, US state otherwise, US state with US context', () => {
    const one = (s: string) => summary(parse(s)).places[0];
    expect(one('CA')).toBe('country:CA');
    expect(one('IN')).toBe('country:IN');
    expect(one('DE')).toBe('country:DE');
    expect(one('ID')).toBe('country:ID');
    expect(one('AR')).toBe('country:AR');
    expect(one('IL')).toBe('country:IL');
    expect(one('MA')).toBe('country:MA');
    expect(one('PA')).toBe('admin1:PA/US');
    expect(one('ME')).toBe('admin1:ME/US');
    expect(one('OR')).toBe('admin1:OR/US');
    expect(one('LA')).toBe('city:Los Angeles/CA/US');
    expect(summary(parse(['CA', 'Austin, TX'])).places[0]).toBe('admin1:CA/US');
    expect(summary(parse(['IN', 'Chicago, IL'])).places[0]).toBe('admin1:IN/US');
    expect(summary(parse(['DE', 'Philadelphia, PA'])).places[0]).toBe('admin1:DE/US');
    expect(summary(parse('CO, NY, CA')).places).toEqual(['admin1:CO/US', 'admin1:NY/US', 'admin1:CA/US']);
    // A bare US country is not state-level context: "US, CA" is two countries.
    expect(summary(parse('US, CA')).places).toEqual(['country:US', 'country:CA']);
    expect(summary(parse('CA, US')).places).toEqual(['admin1:CA/US']);
  });

  it('LA as a city and as a state', () => {
    expect(summary(parse('Los Angeles, CA')).places).toEqual(['city:Los Angeles/CA/US']);
    expect(summary(parse('LA, CA')).places).toEqual(['city:Los Angeles/CA/US']);
    expect(summary(parse('Baton Rouge, LA')).places).toEqual(['city:Baton Rouge/LA/US']);
  });

  it('the words "or" and "in" are never Oregon or Indiana', () => {
    expect(summary(parse('NYC or SF')).places).toEqual(['city:New York City/NY/US', 'city:San Francisco/CA/US']);
    expect(summary(parse('Portland, OR')).places).toEqual(['city:Portland/OR/US']);
    expect(summary(parse('Portland, OR / Seattle, WA')).places).toEqual(['city:Portland/OR/US', 'city:Seattle/WA/US']);
    expect(summary(parse('Remote in Canada')).scope).toEqual(['CA']);
    expect(summary(parse('Indianapolis, IN')).places).toEqual(['city:Indianapolis/IN/US']);
    expect(summary(parse('or')).places).toEqual([]);
    expect(summary(parse('in')).places).toEqual([]);
  });

  it('ordinary words never become places; city-named words only with a qualifier', () => {
    for (const s of ['Remote', 'Hybrid', 'Flexible', 'Multiple Locations', 'Various', 'Nationwide', 'Global', 'HQ', 'Headquarters', 'Office', 'TBD', 'N/A', 'Home', 'Field', 'Mobile', 'Of', 'Enterprise', 'Media', 'Normal', 'Industry']) {
      expect(summary(parse(s)).places, s).toEqual([]);
    }
    expect(summary(parse('Mobile, AL')).places).toEqual(['city:Mobile/AL/US']);
    expect(summary(parse('Normal, IL')).places).toEqual(['city:Normal/IL/US']);
    expect(summary(parse('Media, PA')).places).toEqual(['admin1:PA/US@Media']);
    // Reading/Bath/Nice/Split: the place when the whole string, or with a country/county.
    expect(summary(parse('Reading')).places).toEqual(['city:Reading/ENG/GB']);
    expect(summary(parse('Reading, Berkshire')).places).toEqual(['city:Reading/ENG/GB']);
    expect(summary(parse('Nice')).places).toEqual(['city:Nice/93/FR']);
    expect(summary(parse('Reading; London')).places).toEqual(['unknown:Reading', 'city:London/ENG/GB']);
    expect(summary(parse('Nice, France')).places).toEqual(['city:Nice/93/FR']);
    expect(summary(parse('Split, Croatia')).places).toEqual(['city:Split/15/HR']);
  });

  it('localities missing from the gazetteer keep their name on the admin1/country', () => {
    const r = parse('Smallville, TX');
    expect(r.location.places).toHaveLength(1);
    expect(r.location.places[0]).toMatchObject({ kind: 'admin1', admin1: 'TX', country: 'US', city: 'Smallville', label: 'Smallville, TX' });
    expect(r.location.places[0]?.lat).toBeUndefined();
    expect(summary(parse('Paris, Ontario')).places).toEqual(['admin1:08/CA@Paris']);
  });

  it('city-states resolve to their city', () => {
    for (const s of ['Singapore', 'SG', 'Singapore, Singapore', 'Hong Kong', 'Hong Kong SAR', 'Macau', 'Monaco']) {
      expect(summary(parse(s)).places[0], s).toMatch(/^city:/);
    }
  });
});

describe('parseJobLocation: separators and decorations', () => {
  it('splits lists but keeps "City, ST" pairs and names containing separators', () => {
    expect(summary(parse('Austin, TX | Denver, CO')).places).toEqual(['city:Austin/TX/US', 'city:Denver/CO/US']);
    expect(summary(parse('Toronto, ON, Canada or Vancouver, BC, Canada')).places).toEqual(['city:Toronto/08/CA', 'city:Vancouver/02/CA']);
    expect(summary(parse('Trinidad and Tobago')).places).toEqual(['country:TT']);
    expect(summary(parse('UK & Ireland')).places).toEqual(['region:UK & Ireland']);
    expect(summary(parse('Dallas/Fort Worth')).places).toEqual(['city:Dallas/TX/US']);
    expect(summary(parse('Korea, Republic of')).places).toEqual(['country:KR']);
    expect(summary(parse('London\nBerlin')).places).toEqual(['city:London/ENG/GB', 'city:Berlin/16/DE']);
    expect(summary(parse('London • Berlin · Paris')).places).toEqual(['city:London/ENG/GB', 'city:Berlin/16/DE', 'city:Paris/11/FR']);
  });

  it('reads ATS dash formats both ways', () => {
    expect(summary(parse('US - CA - San Francisco')).places).toEqual(['city:San Francisco/CA/US']);
    expect(summary(parse('USA-NY-New York')).places).toEqual(['city:New York City/NY/US']);
    expect(summary(parse('Massachusetts - Boston')).places).toEqual(['city:Boston/MA/US']);
    expect(summary(parse('US-SF-HQ')).places).toEqual(['city:San Francisco/CA/US']);
    expect(summary(parse('Winston-Salem, NC')).places).toEqual(['city:Winston-Salem/NC/US']);
  });

  it('drops neighbourhood/office decorations', () => {
    for (const [s, p] of [
      ['New York, NY (HQ)', 'city:New York City/NY/US'],
      ['London Office', 'city:London/ENG/GB'],
      ['Berlin HQ', 'city:Berlin/16/DE'],
      ['San Francisco (SoMa)', 'city:San Francisco/CA/US'],
      ['NYC - Flatiron', 'city:New York City/NY/US'],
      ['Greater Seattle Area', 'city:Seattle/WA/US'],
      ['Los Angeles Metropolitan Area', 'city:Los Angeles/CA/US'],
    ] as const) {
      expect(summary(parse(s)).places, s).toEqual([p]);
    }
  });

  it('handles diacritics, native names, mojibake, emoji flags and "+N more"', () => {
    expect(summary(parse('München')).places).toEqual(['city:Munich/02/DE']);
    expect(summary(parse('Muenchen')).places).toEqual(['city:Munich/02/DE']);
    expect(summary(parse('MÃ¼nchen')).places).toEqual(['city:Munich/02/DE']);
    expect(summary(parse('Montréal, QC')).places).toEqual(['city:Montréal/10/CA']);
    expect(summary(parse('Montreal, Quebec')).places).toEqual(['city:Montréal/10/CA']);
    expect(summary(parse('Sao Paulo, Brazil')).places).toEqual(['city:São Paulo/27/BR']);
    expect(summary(parse('🇩🇪 Germany')).places).toEqual(['country:DE']);
    expect(summary(parse('London, UK +2 more')).places).toEqual(['city:London/ENG/GB']);
    expect(summary(parse('+2 more')).places).toEqual([]);
    expect(summary(parse('中国')).places).toEqual(['unknown:中国']);
  });

  it('keeps unresolvable text as one unknown place and timezone-only strings as unknown', () => {
    expect(summary(parse('EST/PST timezones')).places).toEqual(['unknown:EST/PST timezones']);
    expect(summary(parse('Black Bess,')).places).toEqual(['unknown:Black Bess']);
    expect(summary(parse('London; Blahville')).places).toEqual(['city:London/ENG/GB', 'unknown:Blahville']);
  });
});

describe('parseJobLocation: work arrangement', () => {
  it('source hint wins', () => {
    expect(parse('Remote', { remote: 'onsite' }).location.remote).toBe('onsite');
    expect(parse('Austin, TX', { remote: 'hybrid' }).text).toBe('Austin, TX · Hybrid');
    expect(parse('Austin, TX', { remote: 'onsite' }).text).toBe('Austin, TX · On-site');
  });

  it('never guesses on-site', () => {
    expect(parse('Austin, TX').location.remote).toBe('unknown');
    expect(parse('Austin, TX', { descriptionText: 'You will work in our Austin office five days a week.' }).location.remote).toBe('unknown');
  });

  it('reads markers in the location strings', () => {
    expect(summary(parse('Hybrid - Toronto, ON'))).toMatchObject({ remote: 'hybrid', places: ['city:Toronto/08/CA'], text: 'Toronto, ON · Hybrid' });
    expect(summary(parse('Seattle, WA (Hybrid)'))).toMatchObject({ remote: 'hybrid', places: ['city:Seattle/WA/US'] });
    expect(summary(parse('Onsite - Austin'))).toMatchObject({ remote: 'onsite', places: ['city:Austin/TX/US'], text: 'Austin, TX · On-site' });
    expect(summary(parse('Remote/Hybrid'))).toMatchObject({ remote: 'remote' });
    expect(summary(parse('Hybrid (3 days/week in Chicago)'))).toMatchObject({ remote: 'hybrid', places: ['city:Chicago/IL/US'] });
    for (const s of ['WFH', 'Work from home', 'Distributed', 'Telecommute', 'Homeoffice', 'Remote (PST hours)', 'Remote (9AM-5PM EST)']) {
      expect(summary(parse(s)), s).toMatchObject({ remote: 'remote', places: [], scope: [] });
    }
  });

  it('falls back to the title, then tags, then (conservatively) the description', () => {
    expect(parse('Austin, TX', { title: 'Senior Engineer (Remote)' }).location.remote).toBe('remote');
    expect(parse('Austin, TX', { title: 'Backend Engineer - Remote US' }).location.remote).toBe('remote');
    expect(parse('Austin, TX', { title: 'Remote Sensing Scientist' }).location.remote).toBe('unknown');
    expect(parse('Austin, TX', { title: 'Remote Support Engineer' }).location.remote).toBe('unknown');
    expect(parse('Austin, TX', { title: 'Hybrid Cloud Architect' }).location.remote).toBe('unknown');
    expect(parse('Austin, TX', { title: 'Product Designer [Hybrid]' }).location.remote).toBe('hybrid');
    expect(parse('Austin, TX', { tags: ['python', 'Remote'] }).location.remote).toBe('remote');
    expect(parse('Austin, TX', { descriptionText: 'About the role. This is a fully remote role open across the US.' }).location.remote).toBe('remote');
    expect(parse('Austin, TX', { descriptionText: 'We have a remote-first culture and great snacks.' }).location.remote).toBe('unknown');
    expect(parse('Austin, TX', { descriptionText: 'This position is remote. Note: this is not a remote role for the first 90 days.' }).location.remote).toBe('unknown');
    expect(parse('Austin, TX', { descriptionText: 'No remote work. On-site only.' }).location.remote).toBe('unknown');
    expect(parse('Austin, TX', { descriptionText: 'This is a hybrid role with three days a week in the office.' }).location.remote).toBe('hybrid');
    // The location strings win over the title.
    expect(parse('Hybrid - Austin, TX', { title: 'Engineer (Remote)' }).location.remote).toBe('hybrid');
  });
});

describe('parseJobLocation: remote scope', () => {
  it('reads scope next to remote markers and keeps it out of places', () => {
    expect(summary(parse('Remote (US)'))).toEqual({ remote: 'remote', places: [], scope: ['US'], text: 'Remote · US' });
    expect(summary(parse('United States (Remote)'))).toEqual({ remote: 'remote', places: [], scope: ['US'], text: 'Remote · US' });
    expect(summary(parse('Remote - US: Select locations'))).toEqual({ remote: 'remote', places: [], scope: ['US'], text: 'Remote · US' });
    expect(summary(parse('Remote (must reside in CO, NY, or CA)')).scope).toEqual(['US']);
    expect(summary(parse('Remote - EMEA'))).toMatchObject({ scope: regionCountries('EMEA'), text: 'Remote · EMEA' });
    expect(summary(parse('Anywhere (US)'))).toMatchObject({ remote: 'remote', scope: ['US'] });
    expect(summary(parse('London / Berlin / Remote (EU)'))).toEqual({
      remote: 'remote',
      places: ['city:London/ENG/GB', 'city:Berlin/16/DE'],
      scope: regionCountries('EU'),
      text: 'London, UK +1 more · Remote (EU)',
    });
    expect(summary(parse('San Francisco, CA; New York, NY; Remote'))).toEqual({
      remote: 'remote',
      places: ['city:San Francisco/CA/US', 'city:New York City/NY/US'],
      scope: [],
      text: 'San Francisco, CA +1 more · Remote',
    });
  });

  it('anywhere means no restriction and wins over listed areas', () => {
    expect(summary(parse('Anywhere in the world'))).toEqual({ remote: 'remote', places: [], scope: [], text: 'Remote · Anywhere' });
    expect(summary(parse(['Worldwide', 'USA']))).toMatchObject({ remote: 'remote', scope: [], text: 'Remote · Anywhere' });
  });

  it('on a remote board, country/region lists are scope; regions expand to ISO codes', () => {
    expect(summary(parse(['USA', 'Canada'], { remote: 'remote' }))).toEqual({ remote: 'remote', places: [], scope: ['CA', 'US'], text: 'Remote · US, Canada' });
    expect(summary(parse(['Anywhere'], { remote: 'remote' }))).toEqual({ remote: 'remote', places: [], scope: [], text: 'Remote · Anywhere' });
    expect(summary(parse(['Europe'], { remote: 'remote' })).scope).toEqual(regionCountries('Europe'));
    const americasEmea = [...new Set([...regionCountries('AMER'), ...regionCountries('EMEA')])].sort();
    expect(summary(parse(['Americas', 'EMEA'], { remote: 'remote' }))).toMatchObject({ places: [], scope: americasEmea, text: 'Remote · AMER, EMEA' });
    expect(summary(parse(['California', 'Texas'], { remote: 'remote' }))).toMatchObject({ places: [], scope: ['US'] });
    expect(parse(['DE', 'AT', 'CH', 'NL', 'BE'], { remote: 'remote' }).text).toBe('Remote · Germany, Austria, Switzerland +2 more');
  });

  it('hybrid and unknown jobs keep countries as places and have no scope', () => {
    expect(summary(parse('United States', { remote: 'hybrid' }))).toEqual({ remote: 'hybrid', places: ['country:US'], scope: [], text: 'United States · Hybrid' });
    expect(summary(parse('Canada'))).toEqual({ remote: 'unknown', places: ['country:CA'], scope: [], text: 'Canada' });
  });

  it('reads eligibility phrases in the description only when the locations gave none', () => {
    const scopeOf = (descriptionText: string, locations = ['Remote']) => parse(locations, { descriptionText }).location.remoteScope;
    expect(scopeOf('Candidates must be based in the United States or Canada.')).toEqual(['CA', 'US']);
    expect(scopeOf('This role is open to candidates in the EU.')).toEqual(regionCountries('EU'));
    expect(scopeOf('Benefits... (US only)')).toEqual(['US']);
    expect(scopeOf('We are hiring UK-based candidates for this team.')).toEqual(['GB']);
    expect(scopeOf('You must reside in and be authorized to work in Canada.')).toEqual(['CA']);
    expect(scopeOf('You can work remotely from anywhere in Germany.')).toEqual(['DE']);
    expect(scopeOf('Applicants should be located in California or Texas.')).toEqual(['US']);
    // Bare work-authorisation boilerplate is not a location restriction.
    expect(scopeOf('You must be authorized to work in the United States.')).toEqual([]);
    // Company facts are not restrictions.
    expect(scopeOf('We are a US-based company with offices in London.')).toEqual([]);
    expect(scopeOf('Must be located in the Pacific time zone.')).toEqual([]);
    expect(scopeOf('Must be based in a city with a good airport.')).toEqual([]);
    // "Georgia" in prose could be either: no restriction rather than a wrong one.
    expect(scopeOf('Candidates must be based in Georgia.')).toEqual([]);
    expect(parse(['Remote'], { descriptionText: 'Work from anywhere in the world!' }).text).toBe('Remote · Anywhere');
    // Locations already gave a scope: the description is not consulted.
    expect(scopeOf('Candidates must be based in Canada.', ['Remote (US)'])).toEqual(['US']);
    // Not remote: no scope at all.
    expect(parse(['Austin, TX'], { remote: 'hybrid', descriptionText: 'Must be based in the US.' }).location.remoteScope).toEqual([]);
  });
});

describe('parseJobLocation: display text', () => {
  it('composes places and arrangement compactly', () => {
    expect(parse('Austin, TX', { remote: 'hybrid' }).text).toBe('Austin, TX · Hybrid');
    expect(parse(['USA', 'Canada'], { remote: 'remote' }).text).toBe('Remote · US, Canada');
    expect(parse('Anywhere').text).toBe('Remote · Anywhere');
    expect(parse(['London, UK', 'Berlin', 'Paris', 'Madrid']).text).toBe('London, UK +3 more');
    expect(parse('NYC or Remote (US)').text).toBe('New York, NY · Remote (US)');
    expect(parse('Multiple Locations').text).toBe('Multiple Locations');
    expect(parse([]).text).toBe('');
    expect(parse(['N/A']).text).toBe('');
  });

  it('labels follow regional conventions', () => {
    const label = (s: string) => parse(s).location.places[0]?.label;
    expect(label('Austin, TX')).toBe('Austin, TX');
    expect(label('Toronto, Ontario, Canada')).toBe('Toronto, ON');
    expect(label('London')).toBe('London, UK');
    expect(label('Berlin')).toBe('Berlin, Germany');
    expect(label('Dubai')).toBe('Dubai, UAE');
    expect(label('California')).toBe('California, US');
    expect(label('Ontario')).toBe('Ontario, Canada');
    expect(label('Germany')).toBe('Germany');
    expect(label('EMEA')).toBe('EMEA');
    expect(label('New York')).toBe('New York, NY');
    expect(label('Singapore')).toBe('Singapore');
  });
});

describe('parseJobLocation: robustness', () => {
  it('survives hostile input', () => {
    const inputs = [
      '', '   ', ',', ';;;', '()', '((((', '))))', '[', '-', '—', '/', '|', '&', 'and', 'or or or', '????', '12345', '+', '++2',
      'a'.repeat(5000), 'Remote '.repeat(500), 'London, '.repeat(300), '<b>London</b>', 'London &amp; Paris', '\u0000\u0001',
      'NULL', 'undefined', '{"city":"Berlin"}', 'Lon​don', '🙂', '🇺🇸', 'US-', '-US', 'Remote (', 'Remote )', '(Remote',
      'St.', 'St. ', 'Ft', 'Mt.', 'The', 'the the', 'Remote - - - US', 'Remote ((US))', 'Remote [US]', 'Remote {US}',
    ];
    for (const s of inputs) {
      const r = parse(s);
      expect(Array.isArray(r.location.places), JSON.stringify(s)).toBe(true);
      expect(typeof r.text).toBe('string');
    }
    expect(summary(parse('Remote [US]')).scope).toEqual(['US']);
    expect(summary(parse('Remote ((US))')).remote).toBe('remote');
    expect(summary(parse('London &amp; Paris')).places).toEqual(['city:London/ENG/GB', 'city:Paris/11/FR']);
    expect(parse(['', '  ', 'Berlin']).location.places.map(enc)).toEqual(['city:Berlin/16/DE']);
    // De-duplicates the same place given twice.
    expect(parse(['New York, NY', 'NYC', 'New York City']).location.places).toHaveLength(1);
  });

  it('is fast enough for ingest', () => {
    const corpus = [...REAL_STRINGS.map((c) => c[0]), ...AWKWARD.map((c) => c[0])];
    const t0 = performance.now();
    let n = 0;
    while (performance.now() - t0 < 300) {
      for (const s of corpus) parseJobLocation({ locations: [s] });
      n += corpus.length;
    }
    const perSecond = (n / (performance.now() - t0)) * 1000;
    expect(perSecond).toBeGreaterThan(20_000);
    let desc = '';
    while (desc.length < 5000) desc += 'We build tools for teams and value ownership, curiosity and clear writing. ';
    desc += 'This is a fully remote role. Candidates must be based in the United States or Canada.';
    const t1 = performance.now();
    const m = 400;
    for (let i = 0; i < m; i++) parseJobLocation({ locations: ['Remote'], descriptionText: desc + i, title: 'Engineer' });
    expect((m / (performance.now() - t1)) * 1000).toBeGreaterThan(2_000);
  });
});

describe('resolvePlace', () => {
  it('is forgiving of case, punctuation and missing commas', () => {
    const r = (s: string) => {
      const p = resolvePlace(s);
      return p ? enc(p) : undefined;
    };
    expect(r('austin tx')).toBe('city:Austin/TX/US');
    expect(r('Austin, TX')).toBe('city:Austin/TX/US');
    expect(r('new york ny')).toBe('city:New York City/NY/US');
    expect(r('london uk')).toBe('city:London/ENG/GB');
    expect(r('london ontario')).toBe('city:London/08/CA');
    expect(r('portland or')).toBe('city:Portland/OR/US');
    expect(r('portland me')).toBe('city:Portland/ME/US');
    expect(r('sf')).toBe('city:San Francisco/CA/US');
    expect(r('bay area')).toBe('city:San Francisco/CA/US');
    expect(r('NYC')).toBe('city:New York City/NY/US');
    expect(r('nyc')).toBe('city:New York City/NY/US');
    expect(r('münchen')).toBe('city:Munich/02/DE');
    expect(r('sao paulo')).toBe('city:São Paulo/27/BR');
    expect(r('Germany')).toBe('country:DE');
    expect(r('germany')).toBe('country:DE');
    expect(r('EMEA')).toBe('region:EMEA');
    expect(r('emea')).toBe('region:EMEA');
    expect(r('california')).toBe('admin1:CA/US');
    expect(r('texas')).toBe('admin1:TX/US');
    expect(r('ga')).toBe('admin1:GA/US');
    expect(r('ca')).toBe('country:CA');
    expect(r('  Berlin!! ')).toBe('city:Berlin/16/DE');
    expect(r('Remote US')).toBe('country:US');
  });

  it('returns kind anywhere for remote/anywhere/worldwide and undefined for gibberish', () => {
    for (const s of ['remote', 'Remote', 'anywhere', 'Worldwide', 'work from home']) expect(resolvePlace(s)?.kind, s).toBe('anywhere');
    expect(resolvePlace('remote')?.label).toBe('Anywhere');
    for (const s of ['', '   ', 'asdfghjkl', 'zzzz qqqq', '12345', 'TBD', 'N/A', 'Multiple Locations', 'Mobile']) expect(resolvePlace(s), s).toBeUndefined();
  });

  it('keeps the typed text as raw and fills coordinates for cities', () => {
    const p = resolvePlace('austin tx');
    expect(p).toMatchObject({ kind: 'city', raw: 'austin tx', city: 'Austin', admin1: 'TX', admin1Name: 'Texas', country: 'US', countryName: 'United States', label: 'Austin, TX' });
    expect(p?.lat).toBeCloseTo(30.27, 1);
    expect(p?.population).toBeGreaterThan(500_000);
  });
});

describe('suggestPlaces', () => {
  const labels = (q: string, n?: number) => suggestPlaces(q, n).map((p) => p.label);

  it('ranks big places first and surfaces countries/states early', () => {
    expect(labels('ger')[0]).toBe('Germany');
    expect(labels('cal')[0]).toBe('California, US');
    expect(labels('cal')).toEqual(expect.arrayContaining(['Calgary, AB', 'Cali, Colombia']));
    expect(labels('new')[0]).toBe('New York, NY');
    expect(labels('new')).toContain('New York, US');
    expect(labels('lon')[0]).toBe('London, UK');
    expect(labels('san f')[0]).toBe('San Francisco, CA');
    expect(labels('EMEA')[0]).toBe('EMEA');
  });

  it('is diacritic-insensitive, handles "city qualifier" queries and falls back to contains', () => {
    expect(labels('sao')[0]).toBe('São Paulo, Brazil');
    expect(labels('zur')).toContain('Zürich, Switzerland');
    expect(labels('austin tx')).toEqual(['Austin, TX']);
    expect(labels('portland, me')).toEqual(['Portland, ME']);
    expect(labels('york')).toEqual(expect.arrayContaining(['York, UK', 'New York, NY']));
    expect(labels('zzzzzz')).toEqual([]);
    expect(labels('')).toEqual([]);
  });

  it('respects the limit, has no duplicates, offers Anywhere for remote-ish queries', () => {
    expect(suggestPlaces('b', 3)).toHaveLength(3);
    const l = labels('san', 20);
    expect(new Set(l).size).toBe(l.length);
    expect(suggestPlaces('rem')[0]?.kind).toBe('anywhere');
    expect(suggestPlaces('any')[0]?.kind).toBe('anywhere');
  });

  it('answers in a few milliseconds', () => {
    suggestPlaces('warm-up');
    expect(suggestIndexStats().buildMs).toBeLessThan(1000);
    const qs = ['g', 'ge', 'ger', 'new y', 'mü', 'sao p', 'austin tx', 'zzzz', 'york', 'b'];
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) for (const q of qs) suggestPlaces(q);
    const avg = (performance.now() - t0) / (20 * qs.length);
    expect(avg).toBeLessThan(5);
  });
});

describe('index', () => {
  it('builds lazily and quickly', () => {
    const s = locationIndexStats();
    expect(s.cities).toBeGreaterThan(30_000);
    expect(s.buildMs).toBeLessThan(1000); // ~110-140 ms measured; generous for slow CI
  });
});

describe('countryName / countryShortName / placeLabel', () => {
  it('names countries', () => {
    expect(countryName('US')).toBe('United States');
    expect(countryName('de')).toBe('Germany');
    expect(countryName('XX')).toBeUndefined();
    expect(countryName('')).toBeUndefined();
    expect(countryShortName('GB')).toBe('UK');
    expect(countryShortName('AE')).toBe('UAE');
    expect(countryShortName('FR')).toBe('France');
  });

  it('labels hand-built places', () => {
    expect(placeLabel({ kind: 'city', raw: 'x', city: 'Austin', admin1: 'TX', country: 'US' })).toBe('Austin, TX');
    expect(placeLabel({ kind: 'city', raw: 'x', city: 'Toronto', admin1: '08', country: 'CA' })).toBe('Toronto, ON');
    expect(placeLabel({ kind: 'city', raw: 'x', city: 'London', admin1: 'ENG', country: 'GB' })).toBe('London, UK');
    expect(placeLabel({ kind: 'city', raw: 'x', city: 'New York City', admin1: 'NY', country: 'US' })).toBe('New York, NY');
    expect(placeLabel({ kind: 'city', raw: 'x', city: 'Springfield', country: 'US' })).toBe('Springfield, US');
    expect(placeLabel({ kind: 'admin1', raw: 'x', admin1: 'CA', admin1Name: 'California', country: 'US' })).toBe('California, US');
    expect(placeLabel({ kind: 'admin1', raw: 'x', admin1: '08', country: 'CA' })).toBe('Ontario, Canada');
    expect(placeLabel({ kind: 'country', raw: 'x', country: 'DE' })).toBe('Germany');
    expect(placeLabel({ kind: 'region', raw: 'x', region: 'EMEA', countries: [] })).toBe('EMEA');
    expect(placeLabel({ kind: 'anywhere', raw: 'worldwide' })).toBe('Anywhere');
    expect(placeLabel({ kind: 'unknown', raw: '  Black   Bess ' })).toBe('Black Bess');
    expect(placeLabel({ kind: 'city', raw: 'Somewhere' })).toBe('Somewhere');
  });
});

describe('distanceKm', () => {
  it('measures great-circle distance', () => {
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
    expect(distanceKm({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 })).toBeCloseTo(344, -1);
  });
});

describe('matchPlace', () => {
  const place = (s: string): Place => {
    const p = resolvePlace(s);
    if (!p) throw new Error(`cannot resolve ${s}`);
    return p;
  };
  const job = (locations: string | string[], extra: Omit<LocationInput, 'locations'> = {}): JobLocation => parse(locations, extra).location;
  const sf = place('San Francisco, CA');

  it('target city: same city, radius, never a containing admin1/country', () => {
    expect(matchPlace(job('San Francisco, CA'), sf)).toEqual({ kind: 'city', distanceKm: 0 });
    expect(matchPlace(job('SF Bay Area'), sf).kind).toBe('city');
    expect(matchPlace(job('Oakland, CA'), sf).kind).toBe('none');
    expect(matchPlace(job('Oakland, CA'), sf, { radiusKm: 0 }).kind).toBe('none');
    const oak = matchPlace(job('Oakland, CA'), sf, { radiusKm: 25 });
    expect(oak.kind).toBe('radius');
    expect(oak.distanceKm).toBeGreaterThan(5);
    expect(oak.distanceKm).toBeLessThan(25);
    expect(matchPlace(job('Berkeley, CA'), sf, { radiusKm: 25 }).kind).toBe('radius');
    expect(matchPlace(job('San Jose, CA'), sf, { radiusKm: 25 }).kind).toBe('none');
    expect(matchPlace(job('California'), sf).kind).toBe('none');
    expect(matchPlace(job('United States'), sf, { radiusKm: 100 }).kind).toBe('none');
    expect(matchPlace(job('EMEA'), place('London')).kind).toBe('none');
  });

  it('radius edges are inclusive and measured between city coordinates', () => {
    const kmPerDeg = distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    const target = makePlace({ kind: 'city', raw: 't', city: 'Origin', country: 'ZZ', lat: 0, lon: 0 });
    const at = (km: number): JobLocation => ({
      places: [makePlace({ kind: 'city', raw: 'j', city: `C${km}`, country: 'ZZ', lat: km / kmPerDeg, lon: 0 })],
      remote: 'unknown',
      remoteScope: [],
    });
    expect(matchPlace(at(49), target, { radiusKm: 50 })).toEqual({ kind: 'radius', distanceKm: 49 });
    expect(matchPlace(at(51), target, { radiusKm: 50 }).kind).toBe('none');
    expect(matchPlace(at(50), target, { radiusKm: 50 }).kind).toBe('radius');
  });

  it('target admin1/country/region: job inside it', () => {
    const ca = place('California');
    expect(matchPlace(job('Oakland, CA'), ca)).toEqual({ kind: 'area' });
    expect(matchPlace(job('California'), ca)).toEqual({ kind: 'area' });
    expect(matchPlace(job('Smallville, CA'), ca)).toEqual({ kind: 'area' });
    expect(matchPlace(job('Austin, TX'), ca).kind).toBe('none');
    expect(matchPlace(job('United States'), ca).kind).toBe('none');
    const us = place('United States');
    expect(matchPlace(job('Austin, TX'), us).kind).toBe('area');
    expect(matchPlace(job('Texas'), us).kind).toBe('area');
    expect(matchPlace(job('United States'), us).kind).toBe('area');
    expect(matchPlace(job('Toronto, ON'), us).kind).toBe('none');
    expect(matchPlace(job('North America'), us).kind).toBe('none');
    const emea = place('EMEA');
    expect(matchPlace(job('Berlin'), emea).kind).toBe('area');
    expect(matchPlace(job('Germany'), emea).kind).toBe('area');
    expect(matchPlace(job('DACH'), emea).kind).toBe('area');
    expect(matchPlace(job('Austin, TX'), emea).kind).toBe('none');
    expect(matchPlace(job('APAC'), emea).kind).toBe('none');
  });

  it('several places: the best match wins', () => {
    expect(matchPlace(job(['Austin, TX', 'Oakland, CA', 'San Francisco, CA']), sf, { radiusKm: 50 })).toEqual({ kind: 'city', distanceKm: 0 });
    const m = matchPlace(job(['San Jose, CA', 'Berkeley, CA', 'Oakland, CA']), sf, { radiusKm: 100 });
    expect(m.kind).toBe('radius');
    expect(m.distanceKm).toBeLessThan(15); // Oakland, the nearest
    expect(matchPlace(job(['Austin, TX', 'Remote (US)']), sf, { includeRemote: true }).kind).toBe('remote');
    expect(matchPlace(job(['San Francisco, CA', 'Remote (US)']), sf, { includeRemote: true }).kind).toBe('city');
  });

  it('remote jobs only with includeRemote, by scope', () => {
    const berlin = place('Berlin');
    expect(matchPlace(job('Remote'), berlin).kind).toBe('none');
    expect(matchPlace(job('Remote'), berlin, { includeRemote: true }).kind).toBe('remote');
    expect(matchPlace(job('Anywhere'), sf, { includeRemote: true }).kind).toBe('remote');
    expect(matchPlace(job('Remote (US)'), sf, { includeRemote: true }).kind).toBe('remote');
    expect(matchPlace(job('Remote (US)'), place('Austin'), { includeRemote: true }).kind).toBe('remote');
    // "I asked for Berlin and got remote jobs restricted to the US" must not happen.
    expect(matchPlace(job('Remote (US)'), berlin, { includeRemote: true }).kind).toBe('none');
    expect(matchPlace(job('Remote - Germany'), place('Austin, TX'), { includeRemote: true }).kind).toBe('none');
    expect(matchPlace(job('Remote - EMEA'), berlin, { includeRemote: true }).kind).toBe('remote');
    expect(matchPlace(job(['USA', 'Canada'], { remote: 'remote' }), place('Toronto'), { includeRemote: true }).kind).toBe('remote');
    expect(matchPlace(job('Remote (US)'), place('Texas'), { includeRemote: true }).kind).toBe('remote');
    expect(matchPlace(job('Remote (US)'), place('Germany'), { includeRemote: true }).kind).toBe('none');
    // Region targets intersect the scope.
    expect(matchPlace(job('Remote (Germany)'), place('EMEA'), { includeRemote: true }).kind).toBe('remote');
    expect(matchPlace(job('Remote (US)'), place('EMEA'), { includeRemote: true }).kind).toBe('none');
    expect(matchPlace(job('Remote (US)'), place('North America'), { includeRemote: true }).kind).toBe('remote');
    expect(matchPlace(job('Remote'), place('EMEA'), { includeRemote: true }).kind).toBe('remote');
  });

  it('a remote job listed only as an area matches targets inside it', () => {
    const j: JobLocation = { places: [place('United States')], remote: 'remote', remoteScope: [] };
    expect(matchPlace(j, sf, { includeRemote: true }).kind).toBe('remote');
    const j2: JobLocation = { places: [place('United States')], remote: 'remote', remoteScope: ['CA'] };
    expect(matchPlace(j2, sf, { includeRemote: true }).kind).toBe('remote');
    expect(matchPlace(j2, sf).kind).toBe('none');
  });

  it('hybrid and on-site jobs match by place only', () => {
    expect(matchPlace(job('Austin, TX', { remote: 'hybrid' }), sf, { includeRemote: true }).kind).toBe('none');
    expect(matchPlace(job('San Francisco, CA', { remote: 'hybrid' }), sf, { includeRemote: true }).kind).toBe('city');
    const hybridUS = job('United States', { remote: 'hybrid' });
    expect(matchPlace(hybridUS, sf, { includeRemote: true }).kind).toBe('none');
    expect(matchPlace(hybridUS, place('United States')).kind).toBe('area');
  });

  it('unknown places never match; unknown/anywhere targets', () => {
    expect(matchPlace(job('Blahville'), sf, { radiusKm: 1000 }).kind).toBe('none');
    expect(matchPlace(job('Black Bess,'), makePlace({ kind: 'unknown', raw: 'Black Bess' })).kind).toBe('none');
    const anywhere = place('anywhere');
    expect(matchPlace(job('Remote'), anywhere).kind).toBe('remote');
    expect(matchPlace(job('Austin, TX'), anywhere).kind).toBe('area');
  });

  it('city-states listed as countries count as the city', () => {
    const sg = place('Singapore');
    const j: JobLocation = { places: [makePlace({ kind: 'country', raw: 'Singapore', country: 'SG', countryName: 'Singapore' })], remote: 'unknown', remoteScope: [] };
    expect(matchPlace(j, sg).kind).toBe('city');
    expect(matchPlace(job('Singapore'), place('SG')).kind).toBe('city');
  });

  it('every target kind x job kind combination', () => {
    const targets: Record<string, Place> = {
      city: place('Austin, TX'),
      admin1: place('Texas'),
      country: place('United States'),
      region: place('North America'),
    };
    const jobs: Record<string, JobLocation> = {
      city: job('Austin, TX'),
      otherCity: job('Dallas, TX'),
      admin1: job('Texas'),
      country: job('United States'),
      region: job('North America'),
      unknown: job('Blahville'),
      remoteNoScope: job('Remote'),
      remoteUS: job('Remote (US)'),
      remoteDE: job('Remote (Germany)'),
      hybrid: job('Austin, TX', { remote: 'hybrid' }),
    };
    const expected: Record<string, Record<string, string>> = {
      city: { city: 'city', otherCity: 'none', admin1: 'none', country: 'none', region: 'none', unknown: 'none', remoteNoScope: 'remote', remoteUS: 'remote', remoteDE: 'none', hybrid: 'city' },
      admin1: { city: 'area', otherCity: 'area', admin1: 'area', country: 'none', region: 'none', unknown: 'none', remoteNoScope: 'remote', remoteUS: 'remote', remoteDE: 'none', hybrid: 'area' },
      country: { city: 'area', otherCity: 'area', admin1: 'area', country: 'area', region: 'none', unknown: 'none', remoteNoScope: 'remote', remoteUS: 'remote', remoteDE: 'none', hybrid: 'area' },
      region: { city: 'area', otherCity: 'area', admin1: 'area', country: 'area', region: 'area', unknown: 'none', remoteNoScope: 'remote', remoteUS: 'remote', remoteDE: 'none', hybrid: 'area' },
    };
    for (const [tk, t] of Object.entries(targets)) {
      for (const [jk, j] of Object.entries(jobs)) {
        expect(matchPlace(j, t, { includeRemote: true }).kind, `${tk} x ${jk}`).toBe(expected[tk]![jk]);
        if (j.remote === 'remote' && !j.places.length) expect(matchPlace(j, t).kind, `${tk} x ${jk} without includeRemote`).toBe('none');
      }
    }
  });
});
