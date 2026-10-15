import { useQuery } from '@tanstack/react-query'
import { qk } from '@/app/queryClient'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Card, CardHeader, ErrorState, Skeleton } from '@/ui'

const TASK_LABELS: Record<string, string> = {
  score: 'Quick scores', evaluate: 'Job evaluations', email: 'Emails', categorize: 'Company labels',
  resume: 'Tailored resumes', cover_letter: 'Cover letters',
}

export function AiSpendCard() {
  const usage = useQuery({ queryKey: qk.aiUsage, queryFn: api.aiUsage })
  const u = usage.data
  const bar = (spent: number, cap: number) => {
    const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0
    return (
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
        <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-accent')} style={{ width: `${pct}%` }} />
      </div>
    )
  }
  return (
    <Card>
      <CardHeader title="AI spending this month"
        description="Every AI call is metered. When a limit is reached, AI work pauses until the 1st, with nothing charged beyond it." />
      {usage.isError ? <ErrorState compact error={usage.error} onRetry={() => void usage.refetch()} /> : usage.isLoading || !u ? (
        <div className="p-5"><Skeleton className="h-16" /></div>
      ) : (
        <div className="space-y-5 p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="flex justify-between text-[14px]"><span className="text-fg">You</span><span className="font-mono text-muted">${u.spent.mine.toFixed(2)} / ${u.caps.user.toFixed(0)}</span></div>
              {bar(u.spent.mine, u.caps.user)}
            </div>
            <div>
              <div className="flex justify-between text-[14px]"><span className="text-fg">Whole site</span><span className="font-mono text-muted">${u.spent.site.toFixed(2)} / ${u.caps.site.toFixed(0)}</span></div>
              {bar(u.spent.site, u.caps.site)}
            </div>
          </div>
          {u.byTask.length > 0 && (
            <dl className="divide-y divide-line border-t border-line text-[14px]">
              {u.byTask.map(t => (
                <div key={t.task} className="flex justify-between py-2">
                  <dt className="text-muted">{TASK_LABELS[t.task] ?? t.task} <span className="text-subtle">· {t.calls}</span></dt>
                  <dd className="font-mono text-fg">${t.cost.toFixed(t.cost < 0.1 ? 3 : 2)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-[13px] text-subtle">Resumes and cover letters use Claude Opus 5.5; scoring and emails use Groq, with OpenAI as backup.</p>
        </div>
      )}
    </Card>
  )
}
