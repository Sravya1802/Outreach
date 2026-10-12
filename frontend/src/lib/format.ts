const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "5m ago", "3h ago", "2d ago", "3w ago", or a short date beyond ~2 months. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
  const diff = Math.max(0, now - then)
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`
  if (diff < 60 * DAY) return `${Math.floor(diff / (7 * DAY))}w ago`
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatNumber(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '0'
}

/** Percent of part/whole, rounded; 0 when whole is 0. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

export function greeting(date: Date = new Date()): string {
  const h = date.getHours()
  if (h < 5) return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Display name from an email: "jane.doe@x.com" → "Jane Doe". */
export function nameFromEmail(email: string | null | undefined): string {
  const local = (email ?? '').split('@')[0] ?? ''
  // Drop digits and 1-letter fragments: "e2e" or "j.doe99" shouldn't become "E E" / "J Doe".
  const words = local.replace(/\d+/g, ' ').split(/[\s._\-+]+/).filter(w => w.length > 1)
  if (!words.length) return 'there'
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + second).toUpperCase()
}
