// Typed façade over the legacy JS client in src/api.js.
//
// The legacy client owns HTTP + auth (JWT attach, error normalisation, blob
// downloads) and is still imported by old pages and by tests/api-client.test.mjs,
// so new code wraps it rather than duplicating it. Each wrapper pins the
// response shape the backend actually returns (verified against the live API).
import { api as legacy, rawApiFetch } from '../api.js'

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface Stats {
  totalCompanies: number
  totalContacts: number
  contactsWithEmail: number
  totalLinkedInContacts: number
  totalSent: number
  responseRate: number
  activeSources: number
  ycImported: number
  totalApplications: number
  lastScrape: string | null
}

export interface JobMetrics {
  summary: {
    totalCompanies: number
    totalEvaluations: number
    totalContacts: number
    contactsWithEmail: number
    contactsWithLinkedIn: number
    outreachGenerated: number
    outreachSent: number
    outreachReplied: number
    responseRate: number
    applyRate: number
  }
  applyFunnel: Record<'evaluated' | 'applied' | 'submitted' | 'responded' | 'interview' | 'offer' | 'rejected', number>
  applyModes: { manual: number; auto: number }
  gradeDist: Record<'A' | 'B' | 'C' | 'D' | 'F', number>
}

export interface CatalogRole {
  title: string
  company_name: string
  apply_url: string
}

export interface DailyUpdates {
  intern: { today: number; recent: CatalogRole[] }
  newGrad: { today: number; recent: CatalogRole[] }
  careerOps: { evaluatedToday: number; queued: number; totalEvaluations: number }
}

export type QueueStatus = 'queued' | 'needs_review' | 'submitted' | 'failed' | 'unsupported'

export interface AutoApplyQueue {
  items: unknown[]
  counts: Record<QueueStatus, number>
}

export interface ActivityItem {
  id: number
  action: string
  /** Stored as TEXT but some writers put JSON in it; may also arrive parsed. */
  details: string | Record<string, unknown> | null
  created_at: string
}

export interface Health {
  status: string
  ai_provider: string
  has_gemini: boolean
  has_openai: boolean
  has_apify: boolean
  has_apollo: boolean
  has_serper: boolean
  has_hunter: boolean
  has_prospeo: boolean
  has_linkedin: boolean
  auth_mode: string
  nightly_cron_disabled: boolean
}

interface CreditFlags {
  configured: boolean
  warning?: boolean
  critical?: boolean
  error?: string
}

export interface Credits {
  hunter?: CreditFlags & { used: number; available: number; total: number; resetDate?: string }
  apify?: CreditFlags & { usedUsd: number; limitUsd: number; balanceUsd: number }
  apollo?: CreditFlags & { working?: boolean }
  prospeo?: CreditFlags & { working?: boolean }
  gemini?: CreditFlags & { rateLimited?: boolean; rateLimitedAt?: string | null }
  checkedAt?: string
  hasWarnings?: boolean
}

/** Saved application profile. Only the fields the new UI reads are typed. */
export interface CareerProfile {
  first_name?: string
  last_name?: string
  email?: string
  auto_apply_consent?: boolean
  /** 'usa' | 'india' | 'other' — null until the user picks. */
  job_market?: string | null
  [key: string]: unknown
}

