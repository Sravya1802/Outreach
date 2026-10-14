/**
 * sendWindow.js — when an email should land: 8–11 AM on a weekday in the
 * recipient's time zone (cold-email studies: mid-week mornings get the most
 * replies; evenings and weekends the fewest). Follow-ups count business days.
 * No date library: offsets come from Intl, so DST is handled per zone.
 */

const US_STATE_TZ = {
  // Eastern
  CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York',
  ME: 'America/New_York', MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', NH: 'America/New_York',
  NJ: 'America/New_York', NY: 'America/New_York', NC: 'America/New_York', OH: 'America/New_York', PA: 'America/New_York',
  RI: 'America/New_York', SC: 'America/New_York', VT: 'America/New_York', VA: 'America/New_York', WV: 'America/New_York',
  IN: 'America/Indiana/Indianapolis', KY: 'America/New_York',
  // Central
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago', IA: 'America/Chicago', KS: 'America/Chicago',
  LA: 'America/Chicago', MN: 'America/Chicago', MS: 'America/Chicago', MO: 'America/Chicago', NE: 'America/Chicago',
  ND: 'America/Chicago', OK: 'America/Chicago', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', WI: 'America/Chicago',
  // Mountain / Pacific / other
  AZ: 'America/Phoenix', CO: 'America/Denver', ID: 'America/Boise', MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver', WY: 'America/Denver',
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};

const STATE_NAMES = {
  'new york': 'NY', california: 'CA', washington: 'WA', texas: 'TX', massachusetts: 'MA', illinois: 'IL', georgia: 'GA',
  colorado: 'CO', florida: 'FL', 'north carolina': 'NC', virginia: 'VA', pennsylvania: 'PA', 'new jersey': 'NJ',
  michigan: 'MI', ohio: 'OH', oregon: 'OR', utah: 'UT', arizona: 'AZ', minnesota: 'MN', tennessee: 'TN', maryland: 'MD',
  wisconsin: 'WI', missouri: 'MO', indiana: 'IN', connecticut: 'CT',
};

// Checked in order; first match wins.
const PLACES = [
  [/\b(new york|nyc|brooklyn|manhattan|boston|cambridge|philadelphia|pittsburgh|atlanta|miami|washington,? d\.?c|arlington|reston|charlotte|raleigh|durham|jersey city|hoboken|stamford|baltimore)\b/, 'America/New_York'],
  [/\b(chicago|austin|dallas|houston|san antonio|minneapolis|st\.? louis|kansas city|nashville|madison|milwaukee|new orleans|plano|irving)\b/, 'America/Chicago'],
  [/\b(denver|boulder|salt lake|lehi|provo)\b/, 'America/Denver'],
  [/\b(phoenix|scottsdale|tempe)\b/, 'America/Phoenix'],
  [/\b(san francisco|bay area|sf|palo alto|mountain view|menlo park|sunnyvale|san jose|santa clara|cupertino|redwood city|oakland|berkeley|los angeles|santa monica|san diego|irvine|seattle|bellevue|redmond|kirkland|portland)\b/, 'America/Los_Angeles'],
  [/\b(india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurgaon|gurugram|noida|chennai|kolkata|ahmedabad)\b/, 'Asia/Kolkata'],
  [/\b(toronto|ottawa|montreal|waterloo)\b/, 'America/Toronto'],
  [/\b(vancouver)\b/, 'America/Vancouver'],
  [/\b(london|manchester|edinburgh|united kingdom|\buk\b)\b/, 'Europe/London'],
  [/\b(dublin|ireland)\b/, 'Europe/Dublin'],
  [/\b(berlin|munich|germany|amsterdam|netherlands|paris|france|zurich|switzerland|stockholm|madrid|barcelona|warsaw)\b/, 'Europe/Berlin'],
  [/\b(singapore)\b/, 'Asia/Singapore'],
  [/\b(sydney|melbourne)\b/, 'Australia/Sydney'],
  [/\b(tel aviv|israel)\b/, 'Asia/Jerusalem'],
];

/** Best guess at a location's time zone, or null. */
export function timezoneFor(location) {
  const raw = String(location || '');
  const s = raw.toLowerCase();
  if (!s.trim()) return null;
  for (const [re, tz] of PLACES) if (re.test(s)) return tz;
  const code = /,\s*([A-Z]{2})\b/.exec(raw)?.[1];
  if (code && US_STATE_TZ[code]) return US_STATE_TZ[code];
  for (const [name, abbr] of Object.entries(STATE_NAMES)) if (new RegExp(`\\b${name}\\b`).test(s)) return US_STATE_TZ[abbr];
  return null;
}

export function isValidTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return Boolean(tz); } catch { return false; }
}

/** Wall-clock parts of an instant in a zone. */
export function partsIn(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, dow };
}

/** The instant when the clock in `tz` reads y-m-d h:mi. */
export function zonedToUtc({ year, month, day, hour = 0, minute = 0 }, tz) {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(guess), tz);
    const asIf = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const want = Date.UTC(year, month - 1, day, hour, minute);
    if (asIf === want) break;
    guess += want - asIf;
  }
  return new Date(guess);
}

function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), dow: d.getUTCDay() };
}

/**
 * The next send time inside the window on a weekday in `tz`. `rand` picks
 * the minute (0–1) so a day's emails don't all go at once.
 */
export function nextSendSlot(tz, { now = new Date(), startHour = 8, endHour = 11, rand = Math.random } = {}) {
  const zone = isValidTz(tz) ? tz : 'America/New_York';
  const local = partsIn(now, zone);
  for (let i = 0; i < 8; i++) {
    const day = addDays(local, i);
    if (day.dow === 0 || day.dow === 6) continue;
    const open = zonedToUtc({ ...day, hour: startHour }, zone);
    const close = zonedToUtc({ ...day, hour: endHour }, zone);
    const earliest = Math.max(open.getTime(), now.getTime() + 2 * 60_000);
    if (earliest >= close.getTime() - 60_000) continue;
    return new Date(earliest + Math.floor(rand() * (close.getTime() - earliest - 60_000)));
  }
  return new Date(now.getTime() + 24 * 3600_000);
}

/** The window opening on the weekday `n` business days after `from`, in `tz`. */
export function businessDaysLater(from, n, tz, opts = {}) {
  const zone = isValidTz(tz) ? tz : 'America/New_York';
  let day = partsIn(from, zone);
  let left = n;
  while (left > 0) {
    day = addDays(day, 1);
    if (day.dow !== 0 && day.dow !== 6) left -= 1;
  }
  const start = zonedToUtc({ ...day, hour: 0 }, zone);
  return nextSendSlot(zone, { ...opts, now: start });
}

/** "Tue 9:14 AM" in the zone, for the UI and logs. */
export function describeSlot(date, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
}
