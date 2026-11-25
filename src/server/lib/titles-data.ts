/**
 * Small curated tables for job-title understanding (lib/titles.ts). Everything is lower-case and in
 * normalizeText form (diacritics folded, punctuation collapsed to single spaces).
 *
 * The place lists are deliberately compact (countries, US states and Canadian provinces, hiring
 * regions and roughly the 300 largest or most job-relevant cities). They only decide whether a trailing
 * title segment such as "- London" or ", Berlin, Germany" is a location; the full gazetteer lives in
 * lib/location. City names that are also ordinary title words (Mobile, Reading, Nice, Enterprise,
 * Commerce, Orange, Split, Bath, Normal, Independence…) are left out on purpose.
 */

const words = (s: string): string[] => s.split('|').map((w) => w.trim()).filter(Boolean);

export const COUNTRIES = words(
  'afghanistan|albania|algeria|andorra|angola|argentina|armenia|australia|austria|azerbaijan|bahamas|bahrain|bangladesh|' +
    'barbados|belarus|belgium|belize|benin|bhutan|bolivia|bosnia|bosnia and herzegovina|botswana|brazil|brasil|brunei|' +
    'bulgaria|burkina faso|burundi|cambodia|cameroon|canada|cape verde|chile|china|colombia|congo|costa rica|croatia|cuba|' +
    'cyprus|czechia|czech republic|denmark|djibouti|dominican republic|ecuador|egypt|el salvador|eritrea|estonia|eswatini|' +
    'ethiopia|fiji|finland|france|gabon|gambia|georgia|germany|deutschland|ghana|greece|grenada|guatemala|guinea|guyana|' +
    'haiti|honduras|hungary|iceland|india|indonesia|iran|iraq|ireland|israel|italy|italia|ivory coast|cote d ivoire|' +
    'jamaica|japan|kazakhstan|kenya|kosovo|kuwait|kyrgyzstan|laos|latvia|lebanon|lesotho|liberia|libya|liechtenstein|' +
    'lithuania|luxembourg|madagascar|malawi|malaysia|maldives|mali|malta|mauritania|mauritius|mexico|moldova|monaco|' +
    'mongolia|montenegro|morocco|mozambique|myanmar|namibia|nepal|netherlands|the netherlands|holland|new zealand|' +
    'nicaragua|niger|nigeria|north macedonia|macedonia|norway|oman|pakistan|panama|papua new guinea|paraguay|peru|' +
    'philippines|poland|portugal|puerto rico|qatar|romania|russia|rwanda|saudi arabia|ksa|senegal|serbia|seychelles|' +
    'sierra leone|singapore|slovakia|slovenia|somalia|south africa|south korea|korea|spain|espana|sri lanka|sudan|' +
    'suriname|sweden|switzerland|schweiz|suisse|syria|taiwan|tajikistan|tanzania|thailand|togo|trinidad|' +
    'trinidad and tobago|tunisia|turkey|turkiye|turkmenistan|uganda|ukraine|uae|united arab emirates|united kingdom|uk|' +
    'great britain|britain|england|scotland|wales|northern ireland|united states|united states of america|usa|us|u s|' +
    'u s a|america|uruguay|uzbekistan|venezuela|vietnam|viet nam|yemen|zambia|zimbabwe|osterreich|polska|sverige|' +
    'nederland|belgique|belgie|danmark|norge|suomi|eesti|magyarorszag|cesko|hrvatska|mexique|bresil|allemagne|espagne|' +
    'italie|royaume uni|etats unis|canada|chine|japon|inde',
);

export const US_STATES = words(
  'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|' +
    'indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|' +
    'montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|' +
    'oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|' +
    'west virginia|wisconsin|wyoming|district of columbia|' +
    'ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|' +
    'prince edward island|bavaria|bayern|catalonia|catalunya|andalusia|lombardy|ile de france|new south wales|nsw|' +
    'victoria|queensland|western australia|maharashtra|karnataka|telangana|tamil nadu|haryana',
);

/**
 * Two-letter region codes (US states, Canadian provinces). They collide with ordinary abbreviations
 * (PA, MD, MA, CT, OR, IN…), so they only count as a place right after another place or "remote".
 */
export const REGION_CODES = words(
  'al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|' +
    'pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc|on|qc|bc|ab|mb|sk|ns|nb|nl|pe',
);

