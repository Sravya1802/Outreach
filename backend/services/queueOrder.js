// The pure half of queueAll.js: which roles the Roles tab holds, how the same
// job is grouped, and the order roles go to the runs. No I/O.
import { notReturnToSchool, yearCondition } from './gradYear.js';

// The Roles tab as the user reads it: USA, says 2027, not "won't sponsor".
export const QUEUE_YEAR = '2027';
export const OLD_DAYS = 14;
export const SOON_DAYS = 7;
export const RECHECK_DAYS = 3;
export const DAY = 86_400_000;
const ATS = /(greenhouse\.io|lever\.co|ashbyhq\.com)/i;

/** WHERE (on scraped_roles, unqualified) for the Roles tab's roles; `next` is the first free $ index. */
export function rolesTabWhere(next, { keepReturnToSchool = false } = {}) {
  const y = yearCondition({ year: QUEUE_YEAR, orUnstated: false }, next);
  const parts = ['is_active = 1', "region = 'usa'", "role_type IN ('intern', 'new_grad')", "(sponsorship IS NULL OR sponsorship = 'sponsors')", y.sql];
  if (!keepReturnToSchool) parts.push(notReturnToSchool());
  return { sql: parts.join(' AND '), params: y.params };
}

export const day = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
export const time = (v) => (v ? new Date(v).getTime() || 0 : 0);
export const key = (company, title) => `${String(company || '').trim().toLowerCase()}|${String(title || '').trim().toLowerCase()}`;

/**
 * The order roles go to the runs: every role whose posting states a closing
 * date still to come, soonest first; then roles at top companies (FAANG+ and
 * quant firms, `top`), newest first; then the rest alternating newest and
 * oldest. Rows: { deadline, posted, top }. Pure.
 */
export function queueOrder(rows, { now = new Date() } = {}) {
  const today = day(now);
  const newest = (a, b) => time(b.posted) - time(a.posted);
  const dated = (r) => { const d = day(r.deadline); return Boolean(d && d >= today); };
  const closing = rows.filter(dated).sort((a, b) => day(a.deadline).localeCompare(day(b.deadline)) || Number(Boolean(b.top)) - Number(Boolean(a.top)) || newest(a, b));
  const left = rows.filter(r => !dated(r));
  const top = left.filter(r => r.top).sort(newest);
  const rest = left.filter(r => !r.top).sort(newest);
  const mix = [];
  for (let i = 0, j = rest.length - 1, first = true; i <= j; first = !first) mix.push(first ? rest[i++] : rest[j--]);
  return [...closing, ...top, ...mix];
}

/** Roles that are the same job (company + title), the one to apply on first: an auto-apply form, then the newest. Pure. */
export function groupRoles(roles) {
  const groups = new Map();
  for (const r of roles) {
    const k = key(r.company_name, r.title);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()].map((list) => {
    const sorted = [...list].sort((a, b) => Number(ATS.test(b.apply_url || '')) - Number(ATS.test(a.apply_url || '')) || time(b.posted) - time(a.posted));
    const locations = [...new Set(list.map(r => String(r.location || '').trim()).filter(Boolean))];
    const deadlines = list.map(r => day(r.apply_deadline)).filter(Boolean).sort();
    return { lead: sorted[0], ids: list.map(r => String(r.id)), location: locations.join('; ').slice(0, 300) || null, deadline: deadlines[0] || null };
  });
}

