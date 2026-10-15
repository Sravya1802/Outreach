import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useDailyUpdates, useJobMetrics } from '@/app/queries'
import { qk } from '@/app/queryClient'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Page, PageHeader, Skeleton } from '@/ui'
import { useDailyPlan } from '@/features/applications/useDailyPlan'
import { emailSteps, flowSettingsLine, flowSteps, whatsappSteps, type FlowState, type FlowStep } from '@/features/home/queueFlow'

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-rule pb-2">
      <h2 className="font-display text-[22px] font-semibold text-fg">{children}</h2>
      {action}
    </div>
  )
}

const FLOW_COUNT: Record<FlowState, string> = { idle: 'text-subtle', busy: 'text-fg', you: 'text-accent', stuck: 'text-danger' }
const FLOW_BOX: Record<FlowState, string> = {
  idle: 'border-line', busy: 'border-line', you: 'border-accent bg-accent-soft', stuck: 'border-danger/50 bg-danger-soft',
}

function FlowGrid({ steps, loading, cols }: { steps: FlowStep[]; loading: boolean; cols: string }) {
  return (
    <ol className={cn('grid gap-3 sm:grid-cols-2', cols)}>
      {steps.map((st, n) => (
        <li key={st.id} className="min-w-0">
          <Link to={st.to} className={cn('flex h-full flex-col gap-1.5 rounded-[6px] border bg-surface p-4 transition-colors hover:border-line-strong', FLOW_BOX[st.state])}>
            <span className="flex items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line-strong font-mono text-[12px] text-muted">{n + 1}</span>
              <span className="text-[15px] font-medium text-fg">{st.title}</span>
            </span>
            {loading ? <Skeleton className="h-5 w-24" /> : (
              <span className={cn('truncate font-mono text-[14px]', FLOW_COUNT[st.state])} title={st.countLabel}>
                {st.countLabel}{st.alert && <span className="ml-2 text-danger">· {st.alert}</span>}
              </span>
            )}
            <span className="text-[13px] leading-relaxed text-muted">{st.explain}</span>
          </Link>
        </li>
      ))}
    </ol>
  )
}

/** Both queues (applications and outreach email): every stage, explained with the user's own settings, with live counts. */
export default function HowItWorksPage() {
  const [now] = useState(() => Date.now())
  const daily = useDailyUpdates()
  const metrics = useJobMetrics()
  const plan = useDailyPlan()
  const pipeline = useQuery({ queryKey: qk.pipeline, queryFn: api.pipeline })
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })
  const outbox = useQuery({ queryKey: qk.outbox, queryFn: api.outbox, enabled: Boolean(gmail.data?.connected) })
  const replies = useQuery({ queryKey: qk.replies, queryFn: api.replies, enabled: Boolean(gmail.data?.connected) })
  const connections = useQuery({ queryKey: qk.connections, queryFn: api.connections })
  const whatsapp = useQuery({ queryKey: qk.whatsapp, queryFn: api.whatsappStatus })
  const apply = flowSteps({
    now,
    newToday: (daily.data?.intern.today ?? 0) + (daily.data?.newGrad.today ?? 0),
    plan: plan.data,
    tracked: pipeline.data ? Object.values(pipeline.data.columns).flatMap(c => c.items) : [],
  })
  const email = emailSteps({ gmail: gmail.data, contactsWithEmail: metrics.data?.summary.contactsWithEmail ?? 0, connections: connections.data?.total, outbox: outbox.data, replies: replies.data })

  return (
    <Page wide>
      <PageHeader title="How it works" description="What happens to every role, email and message, step by step, with where each one is right now." />
      <div className="space-y-10">
      <div>
        <SectionTitle action={<Link to="/applications/auto-apply" className="text-[14px] text-accent hover:underline">Change settings</Link>}>
          <span id="flow-h">How your job queue works</span>
        </SectionTitle>
        <p className="mb-4 text-[14px] text-muted">{plan.isLoading ? 'Loading your queue…' : flowSettingsLine(plan.data)}</p>
        <FlowGrid steps={apply} loading={plan.isLoading || pipeline.isLoading || daily.isLoading} cols="lg:grid-cols-4" />
      </div>
      <div>
        <SectionTitle action={<Link to="/people/outbox" className="text-[14px] text-accent hover:underline">Outbox</Link>}>
          <span id="email-flow-h">How your outreach goes out</span>
        </SectionTitle>
        <p className="mb-4 text-[14px] text-muted">Emails and referral asks go out automatically from your Gmail on a schedule, with follow-ups that stop the moment someone replies. LinkedIn notes are written for you and sent by you.</p>
        <FlowGrid steps={email} loading={gmail.isLoading || metrics.isLoading || connections.isLoading} cols="lg:grid-cols-4" />
      </div>
      <div>
        <SectionTitle action={<Link to="/integrations/whatsapp" className="text-[14px] text-accent hover:underline">WhatsApp settings</Link>}>
          <span id="wa-flow-h">On your phone with WhatsApp</span>
        </SectionTitle>
        <p className="mb-4 text-[14px] text-muted">The same updates on WhatsApp, and you can approve your list just by replying.</p>
        <FlowGrid steps={whatsappSteps(whatsapp.data)} loading={whatsapp.isLoading} cols="lg:grid-cols-3" />
      </div>
      </div>
    </Page>
  )
}
