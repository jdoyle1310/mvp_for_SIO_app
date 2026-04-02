/**
 * US address normalizer — no external APIs, pure JS.
 *
 * Cleans and standardises incoming contact address fields before they are
 * sent to BatchData and Trestle. The goal is to maximise property match rates
 * by removing noise that causes lookup misses:
 *
 *   1. Combined-address parsing  — split "123 Main St, City, ST 12345" into fields
 *   2. Unit/secondary stripping  — remove "Apt 4B", "Unit 2", "#5", etc.
 *   3. USPS suffix abbreviations — "Street" → "St", "Avenue" → "Ave", etc.
 *   4. Directional normalisation — "North" → "N", "Southwest" → "SW", etc.
 *   5. State name → two-letter code
 *   6. ZIP cleanup              — strip ZIP+4, non-digits
 *   7. Whitespace / punctuation cleanup
 */

// ─── USPS standard street-suffix abbreviations ────────────────────────────────
// Full words and common alternate spellings → USPS short form.
// Source: https://pe.usps.com/text/pub28/28apc_002.htm
const SUFFIX_MAP = {
  allee: 'Aly', alley: 'Aly', ally: 'Aly', aly: 'Aly',
  anex: 'Anx', annex: 'Anx', annx: 'Anx', anx: 'Anx',
  arc: 'Arc', arcade: 'Arc',
  av: 'Ave', ave: 'Ave', aven: 'Ave', avenu: 'Ave', avenue: 'Ave', avn: 'Ave', avnue: 'Ave',
  bayoo: 'Byu', bayou: 'Byu',
  beach: 'Bch', bch: 'Bch',
  bend: 'Bnd', bnd: 'Bnd',
  blf: 'Blf', bluff: 'Blf', bluffs: 'Blfs',
  bot: 'Btm', bottm: 'Btm', bottom: 'Btm', btm: 'Btm',
  blvd: 'Blvd', boul: 'Blvd', boulevard: 'Blvd', boulv: 'Blvd',
  br: 'Br', branch: 'Br', brnch: 'Br',
  brdge: 'Brg', bridge: 'Brg', brg: 'Brg',
  brk: 'Brk', brook: 'Brk',
  byp: 'Byp', bypa: 'Byp', bypas: 'Byp', bypass: 'Byp', byps: 'Byp',
  camp: 'Cp', cp: 'Cp', cmp: 'Cp',
  canyn: 'Cyn', canyon: 'Cyn', cnyn: 'Cyn', cyn: 'Cyn',
  cape: 'Cpe', cpe: 'Cpe',
  causeway: 'Cswy', causwa: 'Cswy', cswy: 'Cswy',
  cen: 'Ctr', cent: 'Ctr', center: 'Ctr', centr: 'Ctr', centre: 'Ctr', cnter: 'Ctr', cntr: 'Ctr', ctr: 'Ctr',
  cir: 'Cir', circ: 'Cir', circl: 'Cir', circle: 'Cir', crcl: 'Cir', crcle: 'Cir',
  clf: 'Clf', cliffs: 'Clfs', cliff: 'Clf',
  clb: 'Clb', club: 'Clb',
  common: 'Cmn', cmn: 'Cmn',
  corner: 'Cor', cor: 'Cor', corners: 'Cors', cors: 'Cors',
  course: 'Crse', crse: 'Crse',
  court: 'Ct', ct: 'Ct', courts: 'Cts', cts: 'Cts',
  cove: 'Cv', cv: 'Cv',
  creek: 'Crk', crk: 'Crk',
  crescent: 'Cres', cres: 'Cres', crsent: 'Cres', crsnt: 'Cres',
  crossing: 'Xing', crssng: 'Xing', xing: 'Xing',
  crossroad: 'Xrd', xrd: 'Xrd',
  curve: 'Curv', curv: 'Curv',
  dale: 'Dl', dl: 'Dl',
  dam: 'Dm', dm: 'Dm',
  div: 'Dv', divide: 'Dv', dv: 'Dv', dvd: 'Dv',
  dr: 'Dr', driv: 'Dr', drive: 'Dr', drv: 'Dr',
  estate: 'Est', est: 'Est', estates: 'Ests', ests: 'Ests',
  exp: 'Expy', expr: 'Expy', express: 'Expy', expressway: 'Expy', expw: 'Expy', expy: 'Expy',
  ext: 'Ext', extension: 'Ext', extn: 'Ext', extnsn: 'Ext',
  fall: 'Fall', falls: 'Fls', fls: 'Fls',
  ferry: 'Fry', frry: 'Fry', fry: 'Fry',
  field: 'Fld', fld: 'Fld', fields: 'Flds', flds: 'Flds',
  flat: 'Flt', flt: 'Flt', flats: 'Flts', flts: 'Flts',
  ford: 'Frd', frd: 'Frd', fords: 'Frds',
  forest: 'Frst', forests: 'Frst', frst: 'Frst',
  forg: 'Frg', forge: 'Frg', frg: 'Frg', forges: 'Frgs',
  fork: 'Frk', frk: 'Frk', forks: 'Frks', frks: 'Frks',
  fort: 'Ft', frt: 'Ft', ft: 'Ft',
  freeway: 'Fwy', freewy: 'Fwy', frway: 'Fwy', frwy: 'Fwy', fwy: 'Fwy',
  garden: 'Gdn', gardn: 'Gdn', gdn: 'Gdn', grden: 'Gdn', grdn: 'Gdn', gardens: 'Gdns', gdns: 'Gdns',
  gateway: 'Gtwy', gatewy: 'Gtwy', gatway: 'Gtwy', gtway: 'Gtwy', gtwy: 'Gtwy',
  glen: 'Gln', gln: 'Gln', glens: 'Glns',
  green: 'Grn', grn: 'Grn', greens: 'Grns',
  grove: 'Grv', grov: 'Grv', grv: 'Grv', groves: 'Grvs',
  harb: 'Hbr', harbor: 'Hbr', harbr: 'Hbr', hbr: 'Hbr', hrbor: 'Hbr', harbors: 'Hbrs',
  haven: 'Hvn', hvn: 'Hvn',
  heights: 'Hts', hts: 'Hts',
  highway: 'Hwy', highwy: 'Hwy', hiway: 'Hwy', hiwy: 'Hwy', hway: 'Hwy', hwy: 'Hwy',
  hill: 'Hl', hl: 'Hl', hills: 'Hls', hls: 'Hls',
  hllw: 'Holw', hollow: 'Holw', hollows: 'Holw', holw: 'Holw', holws: 'Holw',
  inlt: 'Inlt', inlet: 'Inlt',
  island: 'Is', is: 'Is', islnd: 'Is', islands: 'Iss', islnds: 'Iss',
  isle: 'Isle', isles: 'Isle',
  jct: 'Jct', jction: 'Jct', jctn: 'Jct', junction: 'Jct', junctn: 'Jct', juncton: 'Jct',
  key: 'Ky', ky: 'Ky', keys: 'Kys', kys: 'Kys',
  knl: 'Knl', knoll: 'Knl', knls: 'Knls', knolls: 'Knls',
  lake: 'Lk', lk: 'Lk', lakes: 'Lks', lks: 'Lks',
  land: 'Land',
  landing: 'Lndg', lndg: 'Lndg', lndng: 'Lndg',
  lane: 'Ln', ln: 'Ln',
  lgt: 'Lgt', light: 'Lgt', lights: 'Lgts',
  lf: 'Lf', loaf: 'Lf',
  lock: 'Lck', lck: 'Lck', locks: 'Lcks', lcks: 'Lcks',
  ldg: 'Ldg', ldge: 'Ldg', lodg: 'Ldg', lodge: 'Ldg',
  loop: 'Loop', loops: 'Loop',
  mall: 'Mall',
  manor: 'Mnr', mnr: 'Mnr', manors: 'Mnrs', mnrs: 'Mnrs',
  meadow: 'Mdw', meadows: 'Mdws', medows: 'Mdws', mdws: 'Mdws',
  mews: 'Mews',
  mill: 'Ml', ml: 'Ml', mills: 'Mls', mls: 'Mls',
  missn: 'Msn', mssn: 'Msn', mission: 'Msn',
  motorway: 'Mtwy', mtwy: 'Mtwy',
  mount: 'Mt', mnt: 'Mt', mt: 'Mt', mountain: 'Mtn', mntain: 'Mtn', mntn: 'Mtn', mtn: 'Mtn', mntns: 'Mtns', mountains: 'Mtns',
  neck: 'Nck', nck: 'Nck',
  orch: 'Orch', orchard: 'Orch', orchrd: 'Orch',
  oval: 'Oval', ovl: 'Oval',
  overpass: 'Opas', opas: 'Opas',
  park: 'Park', prk: 'Park', parks: 'Park',
  parkway: 'Pkwy', parkwy: 'Pkwy', pkway: 'Pkwy', pkwy: 'Pkwy', pky: 'Pkwy', pkwys: 'Pkwy', parkways: 'Pkwy',
  pass: 'Pass',
  passage: 'Psge', psge: 'Psge',
  path: 'Path', paths: 'Path',
  pike: 'Pike', pikes: 'Pike',
  pine: 'Pne', pnes: 'Pnes', pines: 'Pnes',
  place: 'Pl', pl: 'Pl',
  plain: 'Pln', pln: 'Pln', plains: 'Plns', plns: 'Plns',
  plaza: 'Plz', plz: 'Plz', plza: 'Plz',
  point: 'Pt', pt: 'Pt', points: 'Pts', pts: 'Pts',
  port: 'Prt', prt: 'Prt', ports: 'Prts', prts: 'Prts',
  prairie: 'Pr', pr: 'Pr', prr: 'Pr',
  rad: 'Radl', radial: 'Radl', radiel: 'Radl', radl: 'Radl',
  ramp: 'Ramp',
  ranch: 'Rnch', ranches: 'Rnch', rnch: 'Rnch', rnchs: 'Rnch',
  rapid: 'Rpd', rpd: 'Rpd', rapids: 'Rpds', rpds: 'Rpds',
  rest: 'Rst', rst: 'Rst',
  ridge: 'Rdg', rdg: 'Rdg', rdge: 'Rdg', ridges: 'Rdgs', rdgs: 'Rdgs',
  riv: 'Riv', river: 'Riv', rvr: 'Riv', rivr: 'Riv',
  road: 'Rd', rd: 'Rd', roads: 'Rds', rds: 'Rds',
  route: 'Rte', rte: 'Rte',
  row: 'Row',
  rue: 'Rue',
  run: 'Run',
  shoal: 'Shl', shl: 'Shl', shoals: 'Shls', shls: 'Shls',
  shoar: 'Shr', shore: 'Shr', shr: 'Shr', shoars: 'Shrs', shores: 'Shrs', shrs: 'Shrs',
  skyway: 'Skwy', skwy: 'Skwy',
  spg: 'Spg', spring: 'Spg', sprng: 'Spg', spngs: 'Spgs', springs: 'Spgs', sprngs: 'Spgs', spgs: 'Spgs',
  spur: 'Spur', spurs: 'Spur',
  sq: 'Sq', sqr: 'Sq', sqre: 'Sq', squ: 'Sq', square: 'Sq', sqrs: 'Sqs', squares: 'Sqs',
  sta: 'Sta', station: 'Sta', statn: 'Sta', stn: 'Sta',
  stra: 'Stra', strav: 'Stra', straven: 'Stra', stravenue: 'Stra', stravn: 'Stra', strvn: 'Stra', strvnue: 'Stra',
  stream: 'Strm', streme: 'Strm', strm: 'Strm',
  street: 'St', strt: 'St', str: 'St', st: 'St', streets: 'Sts',
  sumit: 'Smt', sumitt: 'Smt', summit: 'Smt', smt: 'Smt',
  terr: 'Ter', terrace: 'Ter', ter: 'Ter',
  throughway: 'Trwy', trwy: 'Trwy',
  trace: 'Trce', traces: 'Trce', trce: 'Trce',
  track: 'Trak', tracks: 'Trak', trak: 'Trak', trk: 'Trak', trks: 'Trak',
  trafficway: 'Trfy', trfy: 'Trfy',
  trail: 'Trl', trails: 'Trl', trl: 'Trl', trls: 'Trl',
  tunnel: 'Tunl', tunl: 'Tunl', tunls: 'Tunl', tunnels: 'Tunl', tunnl: 'Tunl',
  trnpk: 'Tpke', turnpike: 'Tpke', turnpk: 'Tpke', tpke: 'Tpke',
  underpass: 'Upas', upas: 'Upas',
  un: 'Un', union: 'Un', unions: 'Uns',
  valley: 'Vly', vally: 'Vly', vlly: 'Vly', vly: 'Vly', valleys: 'Vlys', vlys: 'Vlys',
  vdct: 'Via', via: 'Via', viadct: 'Via', viaduct: 'Via',
  view: 'Vw', vw: 'Vw', views: 'Vws', vws: 'Vws',
  vill: 'Vlg', villag: 'Vlg', village: 'Vlg', villg: 'Vlg', villiage: 'Vlg', vlg: 'Vlg', vlgs: 'Vlgs', villages: 'Vlgs',
  ville: 'Vl', vl: 'Vl',
  vis: 'Vis', vist: 'Vis', vista: 'Vis', vst: 'Vis', vsta: 'Vis',
  walk: 'Walk', walks: 'Walk',
  wall: 'Wall',
  way: 'Way', wy: 'Way', ways: 'Ways',
  well: 'Wl', wl: 'Wl', wells: 'Wls', wls: 'Wls',
};

