/**
 * postingText.js — is a fetched page a job description? Many fetches come
 * back with something else: LinkedIn's pay-range box, an iCIMS or careers-page
 * shell, a "no open positions" page. Scoring those gives a role a 9.8 with
 * nothing to check it against. Pure functions (no I/O).
 */

const JD_SIGNALS = /responsibilit|requirement|qualification|what you['’]ll|you will|you['’]ll (?:be|work|build|join)|experience (?:with|in)|skills|about (?:the|this) (?:role|team|job|position)|looking for|duties|preferred|bachelor|degree|proficien/gi;
const SHELL = /loading job openings|no open positions|currently no open|\{\{\s*company\.name\s*\}\}|sign in to (?:view|see)|page not found|no longer available|this job has expired|position has been filled/i;
const CLOSED = /no open positions|currently no open|no longer available|job not found|has expired|position has been filled|no longer accepting/i;

/** At least 500 characters with two or more of the things job descriptions say. */
export function looksLikeJobDescription(text) {
  const t = String(text || '');
  if (t.length < 500) return false;
  if (SHELL.test(t) && t.length < 3000) return false;
  const kinds = new Set((t.match(JD_SIGNALS) || []).map(m => m.toLowerCase().slice(0, 6)));
  return kinds.size >= 2;
}

export const looksClosed = (text) => CLOSED.test(String(text || ''));

/** LinkedIn job id from https://www.linkedin.com/jobs/view/<id> or ...?currentJobId=<id>. */
export function linkedInJobId(jobUrl) {
  try {
    const u = new URL(jobUrl);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
    return (u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/) || [])[1] || u.searchParams.get('currentJobId') || null;
  } catch { return null; }
}

