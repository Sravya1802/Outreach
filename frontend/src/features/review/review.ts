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
export function approvedLine({ emails, notes, repeated, blankDraft }: ApproveResult) {
  const again = againLine(repeated)
  if (blankDraft) return 'Approved. Your template goes to Gmail Drafts with the resume attached and an empty To line: add the address you find and send it. It applies only when you press Apply without referral.'
  if (!emails && notes) return `Approved. LinkedIn notes are waiting in People → Contacts; mark each one sent, and applying waits 2 business days from then.${again}`
  if (!emails) return `Approved.${again} No outreach went out, so it applies only when you press Apply without referral.`
  const count = emails === 1 ? '1 email' : `${emails} emails`
  return `Approved. ${count} on the way to Outbox and Gmail Drafts. OK each one in Outbox to send it.${again}`
}

/** The rule is above 90, so 90 itself is under it. */
export const atsOk = (n: number | null | undefined) => n != null && n > 90

/** Says so when the posting rules out someone who needs sponsorship. */
export const visaLine = (s: string | null | undefined) => (s === 'citizens_only' ? 'US citizens only' : s === 'no_sponsorship' ? 'Won’t sponsor' : null)

/** A recruiter mode with nothing written. My contact and None email nobody, so they never wait for this. */
export const needsOutreach = (r: Pick<ReviewRow, 'referral_mode' | 'outreach'>) => ['recruiters', 'recruiters_engineers'].includes(r.referral_mode) && r.outreach === 0

/** Where a role with no outreach stands. */
export const outreachLine = (r: Pick<ReviewRow, 'outreach_due' | 'contacts_at'>) => (r.outreach_due ? 'Emails coming' : r.contacts_at ? 'No recruiter found' : 'No outreach yet')

export type OutreachState = 'written' | 'coming' | 'none' | 'nobody' | 'self'

/** The outreach menu: one state per role, the same ones the badges show. */
export const OUTREACH_OPTIONS: { value: OutreachState; label: string }[] = [
  { value: 'written', label: 'Has outreach' },
  { value: 'coming', label: 'Emails coming' },
  { value: 'none', label: 'No outreach yet' },
  { value: 'nobody', label: 'No recruiter found' },
  { value: 'self', label: 'My contact or none' },
]

export function outreachState(r: Pick<ReviewRow, 'referral_mode' | 'outreach' | 'outreach_due' | 'contacts_at'>): OutreachState {
  if (r.outreach > 0) return 'written'
  if (!needsOutreach(r)) return 'self'
  return r.outreach_due ? 'coming' : r.contacts_at ? 'nobody' : 'none'
}

/** '' keeps every role. */
export const outreachMatch = (r: Parameters<typeof outreachState>[0], filter: string) => !filter || outreachState(r) === filter

/** Before applying starts, you can say you applied yourself. */
export const canMarkApplied = (r: { status: ReviewStatus; finishing?: boolean }) =>
  ['queued', 'ready', 'revision_requested', 'approved'].includes(r.status) && !r.finishing

/** What I already applied did, for the toast. */
export const appliedLine = (emailsWaiting: number) =>
  `Marked as applied. Nothing will apply for you.${emailsWaiting ? ` ${emailsWaiting === 1 ? '1 email is' : `${emailsWaiting} emails are`} still in Outbox: OK or discard ${emailsWaiting === 1 ? 'it' : 'them'} there.` : ''}`

/** A role Approve can take. */
// No recruiter found: Approve puts the template in Gmail Drafts with an empty To line. Emails a run is about to write are waited for.
export const canApprove = (r: Pick<ReviewRow, 'status' | 'check_status' | 'referral_mode' | 'outreach' | 'outreach_due'>) => r.status === 'ready' && r.check_status === 'passed' && !(needsOutreach(r) && r.outreach_due)

/** What Select all takes: nothing under the ATS rule or with an eligibility question goes in unread. */
export const safeToBulk = (r: Pick<ReviewRow, 'status' | 'check_status' | 'referral_mode' | 'outreach' | 'outreach_due' | 'ats_after' | 'eligibility' | 'sponsorship'>) => canApprove(r) && !needsOutreach(r) && atsOk(r.ats_after) && !r.eligibility && !visaLine(r.sponsorship)

/** How a bulk approve went, for the toast. */
export function bulkLine(done: ApproveResult[], failed: number) {
  const emails = done.reduce((n, r) => n + r.emails, 0)
  const roles = done.length === 1 ? '1 role' : `${done.length} roles`
  const mail = emails === 1 ? '1 email' : `${emails} emails`
  const repeated = done.reduce((n, r) => n + (r.repeated ?? 0), 0)
  return `Approved ${roles}.${emails ? ` ${mail} on the way to Outbox and Gmail Drafts over the next few minutes, each waiting for your OK.` : ''}${againLine(repeated)}${failed ? ` ${failed} couldn’t be approved.` : ''}`
}

/** The year menu, as on the Jobs page: the posting names 2027, or names 2027 or no year at all. */
export const YEAR_OPTIONS = [
  { value: '2027', label: 'Says 2027' },
  { value: '2027-or-unstated', label: '2027 or not stated' },
] as const

/** '' keeps every role. */
export function yearMatch(years: string[] | null | undefined, filter: string) {
  const m = /^(\d{4})(-or-unstated)?$/.exec(filter)
  if (!m) return true
  const [, y = '', orUnstated] = m
  const named = years ?? []
  return named.includes(y) || (Boolean(orUnstated) && named.length === 0)
}

