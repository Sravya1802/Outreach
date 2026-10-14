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
  downloadResumeFile: (id: number, filename: string): Promise<void> => legacy.career.downloadResumeFile(id, filename),
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
