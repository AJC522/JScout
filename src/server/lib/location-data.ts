/**
 * Small curated tables for lib/location that the generated gazetteer does not carry:
 * word lists for telling place names from ordinary words, display conventions and
 * a few tie-break rules. Keys are lower case unless noted.
 */

/** Countries that are a single city: the city row stands for the country and vice versa. */
export const CITY_STATES: ReadonlySet<string> = new Set(['SG', 'HK', 'MO', 'MC', 'GI', 'VA']);

/**
 * Two-letter codes that are both a US state and an ISO country code. Standing alone and with no
 * US context, these mean the country (job boards list countries as ISO codes: "DE", "IN", "CA").
 * Every other US state code (GA, MD, ME, PA, ...) means the state: the colliding country is too small
 * to be the likelier reading.
 */
export const ISO_PREFERRED_CODES: ReadonlySet<string> = new Set(['CA', 'DE', 'IN', 'ID', 'AR', 'CO', 'MA', 'IL']);

/** Uppercase codes never read as a place on their own ("9 AM", "PM"). */
export const BLOCKED_CODES: ReadonlySet<string> = new Set(['AM', 'PM', 'AI', 'IO', 'TV', 'FM']);

/**
 * Countries whose first-level divisions are commonly named on their own ("California", "Ontario",
 * "Bavaria", "Karnataka"). Elsewhere an admin1 name only counts next to its country or as a city qualifier,
 * because many are ordinary words ("Central", "Western", "Capital").
 */
export const STANDALONE_ADMIN1_COUNTRIES: readonly string[] = [
  'US', 'CA', 'AU', 'GB', 'IN', 'DE', 'BR', 'MX', 'ES', 'IT', 'FR', 'CN', 'NL', 'CH', 'AT', 'BE', 'PL', 'JP',
];

/**
 * Countries where a state/province name beats a same-named city inside it ("Quebec" is the province).
 * Elsewhere the city wins ("Tokyo", "Berlin", "Madrid", "Dubai" are both).
 */
export const ADMIN1_BEATS_CITY_COUNTRIES: ReadonlySet<string> = new Set(['US', 'CA', 'AU']);

/** Names that mean the city even though an admin1 or country shares them. */
export const CITY_FIRST_KEYS: ReadonlySet<string> = new Set(['new york']);

/**
 * City names that are ordinary words. Alone they never resolve; with a qualifier they do
 * ("Mobile, AL", "Normal, IL", "Reading, UK").
 */
export const COMMON_WORD_CITIES: ReadonlySet<string> = new Set([
  'mobile', 'normal', 'enterprise', 'media', 'industry', 'of', 'sale', 'asia', 'central', 'metro', 'university',
  'san', 'surprise', 'liberty', 'union', 'independence', 'mission', 'temple', 'paradise', 'spring', 'vista',
  'orange', 'plantation', 'eagle', 'marina', 'bay', 'forest', 'summit', 'deal', 'bell', 'clay', 'salt', 'best',
  'can', 'come', 'man', 'most', 'much', 'same', 'say', 'than', 'time', 'to', 'young', 'commerce', 'home', 'field',
  'office', 'remote', 'hybrid', 'global', 'flexible', 'various', 'multiple', 'nationwide', 'online', 'virtual',
  'distributed', 'travel', 'hollywood', 'delta', 'surrey', 'essex', 'kent', 'bath', 'reading', 'nice', 'split',
  'sandy', 'friendly', 'hope', 'harmony', 'unity', 'faith', 'progress', 'success', 'opportunity', 'local',
  'national', 'international', 'corporate', 'headquarters', 'campus', 'downtown', 'midtown', 'uptown', 'north',
  'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western', 'capital', 'coast', 'island', 'islands',
]);

/**
 * Of the common-word cities, those that are a real place when the WHOLE location string is that one word
 * ("Reading" on a UK job board), or when qualified. All other common words also resolve when qualified.
 */
export const WHOLE_STRING_CITIES: ReadonlySet<string> = new Set(['reading', 'bath', 'nice', 'split']);

/** Extra city aliases (lower case) -> [city, admin1, country], for common spellings the gazetteer lacks. */
export const EXTRA_CITY_ALIASES: ReadonlyArray<readonly [string, string, string, string]> = [
  ['cluj', 'Cluj-Napoca', '13', 'RO'],
  ['aarhus', 'Århus', '18', 'DK'],
  ['san fransisco', 'San Francisco', 'CA', 'US'],
  ['san fransisco bay area', 'San Francisco', 'CA', 'US'],
  ['beijing shi', 'Beijing', '22', 'CN'],
  ['shanghai shi', 'Shanghai', '23', 'CN'],
  ['new york city metro', 'New York City', 'NY', 'US'],
  ['plzen', 'Pilsen', '87', 'CZ'],
  ['plzeň', 'Pilsen', '87', 'CZ'],
];