// ─── Directional words and abbreviations → USPS two-letter code ───────────────
const DIRECTIONAL_MAP = {
  north: 'N', south: 'S', east: 'E', west: 'W',
  northeast: 'NE', northwest: 'NW', southeast: 'SE', southwest: 'SW',
  n: 'N', s: 'S', e: 'E', w: 'W',
  ne: 'NE', nw: 'NW', se: 'SE', sw: 'SW',
};

// ─── US state full names → two-letter USPS code ───────────────────────────────
const STATE_MAP = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
  'puerto rico': 'PR', 'guam': 'GU', 'virgin islands': 'VI',
};

// ─── Secondary-unit designators (USPS Pub 28, appendix C2) ───────────────────
// These are stripped along with everything that follows them.
const UNIT_DESIGNATORS = [
  'apartment', 'apt', 'basement', 'bldg', 'building', 'department', 'dept',
  'floor', 'fl', 'frnt', 'front', 'hangar', 'hngr', 'key', 'lbby', 'lobby',
  'lot', 'lower', 'lowr', 'ofc', 'office', 'penthouse', 'ph', 'pier', 'rear',
  'rm', 'room', 'side', 'slip', 'space', 'spc', 'stop', 'ste', 'suite',
  'trlr', 'trailer', 'unit', 'upper', 'uppr',
];

