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

/**
 * The opening date for the Posted column: "Oct 15" (plus the year when it isn't
 * this year) and how long ago. `known` is false when the source gives no posting
 * date and this is the day we first found the role.
 */
export function postedDate(postedAt: string | null, scrapedAt: string, now: number = Date.now()): { date: string; ago: string; known: boolean } | null {
  const iso = postedAt || scrapedAt
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  const days = Math.floor((now - t) / 86_400_000)
  const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`
  return { date, ago, known: Boolean(postedAt) && !Number.isNaN(new Date(postedAt as string).getTime()) }
}

/** The date in words, where there's no Posted column: "Posted Oct 15" / "First seen Oct 15". */
export function postedWords(p: { date: string; known: boolean }): string {
  return `${p.known ? 'Posted' : 'First seen'} ${p.date}`
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
