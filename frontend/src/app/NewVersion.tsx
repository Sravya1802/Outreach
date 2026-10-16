import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { bundleFrom, isStale, runningBundle } from './version'

const EVERY = 5 * 60_000

/**
 * Notices when a newer version has been deployed. Shows a slim "Reload" bar,
 * and switches over by itself on the next page change (nothing typed is lost
 * that a page change wouldn't lose anyway).
 */
export function NewVersionBar() {
  const { pathname } = useLocation()
  const [stale, setStale] = useState(false)
  const first = useRef(pathname)

  useEffect(() => {
    const running = runningBundle()
    if (!running) return // dev server
    let alive = true
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/', { cache: 'no-store' })
        if (res.ok && alive && isStale(running, bundleFrom(await res.text()))) setStale(true)
      } catch { /* offline: try again later */ }
    }
    const t = window.setInterval(() => void check(), EVERY)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    void check()
    return () => { alive = false; window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible) }
  }, [])

  // The router has already moved to the new page, so a reload lands there on the new version.
  useEffect(() => {
    if (stale && pathname !== first.current) window.location.reload()
    first.current = pathname
  }, [pathname, stale])

  if (!stale) return null
  return (
    <div role="status" className="flex items-center justify-center gap-3 border-b border-accent/30 bg-accent-soft px-4 py-1.5 text-[13px] text-fg">
      <span>Scout’n’Jobs has been updated.</span>
      <button type="button" onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
        <RefreshCw className="size-3.5" aria-hidden="true" /> Reload
      </button>
    </div>
  )
}