/** "2027", or "2026–27" when a posting takes either year. */
export function yearsLabel(years: string[]) {
  const first = years[0] ?? ''
  const last = years[years.length - 1] ?? ''
  return first === last ? first : `${first}–${last.slice(2)}`
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

/** skills_to_learn as written: plain names, or { skill, why }. */
function skillList(x: unknown) {
  if (!Array.isArray(x)) return []
  return x.map((k) => {
    if (typeof k === 'string') return k.trim()
    const o = (k && typeof k === 'object' ? k : {}) as Record<string, unknown>
    const name = text(o.skill) ?? text(o.name)
    const why = text(o.why) ?? text(o.reason) ?? text(o.note)
    return name ? (why ? `${name}: ${why}` : name) : ''
  }).filter(Boolean)
}

const DAY = 86_400_000

/** Midnight of `now`'s day (the browser's), as a UTC timestamp of that date: compares with 'YYYY-MM-DD' dates. */
function today(now: number) {
  const d = new Date(now)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

/** The Opened menu: when the posting went up (the day the app first saw it, when the posting doesn't say). */
export const OPENED_OPTIONS = [
  { value: '1', label: 'Opened in the last day' },
  { value: '3', label: 'Opened in the last 3 days' },
  { value: '7', label: 'Opened in the last 7 days' },
  { value: '14', label: 'Opened in the last 14 days' },
  { value: '30', label: 'Opened in the last 30 days' },
  { value: 'older', label: 'Opened over 30 days ago' },
] as const

/** '' keeps every role. */
export function openedMatch(posted: string | null | undefined, filter: string, now = Date.now()) {
  if (!filter) return true
  const t = posted ? new Date(posted).getTime() : NaN
  if (Number.isNaN(t)) return false
  const days = (now - t) / DAY
  return filter === 'older' ? days > 30 : days <= Number(filter)
}

/** The Closes menu: only postings that state a closing date have one. */
export const CLOSES_OPTIONS = [
  { value: '3', label: 'Closes within 3 days' },
  { value: '7', label: 'Closes within 7 days' },
  { value: '14', label: 'Closes within 14 days' },
  { value: '30', label: 'Closes within 30 days' },
  { value: 'stated', label: 'States a closing date' },
  { value: 'none', label: 'No closing date stated' },
] as const

/** '' keeps every role. "Within N days" counts from today (today included); a date already past only counts as stated. */
export function closesMatch(deadline: string | null | undefined, filter: string, now = Date.now()) {
  if (!filter) return true
  const t = deadline ? Date.parse(`${deadline.slice(0, 10)}T00:00:00Z`) : NaN
  if (filter === 'none') return Number.isNaN(t)
  if (Number.isNaN(t)) return false
  if (filter === 'stated') return true
  const days = (t - today(now)) / DAY
  return days >= 0 && days <= Number(filter)
}

/**
 * How old the posting is: "Opened today", "Opened yesterday", "Opened 10 days
 * ago (Nov 3)" (the year when it isn't this one). When the board gave no
 * posting date (`known` false) it's the day the app first saw it: "First seen …".
 */
export function openedLabel(posted: string | null | undefined, now = Date.now(), known = true) {
  const d = posted ? new Date(posted) : null
  if (!d || Number.isNaN(d.getTime())) return null
  const word = known ? 'Opened' : 'First seen'
  const days = Math.max(0, Math.round((today(now) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / DAY))
  if (days === 0) return `${word} today`
  if (days === 1) return `${word} yesterday`
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return `${word} ${days} days ago (${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })})`
}

/** The Sort by menu; '' keeps the queue's own order (turn, then most recently updated). */
export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest opened first' },
  { value: 'oldest', label: 'Oldest opened first' },
  { value: 'closing', label: 'Closing soonest' },
  { value: 'ats', label: 'Highest ATS' },
  { value: 'company', label: 'Company A–Z' },
] as const

type Sortable = Pick<ReviewRow, 'posted_at' | 'deadline' | 'ats_after' | 'company_name' | 'title'>
const at = (d: string | null | undefined) => { const t = d ? new Date(d).getTime() : NaN; return Number.isNaN(t) ? null : t }
/** null sorts last whichever way the rest go. */
const by = (a: number | null, b: number | null, dir: 1 | -1) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : (a - b) * dir)

/** A sorted copy; ties keep the order they came in. */
export function sortRows<T extends Sortable>(rows: T[], sort: string): T[] {
  const cmp: Record<string, (a: T, b: T) => number> = {
    newest: (a, b) => by(at(a.posted_at), at(b.posted_at), -1),
    oldest: (a, b) => by(at(a.posted_at), at(b.posted_at), 1),
    closing: (a, b) => by(at(a.deadline), at(b.deadline), 1),
    ats: (a, b) => by(a.ats_after, b.ats_after, -1),
    company: (a, b) => a.company_name.localeCompare(b.company_name, 'en', { sensitivity: 'base' }) || a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }),
  }
  const f = cmp[sort]
  return f ? [...rows].sort(f) : rows
}

/** "Closes Fri, Nov 14" for a stated deadline ('YYYY-MM-DD'). */
export function deadlineLabel(d: string | null | undefined) {
  if (!d) return null
  const date = new Date(`${d.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : `Closes ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`
}

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
    skillsToLearn: skillList(r.skills_to_learn),
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
