import type { RoleType } from '@/lib/api'

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

/** URL slug ↔ API role type. */
export const kindToRoleType = (kind: string | undefined): RoleType | null =>
  kind === 'intern' ? 'intern' : kind === 'new-grad' ? 'new_grad' : null
export const roleTypeToKind = (t: RoleType): 'intern' | 'new-grad' => (t === 'intern' ? 'intern' : 'new-grad')

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

/** Total listings per role type from the per-source counts. */
export function countsByType(rows: { role_type: RoleType; n: number }[]): Record<RoleType, number> {
  const out: Record<RoleType, number> = { intern: 0, new_grad: 0 }
  for (const r of rows) out[r.role_type] = (out[r.role_type] ?? 0) + r.n
  return out
}
