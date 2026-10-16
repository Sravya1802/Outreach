import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronRight, X } from 'lucide-react'
import { GUIDE } from '@/features/howitworks/walkthrough'
import { cn } from '@/lib/cn'
import { Button } from '@/ui'
import { ACCOUNT_SECTIONS, PRIMARY_SECTIONS } from '../nav'
import { useTour } from './context'

/** Floating Help in the bottom-right corner: replay the tour, or look up what any tab does. */
export function HelpLauncher() {
  const { start } = useTour()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div ref={root} className="fixed right-4 bottom-4 z-[70] flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open && (
        <section role="dialog" aria-labelledby="help-h"
          className="flex max-h-[min(640px,calc(100vh-120px))] w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-[6px] border border-line bg-surface shadow-pop"
          style={{ animation: 'ui-fade-in 120ms ease-out' }}>
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 id="help-h" className="font-display text-[19px] font-semibold text-fg">Help</h2>
            <button type="button" onClick={close} aria-label="Close help" className="rounded p-1 text-subtle hover:bg-hover hover:text-fg">
              <X className="size-4" />
            </button>
          </header>
          <div className="overflow-y-auto">
            <div className="border-b border-line px-5 py-4">
              <Button variant="primary" className="w-full justify-center" onClick={() => { close(); start() }}>Take the tour</Button>
              <p className="mt-2 text-center text-[13px] text-subtle">A one-minute look at each tab along the top.</p>
            </div>
            <p className="px-5 pt-4 pb-1 text-[12px] font-medium tracking-wide text-subtle uppercase">What each tab does</p>
            <ul className="px-2 pb-2">
              {[...PRIMARY_SECTIONS, ...ACCOUNT_SECTIONS].map(s => {
                const g = GUIDE[s.id]
                const tabs = [...s.tabs.map(t => ({ label: t.label, to: t.to, does: g.tabs[t.to] ?? '' })), ...(g.extraTabs ?? [])]
                return (
                  <li key={s.id}>
                    <details className="group rounded-[4px] open:bg-hover/40">
                      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[4px] px-3 py-2 text-[14px] text-fg hover:bg-hover [&::-webkit-details-marker]:hidden">
                        <s.icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                        <span className="flex-1 font-medium">{s.label}</span>
                        <ChevronRight className="size-4 text-subtle transition-transform group-open:rotate-90" aria-hidden="true" />
                      </summary>
                      <div className="px-3 pb-3 pl-9">
                        <p className="text-[13px] leading-relaxed text-muted">{g.what} {g.when}</p>
                        <ul className="mt-2 space-y-2">
                          {tabs.map(t => (
                            <li key={t.to}>
                              <Link to={t.to} onClick={close} className="text-[13px] font-medium text-accent hover:underline">{t.label}</Link>
                              <p className="text-[13px] leading-snug text-muted">{t.does}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  </li>
                )
              })}
            </ul>
          </div>
          <footer className="border-t border-line px-5 py-3">
            <Link to="/how-it-works" onClick={close} className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline">
              Every tab on one page <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </footer>
        </section>
      )}
      <button ref={button} type="button" data-tour="help" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Help" title="Help"
        className={cn('grid size-11 place-items-center rounded-full bg-accent text-on-accent shadow-pop transition-colors hover:bg-accent-hover',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent')}>
        {open ? <X className="size-5" aria-hidden="true" /> : <span aria-hidden="true" className="text-[22px] leading-none font-semibold">?</span>}
      </button>
    </div>
  )
}
