// ── Application / outreach status vocabulary ─────────────────────────────────
// One definition of what each funnel stage means, shared by the dashboard
// metrics, the auto-apply queue and the pipeline board, so they can't drift.

// Worker / user statuses on evaluations.apply_status.
export const APPLIED   = ['submitted', 'responded', 'interview', 'offer', 'rejected']; // really sent to the employer
export const RESPONDED = ['responded', 'interview', 'offer', 'rejected'];
export const INTERVIEW = ['interview', 'offer'];
export const IN_FLIGHT = ['opened', 'queued', 'in_progress', 'needs_review', 'captcha_needed', 'login_needed'];
export const FAILED    = ['submit_failed', 'platform_unsupported'];

// Contact statuses on job_contacts / prospects. A reply implies it was sent.
export const OUTREACH_SENT    = ['sent', 'email_sent', 'dm_sent', 'replied'];
export const OUTREACH_REPLIED = ['replied'];

/** SQL list literal for a constant status set: ('a','b'). Constants only — never user input. */
export function sqlList(values) {
  return `(${values.map(v => {
    if (!/^[a-z_]+$/.test(v)) throw new Error(`unsafe status literal: ${v}`);
    return `'${v}'`;
  }).join(',')})`;
}
