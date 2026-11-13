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


// Titles the user doesn't apply to: outside software, data and AI, or a degree
// they don't have. A title that names software/data/AI work stays, whatever
// else it says ("Marketing Data Science Intern").
const IN_FIELD = /\b(software|data|machine learning|ml|ai|artificial intelligence|deep learning|llm|nlp|computer vision|developer|devops|sre|site reliability|backend|back-end|frontend|front-end|full[- ]?stack|cloud|platform engineer|infrastructure|security engineer|cyber ?security|analytics|quantitative|quant|algorithm|robotics software|embedded software|firmware|programmer|coding|computer science|research engineer|research scientist|applied scientist|swe|sde|statistic(s|al)|informatics|engineer, development)\b/i;
const OFF_FIELD = /\b(financial analyst|finance|accounting|accountant|audit|tax|treasury|fp&a|actuarial|underwriting|insurance|sales|marketing|communications|public relations|human resources|hr|recruiting|talent acquisition|legal|paralegal|supply chain|procurement|logistics|operations intern|business operations|strategy|strategic partnerships|consulting|ux|ui|user experience|graphic|visual design|product design|industrial design|content|journalism|editorial|wastewater|civil|mechanical|electrical engineer(ing)?|mechanical engineering|geotechnical|structural|surveying|digital design|graphic design|design intern|chemical|manufacturing|process engineer|quality engineer|facilities|construction|environmental|vlsi|asic|rtl|analog|circuit|physical design|hardware engineer|biology|biolog|chemistry|clinical|pharma|nursing|medical|public policy|economics|real estate|investment banking|wealth|private equity)\b/i;
const MBA = /\bmba\b/i;
const PHD_ONLY = /\b(ph\.?\s?d|doctoral|doctorate)\b/i;
const OTHER_DEGREE = /\b(master'?s?|masters|ms|m\.s\.|bachelor'?s?|bs|b\.s\.|undergrad(uate)?|graduate)\b/i;

/** Why a title is skipped ('mba' | 'phd' | 'field'), or null to keep it. Pure. */
export function offFieldReason(title) {
  const t = String(title || '');
  if (MBA.test(t)) return 'mba';
  if (PHD_ONLY.test(t) && !OTHER_DEGREE.test(t)) return 'phd';
  if (OFF_FIELD.test(t) && !IN_FIELD.test(t)) return 'field';
  return null;
}

/** The note a skipped role gets. */
export const OFF_FIELD_NOTE = {
  mba: 'Skipped: the role is for MBA students.',
  phd: 'Skipped: the role is for PhD students.',
  field: 'Skipped: outside software, data and AI.',
};
