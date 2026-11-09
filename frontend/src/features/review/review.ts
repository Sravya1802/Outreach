import type { ApproveResult, PipelineRun, ReferralMode, ReviewRow, ReviewStatus } from '@/lib/api'
import { timeAgo } from '@/lib/format'

export type ReviewTab = 'ready' | 'revising' | 'working' | 'waiting' | 'approved' | 'applied' | 'closed'

export const TABS: { value: ReviewTab; label: string }[] = [
  { value: 'ready', label: 'Ready for you' },
  { value: 'revising', label: 'Revising' },
  { value: 'working', label: 'Run working now' },
  { value: 'waiting', label: 'Waiting for a run' },
  { value: 'approved', label: 'Approved' },
  { value: 'applied', label: 'Applied' },
  { value: 'closed', label: 'Closed' },
]

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  queued: 'Waiting for a run',
  in_progress: 'A run is on it',
  ready: 'Ready for review',
  revision_requested: 'Revision requested',
  approved: 'Approved',
  applied: 'Applied',
  closed: 'Closed',
}

export const MODE_LABEL: Record<ReferralMode, string> = {
  recruiters: 'Recruiters only',
  recruiters_engineers: 'Recruiters and engineers',
  my_contact: 'My contact',
  none: 'None',
}

export const NOTE_LIMIT = 300

/** The tab a role sits in. A role a run is revising stays in Revising. */
export function reviewTab(r: Pick<ReviewRow, 'status' | 'open_comments'>): ReviewTab {
  if (r.status === 'queued') return 'waiting'
  if (r.status === 'in_progress') return r.open_comments > 0 ? 'revising' : 'working'
  if (r.status === 'revision_requested') return 'revising'
  return r.status
}

/** The backlog bar: a role is done once a run has written it or closed it. */
export function backlog(rows: Pick<ReviewRow, 'status' | 'open_comments'>[]) {
  const done = rows.filter(r => !['working', 'waiting'].includes(reviewTab(r))).length
  return { done, total: rows.length, percent: rows.length ? Math.round((done / rows.length) * 100) : 0 }
}

// claim_tailor_jobs gives up on a run after this long and puts its roles back in line.
const RUN_STOPPED_MS = 2 * 60 * 60 * 1000

/** A run with no finish time isn't running if it has outlived the 2 hours. */
export const isRunning = (run: PipelineRun | null, now = Date.now()) =>
  !!run && !run.finished_at && now - new Date(run.started_at).getTime() < RUN_STOPPED_MS

/** One line on the latest run, so an empty Run working now tile isn't a mystery. */
export function runLine(run: PipelineRun | null, now = Date.now()) {
  if (!run) return 'No run has started yet.'
  if (isRunning(run, now)) return `Run ${run.id} started ${timeAgo(run.started_at, now)}.`
  if (!run.finished_at) return `Run ${run.id} started ${timeAgo(run.started_at, now)} and never finished. Its roles go back in line on the next run.`
  const failed = run.roles_failed ? `, ${run.roles_failed} failed` : ''
  return `Run ${run.id} finished ${timeAgo(run.finished_at, now)}: ${run.roles_done} ${run.roles_done === 1 ? 'role' : 'roles'} done${failed}.`
}

const againLine = (n = 0) => (n ? ` ${n === 1 ? '1 person' : `${n} people`} already asked for another role ${n === 1 ? 'wasn’t' : 'weren’t'} contacted again.` : '')

/** What Approve did, for the toast. */
export function approvedLine({ emails, notes, repeated }: ApproveResult) {
  const again = againLine(repeated)
  if (!emails && notes) return `Approved. LinkedIn notes are waiting in People → Contacts; mark each one sent, and applying waits 2 business days from then.${again}`
  if (!emails) return `Approved.${again} No outreach went out, so it applies only when you press Apply without referral.`
  const count = emails === 1 ? '1 email' : `${emails} emails`
  return `Approved. ${count} in Outbox, reaching Gmail Drafts within a minute. OK each one in Outbox to send it.${again}`
}

