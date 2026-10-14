// Normalizes the profile's experience list (user_profile.experiences).
const MAX_ENTRIES = 15;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/; // "2025-06" (from <input type="month">)

/** Untrusted input → clean entries, newest first. Throws on a non-array. */
export function normalizeExperiences(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw Object.assign(new Error('experiences must be a list'), { status: 400 });
  return input.slice(0, MAX_ENTRIES).map(e => {
    const current = Boolean(e?.current);
    const start = MONTH.test(e?.start) ? e.start : '';
    const end = current ? '' : (MONTH.test(e?.end) ? e.end : '');
    return {
      company: str(e?.company, 200),
      title: str(e?.title, 200),
      location: str(e?.location, 200),
      type: ['job', 'internship', 'research', 'part_time', 'volunteer'].includes(e?.type) ? e.type : 'internship',
      start, end, current,
      summary: str(e?.summary, 2000),
    };
  })
    .filter(e => e.company || e.title)
    .sort((a, b) => Number(b.current) - Number(a.current) || (b.end || '9999').localeCompare(a.end || '9999') || b.start.localeCompare(a.start));
}

/** The entry forms mean by "current or most recent". */
export function mostRecent(entries) {
  return entries[0] ?? null;
}
