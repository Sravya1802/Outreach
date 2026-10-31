// ── Which year a role is for ─────────────────────────────────────────────────
// Postings name the year in the title ("2027 New Grad", "Summer 2027") or in
// the description, next to words about graduating or starting ("graduating in
// December 2026 or Spring 2027", "start date will be January 2027"). A bare
// year elsewhere in a description (a copyright, a deadline) doesn't count.
// Patterns are Postgres regexes (\m and \M are word starts and ends).

const CONTEXT = '(?:grad\\w*|class of|degree|start\\w*|university|college|commenc\\w*|complet\\w*|summer|fall|winter|spring|cohort)[^.\\n]{0,60}?';
const ANY_YEAR = '202[5-9]';

/** ?year= → '2027' (says 2027) or '2027-or-unstated' (says 2027, or names no year); anything else is no filter. */
export function parseYearFilter(value) {
  const m = /^(202[5-9])(-or-unstated)?$/.exec(String(value || ''));
  return m ? { year: m[1], orUnstated: Boolean(m[2]) } : null;
}

/** SQL condition: the role names `year` (a regex for one or more years). `next` is the first free $ index. */
function names(year, next) {
  return {
    sql: `(title ~ $${next} OR left(COALESCE(description, ''), 20000) ~* $${next + 1})`,
    params: [`\\m${year}\\M`, `${CONTEXT}\\m${year}\\M`],
  };
}

/** WHERE fragment + params for a parsed filter (null → no condition). */
export function yearCondition(filter, next) {
  if (!filter) return null;
  const says = names(filter.year, next);
  if (!filter.orUnstated) return says;
  const any = names(ANY_YEAR, next + 2);
  return { sql: `(${says.sql} OR NOT ${any.sql})`, params: [...says.params, ...any.params] };
}

/** SELECT expression: the years (2025–2029) a row names, for the year tag on each role. */
export const YEARS_SELECT = `ARRAY(
  SELECT y FROM unnest(ARRAY['2025', '2026', '2027', '2028', '2029']) AS y
   WHERE r.title ~ ('\\m' || y || '\\M') OR left(COALESCE(r.description, ''), 20000) ~* ('${CONTEXT}\\m' || y || '\\M')
) AS grad_years`;
