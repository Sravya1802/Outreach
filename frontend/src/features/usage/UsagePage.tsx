import { RefreshCw } from 'lucide-react'
import { useProviderUsage, useServiceHealth } from '@/app/queries'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { Badge, Button, Card, CardHeader, ErrorState, Page, PageHeader, Skeleton, StatusDot, type Tone } from '@/ui'
import { AiSpendCard } from './AiSpendCard'

const stateTone: Record<string, Tone> = { ok: 'success', warn: 'warning', down: 'danger', off: 'neutral' }
const stateLabel: Record<string, string> = { ok: 'Working', warn: 'Attention', down: 'Unavailable', off: 'Not set up' }

const USAGE_LABELS = { hunter: 'Hunter', prospeo: 'Prospeo', apollo: 'Apollo', serper: 'Google search' } as const

function UsageCard() {
  const usage = useProviderUsage()
  return (
    <Card>
      <CardHeader title="Your lookups this month" description="Contact and email lookups share the server's keys, so each account has a monthly allowance. Resets on the 1st." />
      {usage.isError ? <ErrorState compact error={usage.error} onRetry={() => void usage.refetch()} /> : (
        <ul className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
          {(Object.keys(USAGE_LABELS) as (keyof typeof USAGE_LABELS)[]).map(k => {
            const u = usage.data?.[k]
            const pct = u && u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0
            return (
              <li key={k}>
                <div className="mb-1.5 flex justify-between text-[13px]">
                  <span className="text-fg">{USAGE_LABELS[k]}</span>
                  {usage.isLoading ? <Skeleton className="h-4 w-12" /> : <span className="tabular-nums text-muted">{u?.used ?? 0} / {u?.limit ?? 0}</span>}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
                  <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-accent')} style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

export default function UsagePage() {
  const { services, isLoading, error, checkedAt, refetch } = useServiceHealth()
  return (
    <Page>
    <PageHeader title="Usage" description="What you’ve spent on AI and lookups this month, and whether each service the app depends on is working." />
    <div className="space-y-4">
    <AiSpendCard />
    <UsageCard />
    <Card>
      <CardHeader
        title="Service status"
        description={checkedAt ? `Checked ${timeAgo(checkedAt)}. Keys are set on the server.` : 'Keys are set on the server.'}
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={refetch}>Recheck</Button>}
      />
      {error ? <ErrorState compact error={error} onRetry={refetch} /> : (
        <ul className="divide-y divide-line">
          {services.map(s => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <StatusDot tone={isLoading ? 'neutral' : stateTone[s.state] ?? 'neutral'} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-fg">{s.name}</p>
                <p className="truncate text-xs text-subtle">{s.purpose}</p>
              </div>
              {isLoading ? <Skeleton className="h-5 w-20" /> : (
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                  {s.note && <span className="hidden max-w-72 truncate text-xs text-subtle sm:block" title={s.note}>{s.note}</span>}
                  <Badge tone={stateTone[s.state] ?? 'neutral'}>{stateLabel[s.state]}</Badge>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
    </div>
    </Page>
  )
}

