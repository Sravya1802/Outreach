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
  stats: ['stats'] as const,
  jobMetrics: ['job-metrics'] as const,
  dailyUpdates: ['daily-updates'] as const,
  activity: ['activity'] as const,
  autoApplyQueue: ['auto-apply-queue'] as const,
  hasResume: ['has-resume'] as const,
  profile: ['career-profile'] as const,
  nightlySettings: ['nightly-settings'] as const,
  companySearch: (q: string) => ['company-search', q] as const,
}