/** The rule is above 90, so 90 itself is under it. */
export const atsOk = (n: number | null | undefined) => n != null && n > 90

/** Says so when the posting rules out someone who needs sponsorship. */
export const visaLine = (s: string | null | undefined) => (s === 'citizens_only' ? 'US citizens only' : s === 'no_sponsorship' ? 'Won’t sponsor' : null)

/** A recruiter mode with nothing written. My contact and None email nobody, so they never wait for this. */
export const needsOutreach = (r: Pick<ReviewRow, 'referral_mode' | 'outreach'>) => ['recruiters', 'recruiters_engineers'].includes(r.referral_mode) && r.outreach === 0

/** Where a role with no outreach stands. */
export const outreachLine = (r: Pick<ReviewRow, 'outreach_due' | 'contacts_at'>) => (r.outreach_due ? 'Emails coming' : r.contacts_at ? 'No recruiter found' : 'No outreach yet')

/** A role Approve can take. */
export const canApprove = (r: Pick<ReviewRow, 'status' | 'check_status' | 'referral_mode' | 'outreach'>) => r.status === 'ready' && r.check_status === 'passed' && !needsOutreach(r)

/** What Select all takes: nothing under the ATS rule or with an eligibility question goes in unread. */
export const safeToBulk = (r: Pick<ReviewRow, 'status' | 'check_status' | 'referral_mode' | 'outreach' | 'ats_after' | 'eligibility' | 'sponsorship'>) => canApprove(r) && atsOk(r.ats_after) && !r.eligibility && !visaLine(r.sponsorship)

/** How a bulk approve went, for the toast. */
export function bulkLine(done: ApproveResult[], failed: number) {
  const emails = done.reduce((n, r) => n + r.emails, 0)
  const roles = done.length === 1 ? '1 role' : `${done.length} roles`
  const mail = emails === 1 ? '1 email' : `${emails} emails`
  const repeated = done.reduce((n, r) => n + (r.repeated ?? 0), 0)
  return `Approved ${roles}.${emails ? ` ${mail} in Outbox, reaching Gmail Drafts over the next few minutes, each waiting for your OK.` : ''}${againLine(repeated)}${failed ? ` ${failed} couldn’t be approved.` : ''}`
}

