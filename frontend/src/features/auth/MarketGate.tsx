import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/app/auth'
import { useProfile } from '@/app/queries'
import { qk } from '@/app/queryClient'
import { api } from '@/lib/api'
import { isMarket, type Market } from '@/lib/markets'
import { Button, PageSpinner } from '@/ui'
import { AuthLayout, FormMessage } from './AuthLayout'
import { MarketOptions } from './MarketOptions'

/**
 * Every account works in one job market. The choice made at sign-up lives in
 * the account's metadata until the profile exists; it's copied over here on
 * first sign-in. Accounts with no choice at all are asked once.
 */
export function MarketGate({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const profile = useProfile()
  const qc = useQueryClient()
  const [picked, setPicked] = useState<Market | null>(null)
  const fromSignUp = session?.user?.user_metadata?.job_market
  const saved = profile.data?.job_market

  const save = useMutation({
    mutationFn: (job_market: Market) => api.saveProfile({ job_market }),
    onSuccess: row => qc.setQueryData(qk.profile, row),
  })

  const copied = useRef(false)
  useEffect(() => {
    if (profile.isSuccess && !isMarket(saved) && isMarket(fromSignUp) && !copied.current) {
      copied.current = true
      save.mutate(fromSignUp)
    }
  }, [profile.isSuccess, saved, fromSignUp, save])

  // Never lock someone out because the profile call failed; lists fall back to USA.
  if (profile.isError || isMarket(saved)) return <>{children}</>
  if (profile.isLoading || (isMarket(fromSignUp) && !save.isError)) return <div className="flex h-full bg-canvas"><PageSpinner /></div>

  return (
    <AuthLayout title="Where are you looking for jobs?" subtitle="Role lists, alerts and auto-apply all follow this. You can change it later in Profile.">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (picked) save.mutate(picked) }}>
        <MarketOptions value={picked} onChange={setPicked} />
        {save.isError && <FormMessage tone="error">{(save.error as Error).message}</FormMessage>}
        <Button type="submit" variant="primary" className="w-full" disabled={!picked} loading={save.isPending}>Continue</Button>
      </form>
    </AuthLayout>
  )
}
