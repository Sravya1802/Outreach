// The AI usage line under "Your accounts" on Home.
import type { AiUsage } from '@/lib/api'

export type UsageTone = 'success' | 'warning' | 'danger' | 'neutral'

/** "$3.20 of $30 this month", coloured by how close you are to your monthly limit. */
export function aiUsageLine(u: AiUsage | undefined): { text: string; tone: UsageTone; pct: number } | null {
  if (!u) return null
  const cap = u.caps.user
  const spent = u.spent.mine
  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0
  const tone: UsageTone = cap <= 0 ? 'neutral' : pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'success'
  return { text: cap > 0 ? `$${spent.toFixed(2)} of $${cap.toFixed(0)} this month` : `$${spent.toFixed(2)} this month`, tone, pct }
}
