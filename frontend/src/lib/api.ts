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
  [key: string]: unknown
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

export interface SensitiveProfilePreview {
  profileFields?: string[]
  metaKeys?: string[]
  erased?: { profileFields?: string[]; metaKeys?: string[] }
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export const api = {
  health: (): Promise<Health> => legacy.health(),
  stats: (): Promise<Stats> => legacy.stats(),
  jobMetrics: (): Promise<JobMetrics> => legacy.jobMetrics(),
  dailyUpdates: (): Promise<DailyUpdates> => legacy.dailyUpdates(),
  activity: async (): Promise<ActivityItem[]> => (await legacy.activity()).activity ?? [],
  credits: (refresh = false): Promise<Credits> => legacy.credits.status(refresh),
  autoApplyQueue: (): Promise<AutoApplyQueue> => legacy.career.autoApplyQueue(),
  hasResume: async (): Promise<boolean> => Boolean((await legacy.career.resume())?.hasResume),
  profile: (): Promise<CareerProfile> => legacy.career.profile(),
  nightlySettings: async (): Promise<NightlySettings> => (await legacy.career.nightlySettings()).settings,
  /** Up to 8 of the user's companies whose name matches. */
  searchCompanies: (q: string): Promise<CompanySearchHit[]> => legacy.jobs.search(q),
  exportData: (): Promise<unknown> => legacy.career.exportData(),
  eraseSensitiveProfile: (dryRun: boolean): Promise<SensitiveProfilePreview> =>
    legacy.career.eraseSensitiveProfile(dryRun),
}
