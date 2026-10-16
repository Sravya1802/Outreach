import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '@/lib/supabase'
import { Button } from '@/ui'
import { place, type Rect } from './placement'
import { TourContext } from './context'
import { doneKey, tourSteps, type TourStep } from './steps'


function readLocal(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

/** The first visible element marked data-tour="name" (the top bar and the phone header both carry some). */
function findAnchor(name: string | undefined): Rect | null {
  if (!name) return null
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return { top: r.top, left: r.left, width: r.width, height: r.height }
  }
  return null
}

const CARD_WIDTH = 380
const PAD = 6

function TourCard({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const steps = useMemo(() => tourSteps(), [])
  const [i, setI] = useState(0)
  const step: TourStep = steps[i] ?? { id: 'none', title: '', body: '' }
  const last = i === steps.length - 1
  const card = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<Rect | null>(null)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight, card: 240 })

  // Re-measure on every step, resize and scroll.
  useLayoutEffect(() => {
    const measure = () => {
      setAnchor(findAnchor(step.anchor))
      setSize({ w: window.innerWidth, h: window.innerHeight, card: card.current?.offsetHeight ?? 240 })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [step.anchor, i])

  useEffect(() => { primary.current?.focus() }, [i])

  const next = useCallback(() => (last ? onClose() : setI(n => n + 1)), [last, onClose])
  const back = useCallback(() => setI(n => Math.max(0, n - 1)), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
      else if (e.key === 'Tab' && card.current) {
        // Keep focus inside the card.
        const items = [...card.current.querySelectorAll<HTMLElement>('button, a[href]')]
        const first = items[0], end = items.at(-1)
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end?.focus() }
        else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, onClose])

  const p = place(anchor, { width: CARD_WIDTH, height: size.card }, size.w, size.h)

  return (
    <div className="fixed inset-0 z-[95]" style={{ animation: 'ui-fade-in 160ms ease-out' }}>
      {/* Blocks the app while touring; the spotlight's shadow does the dimming. */}
      <div className="absolute inset-0" aria-hidden="true" />
      {anchor ? (
        <div aria-hidden="true" className="pointer-events-none absolute rounded-md ring-2 ring-accent transition-all duration-200 ease-out"
          style={{ top: anchor.top - PAD, left: anchor.left - PAD, width: anchor.width + PAD * 2, height: anchor.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.5)' }} />
      ) : <div aria-hidden="true" className="absolute inset-0 bg-black/50" />}

      <div ref={card} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body"
        className="absolute flex max-h-[calc(100vh-32px)] flex-col rounded-[6px] border border-line bg-surface shadow-pop transition-[top,left] duration-200 ease-out"
        style={{ top: p.top, left: p.left, width: p.width }}>
        {p.caret !== null && (
          <span aria-hidden="true" className="absolute -top-[7px] size-3 rotate-45 border-t border-l border-line bg-surface" style={{ left: p.caret - 6 }} />
        )}
        <div className="overflow-y-auto px-5 pt-4 pb-3">
          <p className="font-mono text-[12px] text-subtle">{i + 1} of {steps.length}</p>
          <h2 id="tour-title" className="mt-1 font-display text-[20px] font-semibold text-fg">{step.title}</h2>
          <p id="tour-body" className="mt-1.5 text-[14px] leading-relaxed text-muted">{step.body}</p>
          {step.tabs && step.tabs.length > 0 && (
            <dl className="mt-3 divide-y divide-line border-t border-line">
              {step.tabs.map(t => (
                <div key={t.label} className="py-2">
                  <dt className="text-[13px] font-medium text-fg">{t.label}</dt>
                  <dd className="text-[13px] leading-snug text-muted">{t.does}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          {last
            ? <button type="button" onClick={() => { onClose(); navigate('/how-it-works') }} className="text-[13px] text-accent hover:underline">Open the Walkthrough</button>
            : <button type="button" onClick={onClose} className="text-[13px] text-subtle hover:text-fg">Skip tour</button>}
          <span className="flex-1" />
          {i > 0 && <Button size="sm" variant="ghost" onClick={back}>Back</Button>}
          <Button ref={primary} size="sm" variant="primary" onClick={next}>{last ? 'Done' : i === 0 ? 'Show me' : 'Next'}</Button>
        </div>
      </div>
    </div>
  )
}

/** Opens the tour on a user's first visit, and whenever Help is clicked. */
export function TourProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const user = session?.user
  const [open, setOpen] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)

  const start = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    returnFocus.current?.focus?.()
    if (!user) return
    try { localStorage.setItem(doneKey(user.id), '1') } catch { /* private window: the account flag still holds */ }
    if (!user.user_metadata?.tour_done_at) {
      void supabase.auth.updateUser({ data: { tour_done_at: new Date().toISOString() } }).catch(() => undefined)
    }
  }, [user])

  // First visit: wait for the page to settle so the tabs are on screen.
  const seen = !user || Boolean(user.user_metadata?.tour_done_at) || readLocal(doneKey(user.id))
  useEffect(() => {
    if (seen) return
    const t = window.setTimeout(start, 900)
    return () => window.clearTimeout(t)
  }, [seen, start])

  const value = useMemo(() => ({ start }), [start])
  return (
    <TourContext.Provider value={value}>
      {children}
      {open && <TourCard onClose={close} />}
    </TourContext.Provider>
  )
}
