import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, X } from 'lucide-react'
import { Button } from '@/ui'

const KEY = 'snj.walkthrough.dismissed'

function readDismissed(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

/** The three things a new user needs to know, in order. Stays until dismissed or setup is complete. */
const WALKTHROUGH_STEPS = [
  {
    title: 'Tell it about you',
    body: 'Upload your resume and fill in your details once. Every role is scored against your resume, and every application form is filled from your details.',
    to: '/profile/resume', cta: 'Open profile',
  },
  {
    title: 'Connect your accounts',
    body: 'Gmail sends referral asks and follow-ups from your own address. LinkedIn tells it who you know. WhatsApp pings your phone. Each one is optional.',
    to: '/integrations', cta: 'See what each one does',
  },
  {
    title: 'Every evening, a list',
    body: 'New roles are scored overnight and the best land on Home. You approve or skip each one. Approved roles get a referral ask first, then an application, and replies are tracked for you.',
    to: '/how-it-works', cta: 'See the full flow',
  },
] as const

export function Walkthrough({ hidden }: { hidden: boolean }) {
  const [dismissed, setDismissed] = useState(readDismissed)
  if (hidden || dismissed) return null
  function dismiss() {
    try { localStorage.setItem(KEY, '1') } catch { /* private window: it just comes back next visit */ }
    setDismissed(true)
  }
  return (
    <section aria-labelledby="walk-h" className="rounded-[6px] border border-accent/40 bg-accent-soft/40 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="walk-h" className="font-display text-[22px] font-semibold text-fg">How Scout’n’Jobs works</h2>
          <p className="mt-1 text-[14px] text-muted">It finds roles, asks your network for referrals, applies, and tracks replies. Three things to know first.</p>
        </div>
        <Button size="sm" variant="ghost" aria-label="Hide this walkthrough" onClick={dismiss} icon={<X className="size-3.5" />}>Hide</Button>
      </div>
      <ol className="mt-4 grid gap-4 md:grid-cols-3">
        {WALKTHROUGH_STEPS.map((s, i) => (
          <li key={s.title} className="flex flex-col rounded-[4px] border border-line bg-surface p-4">
            <span className="flex items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent font-mono text-[12px] text-white">{i + 1}</span>
              <span className="text-[15px] font-medium text-fg">{s.title}</span>
            </span>
            <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted">{s.body}</p>
            <Link to={s.to} className="mt-3 inline-flex items-center gap-1.5 self-start text-[14px] font-medium text-accent hover:underline">
              {s.cta} <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
