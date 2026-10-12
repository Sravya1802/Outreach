import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

interface AuthState {
  /** undefined while the stored session is still being read. */
  session: Session | null | undefined
  email: string
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    supabase.auth.getSession()
      .then(({ data }) => { if (active) setSession(data.session) })
      .catch(() => { if (active) setSession(null) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  const value = useMemo<AuthState>(() => ({
    session,
    email: session?.user?.email ?? '',
    signOut: async () => { await supabase.auth.signOut() },
  }), [session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