/** Short display forms used where a country follows a city or lists a remote scope. */
export const COUNTRY_SHORT: Readonly<Record<string, string>> = {
  US: 'US',
  GB: 'UK',
  AE: 'UAE',
  CD: 'DR Congo',
  CG: 'Congo',
  VA: 'Vatican City',
  UM: 'US Minor Outlying Islands',
  VI: 'US Virgin Islands',
  GS: 'South Georgia',
  HM: 'Heard & McDonald Islands',
  VC: 'St Vincent & Grenadines',
  PM: 'St Pierre & Miquelon',
  TC: 'Turks & Caicos',
  CC: 'Cocos Islands',
  IO: 'British Indian Ocean Territory',
  BQ: 'Caribbean Netherlands',
};

/** Countries whose cities are labelled with the state/province code ("Austin, TX", "Toronto, ON"). */
export const ADMIN1_CODE_LABEL_COUNTRIES: ReadonlySet<string> = new Set(['US', 'CA']);

/** Lower-case short keys (3 letters or fewer) accepted in any letter case. */
export const LOWER_OK_SHORT_KEYS: ReadonlySet<string> = new Set(['usa', 'uk', 'uae', 'us', 'eu', 'eea', 'nyc', 'sf', 'dc']);

/**
 * UK counties (and their usual abbreviations) -> GB admin1 code. Used only to qualify a city
 * ("Reading, Berkshire"); alone they do not resolve.
 */
export const UK_COUNTIES: Readonly<Record<string, string>> = Object.fromEntries([
  ...[
    'bedfordshire', 'beds', 'berkshire', 'berks', 'buckinghamshire', 'bucks', 'cambridgeshire', 'cambs', 'cheshire',
    'cornwall', 'cumbria', 'derbyshire', 'devon', 'dorset', 'county durham', 'east sussex', 'essex', 'gloucestershire',
    'glos', 'hampshire', 'hants', 'herefordshire', 'hertfordshire', 'herts', 'isle of wight', 'kent', 'lancashire',
    'lancs', 'leicestershire', 'leics', 'lincolnshire', 'lincs', 'merseyside', 'middlesex', 'norfolk',
    'northamptonshire', 'northants', 'northumberland', 'north yorkshire', 'nottinghamshire', 'notts', 'oxfordshire',
    'oxon', 'rutland', 'shropshire', 'somerset', 'south yorkshire', 'staffordshire', 'staffs', 'suffolk', 'surrey',
    'tyne and wear', 'warwickshire', 'west sussex', 'west yorkshire', 'wiltshire', 'wilts', 'worcestershire', 'worcs',
    'east riding of yorkshire', 'yorkshire', 'greater manchester', 'greater london', 'west midlands',
  ].map((k) => [k, 'ENG']),
  ...['lanarkshire', 'fife', 'aberdeenshire', 'lothian', 'midlothian', 'west lothian', 'renfrewshire', 'ayrshire', 'highland', 'perthshire']
    .map((k) => [k, 'SCT']),
  ...['glamorgan', 'south glamorgan', 'west glamorgan', 'gwent', 'gwynedd', 'powys', 'carmarthenshire', 'pembrokeshire', 'flintshire']
    .map((k) => [k, 'WLS']),
  ...['county antrim', 'antrim', 'county down', 'county armagh', 'county tyrone', 'county londonderry', 'county fermanagh']
    .map((k) => [k, 'NIR']),
]);

/** Folded alias keys that are ordinary English words and must not resolve ("Ísland" folds to "island"). */
export const DENY_KEYS: ReadonlySet<string> = new Set(['island']);

/** Extra country aliases (lower-case keys) -> ISO code. */
export const EXTRA_COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  ksa: 'SA',
  'kingdom of saudi arabia': 'SA',
  'st lucia': 'LC',
  'st kitts and nevis': 'KN',
  'st kitts': 'KN',
  'st vincent and the grenadines': 'VC',
  'the gambia': 'GM',
  'the bahamas': 'BS',
  'mainland china': 'CN',
  deutschlandweit: 'DE',
  'ganz deutschland': 'DE',
  osterreichweit: 'AT',
  schweizweit: 'CH',
};
