import { useQuery } from '@tanstack/react-query'
import { api, type DailyPlanOverview } from '@/lib/api'
import { qk } from '@/app/queryClient'

export function useDailyPlan() {
  return useQuery({
    queryKey: qk.dailyPlan,
    queryFn: api.dailyPlan,
    // Poll while a list is building or resumes are being written.
    refetchInterval: q => {
      const d = q.state.data as DailyPlanOverview | undefined
      return d?.plan?.status === 'building' || d?.active.some(a => a.stage === 'tailoring') ? 10_000 : false
    },
  })
}