export interface SavedAnswer {
  id: number
  question: string
  answer: string | null
  status: 'answered' | 'pending'
  /** "Figma · Software Engineer Intern" — the form that asked a pending question. */
  asked_by: string | null
  evaluation_id: number | null
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export interface GithubStatus {
  configured: boolean
  connected: boolean
  login?: string
  avatar_url?: string | null
  connected_at?: string
  last_synced_at?: string | null
  sync_status?: 'idle' | 'syncing' | 'error'
  sync_error?: string | null
}

export interface GithubRepo {
  repo_id: number
  full_name: string
  name: string
  description: string | null
  html_url: string
  homepage: string | null
  language: string | null
  /** Bytes per language, as GitHub reports them. */
  languages: Record<string, number>
  topics: string[]
  stars: number
  fork: boolean
  archived: boolean
  pushed_at: string | null
  include: boolean
  has_readme: boolean
  readme_preview: string | null
}

export interface AiUsage {
  since: string
  caps: { site: number; user: number }
  spent: { site: number; mine: number }
  byTask: { task: string; calls: number; cost: number }[]
}

export interface OutreachContact {
  id: number
  name: string | null
  title: string | null
  email: string | null
  /** verified | valid | catch_all | risky | invalid | … */
  email_status: string | null
  linkedin_url: string | null
  /** pending | generated | sent | dm_sent | replied | closed */
  status: string | null
  job_id: number | null
  company_name: string | null
  category: string | null
}

export interface TemplateVariant { id: string; kind: 'email' | 'linkedin'; name: string; body: string }
export interface OutreachTemplates { email: string; linkedin: string; variants: TemplateVariant[] }

export interface CompanyDetail {
  id: number
  name: string
  status: CompanyStatus | null
  description: string | null
  wikipedia_summary: string | null
  website: string | null
  url: string | null
  domain: string | null
  category: string | null
  subcategory: string | null
  location: string | null
  team_size: string | number | null
  tags: string | null
  yc_batch: string | null
  slug: string | null
}

export interface CompanyContact extends OutreachContact {
  generated_subject: string | null
  generated_body: string | null
  generated_dm: string | null
}

export interface CompanyRole {
  id: number
  title: string
  location: string | null
  source: string | null
  apply_url: string
  posted_at: string | null
  role_type: 'intern' | 'fulltime' | string
  created_at: string
}

export type PeopleEvent =
  | { type: 'source'; source: string; status: 'running' | 'done' | 'skip' | 'error'; count?: number; message?: string }
  | { type: 'complete'; added: number; updated: number; total: number; message?: string }
  | { type: 'error'; message: string }

export interface NightlySettings {
  enabled: boolean
  roleType: string
  minScore: number
  maxApps: number
  useLibraryResume: boolean
}

export interface CompanySearchHit {
  id: number
  name: string
  category?: string | null
  location?: string | null
}

export type ProviderUsage = Record<'hunter' | 'prospeo' | 'apollo' | 'serper', { used: number; limit: number }>

export type RoleType = 'intern' | 'new_grad'
export type Region = 'usa' | 'india' | 'intl'
export type Field = 'swe' | 'ai'
export type Tier = 'faang' | 'quant'

export interface CatalogListing {
  id: number
  role_type: RoleType
  region: Region
  tracks: Field[]
  title: string
  company_name: string
  company_url: string | null
  location: string | null
  apply_url: string
  source: string
  tier: 'faang' | 'quant' | 'other' | null
  salary_range: string | null
  posted_at: string | null
  scraped_at: string
  tracked: boolean
  autoQueued: boolean
  /** What the job description says about visa sponsorship; null = doesn't say or not read yet. */
  sponsorship: Sponsorship | null
  sponsorship_quote: string | null
  /** The description has been read (so a null sponsorship means "doesn't say"). */
  jd_read: boolean
  /** Other sources listing the same job (same company + title). */
  also_on: string[]
}

export type Sponsorship = 'sponsors' | 'no_sponsorship' | 'citizens_only'
export type VisaFilter = 'sponsors' | 'open' | 'citizens'

export interface CatalogPage {
  role_type: RoleType
  page: number
  pageSize: number
  total: number
  rows: CatalogListing[]
}

export interface CatalogSourceCount { source: string; role_type: RoleType; region: Region; n: number; swe: number; ai: number }

export interface CatalogQuery { roleType: RoleType; region: Region; field?: Field; source?: string; search?: string; tier?: Tier; hasPay?: boolean; visa?: VisaFilter; page?: number; pageSize?: number }

export interface AlertSubscription {
  subscribed: boolean
  email: string
  frequency: 'daily' | 'weekly'
  roleType: 'all' | 'intern' | 'new_grad'
  keywords: string
}

export type CompanyStatus = 'new' | 'researching' | 'contacted' | 'responded' | 'skip'

export interface CompanyRow {
  id: number
  name: string
  category: string | null
  subcategory: string | null
  status: CompanyStatus | null
  location: string | null
  careers_url: string | null
  domain: string | null
  is_hiring: number
  intern_roles_count: number | null
  intern_roles_checked_at: string | null
  linkedin_count: number
  email_count: number
  total_contacts: number
  source: string
}

export type CompanySort = 'recent' | 'contacts' | 'az' | 'za' | 'hiring'

export interface CompanyQuery { category?: string; search?: string; status?: string; sort?: CompanySort; page?: number; pageSize?: number }

export interface CompanyPage { companies: CompanyRow[]; total: number; page: number; pageSize: number; hasMore: boolean }

export interface ScrapeResult {
  added: number
  found: number
  alreadyInDb: number
  errors?: Record<string, string> | string[]
  newCompanies?: string[]
}

export interface SensitiveProfilePreview {
  profileFields?: string[]
  metaKeys?: string[]
  erased?: { profileFields?: string[]; metaKeys?: string[] }
}


// ── Applications (evaluations) ───────────────────────────────────────────────

/** One PDF kept in cloud storage (resume_files). */
export interface ResumeFile {
  id: number
  kind: 'master' | 'tailored' | 'uploaded' | 'library'
  filename: string
  size_bytes: number | null
  /** The account's country setting when the file was made. */
  market: 'usa' | 'india' | 'other' | null
  evaluation_id: number | null
  is_current: boolean
  created_at: string
  /** Master versions only: an application was tailored from or sent with it, so it can't be deleted. */
  in_use?: boolean
}
export interface ResumeFileUse extends Omit<ResumeFile, 'is_current' | 'evaluation_id'> {
  evaluation_id: number
  company_name: string
  job_title: string
  job_url: string | null
  apply_status: ApplyStatus | null
  applied_at: string | null
  /** True once this exact file went out with the application. */
  sent: boolean
  location: string | null
  region: 'usa' | 'india' | 'intl' | null
}
export interface ResumeHistory { masters: ResumeFile[]; applications: ResumeFileUse[] }

// ── WhatsApp ─────────────────────────────────────────────────────────────────

export type WhatsAppKind = 'list' | 'replies' | 'needs' | 'summary' | 'projects' | 'skills'
export interface WhatsAppStatus {
  configured: boolean
  businessNumber: string | null
  linked: boolean
  phone: string | null
  enabled: boolean
  prefs: Record<WhatsAppKind, boolean>
  verifiedAt: string | null
  pending: { code: string; expires: string } | null
}
export interface WhatsAppTemplate { name: string; header: string; body: string; footer: string; button: string; example: string[] }

// ── People → Messages ───────────────────────────────────────────────────────

export interface MessageCompany { key: string; name: string; connections: number; contacts: number; emails: number; contacted: number; drafted: number; openRoles: number }
export interface MessageCompanyPage { total: number; page: number; pageSize: number; companies: MessageCompany[] }
export interface MessagePerson {
  /** "c:<contact id>" or "l:<connection id>" */
  ref: string
  contactId: number | null
  connectionId: number | null
  isConnection: boolean
  name: string
  title: string | null
  linkedinUrl: string | null
  email: string | null
  emailStatus: string | null
  status: string
  note: string | null
  subject: string | null
  body: string | null
}
export interface MessageCompanyDetail { key: string; name: string; role: { title: string; url: string } | null; people: MessagePerson[] }
export type MessageFilter = 'all' | 'roles' | 'connections' | 'emails'

// ── Daily plan (the evening list) ────────────────────────────────────────────

export interface DailyPlanSettings {
  enabled: boolean
  /** Local hour, 17–23 */
  listHour: number
  timezone: string
  minScore: number
  maxPerDay: number
  /** Fill up to this many with close matches (8+) when fewer clear the bar */
  minPerDay: number
  referralFirst: boolean
  referralWaitDays: number
}
export type PlanStage = 'proposed' | 'tailoring' | 'asking_referral' | 'waiting_referral' | 'ready_to_apply' | 'applying' | 'applied' | 'referred' | 'needs_you' | 'done'
/** What happens once a role is approved: the app applies, or it waits for you to read the resume. */
export type ApplyMode = 'auto' | 'review'

export interface PlanItem {
  id: number
  apply_mode?: ApplyMode
  evaluation_id: number | null
  company_name: string
  title: string
  apply_url: string
  location: string | null
  pay: string | null
  sponsorship: string | null
  tier: 'top' | 'worth'
  score: string | number | null
  reason: string | null
  decision: 'pending' | 'approved' | 'skipped' | 'expired'
  stage: PlanStage
  stage_note: string | null
  /** LinkedIn connections the user has at this company */
  connections: number
  /** People found there, with an email or a LinkedIn profile (People → Contacts) */
  people?: number
  people_email?: number
  /** The company page holding them */
  company_id?: number | null
}
export interface ReferralAsk {
  id: number
  plan_item_id: number
  channel: 'email' | 'linkedin' | 'search'
  person_name: string | null
  person_title: string | null
  linkedin_url: string | null
  email: string | null
  subject: string | null
  message: string
  status: 'draft' | 'scheduled' | 'sent' | 'to_send' | 'marked_sent' | 'replied'
  email_status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled' | null
  send_after: string | null
  sent_at: string | null
  recipient_tz: string | null
  contact_status: string | null
}
export type ReferralAction = 'link' | 'submitted' | 'declined' | 'apply_now' | 'applied_myself'
export interface ReferralStats {
  roles: { asked: number; got: number; submitted: number; link: number; declined: number; waiting: number; without: number }
  asks: { total: number; emails_sent: number; emails_scheduled: number; notes_sent: number; to_send: number; replied: number }
  connections: { total: number; companies: number }
}
export interface ConnectionsSummary { total: number; imported: string | null; topCompanies: { company: string; n: number }[] }
export interface ActivePlanItem {
  id: number
  evaluation_id: number | null
  company_name: string
  title: string
  apply_url: string
  location: string | null
  score: string | number | null
  stage: PlanStage
  stage_note: string | null
  referral_status: 'none' | 'asked' | 'link' | 'submitted' | 'declined'
  wait_until: string | null
  apply_after: string | null
  applied_at: string | null
  decided_at: string | null
  ats_score: number | null
  referral_link: string | null
  company_tz: string | null
  connections: number
  people?: number
  people_email?: number
  company_id?: number | null
  asks: ReferralAsk[]
}
export interface DailyPlan {
  id: number
  plan_date: string
  status: 'building' | 'ready' | 'failed'
  stats: { considered?: number; scored?: number; top?: number; worth?: number; low?: number; excluded?: number; costUsd?: number }
  error: string | null
  built_at: string | null
  emailed_at: string | null
}
/** A top role from an earlier list that was never answered (still approvable for 14 days). */
export interface MissedPlanItem extends PlanItem { plan_date: string; ats_score: number | null }
export interface DailyPlanOverview { settings: DailyPlanSettings; plan: DailyPlan | null; items: PlanItem[]; missed?: MissedPlanItem[]; active: ActivePlanItem[]; gmailConnected: boolean }

// ── Gmail (each user's own account) ──────────────────────────────────────────

export interface GmailStatus {
  connected: boolean
  email?: string
  display_name?: string | null
  status?: 'ok' | 'error'
  last_error?: string | null
  connected_at?: string
  last_checked_at?: string | null
  daily_cap?: number
}
export interface OutboxItem {
  id: number
  contact_id: number | null
  /** 0 = first email, 1–2 = follow-ups */
  step: 0 | 1 | 2
  thread_root_id: number | null
  to_email: string
  to_name: string | null
  subject: string
  body: string
  recipient_tz: string
  /** For a draft, a placeholder until it's approved. */
  send_after: string
  /** draft = written by the app, waiting for the user's OK */
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled'
  cancel_reason: string | null
  error: string | null
  sent_at: string | null
  created_at: string
  company_name: string | null
  company_id: number | null
  contact_status: string | null
  contact_title?: string | null
  email_guessed?: boolean | null
  purpose?: 'outreach' | 'referral'
  approved_at?: string | null
  /** A copy sits in the user's Gmail Drafts. */
  in_gmail_drafts?: boolean
  attachment_file_id?: number | null
  attachment_name?: string | null
}
export interface ReplyItem {
  id: number
  contact_id: number | null
  channel: 'email' | 'linkedin'
  kind: 'reply' | 'auto_reply' | 'bounce' | 'linkedin_message' | 'linkedin_accept'
  from_email: string | null
  from_name: string | null
  subject: string | null
  snippet: string | null
  received_at: string
  contact_name: string | null
  company_name: string | null
  company_id: number | null
}

// ── Resume engine (tailored resume + cover letter per role) ─────────────────

export interface AtsKeyword { term: string; aliases: string[]; importance: 'required' | 'preferred'; kind: 'hard' | 'soft'; tool?: boolean }
export interface TailoringAts {
  score: number
  target: number
  /** Weighted keyword coverage, 0–100. */
  coverage: number
  keywords: AtsKeyword[]
  matched: string[]
  /** In the candidate's background but not on the page (normally empty). */
  missingYouHave: string[]
  /** Not anywhere in the candidate's resume or GitHub; never added. */
  missingYouDont: { term: string; importance: 'required' | 'preferred' }[]
  checks: { id: string; label: string; ok: boolean }[]
  pages: number | null
  /** The untailored master, scored the same way. */
  before?: number
  /** The keywords table: each keyword and the sections it appears in ([] = missing). */
  places?: { term: string; importance: 'required' | 'preferred'; where: string[] }[]
}
export type ResumeVerdict = 'apply' | 'apply_with_referral' | 'skip'
export interface ProposedProject {
  id: number
  name: string
  tech: string[]
  bullets: string[]
  /** Job keywords it adds. */
  covers: string[]
  why: string
  plan: string[]
  status: 'suggested' | 'built' | 'dismissed'
  /** The ATS score with the project on the page, and without it. */
  projectedAts: number | null
  withoutAts?: number | null
  /** On the resume (it isn't sent until built). */
  onPage?: boolean
  addedAt?: string
}
/** A project to build: suggested for one role's resume, or weekly from the roles on your lists. */
export interface PlannedProject {
  id: number
  name: string
  tech: string[]
  bullets: string[]
  covers: string[]
  why: string | null
  plan: string[]
  status: 'suggested' | 'built' | 'dismissed'
  origin: 'role' | 'weekly'
  /** Weekly ones: how many listed roles ask for what it adds. */
  demand: { roles: number; of: number; keywords: { term: string; roles: number }[]; examples: string[] } | null
  repo_url: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
}
export interface ProjectsState { projects: PlannedProject[]; suggesting: boolean; lastRunAt: string | null; note: string | null }

export interface TailoringReport {
  notes?: string
  changes?: { section: string; before: string; after: string; why: string }[]
  projects?: { name: string; source: 'resume' | 'github' | 'planned'; why: string }[]
  removed?: { where: string; what: string; why: string }[]
  addedSkills?: string[]
  shortenedSteps?: number
  /** JD analysis */
  title?: string
  focus?: string[]
  roleKind?: { quant: boolean; finance: boolean }
  /** Recruiter check (a different model from the writer) */
  callback?: { before: number; after: number; target: number; why: string } | null
  atsWhy?: string
  topChanges?: string[]
  nextChange?: string
  blockers?: string[]
  verdict?: ResumeVerdict | null
  verdictWhy?: string
  gaps?: { term: string; why: string }[]
  ruleIssues?: { where: string; bullet: string; code: string; why: string }[]
  fixed?: { what: string; now: string; why: string }[]
  proposedProject?: ProposedProject | null
  revised?: boolean
  /** The tailored resume's LaTeX source. */
  tex?: string
  /** Cover letters */
  paragraphs?: string[]
  greeting?: string
}
export interface Tailoring {
  id: number
  kind: 'resume' | 'cover_letter'
  status: 'running' | 'ready' | 'needs_review' | 'failed'
  ats_score: number | null
  ats: TailoringAts | null
  report: TailoringReport | null
  error: string | null
  cost_usd: string | number
  approved_at: string | null
  created_at: string
  finished_at: string | null
  file_id: number | null
  filename: string | null
  /** Set while a nightly resume waits in Anthropic's batch (half price). */
  batch?: { phase: 'queued' | 'drafting' | 'revise_queued' | 'revising'; submittedAt?: string } | null
}
/** One row of Dashboard → Tracker (the sheet view of every application). */
export type TrackerStatus = 'not_started' | 'submitted' | 'responded' | 'interview' | 'offer' | 'rejected'
export type TrackerReferral = 'yes' | 'no' | 'not_required' | 'asked'
export interface TrackerRow {
  id: number
  company_name: string
  job_title: string
  job_url: string | null
  apply_status: TrackerStatus
  submitted: boolean
  referral: TrackerReferral | null
  /** True when the app applied (or will apply) for you. */
  by_app: boolean
  applied_at: string | null
  updated_at: string
  /** The tailored resume's ATS match and the recruiter check's interview chance (%). */
  ats: number | null
  callback: number | null
}
export interface TrackerImport { total: number; added: number; updated: number; unchanged: number; skipped: string[] }

export interface TailoringState { resume: Tailoring | null; cover_letter: Tailoring | null; coverLetterRequested: boolean }
/** One row of Resumes → By job. */
export interface SkillGaps {
  skills: { skill: string; resumes: number; underBar: number; required: number }[]
  unsent: number
  underBar: number
  updating: { running: boolean; total: number; done: number; skills: string[] } | null
}

export interface ResumeJob {
  id: number
  company_name: string
  job_title: string
  job_url: string | null
  /** Fit score out of 10. */
  eval_score: number | null
  /** The evening list it came from (YYYY-MM-DD), if any. */
  list_date: string | null
  decision: 'pending' | 'approved' | 'skipped' | 'expired' | null
  stage: string | null
  apply_status: string | null
  /** Its evening-list item, for Approve / Send it. */
  plan_item_id?: number | null
  apply_mode?: ApplyMode | null
  stage_note?: string | null
  needs_reason?: string | null
  apply_after?: string | null
  wait_until?: string | null
  applied_at?: string | null
  /** From the role listing it came from, when there is one. */
  role_type?: 'intern' | 'new_grad' | null
  tracks?: string[]
  company_tier?: 'faang' | 'quant' | null
  sponsorship?: Sponsorship | null
  location?: string | null
  /** The company's industry, from Companies. */
  industry?: string | null
  /** Graduation or start years the posting names ("class of 2027", "Summer 2027"). */
  grad_years?: string[]
  resume: {
    tailoring_id: number
    status: 'running' | 'ready' | 'needs_review' | 'failed'
    batch_phase: string | null
    ats: number | null
    ats_before: number | null
    callback: number | null
    verdict: ResumeVerdict | null
    file_id: number | null
    finished_at: string | null
    project: string | null
    project_status: string | null
  } | null
  /** Which resume goes out with the application. */
  sending: { kind: 'yours' | 'tailored'; file_id: number; filename: string } | null
}

/** The LaTeX preamble resumes are built in. */
export interface ResumeTemplate { custom: boolean; preamble: string; updatedAt: string | null }

export interface ResumeStatus { hasResume: boolean; name?: string | null; date?: string | null; textPreview?: string | null; file?: ResumeFile | null; inCloud?: boolean }

/** Raw apply_status values the backend writes. */
export type ApplyStatus = 'not_started' | 'opened' | 'queued' | 'in_progress' | 'submitted' | 'responded' | 'interview' | 'offer' | 'rejected'
  | 'needs_review' | 'captcha_needed' | 'login_needed' | 'submit_failed' | 'platform_unsupported'

export interface EvaluationSummary {
  id: number
  job_title: string
  company_name: string
  job_url?: string | null
  grade: string | null
  /** 0–100 */
  score: number | null
  apply_mode: 'manual' | 'auto' | null
  apply_status: ApplyStatus | null
  applied_at?: string | null
  created_at: string
  apply_error?: string | null
  apply_platform?: string | null
  /** Pipeline only: the resume sent (or to be sent) with this application. */
  resume_file_id?: number | null
  resume_filename?: string | null
  resume_kind?: ResumeFile['kind'] | null
  resume_sent?: boolean
  /** Pipeline only. */
  notes?: string | null
  next_step?: string | null
  /** YYYY-MM-DD */
  next_step_at?: string | null
  stage_changed_at?: string | null
  /** The tracked company with this name, for its people page. */
  company_id?: number | string | null
}

export interface PipelineNotes { notes?: string | null; next_step?: string | null; next_step_at?: string | null }

/** The parts of the evaluation report the new pages show (the JSON has more). */
export interface EvaluationReport {
  jobTitle?: string
  companyName?: string
  globalScore?: number
  grade?: string
  recommendation?: string
  verdict?: { headline?: string; oneLineWhy?: string; buriedMatch?: string | null; interviewOdds?: { asIs?: string; properlyTailored?: string; reasoning?: string } }
  topGaps?: { gap: string; fix?: string; severity?: string }[]
  scoreBreakdown?: Partial<Record<'cvMatch' | 'northStar' | 'comp' | 'culture' | 'redFlags', number>>
  blockA_roleSummary?: { tldr?: string; seniority?: string; remote?: string }
  blockB_cvMatch?: { requirements?: { requirement: string; cvEvidence?: string; status?: 'match' | 'partial' | 'gap'; reasoning?: string }[] }
  blockD_compAndDemand?: { salaryRange?: string }
  blockE_personalization?: { cvChanges?: { section?: string; currentState?: string; proposedChange?: string; why?: string }[] }
  blockG_legitimacy?: { assessment?: string; contextNotes?: string }
  atsKeywords?: string[]
}

/** A stored PDF for one application. */
export interface EvaluationFile {
  id: number | string
  kind: ResumeFile['kind'] | 'cover_letter'
  filename: string
  size_bytes: number | null
  created_at: string
  /** Went out with the application. */
  sent: boolean
  /** The one the application uses (sent, or ready to send). */
  primary_file: boolean
}
/** The catalog listing an evaluated role came from, when there is one. */
export interface EvaluationRole {
  location: string | null
  region: string | null
  salary_range: string | null
  posted_at: string | null
  source: string | null
  description: string | null
  role_type: string | null
}
export interface EvaluationDetail extends EvaluationSummary {
  evaluation: EvaluationReport | null
  job_description?: string | null
  role?: EvaluationRole | null
  files?: EvaluationFile[]
}

export type PipelineColumn = 'evaluated' | 'applied' | 'responded' | 'interview' | 'offer' | 'rejected'
export interface Pipeline { columns: Record<PipelineColumn, { label: string; hint: string; items: EvaluationSummary[] }>; totals: Record<PipelineColumn, number>; total: number }

export interface AutoApplyItems { items: EvaluationSummary[]; counts: Record<QueueStatus, number> }

/** The master resume as the resume engine read it (backend MASTER_SCHEMA); dates as written on the resume. */
export interface ParsedResume {
  name?: string
  contact?: { email?: string; phone?: string; location?: string; links?: { label: string; url: string }[] }
  education?: { school: string; degree: string; field: string; location: string; start: string; end: string; gpa: string }[]
  experience?: { company: string; title: string; location: string; start: string; end: string; bullets: string[] }[]
  skills?: { category: string; items: string[] }[]
  extras?: { heading: string; items: string[] }[]
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export const api = {
  health: (): Promise<Health> => legacy.health(),
  stats: (): Promise<Stats> => legacy.stats(),
  jobMetrics: (): Promise<JobMetrics> => legacy.jobMetrics(),
  dailyUpdates: (): Promise<DailyUpdates> => legacy.dailyUpdates(),
  activity: async (): Promise<ActivityItem[]> => (await legacy.activity()).activity ?? [],
  credits: (refresh = false): Promise<Credits> => legacy.credits.status(refresh),
  /** This user's monthly share of the shared provider keys. */
  providerUsage: async (): Promise<ProviderUsage> => (await legacy.credits.usage()).usage,
  aiUsage: (): Promise<AiUsage> => legacy.credits.aiUsage(),
  contacts: async (email: 'all' | 'with' | 'without'): Promise<{ contacts: OutreachContact[]; total: number }> => {
    const params = new URLSearchParams({ limit: '1000' })
    if (email === 'with') params.set('hasEmail', 'true')
    if (email === 'without') params.set('noEmail', 'true')
    return legacy.unified.allContacts(params)
  },
  templates: async (): Promise<{ templates: OutreachTemplates; defaults: { email: string; linkedin: string } }> => {
    const d = await legacy.generate.templates()
    const t = d.templates ?? {}
    return {
      templates: { email: t.email ?? '', linkedin: t.linkedin ?? '', variants: Array.isArray(t.variants) ? t.variants : [] },
      defaults: { email: d.defaults?.email ?? '', linkedin: d.defaults?.linkedin ?? '' },
    }
  },
  saveTemplates: (t: OutreachTemplates): Promise<unknown> => legacy.generate.saveTemplates(t),
  company: (id: number): Promise<{ company: CompanyDetail; contacts: CompanyContact[]; roles: CompanyRole[] }> => legacy.jobs.detail(id),
  companyContacts: (id: number): Promise<CompanyContact[]> => legacy.jobs.contacts(id),
  companyRoles: (id: number): Promise<CompanyRole[]> => legacy.jobs.roles(id),
  careersUrl: (id: number): Promise<{ url: string | null; source?: string }> => legacy.jobs.careersUrl(id),
  setCareersUrl: (id: number, url: string): Promise<{ success: boolean; url: string }> => legacy.jobs.updateUrl(id, url),
  scrapeCompanyRoles: (id: number, roleType: 'intern' | 'fulltime'): Promise<{ roles: CompanyRole[]; added: number; found: number; careersPageUrl?: string }> =>
    legacy.jobs.scrapeRoles(id, roleType),
  findEmails: (id: number): Promise<{ added?: number; updated?: number; message?: string; hintText?: string; domain?: string }> => legacy.jobs.findEmails(id),
  findEmailFor: (contactId: number): Promise<{ email: string | null; email_status?: string | null; message?: string }> => legacy.jobs.findEmailForContact(contactId),
  writeTo: (contactId: number, type: 'cold_email' | 'linkedin', extraContext: string): Promise<{ subject?: string; body?: string; message?: string; dm?: string }> =>
    legacy.jobs.generate(contactId, type, extraContext),
  writeWaas: (body: { companyName: string; companyDescription?: string; contactName?: string; extraContext?: string; ycBatch?: string }): Promise<{ message: string }> =>
    legacy.generate.waas(body),
  updateContact: (contactId: number, patch: Record<string, string>): Promise<CompanyContact> => legacy.jobs.updateContact(contactId, patch),
  deleteContact: (contactId: number): Promise<unknown> => legacy.jobs.deleteContact(contactId),
  /** Find people at a company, reporting progress as the server streams it. */
  findPeople: async (id: number, onEvent: (e: PeopleEvent) => void): Promise<void> => {
    const res: Response = await rawApiFetch(`/jobs/${id}/find-people-stream`, { headers: { Accept: 'text/event-stream' } })
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error || `Couldn’t start the search (HTTP ${res.status})`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut: number
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const event = /^event: (.+)$/m.exec(chunk)?.[1]?.trim()
        const data = /^data: (.+)$/m.exec(chunk)?.[1]
        if (!event || !data) continue
        try {
          const d = JSON.parse(data) as Record<string, unknown>
          if (event === 'source' || event === 'complete' || event === 'error') onEvent({ type: event, ...d } as PeopleEvent)
        } catch { /* ignore a malformed line */ }
      }
    }
  },
  autoApplyQueue: (): Promise<AutoApplyQueue> => legacy.career.autoApplyQueue(),
  autoApplyItems: (): Promise<AutoApplyItems> => legacy.career.autoApplyQueue(),
  resumeStatus: (): Promise<ResumeStatus> => legacy.career.resume(),
  resumeHistory: (): Promise<ResumeHistory> => legacy.career.resumeFiles(),
  tailoring: (evalId: number): Promise<TailoringState> => legacy.career.tailoring(evalId),
  /** The master resume read into sections (reads it once if it never was). */
  parsedResume: async (): Promise<ParsedResume> => (await legacy.career.readMasterResume()).parsed ?? {},
  whatsappStatus: (): Promise<WhatsAppStatus> => legacy.whatsapp.status(),
  whatsappJoin: (): Promise<{ code: string; number: string; link: string | null }> => legacy.whatsapp.join(),
  whatsappPrefs: (body: { prefs?: Partial<Record<WhatsAppKind, boolean>>; enabled?: boolean }): Promise<WhatsAppStatus> => legacy.whatsapp.prefs(body),
  whatsappUnlink: (): Promise<{ ok: boolean }> => legacy.whatsapp.unlink(),
  whatsappTest: (): Promise<{ ok: boolean }> => legacy.whatsapp.test(),
  whatsappTemplates: async (): Promise<Record<string, WhatsAppTemplate>> => (await legacy.whatsapp.templates()).templates,
  messageCompanies: (q: { q?: string; filter?: MessageFilter; page?: number }): Promise<MessageCompanyPage> => legacy.messages.companies(q),
  messageCompany: (key: string): Promise<MessageCompanyDetail> => legacy.messages.company(key),
  writeMessage: (key: string, ref: string): Promise<MessagePerson> => legacy.messages.write(key, ref),
  dailyPlan: (): Promise<DailyPlanOverview> => legacy.dailyPlan.overview(),
  /** Just the evening-list settings: fast, unlike the whole overview. */
  dailyPlanSettings: (): Promise<DailyPlanSettings> => legacy.dailyPlan.getSettings(),
  saveDailyPlanSettings: (body: Partial<DailyPlanSettings>): Promise<DailyPlanSettings> => legacy.dailyPlan.save(body),
  buildDailyPlan: (rebuild = false): Promise<{ plan: DailyPlan }> => legacy.dailyPlan.build(rebuild),
  emailDailyPlan: (): Promise<{ ok?: boolean; skipped?: string }> => legacy.dailyPlan.email(),
  /** mode: 'auto' = the app goes on to apply; 'review' = it stops once the resume is written, for you to read. */
  decidePlanItem: (id: number, decision: 'approved' | 'skipped' | 'pending', mode: ApplyMode = 'auto'): Promise<PlanItem> => legacy.dailyPlan.decide(id, decision, mode),
  /** Review mode: you read the resume; the app moves the role on (referral, then applying). */
  sendPlanItem: (id: number): Promise<PlanItem> => legacy.dailyPlan.send(id),
  approveAllPlan: (planId: number): Promise<{ approved: number }> => legacy.dailyPlan.approveAll(planId),
  referralAction: (id: number, action: ReferralAction, link?: string): Promise<unknown> => legacy.dailyPlan.referral(id, { action, link }),
  markAskSent: (id: number): Promise<unknown> => legacy.dailyPlan.askSent(id),
  connections: (): Promise<ConnectionsSummary> => legacy.dailyPlan.connections(),
  referralStats: (): Promise<ReferralStats> => legacy.dailyPlan.referralStats(),
  importConnections: (csv: string): Promise<ConnectionsSummary> => legacy.dailyPlan.importConnections(csv),
  clearConnections: (): Promise<{ ok: boolean }> => legacy.dailyPlan.clearConnections(),
  gmailStatus: (): Promise<GmailStatus> => legacy.gmail.status(),
  connectGmail: (body: { email: string; appPassword: string; displayName?: string }): Promise<GmailStatus> => legacy.gmail.connect(body),
  gmailSettings: (body: { displayName?: string; dailyCap?: number }): Promise<GmailStatus> => legacy.gmail.settings(body),
  disconnectGmail: (): Promise<{ ok: boolean }> => legacy.gmail.disconnect(),
  testGmail: (): Promise<{ ok: boolean; to: string }> => legacy.gmail.test(),
  outbox: async (): Promise<OutboxItem[]> => (await legacy.gmail.outbox()).items ?? [],
  scheduleEmail: (body: { contactId: number; subject: string; body: string; when: 'best' | 'now' }): Promise<OutboxItem & { when: string }> => legacy.gmail.schedule(body),
  editOutbox: (id: number, body: { subject?: string; body?: string }): Promise<OutboxItem> => legacy.gmail.edit(id, body),
  cancelOutbox: (id: number): Promise<OutboxItem> => legacy.gmail.cancel(id),
  /** The user's OK on a draft; `when` = the recipient's next morning (best) or now. */
  approveOutbox: (id: number, when: 'best' | 'now' = 'best'): Promise<OutboxItem & { when: string; edited_in_gmail?: boolean }> => legacy.gmail.approve(id, { when }),
  replies: async (): Promise<ReplyItem[]> => (await legacy.gmail.replies()).replies ?? [],
  checkReplies: (): Promise<{ events?: number }> => legacy.gmail.check(),
  startTailoring: async (evalId: number): Promise<Tailoring> => (await legacy.career.startTailoring(evalId)).tailoring,
  startCoverLetter: async (evalId: number): Promise<Tailoring> => (await legacy.career.startCoverLetter(evalId)).tailoring,
  approveTailoring: (id: number): Promise<{ ok: boolean }> => legacy.career.approveTailoring(id),
  /** You know these JD skills: added to this resume and remembered for the next ones. */
  approveSkills: (id: number, skills: string[]): Promise<{ tailoring: Tailoring | null }> => legacy.career.approveSkills(id, skills),
  resumeJobs: async (): Promise<ResumeJob[]> => (await legacy.career.resumeJobs()).jobs ?? [],
  /** Skills holding unsent resumes under the ATS bar, across every draft. */
  skillGaps: (): Promise<SkillGaps> => legacy.career.skillGaps(),
  /** "I know these": added to every unsent resume missing them, each re-scored. */
  approveSkillGaps: (skills: string[]): Promise<{ resumes: number; skills: string[] }> => legacy.career.approveSkillGaps(skills),
  /** Send the app's tailored resume for this role instead of the one you uploaded. */
  useTailored: (id: number): Promise<{ ok: boolean }> => legacy.career.useTailored(id),
  /** Upload your own resume for one role; it's sent as-is. */
  uploadRoleResume: (id: number, file: File): Promise<unknown> => legacy.career.uploadEvalResume(id, file),
  trackerRows: async (): Promise<{ rows: TrackerRow[]; title: string }> => { const r = await legacy.career.trackerRows(); return { rows: r.rows ?? [], title: r.title || 'MY APPLICATIONS' } },
  trackerTitle: (title: string): Promise<{ title: string }> => legacy.career.trackerTitle(title),
  trackerAdd: (body: { company: string; role: string; link?: string; status?: TrackerStatus; referral?: TrackerReferral | null }): Promise<{ id: number }> => legacy.career.trackerAdd(body),
  trackerUpdate: async (id: number, body: Partial<{ company: string; role: string; link: string; status: TrackerStatus; submitted: boolean; referral: TrackerReferral | null }>): Promise<TrackerRow> => (await legacy.career.trackerUpdate(id, body)).row,
  trackerImport: (csv: string): Promise<TrackerImport> => legacy.career.trackerImport(csv),
  trackerDownload: (): Promise<void> => legacy.career.trackerDownload(),
  resumeTemplate: (): Promise<ResumeTemplate> => legacy.career.resumeTemplate(),
  saveResumeTemplate: (tex: string): Promise<ResumeTemplate> => legacy.career.saveResumeTemplate(tex),
  resetResumeTemplate: (): Promise<ResumeTemplate> => legacy.career.resetResumeTemplate(),
  /** You built a suggested project and pushed it; it's added to the resume it was suggested for. */
  markProjectBuilt: (id: number, body: { repo_url: string; start: string; end: string; values?: string[] }): Promise<{ project: unknown; tailoring: Tailoring | null }> => legacy.career.markProjectBuilt(id, body),
  dismissProject: (id: number): Promise<{ project: unknown }> => legacy.career.dismissProject(id),
  plannedProjects: (): Promise<ProjectsState> => legacy.career.plannedProjects(),
  suggestProjects: (): Promise<{ suggesting: boolean }> => legacy.career.suggestProjects(),
  downloadResumeFile: (id: number, filename: string): Promise<void> => legacy.career.downloadResumeFile(id, filename),
  /** The PDF's bytes, for the in-site viewer. */
  resumeFileBlob: (id: number | string): Promise<Blob> => legacy.career.resumeFileBlob(id),
  /** A 10-minute link that opens the PDF in a browser tab. */
  resumeFileLink: (id: number | string): Promise<{ url: string; filename: string; expiresIn: number }> => legacy.career.resumeFileLink(id),
  /** An earlier master version; the server refuses the current one and any an application uses. */
  deleteResumeFile: (id: number): Promise<{ ok: boolean }> => legacy.career.deleteResumeFile(id),
  uploadResume: async (file: File): Promise<ResumeStatus> => {
    const r = await legacy.career.uploadResume(file)
    if (!r.success) throw new Error(r.error || 'Upload failed')
    return r
  },
  evaluate: (input: { jobUrl?: string; jobDescription?: string }): Promise<{ ok: boolean; evalId: number; evaluation: EvaluationReport; autoQueued: boolean }> =>
    legacy.career.evaluate(input),
  evaluations: (): Promise<EvaluationSummary[]> => legacy.career.evaluations(),
  evaluation: (id: number): Promise<EvaluationDetail> => legacy.career.evaluation(id),
  deleteEvaluation: (id: number): Promise<unknown> => legacy.career.deleteEvaluation(id),
  setApplyStatus: (id: number, status: ApplyStatus): Promise<unknown> => legacy.career.setApplyStatus(id, status),
  markApplied: (id: number): Promise<unknown> => legacy.career.markApplied(id),
  /** The app fills in and submits this role's application (Greenhouse, Lever, Ashby). Returns at once; the submit runs on the server. */
  applyForMe: (id: number): Promise<{ ok: boolean; queued: boolean; platform: string; already?: boolean }> => legacy.career.applyForMe(id),
  pipeline: (): Promise<Pipeline> => legacy.career.pipeline(),
  savePipelineNotes: (id: number, notes: PipelineNotes): Promise<PipelineNotes> => legacy.career.savePipelineNotes(id, notes),
  openReport: async (id: number): Promise<void> => { await legacy.career.openReportTab(id) },
  saveNightlySettings: async (s: Partial<NightlySettings>): Promise<NightlySettings> => (await legacy.career.saveNightlySettings(s)).settings,
  hasResume: async (): Promise<boolean> => Boolean((await legacy.career.resume())?.hasResume),
  profile: (): Promise<CareerProfile> => legacy.career.profile(),
  saveProfile: (patch: Partial<CareerProfile>): Promise<CareerProfile> => legacy.career.updateProfile(patch),
  answers: async (): Promise<SavedAnswer[]> => (await legacy.profile.answers()).answers ?? [],
  saveAnswer: (question: string, answer: string): Promise<SavedAnswer> => legacy.profile.saveAnswer(question, answer),
  updateAnswer: (id: number, patch: { question?: string; answer?: string }): Promise<SavedAnswer> => legacy.profile.updateAnswer(id, patch),
  deleteAnswer: (id: number): Promise<{ ok: boolean }> => legacy.profile.deleteAnswer(id),
  githubStatus: (): Promise<GithubStatus> => legacy.github.status(),
  githubConnectUrl: async (): Promise<string> => (await legacy.github.connect()).url,
  githubRepos: async (): Promise<GithubRepo[]> => (await legacy.github.repos()).repos ?? [],
  githubSync: (): Promise<{ repos: number }> => legacy.github.sync(),
  githubSetInclude: (repoId: number, include: boolean): Promise<{ ok: boolean }> => legacy.github.setInclude(repoId, include),
  githubDisconnect: (): Promise<{ ok: boolean }> => legacy.github.disconnect(),
  nightlySettings: async (): Promise<NightlySettings> => (await legacy.career.nightlySettings()).settings,
  /** Up to 8 of the user's companies whose name matches. */
  searchCompanies: (q: string): Promise<CompanySearchHit[]> => legacy.jobs.search(q),
  catalog: (q: CatalogQuery): Promise<CatalogPage> => legacy.scrapedRoles.list(q),
  catalogSources: async (): Promise<CatalogSourceCount[]> => (await legacy.scrapedRoles.sources()).sources ?? [],
  trackListing: (id: number): Promise<{ ok: boolean; evaluation: { id: number; alreadySubmitted?: boolean } }> => legacy.scrapedRoles.track(id),
  autoApplyListing: (id: number): Promise<{ ok: boolean; evaluation: { id: number; alreadySubmitted?: boolean } }> => legacy.scrapedRoles.autoApply(id),
  refreshCatalog: (): Promise<{ ok: boolean; message: string }> => legacy.scrapedRoles.refresh(),
  catalogRefreshStatus: (): Promise<{ running: boolean; lastScrapedAt: string | null; cooldownHours: number }> => legacy.scrapedRoles.refreshStatus(),
  alertSubscription: (): Promise<{ subscription: AlertSubscription; emailConfigured: boolean }> => legacy.alerts.get(),
  saveAlertSubscription: async (sub: Partial<AlertSubscription>): Promise<AlertSubscription> => (await legacy.alerts.save(sub)).subscription,
  sendTestAlert: (): Promise<{ ok: boolean; to: string; total: number }> => legacy.alerts.test(),
  companies: async (q: CompanyQuery): Promise<CompanyPage> => {
    const page: CompanyPage = await legacy.unified.companies(q)
    // Prospect-only rows have no company page; this list is companies only.
    return { ...page, companies: page.companies.filter(c => c.source === 'job' && c.id != null) }
  },
  categoryCounts: async (): Promise<{ category: string; count: number }[]> => (await legacy.unified.categoryCounts()).counts ?? [],
  setCompanyStatus: (id: number, status: CompanyStatus): Promise<unknown> => legacy.jobs.updateStatus(id, status),
  scrapeCompanies: (body: { category: string; subcategory?: string; source?: string }): Promise<ScrapeResult> => legacy.jobs.scrape(body),
  ycIndustries: async (): Promise<string[]> => (await legacy.yc.companies({ pageSize: 1 })).industries ?? [],
  importYc: (filters: { location?: string; industry?: string; maxTeamSize?: number }): Promise<{ imported: number; skipped: number; total: number }> =>
    legacy.yc.importAll(filters),
  addCompanyByName: (name: string): Promise<{ already_existed?: boolean }> => legacy.companies.searchByName(name),
  exportData: (): Promise<unknown> => legacy.career.exportData(),
  eraseSensitiveProfile: (dryRun: boolean): Promise<SensitiveProfilePreview> =>
    legacy.career.eraseSensitiveProfile(dryRun),
}
