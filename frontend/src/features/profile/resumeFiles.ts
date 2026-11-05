import type { ResumeFile, ResumeFileUse } from '@/lib/api'
import { marketInfo, type Market } from '@/lib/markets'

export const KIND_LABEL: Record<ResumeFile['kind'], string> = {
  master: 'Master resume',
  tailored: 'Tailored for this role',
  uploaded: 'Your own upload',
  library: 'From your resume library',
}

/** "48 KB", "1.2 MB". */
const STALE_DAYS = 14

/** A master older than 2 weeks may be missing recent work. */
export const isStale = (at: string | null | undefined, now = Date.now()) =>
  Boolean(at) && now - new Date(at as string).getTime() > STALE_DAYS * 86_400_000

export function formatBytes(n: number | null | undefined): string {
  if (!n || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Which country an application belongs to: the role's own listing when we
 * have it, otherwise the account's country setting when the file was made.
 */
export function countryOf(use: Pick<ResumeFileUse, 'region' | 'market'>): Market {
  if (use.region === 'india') return 'india'
  if (use.region === 'intl') return 'other'
  if (use.region === 'usa') return 'usa'
  return marketInfo(use.market).value
}

export function countryLabel(m: Market): string {
  return marketInfo(m).regionLabel
}
