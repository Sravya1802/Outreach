import { Badge, ButtonLink, Card, CardHeader, Page, PageHeader, Skeleton, StatusDot } from '@/ui'
import { cn } from '@/lib/cn'
import { STATE_LABEL, STATE_TONE } from './overview'
import { useIntegrations } from './useIntegrations'

/** What's connected, what each connection does, and a way into each. Same row layout as Usage → Service status. */
export default function IntegrationsPage() {
  const { cards, connected, loading } = useIntegrations()
  return (
    <Page>
      <PageHeader title="Integrations"
        description="The accounts Scout’n’Jobs works through. Each one is optional and turns on something specific. You can disconnect any of them at any time." />
      <Card>
        <CardHeader title="Your connections"
          description={loading ? 'Checking what’s connected…' : connected === 0 ? 'Nothing connected yet. Start with Gmail.' : `${connected} of ${cards.length} connected`} />
        <ul className="divide-y divide-line">
          {cards.map(c => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3.5">
              <StatusDot tone={STATE_TONE[c.state]} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-fg">{c.title}</p>
                <p className="text-[13px] text-subtle">{c.does}</p>
              </div>
              {c.state === 'loading' ? <Skeleton className="h-5 w-24" /> : (
                <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className={cn('hidden max-w-56 truncate text-xs sm:block', c.state === 'problem' ? 'text-danger' : 'text-subtle')} title={c.detail}>
                    {c.detail ?? (c.state === 'off' ? c.effort : '')}
                  </span>
                  <Badge tone={STATE_TONE[c.state]}>{STATE_LABEL[c.state]}</Badge>
                  <ButtonLink to={c.to} size="sm" variant={c.state === 'on' ? 'ghost' : 'secondary'} className="w-20 justify-center">
                    {c.state === 'on' ? 'Manage' : c.state === 'problem' ? 'Fix' : 'Set up'}
                  </ButtonLink>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  )
}
