import { useEffect, useState } from 'react'

export type OAuthProvider = 'google' | 'github'

/**
 * Which "Continue with…" providers are switched on in Supabase. Read from the
 * public auth settings, so a button appears as soon as the provider is enabled
 * in the dashboard, with no redeploy.
 */
export function useOAuthProviders(): Record<OAuthProvider, boolean> {
  const [enabled, setEnabled] = useState<Record<OAuthProvider, boolean>>({ google: false, github: false })
  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    if (!url || !key) return
    let alive = true
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then(r => (r.ok ? r.json() : null))
      .then((s: { external?: Record<string, boolean> } | null) => {
        if (alive && s?.external) setEnabled({ google: Boolean(s.external.google), github: Boolean(s.external.github) })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return enabled
}