// Pre-build regex: match any unit designator (whole word) followed by optional value.
// Also matches bare "#" followed by alphanumerics.
const UNIT_RE = new RegExp(
  `\\b(${UNIT_DESIGNATORS.join('|')})\\.?\\s*[\\w-]*|#\\s*[\\w-]+`,
  'gi',
);

// ─── Combined-address pattern ─────────────────────────────────────────────────
// Detects "123 Some Street, City, ST 12345" or "123 Some St City ST 12345"
// Captures: street | city | state (2-letter) | zip (5-digit)
const COMBINED_RE = /^(.+?)[,\s]+([a-zA-Z\s]+?)[,\s]+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clean(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .replace(/[,.\-]+$/, '')   // trailing punctuation
    .replace(/\s{2,}/g, ' ')  // collapse whitespace
    .trim();
}

function titleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Normalise the suffix token (last significant word) of a street string.
 * Operates on the already-tokenised parts array, mutating in place.
 */
function normaliseSuffix(tokens) {
  if (tokens.length < 2) return tokens;

  // Find the last non-directional, non-numeric token to treat as the suffix
  let suffixIdx = tokens.length - 1;

  // If the last token is a directional (post-directional), skip it
  if (DIRECTIONAL_MAP[tokens[suffixIdx].toLowerCase()]) {
    suffixIdx--;
  }

  if (suffixIdx < 1) return tokens;

  const key = tokens[suffixIdx].toLowerCase().replace(/\.$/, '');
  if (SUFFIX_MAP[key]) {
    tokens[suffixIdx] = SUFFIX_MAP[key];
  }

  return tokens;
}

