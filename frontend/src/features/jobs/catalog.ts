import type { Field, Region, RoleType } from '@/lib/api'

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

export interface CatalogList { kind: string; roleType: RoleType; region: Region; label: string; region_label: string }

/** The four lists SpeedyApply publishes, each its own tab and URL. */
export const LISTS: CatalogList[] = [
  { kind: 'intern', roleType: 'intern', region: 'usa', label: 'Internships', region_label: 'USA' },
  { kind: 'new-grad', roleType: 'new_grad', region: 'usa', label: 'New grad', region_label: 'USA' },
  { kind: 'intern-intl', roleType: 'intern', region: 'intl', label: 'Internships', region_label: 'International' },
  { kind: 'new-grad-intl', roleType: 'new_grad', region: 'intl', label: 'New grad', region_label: 'International' },
]

export const listForKind = (kind: string | undefined): CatalogList | null => LISTS.find(l => l.kind === kind) ?? null

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

/** Listings per list (role type × region) from the per-source counts. */
export function countsByList(rows: { role_type: RoleType; region?: Region; n: number; swe?: number; ai?: number }[], field?: Field): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(LISTS.map(l => [l.kind, 0]))
  for (const r of rows) {
    const list = LISTS.find(l => l.roleType === r.role_type && l.region === (r.region ?? 'usa'))
    if (list) out[list.kind] = (out[list.kind] ?? 0) + (field ? (r[field] ?? 0) : r.n)
  }
  return out
}
