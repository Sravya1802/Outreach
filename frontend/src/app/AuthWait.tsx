import { useEffect, useState } from 'react'
import { Button, PageSpinner } from '@/ui'

const STALL_MS = 8000

/** Drop the stored Supabase session so the next load starts at sign-in. */
function forgetSession() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k)
  } catch { /* storage blocked */ }
  window.location.reload()
}

/**
 * Shown while the stored session is read. That read refreshes an expired
 * token over the network, and a network that never answers (a work VPN or
 * firewall blocking supabase.co) would otherwise leave a spinner forever.
 */
export function AuthWait() {
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setStalled(true), STALL_MS)
    return () => clearTimeout(t)
  }, [])

  if (!stalled) return <div className="flex h-full bg-canvas"><PageSpinner /></div>
  return (
    <div className="flex h-full items-center justify-center bg-canvas px-4 text-fg">
      <div role="alert" className="max-w-md text-center">
        <p className="font-display text-[22px] font-semibold">Still checking your sign-in</p>
        <p className="mt-2 text-[14px] text-muted">
          The sign-in service isn’t answering. A work VPN, firewall or ad blocker that blocks supabase.co is the usual cause;
          try another network or turn the VPN off.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>Try again</Button>
          <Button onClick={forgetSession}>Sign in again</Button>
        </div>
      </div>
    </div>
  )
}
