import type { Field, Region, RoleType } from '@/lib/api'
import { marketInfo, type Market } from '@/lib/markets'

const SOURCE_LABELS: Record<string, string> = {
  speedyapply: 'SpeedyApply', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', linkedin: 'LinkedIn',
  wellfound: 'Wellfound', ai_jobs: 'ai-jobs.net', jobspresso: 'Jobspresso', remote_rocketship: 'Remote Rocketship',
  internshipdaily: 'InternshipDaily', prosple: 'Prosple', simplify: 'Simplify', github: 'GitHub', handshake: 'Handshake',
  google_jobs: 'Google Jobs', indeed: 'Indeed', dice: 'Dice', yc: 'YC',
}

export function sourceLabel(source: string): string {
  const key = source.toLowerCase()
  if (SOURCE_LABELS[key]) return SOURCE_LABELS[key]
  return key.split(/[_-]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || source
}

export type ListKind = 'intern' | 'new-grad'

export interface CatalogList { kind: ListKind; roleType: RoleType; region: Region; label: string; region_label: string }

/** The two lists (internships, new grad) in the account's market. */
export function listsForMarket(market: Market): CatalogList[] {
  const m = marketInfo(market)
  return [
    { kind: 'intern', roleType: 'intern', region: m.region, label: 'Internships', region_label: m.regionLabel },
    { kind: 'new-grad', roleType: 'new_grad', region: m.region, label: 'New grad', region_label: m.regionLabel },
  ]
}

/**
 * URL kind → list in this market. Old links that named a region
 * ("intern-intl", "new-grad-intl") resolve to the same role type.
 */
export function listForKind(kind: string | undefined, market: Market): CatalogList | null {
  const base = String(kind ?? '').replace(/-(intl|india|usa)$/, '')
  return listsForMarket(market).find(l => l.kind === base) ?? null
}

/** Short "posted" label: "today", "3d ago", "Sep 21". Falls back to scraped date. */
export function postedLabel(postedAt: string | null, scrapedAt: string, now: number = Date.now()): string {
  const iso = postedAt || scrapedAt
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const days = Math.floor((now - t) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Listings per list in this market, from the per-source counts. */
export function countsByList(rows: { role_type: RoleType; region?: Region; n: number; swe?: number; ai?: number }[], market: Market, field?: Field): Record<ListKind, number> {
  const lists = listsForMarket(market)
  const out = { intern: 0, 'new-grad': 0 } as Record<ListKind, number>
  for (const r of rows) {
    const list = lists.find(l => l.roleType === r.role_type && l.region === (r.region ?? 'usa'))
    if (list) out[list.kind] += field ? (r[field] ?? 0) : r.n
  }
  return out
}

/** Visa label for a role, or null when the description hasn't been read. */
export function visaLabel(sponsorship: string | null | undefined, jdRead: boolean): { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } | null {
  if (sponsorship === 'sponsors') return { text: 'Sponsors visas', tone: 'success' }
  if (sponsorship === 'no_sponsorship') return { text: 'No sponsorship', tone: 'warning' }
  if (sponsorship === 'citizens_only') return { text: 'US citizens only', tone: 'danger' }
  return jdRead ? { text: 'Visa not stated', tone: 'neutral' } : null
}
