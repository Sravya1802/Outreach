import { Link } from 'react-router-dom'
import { ArrowRight, Search } from 'lucide-react'
import { ACCOUNT_SECTIONS, PRIMARY_SECTIONS, type NavSection } from '@/app/nav'
import { Kbd, Page, PageHeader } from '@/ui'
import { GUIDE, START_HERE } from './walkthrough'

function SectionCard({ s }: { s: NavSection }) {
  const g = GUIDE[s.id]
  const tabs = [...s.tabs.map(t => ({ label: t.label, to: t.to, does: g.tabs[t.to] ?? '' })), ...(g.extraTabs ?? [])]
  return (
    <li id={`guide-${s.id}`} className="flex flex-col rounded-[6px] border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <s.icon className="size-5 shrink-0 text-accent" aria-hidden="true" />
          <h2 className="font-display text-[20px] font-semibold text-fg">{s.label}</h2>
        </div>
        <Link to={s.to} className="inline-flex shrink-0 items-center gap-1 text-[14px] font-medium text-accent hover:underline">
          Open <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <p className="mt-2 text-[15px] text-fg">{g.what}</p>
      <p className="mt-0.5 text-[14px] text-muted">{g.when}</p>
      <dl className="mt-4 divide-y divide-line border-t border-line">
        {tabs.map(t => (
          <div key={t.to} className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt><Link to={t.to} className="text-[14px] font-medium text-fg hover:text-accent hover:underline">{t.label}</Link></dt>
            <dd className="text-[14px] leading-relaxed text-muted">{t.does}</dd>
          </div>
        ))}
      </dl>
    </li>
  )
}

/** What every section and tab is for, plus the order to set things up in. */
export default function WalkthroughPage() {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <Page wide>
      <PageHeader title="Walkthrough"
        description="What every tab in Scout’n’Jobs is for. The tabs along the top are the main sections. Profile and Settings are under your initial at the top right." />

      <section aria-labelledby="start-h" className="mb-10 rounded-[6px] border border-accent/40 bg-accent-soft/40 p-5">
        <h2 id="start-h" className="font-display text-[20px] font-semibold text-fg">If you’re new, go in this order</h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {START_HERE.map((st, i) => (
            <li key={st.title}>
              <Link to={st.to} className="group flex h-full flex-col rounded-[4px] border border-line bg-surface p-4 transition-colors hover:border-line-strong">
                <span className="flex items-start gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent font-mono text-[12px] text-white">{i + 1}</span>
                  <span className="text-[15px] font-medium leading-snug text-fg group-hover:text-accent">{st.title}</span>
                </span>
                <span className="mt-2 text-[14px] leading-relaxed text-muted">{st.body}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <ol className="grid gap-4 lg:grid-cols-2">
        {[...PRIMARY_SECTIONS, ...ACCOUNT_SECTIONS].map(s => <SectionCard key={s.id} s={s} />)}
      </ol>

      <p className="mt-8 flex flex-wrap items-center gap-1.5 text-[14px] text-muted">
        <Search className="size-4" aria-hidden="true" /> Lost? Press <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd> anywhere and type what you’re looking for.
      </p>
    </Page>
  )
}
