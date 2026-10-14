import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from './queryClient'
import { overallHealth, serviceStatuses } from '@/features/settings/serviceHealth'

export const useStats = () => useQuery({ queryKey: qk.stats, queryFn: api.stats })
export const useJobMetrics = () => useQuery({ queryKey: qk.jobMetrics, queryFn: api.jobMetrics })
export const useDailyUpdates = () => useQuery({ queryKey: qk.dailyUpdates, queryFn: api.dailyUpdates })
export const useActivity = () => useQuery({ queryKey: qk.activity, queryFn: api.activity })
export const useAutoApplyQueue = () => useQuery({ queryKey: qk.autoApplyQueue, queryFn: api.autoApplyQueue })
export const useHasResume = () => useQuery({ queryKey: qk.hasResume, queryFn: api.hasResume })
export const useProfile = () => useQuery({ queryKey: qk.profile, queryFn: api.profile })
export const useNightlySettings = () => useQuery({ queryKey: qk.nightlySettings, queryFn: api.nightlySettings })
export const useProviderUsage = () => useQuery({ queryKey: qk.providerUsage, queryFn: api.providerUsage })

export function useServiceHealth() {
  const health = useQuery({ queryKey: qk.health, queryFn: api.health, staleTime: 5 * 60_000 })
  const credits = useQuery({ queryKey: qk.credits, queryFn: () => api.credits(true), staleTime: 5 * 60_000 })
  const services = serviceStatuses(health.data, credits.data)
  return {
    services,
    overall: overallHealth(services),
    isLoading: health.isLoading || credits.isLoading,
    error: health.error ?? credits.error,
    checkedAt: credits.data?.checkedAt,
    refetch: () => { void health.refetch(); void credits.refetch() },
  }
}

/**
 * Legacy pages broadcast window events after they change data. Turn those
 * into cache invalidations so new screens never show stale numbers.
 */
export function useLegacyEventBridge() {
  const qc = useQueryClient()
  useEffect(() => {
    const onStats = () => {
      for (const key of [qk.stats, qk.jobMetrics, qk.dailyUpdates, qk.activity, qk.autoApplyQueue]) {
        void qc.invalidateQueries({ queryKey: key })
      }
    }
    const onCredits = () => {
      void qc.invalidateQueries({ queryKey: qk.health })
      void qc.invalidateQueries({ queryKey: qk.credits })
    }
    window.addEventListener('stats-refresh', onStats)
    window.addEventListener('credits-refresh', onCredits)
    return () => {
      window.removeEventListener('stats-refresh', onStats)
      window.removeEventListener('credits-refresh', onCredits)
    }
  }, [qc])
}