/** Multi-country hiring regions and region-like words. */
export const REGIONS = words(
  'emea|apac|amer|amers|americas|latam|lat am|nordics|nordic|dach|benelux|anz|apj|apjc|europe|eu|asia|africa|mena|' +
    'middle east|north america|south america|latin america|central america|western europe|eastern europe|' +
    'southern europe|northern europe|central europe|central and eastern europe|southeast asia|south east asia|' +
    'asia pacific|uki|ukie|ukandi|cee|ssa|gcc|iberia|baltics|caribbean|oceania|scandinavia|' +
    'bay area|sf bay area|silicon valley|greater boston|dfw|socal|norcal|tri state|twin cities|puget sound|' +
    'research triangle|east coast|west coast|midwest|northeast|northwest|southeast|southwest|pacific northwest|pnw|' +
    'new england|mid atlantic|gulf coast|nyc|sf|la metro|dmv|gta|lower mainland',
);

/** Places accepted only when they make up a whole segment ("- Global", "| NA"). */
export const SEGMENT_ONLY_PLACES = words(
  'na|global|worldwide|international|anywhere|nationwide|multiple locations|various locations|multiple cities|' +
    'remote|hybrid|onsite|on site|in office|fully remote|remote first|work from home|wfh|telecommute|telework|' +
    'flexible|distributed|virtual',
);

