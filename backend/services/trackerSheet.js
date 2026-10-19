/**
 * trackerSheet.js — the application tracker as a sheet: the user's own
 * spreadsheet columns (Companies, Roles, Link, Submitted, Application
 * Status, Referral Status) mapped to and from evaluations.
 *
 * Pure functions (no I/O): CSV parsing, finding the header row, and the
 * status words both ways, so an import and a download round-trip.
 */

const str = (v) => String(v ?? '').trim();

/** RFC 4180 CSV: quoted fields, "" escapes, newlines inside quotes, CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const HEADERS = {
  company: /^compan/i,
  role: /^(roles?|title|position|job)/i,
  link: /^(link|url|apply|posting)/i,
  submitted: /^(submitted|applied)/i,
  status: /^(application )?status/i,
  referral: /^ref+er+al/i, // "Referral", and the sheet's own "Refferal"
};

/**
 * The tracker rows in a CSV export of the user's sheet. The header row is
 * found wherever it is (the sheet has a title banner above it); rows with
 * neither a company nor a role are skipped.
 */
export function sheetRows(csvText) {
  const rows = parseCsv(csvText);
  const at = rows.findIndex(r => r.some(c => HEADERS.company.test(str(c))) && r.some(c => HEADERS.role.test(str(c))));
  if (at < 0) return { rows: [], title: null, error: 'No header row with “Companies” and “Roles” found. Export the tab that holds your applications.' };
  const head = rows[at].map(str);
  // The sheet's title banner ("2027 NEW GRAD ROLES APPLICATION"): the last row above the header with a single filled cell.
  const banner = rows.slice(0, at).map(r => r.map(str).filter(Boolean)).filter(c => c.length === 1).pop();
  const title = banner ? banner[0].slice(0, 120) : null;
  const col = {};
  for (const [key, re] of Object.entries(HEADERS)) {
    const i = head.findIndex(h => re.test(h));
    if (i >= 0) col[key] = i;
  }
  const out = [];
  for (const r of rows.slice(at + 1)) {
    const get = (k) => (col[k] == null ? '' : str(r[col[k]]));
    const company = get('company');
    const role = get('role');
    if (!company && !role) continue;
    const link = /^https?:\/\//i.test(get('link')) ? get('link') : '';
    out.push({ company, role, link, submitted: get('submitted'), status: get('status'), referral: get('referral') });
  }
  return { rows: out, title, error: null };
}

const SENT = ['submitted', 'responded', 'interview', 'offer', 'rejected'];

/** The sheet's words → evaluations.apply_status. */
export function toApplyStatus(submitted, status) {
  const s = str(status).toLowerCase();
  if (/reject|declin|not selected|no longer/.test(s)) return 'rejected';
  if (/offer/.test(s)) return 'offer';
  if (/interview|onsite|final round|superday/.test(s)) return 'interview';
  if (/progress|assessment|\boa\b|screen|hackerrank|codesignal|recruiter/.test(s)) return 'responded';
  if (/wait|hear|applied|submitted|pending/.test(s)) return 'submitted';
  return /^(yes|y|true|done|✓)$/i.test(str(submitted)) ? 'submitted' : 'not_started';
}

/** The sheet's referral words → evaluations.referral_status (null = not set). */
export function toReferral(text) {
  const s = str(text).toLowerCase();
  if (!s) return null;
  if (/not required|not needed|n\/a|^na$/.test(s)) return 'not_required';
  if (/^(yes|y|referred|done)/.test(s)) return 'yes';
  if (/ask|pending|request/.test(s)) return 'asked';
  if (/^(no|n)$|^no\b/.test(s)) return 'no';
  return null;
}

export const STATUS_LABEL = {
  not_started: '', opened: '', queued: '', in_progress: '', needs_review: '', captcha_needed: '', login_needed: '', submit_failed: '', platform_unsupported: '',
  submitted: 'Waiting to hear back', responded: 'In Progress', interview: 'Interview', offer: 'Offer', rejected: 'Rejected',
};
export const REFERRAL_LABEL = { yes: 'Yes', no: 'No', not_required: 'Not Required', asked: 'Asked' };

export const isSent = (applyStatus) => SENT.includes(applyStatus);

/**
 * A plan item's referral progress (from the referral flow) as the sheet's
 * word, used when the user hasn't set one themselves.
 */
export function referralFromPlan(planStatus) {
  return { submitted: 'yes', link: 'yes', asked: 'asked', declined: 'no' }[planStatus] || null;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Tracker rows → a CSV with the sheet's own columns, ready for File → Import in Google Sheets. */
export function toCsv(rows) {
  const lines = [['Companies', 'Roles', 'Link', 'Submitted', 'Application Status', 'Referral Status']];
  for (const r of rows) {
    lines.push([r.company_name, r.job_title, r.job_url || '', isSent(r.apply_status) ? 'Yes' : '', STATUS_LABEL[r.apply_status] ?? '', REFERRAL_LABEL[r.referral] || '']);
  }
  return lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Match key for de-duplicating an import: the link without tracking bits, else company + role. */
export function matchKey({ company, role, link }) {
  if (link) {
    try {
      const u = new URL(link);
      const keep = ['gh_jid', 'jobId', 'id', 'currentJobId'].filter(k => u.searchParams.get(k)).map(k => `${k}=${u.searchParams.get(k)}`);
      return `url:${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}${keep.length ? `?${keep.join('&')}` : ''}`;
    } catch { /* fall through */ }
  }
  return `cr:${str(company).toLowerCase().replace(/[^a-z0-9]/g, '')}|${str(role).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