/** "About 3:05 PM", or Due now once the time has passed. */
export function nextRunLine(at: string | null, now = Date.now()) {
  if (!at) return 'Not scheduled'
  const t = new Date(at)
  if (t.getTime() <= now) return 'Due now'
  return `About ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [])
const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x : null)

/** A run writes the report as free JSON, so anything can be missing. */
export function readReport(report: unknown) {
  const r = (report && typeof report === 'object' ? report : {}) as Record<string, unknown>
  const scores = (r.scores && typeof r.scores === 'object' ? r.scores : {}) as Record<string, unknown>
  const table = r.keyword_table
  // Written as [{ keyword, where }] or as { keyword: where }.
  const rows: { keyword?: unknown; where?: unknown }[] = Array.isArray(table) ? table
    : table && typeof table === 'object' ? Object.entries(table).map(([keyword, where]) => ({ keyword, where })) : []
  const keywords = rows
    .map(k => ({ keyword: text(k?.keyword), where: text(k?.where) }))
    .filter((k): k is { keyword: string; where: string | null } => k.keyword !== null)
  return {
    needs: strings(r.top_5_hiring_needs),
    gaps: strings(r.gaps),
    changes: strings(r.changes_made),
    keywords,
    verdict: text(r.verdict),
    posting: text(r.posting_check),
    eligibility: text(r.eligibility_flag),
    nextChange: text(r.one_more_change),
    atsReason: text(scores.ats_reason),
    callbackReason: text(scores.callback_reason),
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', bull: '•', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

function entity(whole: string, name: string) {
  if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole
  const n = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole
}

// Words that start a sentence or a list item in postings whose breaks were lost, as in "degreeStrong Python".
// A list and not any capital, which would split JavaScript. No "In", which would split LinkedIn.
const STARTERS = 'About|Ability|As|At|Bachelor|Basic|Benefits|Compensation|Demonstrated|Desired|Excellent|Experience|Exposure|Familiarity|Job|Master|Minimum|Our|Preferred|Previous|Proficiency|Qualifications|Required|Requirements|Responsibilities|Solid|Strong|The|This|Understanding|We|What|You'
const RUN_ON = new RegExp(`(?<=[a-z0-9)%][.!?:])(?=[A-Z][a-z])|(?<=[a-z)])(?=(?:${STARTERS})\\b)`, 'g')

/** A posting as plain text: most are already, some are scraped HTML. Line breaks stay; block tags become them, and so do sentences a scrape ran together. */
export function cleanPosting(raw: string | null | undefined) {
  return (raw ?? '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s*<li\b[^>]*>\s*/gi, '\n• ')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol)\s*>/gi, '\n\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, entity)
    .replace(RUN_ON, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export type KeywordState = 'found' | 'missing' | 'unchecked'

/** What the PDF check said, each side of "A / B" on its own. No check to go on stays unchecked, never found. */
export function keywordStates(keywords: { keyword: string }[], check: { present?: string[]; missing: string[] } | null | undefined): { keyword: string; state: KeywordState }[] {
  if (!check?.present) return keywords.map(k => ({ keyword: k.keyword, state: 'unchecked' }))
  return [...check.present.map(keyword => ({ keyword, state: 'found' as const })), ...check.missing.map(keyword => ({ keyword, state: 'missing' as const }))]
}

/** What to look for in the text: "A / B" and "A (B)" are two things, "CI/CD" is one. */
const termsOf = (keyword: string) => keyword.split(/\s+\/\s+|\s*[()]\s*/).map(t => t.trim()).filter(Boolean)

/** Spaces and hyphens match each other and a plural matches its singular. */
function termPattern(term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+')
  return term.length > 2 && /[a-z]$/i.test(term) ? `${escaped.replace(/(?<=[a-z]{2})s$/i, '')}s?` : escaped
}

const exactCase = (term: string) => term.length <= 2 || /^[A-Z]{3,4}$/.test(term)

export type PostingPart = { text: string } | { text: string; state: KeywordState }

/**
 * The text cut up around each keyword. Longer terms win, so "Apache Spark" isn't
 * marked as "Spark". Two letters and acronyms must match case, so "Go" skips "go".
 * `placed` is the keywords the text really has; the rest need saying some other way.
 */
export function markPosting(text: string, keywords: { keyword: string; state: KeywordState }[]) {
  const terms = keywords
    .flatMap(k => termsOf(k.keyword).map(term => ({ term, keyword: k.keyword, state: k.state })))
    .sort((a, b) => b.term.length - a.term.length)
  if (!terms.length) return { parts: text ? [{ text }] : [], placed: new Set<string>() }
  const find = new RegExp(`(?<![\\p{L}\\p{N}+#])(?:${terms.map(t => `(${termPattern(t.term)})`).join('|')})(?![\\p{L}\\p{N}+#])`, 'giu')
  const parts: PostingPart[] = []
  const placed = new Set<string>()
  let at = 0
  for (const m of text.matchAll(find)) {
    const hit = terms[m.slice(1).findIndex(g => g !== undefined)]
    if (!hit || (exactCase(hit.term) && !m[0].startsWith(hit.term))) continue
    if (m.index > at) parts.push({ text: text.slice(at, m.index) })
    parts.push({ text: m[0], state: hit.state })
    placed.add(hit.keyword)
    at = m.index + m[0].length
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return { parts, placed }
}