/**
 * Normalise directional tokens (pre- and post-directional).
 * Converts "North" → "N", "Southwest" → "SW", etc.
 */
function normaliseDirectionals(tokens) {
  return tokens.map((t, i) => {
    // Only convert if it looks like a standalone directional (not part of a city name)
    const key = t.toLowerCase();
    if (DIRECTIONAL_MAP[key]) {
      return DIRECTIONAL_MAP[key];
    }
    return t;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalise a contact's address fields for BatchData / Trestle lookup.
 *
 * Input: contact object with any of { address, city, state, zip }
 * Output: { street, city, state, zip, changed } where `changed` is true when
 *         any value differs from the raw input (useful for logging).
 *
 * @param {object} contact
 * @returns {{ street: string, city: string, state: string, zip: string, changed: boolean }}
 */
export function normalizeAddress(contact) {
  let street = clean(contact.address || '');
  let city   = clean(contact.city   || '');
  let state  = clean(contact.state  || '');
  let zip    = clean(contact.zip    || '');

  const rawStreet = street;
  const rawCity   = city;
  const rawState  = state;
  const rawZip    = zip;

  // ── 1. Combined-address parsing ─────────────────────────────────────────────
  // If the street field contains what looks like "Street, City, ST ZIP" we split it.
  if (street) {
    const m = COMBINED_RE.exec(street);
    if (m) {
      street = clean(m[1]);
      // Only override city/state/zip if they are empty — don't clobber explicit fields.
      if (!city)  city  = clean(m[2]);
      if (!state) state = clean(m[3]);
      if (!zip)   zip   = clean(m[4]);
    }
  }

  // ── 2. ZIP cleanup ───────────────────────────────────────────────────────────
  if (zip) {
    // Strip ZIP+4 extension ("22042-1234" → "22042")
    zip = zip.replace(/-\d{4}$/, '').replace(/[^\d]/g, '').substring(0, 5);
  }

  // ── 3. State normalisation ───────────────────────────────────────────────────
  if (state) {
    const stateLower = state.toLowerCase();
    if (STATE_MAP[stateLower]) {
      state = STATE_MAP[stateLower];
    } else {
      // Already a 2-letter code: uppercase
      state = state.toUpperCase().substring(0, 2);
    }
  }

  // ── 4. Unit/secondary stripping ─────────────────────────────────────────────
  if (street) {
    street = street.replace(UNIT_RE, '').replace(/\s{2,}/g, ' ').trim();
    // Remove trailing comma or dash left after stripping
    street = street.replace(/[,\-\s]+$/, '').trim();
  }

  // ── 5. Suffix + directional normalisation ───────────────────────────────────
  if (street) {
    // Tokenise on whitespace
    const tokens = street.split(/\s+/);

    // Normalise directionals first (pre- and post-directional)
    const withDirectionals = normaliseDirectionals(tokens);

    // Normalise the street-type suffix
    normaliseSuffix(withDirectionals);

    // Rebuild with title case for each token (USPS standard)
    street = withDirectionals
      .map(t => {
        // Directionals stay uppercase
        if (/^(N|S|E|W|NE|NW|SE|SW)$/.test(t)) return t;
        // Known suffix abbreviations: first letter uppercase, rest lower
        if (/^[A-Z][a-z]+$/.test(t)) return t; // already title case from SUFFIX_MAP
        // Number or alphanumeric unit (e.g. "123", "4B") — keep as-is
        if (/^\d/.test(t)) return t;
        return titleCase(t);
      })
      .join(' ');
  }

  // ── 6. City title-case ────────────────────────────────────────────────────
  if (city) {
    city = titleCase(city);
  }

  // ── 7. Final whitespace cleanup ──────────────────────────────────────────
  street = street.replace(/\s{2,}/g, ' ').trim();
  city   = city.replace(/\s{2,}/g, ' ').trim();

  const changed =
    street !== rawStreet ||
    city   !== rawCity   ||
    state  !== rawState  ||
    zip    !== rawZip;

  return { street, city, state, zip, changed };
}
