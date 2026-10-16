import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check } from 'lucide-react'
import { qk } from '@/app/queryClient'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Badge, Page, PageHeader, Skeleton, type Tone } from '@/ui'
import { STATE_LABEL, integrationCards, type IntegrationState } from './overview'

const TONE: Record<IntegrationState, Tone> = { loading: 'neutral', off: 'neutral', on: 'success', problem: 'danger' }

/** What each connection does, in plain words, and where it stands. */
export default function IntegrationsPage() {
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })
  const github = useQuery({ queryKey: qk.githubStatus, queryFn: api.githubStatus })
  const linkedin = useQuery({ queryKey: qk.connections, queryFn: api.connections })
  const whatsapp = useQuery({ queryKey: qk.whatsapp, queryFn: api.whatsappStatus })
  const cards = integrationCards({
    gmail: gmail.data, github: github.data, linkedin: linkedin.data, whatsapp: whatsapp.data,
    errors: { gmail: gmail.isError, github: github.isError, linkedin: linkedin.isError, whatsapp: whatsapp.isError },
  })
  const on = cards.filter(c => c.state === 'on').length
  const loading = cards.some(c => c.state === 'loading')

  return (
    <Page wide>
      <PageHeader title="Integrations"
        description="Scout’n’Jobs works through accounts you already have. Each one unlocks something specific. None are needed to browse roles or evaluate a job, and you can disconnect any of them at any time." />
      <p className="mb-5 text-[14px] text-muted" role="status">
        {loading ? 'Checking what’s connected…' : on === 0 ? 'Nothing is connected yet. Gmail is the one to start with.' : `${on} of ${cards.length} connected.`}
      </p>
      <ol className="grid gap-4 md:grid-cols-2">
        {cards.map(c => (
          <li key={c.id} className={cn('flex flex-col rounded-[6px] border bg-surface p-5', c.state === 'problem' ? 'border-danger/50' : 'border-line')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-[19px] font-semibold text-fg">{c.title}</h2>
                <p className="mt-1 text-[14px] leading-relaxed text-fg">{c.does}</p>
              </div>
              {c.state === 'loading' ? <Skeleton className="h-5 w-20" /> : <Badge tone={TONE[c.state]}>{STATE_LABEL[c.state]}</Badge>}
            </div>
            {c.detail && <p className={cn('mt-1 truncate font-mono text-[13px]', c.state === 'problem' ? 'text-danger' : 'text-subtle')}>{c.detail}</p>}
            <p className="mt-4 text-[12px] font-medium tracking-wide text-subtle uppercase">What you get</p>
            <ul className="mt-1.5 space-y-1">
              {c.gives.map(g => (
                <li key={g} className="flex gap-2 text-[14px] text-muted">
                  <Check className="mt-1 size-3.5 shrink-0 text-success" strokeWidth={2.5} aria-hidden="true" />{g}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[13px] text-subtle">{c.effort}</p>
            <div className="mt-4 flex-1" />
            <Link to={c.to} className="mt-1 inline-flex items-center gap-1.5 self-start text-[14px] font-medium text-accent hover:underline">
              {c.state === 'on' ? 'Manage' : c.state === 'problem' ? 'Fix it' : 'Set up'} <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>
    </Page>
  )
}