export const CITIES = words(
  // North America
  'new york|new york city|manhattan|brooklyn|queens|los angeles|chicago|houston|phoenix|philadelphia|san antonio|' +
    'san diego|dallas|san jose|austin|jacksonville|fort worth|columbus|charlotte|san francisco|indianapolis|seattle|' +
    'denver|washington dc|washington d c|boston|el paso|nashville|detroit|oklahoma city|portland|las vegas|memphis|' +
    'louisville|baltimore|milwaukee|albuquerque|tucson|fresno|sacramento|kansas city|atlanta|omaha|colorado springs|' +
    'raleigh|miami|long beach|virginia beach|oakland|minneapolis|tulsa|tampa|arlington|new orleans|wichita|cleveland|' +
    'bakersfield|anaheim|honolulu|santa ana|riverside|corpus christi|lexington|stockton|saint paul|st paul|st louis|' +
    'saint louis|cincinnati|pittsburgh|greensboro|anchorage|plano|orlando|irvine|newark|durham|chula vista|toledo|' +
    'fort wayne|st petersburg|laredo|jersey city|scottsdale|reno|buffalo|winston salem|chesapeake|norfolk|fremont|' +
    'hialeah|richmond|boise|spokane|baton rouge|tacoma|san bernardino|modesto|des moines|fayetteville|oxnard|rochester|' +
    'grand rapids|huntsville|salt lake city|frisco|yonkers|amarillo|huntington beach|mckinney|little rock|tempe|' +
    'overland park|tallahassee|knoxville|worcester|chattanooga|sioux falls|palo alto|mountain view|sunnyvale|' +
    'santa clara|menlo park|redwood city|cupertino|san mateo|berkeley|boulder|ann arbor|cambridge|somerville|bellevue|' +
    'redmond|kirkland|hoboken|stamford|white plains|princeton|new haven|hartford|burlington|charleston|savannah|' +
    'birmingham|madison wi|columbia sc|greenville|provo|lehi|ogden|south san francisco|emeryville|santa monica|' +
    'culver city|pasadena|burbank|irving|fort lauderdale|boca raton|west palm beach|jacksonville fl|tysons|reston|' +
    'mclean|herndon|alexandria|bethesda|rockville|columbia md|toronto|vancouver|montreal|calgary|ottawa|edmonton|' +
    'winnipeg|mississauga|waterloo|kitchener|halifax|victoria bc|quebec city|' +
    // Europe
    'london|berlin|paris|madrid|barcelona|amsterdam|munich|munchen|hamburg|frankfurt|frankfurt am main|cologne|koln|' +
    'dusseldorf|stuttgart|leipzig|dresden|hannover|nuremberg|nurnberg|bremen|karlsruhe|mannheim|bonn|essen|dortmund|' +
    'vienna|wien|graz|linz|zurich|geneva|geneve|basel|bern|lausanne|zug|milan|milano|rome|roma|turin|torino|naples|' +
    'bologna|florence|lisbon|lisboa|porto|dublin|cork|galway|edinburgh|glasgow|manchester|leeds|bristol|liverpool|' +
    'oxford|belfast|cardiff|newcastle|sheffield|nottingham|brighton|leicester|southampton|aberdeen|' +
    'brussels|bruxelles|antwerp|ghent|rotterdam|the hague|den haag|utrecht|eindhoven|copenhagen|kobenhavn|aarhus|' +
    'stockholm|gothenburg|goteborg|malmo|oslo|bergen|helsinki|espoo|tallinn|riga|vilnius|warsaw|warszawa|krakow|' +
    'wroclaw|gdansk|poznan|lodz|katowice|prague|praha|brno|budapest|bucharest|bucuresti|cluj|cluj napoca|iasi|sofia|' +
    'belgrade|novi sad|zagreb|ljubljana|bratislava|athens|thessaloniki|istanbul|ankara|izmir|kyiv|kiev|lviv|kharkiv|' +
    'minsk|moscow|saint petersburg|valencia|seville|sevilla|malaga|bilbao|zaragoza|marseille|lyon|toulouse|nice cote|' +
    'bordeaux|lille|nantes|strasbourg|montpellier|rennes|sophia antipolis|limassol|nicosia|valletta|reykjavik|' +
    // Middle East and Africa
    'dubai|abu dhabi|doha|riyadh|jeddah|dammam|tel aviv|jerusalem|haifa|herzliya|amman|beirut|cairo|casablanca|rabat|' +
    'tunis|kuwait city|muscat|manama|lagos|abuja|nairobi|accra|johannesburg|cape town|durban|pretoria|addis ababa|' +
    'kampala|kigali|dar es salaam|dakar|algiers|' +
    // Asia and Oceania
    'tokyo|osaka|kyoto|yokohama|nagoya|fukuoka|seoul|busan|beijing|shanghai|shenzhen|guangzhou|hangzhou|chengdu|' +
    'wuhan|nanjing|xian|tianjin|chongqing|suzhou|hong kong|macau|taipei|hsinchu|kaohsiung|kuala lumpur|penang|' +
    'cyberjaya|jakarta|bandung|surabaya|bali|bangkok|chiang mai|manila|metro manila|makati|cebu|quezon city|taguig|' +
    'pasig|ho chi minh city|ho chi minh|saigon|hanoi|da nang|phnom penh|yangon|dhaka|karachi|lahore|islamabad|' +
    'kathmandu|colombo|mumbai|bombay|delhi|new delhi|delhi ncr|ncr|gurgaon|gurugram|noida|bangalore|bengaluru|' +
    'hyderabad|chennai|pune|kolkata|ahmedabad|jaipur|kochi|chandigarh|indore|coimbatore|thiruvananthapuram|' +
    'trivandrum|mysore|almaty|tashkent|baku|tbilisi|yerevan|sydney|melbourne|brisbane|perth|adelaide|canberra|' +
    'gold coast|auckland|wellington|christchurch|' +
    // Latin America
    'sao paulo|rio de janeiro|belo horizonte|brasilia|curitiba|porto alegre|recife|florianopolis|campinas|fortaleza|' +
    'buenos aires|cordoba|rosario|mendoza|santiago|santiago de chile|lima|bogota|medellin|cali|barranquilla|quito|' +
    'guayaquil|caracas|montevideo|asuncion|la paz|mexico city|ciudad de mexico|cdmx|guadalajara|monterrey|puebla|' +
    'tijuana|queretaro|merida|cancun|panama city|guatemala city|san salvador|tegucigalpa|managua|santo domingo|' +
    'san juan|havana|kingston|port of spain',
);

/** Tokens that may appear inside a location segment without being places themselves. */
export const PLACE_FILLERS = words(
  'remote|hybrid|onsite|on|site|office|offices|in|based|only|area|areas|metro|metropolitan|greater|region|and|or|the|' +
    'of|city|county|state|states|province|fully|100|flexible|home|from|work|wfh|anywhere|within|eastern|central|' +
    'pacific|mountain|time|zone|zones|timezone|timezones|est|pst|cst|mst|cet|cest|gmt|utc|bst|edt|pdt|hq|' +
    'headquarters|north|south|east|west|northern|southern|western|downtown|near|location|locations|multiple|various|' +
    'residents|resident|located|living|must|be|first|friendly|optional|preferred|candidates|applicants|across|any|' +
    'all|other|nationwide|worldwide|global|international|remotely|distributed|virtual|telecommute|telework|days|week|' +
    'per|x|usa|x2|x3|with|travel|relocation|eligible|for|to',
);

