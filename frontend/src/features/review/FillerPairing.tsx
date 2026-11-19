import { useEffect } from 'react'
import { API } from '@/api.js'
import { api } from '@/lib/api'
import { apiOrigin, askFiller, hasFiller } from './ready'

/**
 * Pairs the filler extension with your account once per visit (the key lasts
 * 120 days, so any visit keeps it fresh): it can then open your ready roles
 * each morning and recognise a ready role's page you open yourself.
 */
export function FillerPairing() {
  useEffect(() => {
    let done = false
    const tryPair = async () => {
      if (done || !hasFiller()) return
      done = true
      try {
        const { key } = await api.extensionKey()
        await askFiller('pair', { key, api: apiOrigin(API) })
      } catch { done = false }
    }
    void tryPair()
    const t = setInterval(() => { void tryPair() }, 3000)
    return () => clearInterval(t)
  }, [])
  return null
}
