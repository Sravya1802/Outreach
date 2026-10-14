// Typed façade over the legacy JS client in src/api.js.
//
// The legacy client owns HTTP + auth (JWT attach, error normalisation, blob
// downloads) and is still imported by old pages and by tests/api-client.test.mjs,
// so new code wraps it rather than duplicating it. Each wrapper pins the
// response shape the backend actually returns (verified against the live API).
import { api as legacy } from '../api.js'

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
}

export interface CatalogPage {
  role_type: RoleType
  page: number
  pageSize: number
  total: number
  rows: CatalogListing[]
}

export interface CatalogSourceCount { source: string; role_type: RoleType; region: Region; n: number; swe: number; ai: number }

export interface CatalogQuery { roleType: RoleType; region: Region; field?: Field; source?: string; search?: string; tier?: Tier; hasPay?: boolean; page?: number; pageSize?: number }

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

export interface ResumeStatus { hasResume: boolean; name?: string | null; date?: string | null; textPreview?: string | null }

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
}

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

export interface EvaluationDetail extends EvaluationSummary { evaluation: EvaluationReport | null }

export type PipelineColumn = 'evaluated' | 'applied' | 'responded' | 'interview' | 'offer' | 'rejected'
export interface Pipeline { columns: Record<PipelineColumn, { label: string; hint: string; items: EvaluationSummary[] }>; totals: Record<PipelineColumn, number>; total: number }

export interface AutoApplyItems { items: EvaluationSummary[]; counts: Record<QueueStatus, number> }

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
  autoApplyQueue: (): Promise<AutoApplyQueue> => legacy.career.autoApplyQueue(),
  autoApplyItems: (): Promise<AutoApplyItems> => legacy.career.autoApplyQueue(),
  resumeStatus: (): Promise<ResumeStatus> => legacy.career.resume(),
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
  pipeline: (): Promise<Pipeline> => legacy.career.pipeline(),
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