/** Words that make a whole segment a work-arrangement note. */
export const ARRANGEMENT_WORDS = words(
  'remote|hybrid|onsite|wfh|telecommute|telework|remotely|in office|on site|work from home|work from anywhere|' +
    'remote first|fully remote|100 remote|partially remote|remote friendly|remote optional|flexible',
);

/** Employment-type words stripped from the core (and used as explicit title markers). */
export const EMPLOYMENT_WORDS = words(
  'full time|fulltime|full-time|part time|parttime|contract|contractor|contract to hire|contract to perm|c2h|w2|1099|' +
    'c2c|corp to corp|temporary|temp|temp to hire|temp to perm|seasonal|freelance|freelancer|freiberuflich|permanent|' +
    'perm|fixed term|fixed term contract|befristet|unbefristet|vollzeit|teilzeit|minijob|cdi|cdd|interim|' +
    'per diem|prn|locum|locum tenens|gig|1099 contractor',
);

/** Shift and schedule decorations. */
export const SHIFT_WORDS = words(
  'nights|night|night shift|nightshift|days|day shift|dayshift|evenings|evening|evening shift|weekends|weekend|' +
    'weekend shift|overnight|overnights|swing|swing shift|graveyard|rotating|rotating shift|1st shift|2nd shift|' +
    '3rd shift|first shift|second shift|third shift|12 hour|12 hr|12hr|8 hour|8hr|10 hour|3x12|4x10|5x8|mon fri|' +
    'monday friday|monday to friday|home daily|home weekly|home weekends|home every weekend|local|otr|dedicated|' +
    'flexible hours|flexible schedule|flex|days off',
);

/** Promotional decorations. */
export const PROMO_WORDS = words(
  'hiring now|now hiring|hiring immediately|immediate hire|immediate start|immediate opening|immediately|urgent|' +
    'urgently hiring|urgently|apply now|apply today|start asap|asap|sign on bonus|signing bonus|sign on|bonus|' +
    'relocation|relocation assistance|relocation provided|visa sponsorship|sponsorship|no experience|' +
    'no experience necessary|no experience required|will train|paid training|training provided|weekly pay|daily pay|' +
    'same day pay|great pay|great benefits|benefits|full benefits|401k|pto|top pay|competitive pay|new|hot|' +
    'job|jobs|opening|position|vacancy|opportunity|role|m|f|d|w|x|h|gn|mwd|mfd|fmd|wmd|fmx|mfx|hf|fh|' +
    'all genders|all gender|any gender|gender neutral|diverse|divers|evergreen|pipeline|talent pool|talent community|' +
    'multiple openings|multiple positions|various|ref|req|requisition|id|no',
);

/** Seniority-like words that are not levels in these phrases (role names in the taxonomy are protected too). */
export const PROTECTED_PHRASES = words(
  'chief of staff|member of technical staff|member of the technical staff|bar staff|staff accountant|staff nurse|' +
    'staff writer|staff attorney|staff auditor|staff pharmacist|staff physician|staff photographer|staff assistant|' +
    'staff sergeant|staff development|staffing|lead generation|lead gen|lead generator|senior living|senior care|' +
    'senior center|senior centre|senior services|senior housing|senior citizens|senior community|senior home|' +
    'mid market|midmarket|mid size|mid sized|associate professor|associate dean|associate partner|' +
    'assistant professor|assistant principal|vice principal|school principal|principal investigator|junior high|' +
    'junior high school|graduate admissions|graduate student|graduate research|graduate teaching|graduate assistant|' +
    'graduate school|graduate studies|graduate programs|remote sensing|remote patient|remote monitoring|remote pilot|' +
    'head start|lead teacher|intern coordinator|internship coordinator|apprenticeship coordinator|volunteer coordinator|' +
    'volunteer manager|founder associate|founders associate|founding|contract manager|contracts manager|' +
    'contract specialist|contract administrator|contract analyst|contract negotiator|contract management|' +
    'contract coordinator|contract officer|general contractor|electrical contractor|independent contractor|' +
    'temporary housing|executive assistant|executive director|executive chef|account executive|managing editor',
);

/**
 * "X Manager" titles that are individual-contributor roles when the taxonomy does not already say so:
 * the word right before "manager".
 */
