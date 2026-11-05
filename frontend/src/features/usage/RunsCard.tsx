import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { Card, CardHeader, ErrorState, Skeleton } from '@/ui'

const minutes = (from: string, to: string | null) => (to ? `${Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000))} min` : 'Running')

/** How many resumes each Claude chat run wrote. The runs use your Claude plan, so they cost nothing here. */
export function RunsCard() {
  const q = useQuery({ queryKey: qk.reviewRuns, queryFn: api.reviewRuns })
  const runs = q.data?.runs ?? []
  const worked = runs.filter(r => r.roles_done + r.roles_failed > 0)
  const done = worked.reduce((n, r) => n + r.roles_done, 0)
  const failed = worked.reduce((n, r) => n + r.roles_failed, 0)
  if (q.isSuccess && !runs.length) return null
  return (
    <Card>
      <CardHeader title="Claude runs" description={worked.length ? `${done} ${done === 1 ? 'resume' : 'resumes'} in the last ${worked.length} ${worked.length === 1 ? 'run' : 'runs'} that had work, about ${Math.round(done / worked.length)} per run. ${failed} failed.` : 'Runs that found nothing to do are listed too.'} />
      {q.error ? <ErrorState compact error={q.error} onRetry={() => void q.refetch()} /> : q.isLoading ? <Skeleton className="m-4 h-32" /> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px] text-fg">
            <thead>
              <tr className="text-left text-[12px] tracking-wide text-subtle uppercase">
                {['Run', 'Started', 'Took', 'Resumes', 'Failed'].map(h => <th key={h} className="border-b border-line px-4 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id}>
                  <td className="border-b border-line px-4 py-2 font-mono text-[13px]">{r.id}</td>
                  <td className="border-b border-line px-4 py-2 text-muted">{timeAgo(r.started_at)}</td>
                  <td className="border-b border-line px-4 py-2 text-muted">{minutes(r.started_at, r.finished_at)}</td>
                  <td className="border-b border-line px-4 py-2 font-mono text-[13px]">{r.roles_done}</td>
                  <td className="border-b border-line px-4 py-2 font-mono text-[13px]">{r.roles_failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
