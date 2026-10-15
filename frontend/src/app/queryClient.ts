import { QueryClient } from '@tanstack/react-query'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Show cached data instantly on revisit, refresh quietly in the background.
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: (failureCount, error) => {
          // Don't hammer the backend on auth/permission errors.
          const msg = error instanceof Error ? error.message : ''
          if (/401|403|signed in|Unauthorized/i.test(msg)) return false
          return failureCount < 2
        },
        refetchOnWindowFocus: true,
      },
      mutations: { retry: 0 },
    },
  })
}

/** Query keys in one place so invalidation can't drift from the readers. */
export const qk = {
  health: ['health'] as const,
  credits: ['credits'] as const,
  providerUsage: ['provider-usage'] as const,
  aiUsage: ['ai-usage'] as const,
  contacts: (email: string) => ['contacts', email] as const,
  templates: ['outreach-templates'] as const,
  stats: ['stats'] as const,
  jobMetrics: ['job-metrics'] as const,
  dailyUpdates: ['daily-updates'] as const,
  activity: ['activity'] as const,
  autoApplyQueue: ['auto-apply-queue'] as const,
  hasResume: ['has-resume'] as const,
  profile: ['career-profile'] as const,
  answers: ['profile-answers'] as const,
  githubStatus: ['github-status'] as const,
  resume: ['resume-status'] as const,
  resumeHistory: ['resume-history'] as const,
  tailoring: (evalId: number) => ['tailoring', evalId] as const,
  gmail: ['gmail-status'] as const,
  dailyPlan: ['daily-plan'] as const,
  connections: ['linkedin-connections'] as const,
  referralStats: ['referral-stats'] as const,
  whatsapp: ['whatsapp-status'] as const,
  messageCompanies: (q: object) => ['message-companies', q] as const,
  messageCompany: (key: string) => ['message-company', key] as const,
  outbox: ['gmail-outbox'] as const,
  replies: ['gmail-replies'] as const,
  evaluations: ['evaluations'] as const,
  evaluation: (id: number) => ['evaluation', id] as const,
  pipeline: ['pipeline'] as const,
  githubRepos: ['github-repos'] as const,
  nightlySettings: ['nightly-settings'] as const,
  companySearch: (q: string) => ['company-search', q] as const,
  catalog: (q: object) => ['catalog', q] as const,
  catalogSources: ['catalog-sources'] as const,
  catalogRefresh: ['catalog-refresh'] as const,
  alerts: ['alerts'] as const,
  companies: (q: object) => ['companies', q] as const,
  companiesAll: ['companies'] as const,
  categoryCounts: ['category-counts'] as const,
  ycIndustries: ['yc-industries'] as const,
}