export const IC_MANAGER_MODIFIERS = new Set(
  words(
    'product|project|program|programme|account|accounts|community|brand|success|relationship|relationships|partner|' +
      'partnership|partnerships|category|campaign|campaigns|content|case|portfolio|property|media|social|channel|' +
      'alliance|alliances|territory|delivery|release|launch|pricing|lifecycle|crm|seo|ppc|ecommerce|commerce|vendor|' +
      'supplier|contract|contracts|implementation|onboarding|enablement|grants|grant|events|event|privacy|risk|' +
      'compliance|change|solutions|solution|marketing|growth|demand|influencer|creator|talent|wealth|asset|fund|' +
      'investment|engagement|retention|acquisition|advertising|incident|problem|configuration|scrum|iteration|' +
      'merchandising|buying|sourcing|procurement|claims|loan|mortgage|credit|business|development|sustainability|' +
      'esg|innovation|transformation|knowledge|data|insights|research|editorial|publishing|podcast|studio|deal|' +
      'deals|renewals|renewal|revenue|monetization|payments|security|technical|technology|systems|platform|api',
  ),
);

/**
 * Taxonomy roles whose titles end in "Manager" but which manage people even though their typical skills do not
 * list "People Management" (the taxonomy signal used to tell people managers from IC "managers").
 */
export const PEOPLE_MANAGER_ROLE_IDS = new Set(['caterer', 'dental-receptionist', 'healthcare-administrator', 'facilities-manager', 'nurse-manager']);

/** Taxonomy roles that list "People Management" but whose "Manager" title is usually an IC role. */
export const IC_MANAGER_ROLE_IDS = new Set<string>(['marketing-manager', 'digital-marketing-manager']);

/** "Director" titles that are not a director level. */
export const NON_DIRECTOR_PHRASES = words('funeral director|casting director|activities director|activity director|musical director|music director|art director');

/**
 * Single-word taxonomy aliases that must not be used for a title where other words precede them
 * ("Software Architect" is not a building architect; "Podcast Host" is not a restaurant host;
 * "CNC Programmer" is not a software engineer).
 */
export const NO_SINGLE_HEAD_MAP = new Set(
  words('architect|host|hostess|programmer|checker|porter|assessor|reporter|colorist|receiver|server|controller|editor|principal|trader|buyer'),
);

/**
 * Generic head nouns: never map a title to a role on one of these alone.
 */
export const GENERIC_HEADS = new Set(
  words(
    'manager|engineer|specialist|associate|assistant|analyst|consultant|coordinator|director|lead|leader|officer|' +
      'representative|technician|developer|designer|administrator|advisor|adviser|agent|worker|operator|executive|' +
      'partner|intern|staff|member|expert|professional|generalist|head|supervisor|scientist|researcher|architect|' +
      'strategist|planner|programmer|clerk|aide|helper|trainee|apprentice|student|fellow|vp|president|chief|owner|' +
      'founder|principal|tech|technologist|operative|team|employee|crew|contractor|freelancer|instructor|teacher|' +
      'producer|writer|artist|editor|investigator|inspector|auditor|counsel|attorney',
  ),
);

/** Abbreviations expanded only when a title does not map to a role as written. */
export const TITLE_ABBREVIATIONS: Record<string, string> = {
  mgr: 'manager',
  mngr: 'manager',
  engr: 'engineer',
  eng: 'engineer',
  dev: 'developer',
  devs: 'developers',
  admin: 'administrator',
  asst: 'assistant',
  assoc: 'associate',
  coord: 'coordinator',
  rep: 'representative',
  spec: 'specialist',
  tech: 'technician',
  svc: 'service',
  svcs: 'services',
  mktg: 'marketing',
  acct: 'account',
  dir: 'director',
  sw: 'software',
  hw: 'hardware',
  ml: 'machine learning',
  fullstack: 'full stack',
  frontend: 'front end',
  backend: 'back end',
  mgmt: 'management',
  ops: 'operations',
  biz: 'business',
  bizdev: 'business development',
  qa: 'quality assurance',
  ux: 'user experience',
  hr: 'human resources',
  it: 'information technology',
  cs: 'customer success',
  ae: 'account executive',
  dr: 'doctor',
  prof: 'professor',
  analyt: 'analytics',
  rptg: 'reporting',
  ent: 'enterprise',
  sys: 'systems',
  sr: 'senior',
};
